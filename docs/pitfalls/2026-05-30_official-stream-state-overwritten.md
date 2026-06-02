# 官方流状态被只读回填覆盖

## 现象

Web 已连接官方 IPC，`/api/official-ipc/status` 正常，但 Desktop 正在执行时 Web 端看不到流式输出，或者 thread 列表显示进行中，打开详情后又变成非进行中。

## 根因

官方 Desktop 的 `thread-stream-state-changed` 有时先给到 active turn 的空壳，Web 后端会再调用 app-server 做只读 `thread/read` 补详情。旧实现把只读结果直接回灌到官方 IPC 缓存；如果 app-server 这次读到的是旧快照或 `completed/notLoaded` 状态，就会把原本的 `isInProgress=true` 和 `activeTurnId` 覆盖掉。

另一个相关问题是：当 Web 后端在 Desktop 输出中途重启时，可能先收到 `patches-without-snapshot`。恢复逻辑会读取 app-server，但 app-server 返回 `{ thread: ... }` 包装结构时，旧实现把外壳直接塞进 IPC 缓存，导致 `readIsInProgress` 看不到内部 turns。

2026-05-30 又确认了同一类问题的第三个触发条件：官方 stream cache 只存在内存里。`18930` 在 Desktop 正在流式输出期间重启后，Web 会丢失完整 snapshot；官方端不保证给后来加入的 Web 补发当前 active snapshot，后续从 VS Code 或 app-server 得到的 `notLoaded`/非 active 快照还可能把 Web 端判断带偏。

## 影响范围

- Desktop/VS Code 作为官方 owner，Web 只作为 follower 的会话。
- Web 后端重启、浏览器刷新、或官方 snapshot/patch 到达顺序不完整时更容易出现。
- 影响流式输出、进行中状态、主动轮询和引导入口。
- `cachedConversationCount=0` 或 thread readiness 显示 `hasOfficialStreamState=false` 时，Web 只能读历史，不能可靠跟随当前流式输出。

## 最终解决方案

- `thread-detail` 的 app-server 只读回填只补内容，不抹掉官方 live 状态。
- 如果官方 IPC state 仍是 `isInProgress=true`，但 app-server 详情是旧状态，则在回灌前保留/恢复 `status: active`、`threadRuntimeStatus.type: active` 和 `activeTurnId` 对应 turn。
- `patches-without-snapshot` 恢复时先解包 `{ thread: ... }`，只把真实 thread snapshot 注入官方流缓存。
- WebSocket `connected` 后立即刷新 thread 列表、当前详情和审批状态，避免重连后页面停在旧状态。
- 早期曾把官方 stream cache 落盘到 SQLite 的 `official_stream_states` 表并在启动时恢复；2026-06-02 后该做法已废弃，SQLite 不再长期保存完整官方 `conversationState`，live stream cache 只作为内存运行态。
- 协议层拒绝用明显陈旧的非 active snapshot 覆盖现有 active state，尤其是 `status: notLoaded` 或来自不同 source client 的非 active 快照。

## 后续避免方式

- 所有“只读补水/兜底读取”都不能直接覆盖官方 live state。
- 对 `thread/read` 返回值统一先做 `asRecord(result)?.thread ?? result` 解包。
- 增加回归测试覆盖“官方 active + app-server stale”和“patches without snapshot + wrapped thread result”。
- 重启或热更新 `18930` 后，要检查 `/api/official-ipc/status` 的连接和 live cache 状态，以及 `/api/sync/readiness?threadId=...` 的 owner/active tail，不能只看 `/health`。
- 不要再把完整 official stream state 写回 SQLite；需要恢复能力时必须设计小型、短 TTL、限大小的 active metadata。
