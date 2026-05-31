# Stale Official Owner Client ID

## 现象

Desktop 或 VS Code 扩展重启后，Web 侧仍能看到 thread 列表和 IPC connected，但 Web 对 active turn 的 steer/interrupt 或发送 follower 请求可能失败。`/api/sync/readiness` 的 `recentFollowerRequests` 里会出现定向到旧 `targetClientId` 的 `thread-follower-*` error。

## 根因

`thread-stream-state-changed` snapshot 会把当前 owner 的 `sourceClientId` 缓存在 Web bridge 中。官方客户端重启后 client id 会变化，旧 snapshot 里的 owner id 可能已经失效。如果 Web 继续带着旧 `targetClientId` 发 request，官方 IPC router 不一定能把请求送到新的 owner。

## 影响范围

- 官方-owned thread 的 `thread-follower-start-turn`
- active turn 的 `thread-follower-steer-turn`
- active turn 的 `thread-follower-interrupt-turn`

这个问题只影响定向 follower 请求；它不代表 app-server、命名管道或 thread list 一定坏了。

## 最终解决方案

`packages/protocol/src/index.ts` 中的 follower start/steer/interrupt 现在使用同一个受限重试路径：

1. 如果有缓存 owner，先带 `targetClientId` 定向发送。
2. 如果定向请求失败形态像路由/目标 client 失效，例如 generic `official-ipc-request-failed:<method>`、`no-client*`、target-client、timeout 或 disconnect，则追加一次不带 `targetClientId` 的 discovery 请求。
3. 如果 owner 返回明确业务错误，例如拒绝 steer，则不重试、不 fallback 到本地 app-server，避免重复 turn。

协议测试 `packages/protocol/src/officialIpc.test.ts` 覆盖了 stale target 失败后通过 discovery 成功恢复的路径。

实测中也可能出现 direct target 和 discovery 都返回 generic `official-ipc-request-failed:thread-follower-*` 的情况。服务端 fallback policy 必须继续把它当作 owner/routing 不可用，而不是普通 502：已知官方状态的 thread 返回 `official-owner-unavailable`/409，未知 owner 状态返回 `official-owner-required`，两者都不能静默调用本地 app-server。

## 后续避免方式

- 排查三端同步问题时先看 `/api/sync/readiness` 和 `/api/official-ipc/status.recentFollowerRequests`。
- 如果看到先 error 后同 thread 的 discovery success，这通常表示旧 owner id 已被恢复，不应再按同步失败处理。
- 如果 discovery 也失败，再要求用户在 Desktop 或 VS Code 打开目标 thread，并检查协议版本、handler 注册状态和 `/api/official-ipc/status.recentFollowerRequests` 中的 error 形态。
