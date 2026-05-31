# Desktop active turn 有状态但 items 为空

## 现象

Web 的 `/api/official-ipc/status` 显示 connected，`/api/official-thread-stream-state` 也能读到 `isInProgress=true` 和 `threadRuntimeStatus.type=active`，但页面看不到 Desktop 正在流式输出的内容，列表里的进行中状态也可能不更新。

## 根因

官方 Desktop 某些 live snapshot 会把当前运行态放在 `threadRuntimeStatus` / active turn 元数据里，同时最后一个 active turn 的 `items` 暂时为空。旧的 `/api/domain/thread-detail` 只判断官方 detail 里历史 turns 非空，就直接返回 `official-ipc` 详情；结果 Web 拿到的是“有 active turn id、没有 active items”的半截尾巴，不再走 app-server `thread/read` 只读回读补齐。

列表还有另一个独立问题：`/api/domain/threads` 主要来自 app-server 的 thread/list 投影，旧实现只补 owner，不用 official stream cache 覆盖 `inProgress`，所以详情已经 active 时列表行仍可能是完成态。

## 影响范围

- Desktop 或 VS Code 作为 owner 正在执行的 external-owned thread。
- Web 后端重启、浏览器后打开，或官方 snapshot/patch 先后顺序让 Web cache 拿到 partial active tail 的场景。
- WebSocket 事件漏掉时，前端没有 active detail 轮询兜底，会进一步放大“页面停住”的体感。

## 最终解决方案

- `apps/server/src/app.ts` 增加 `detailHasEmptyActiveTurn()`，当 external-owned official detail 出现 active turn 但 `items=[]` 时，改走 app-server `thread/read` 只读返回，并 hydrate official stream cache；不写 SQLite detail cache、不广播、不声明 Web owner。
- `apps/server/src/app.ts` 的 thread list 增加 official stream cache overlay，把当前页 thread 的 owner、`inProgress` 和 active `updatedAtIso` 覆盖到 app-server list 上。
- `apps/web/src/app/hooks/useRuntimeData.ts` 在当前 thread active 时每 1.5 秒轻量刷新 detail/list/approvals，作为 realtime/WebSocket 漏事件兜底。
- `apps/server/src/threadDetailRoute.test.ts` 和 `apps/server/src/threadListRoute.test.ts` 增加回归覆盖。

## 后续避免方式

官方协议中的 live state 不能只按 `turns[].items` 判断是否完整。凡是 `threadRuntimeStatus` 或 active turn id 表明正在执行，但 active turn 内容为空，都应视为 partial snapshot，并从官方 app-server 只读补底或等待后续 patch，而不是把空尾巴缓存成最终 Web detail。
