# SQLite 不能成为官方数据的影子后端

## 现象

`data/codex_web.sqlite` 和 WAL 文件持续膨胀，Web 端打开长会话或官方 live 会话时明显变慢，甚至出现 18930 端口已监听但 HTTP 请求超时。

## 根因

Web 后端曾把 app-server / 官方 IPC 已经能读取的数据长期写入 SQLite：

- `official_stream_states.conversation_state_json` 保存完整官方 `conversationState`。
- `thread_details.detail_json` 保存归一化后的完整会话详情。
- `threads` / `projects` 保存官方 `thread/list` 可重新读取的投影。

这些数据不是 Web 的真实所有权数据，而是官方 app-server 和 Desktop/VS Code IPC 的派生状态。长期落盘会形成第二套“影子后端”，既容易膨胀，也容易和官方状态打架。

## 影响范围

- 长会话、含大量命令输出/文件 diff 的会话。
- 正在流式输出的 Desktop/VS Code owned 会话。
- Web 后端重启后恢复旧 stream cache 的路径。
- SQLite WAL 模式下，历史大 JSON 即使删除也需要 checkpoint/VACUUM 才会真正瘦身。

## 最终解决方案

- SQLite 只保存 Web 自定义状态，例如附件元数据、置顶、本地配置相关索引。
- 会话列表、会话详情、官方完整 `conversationState` 不再长期写入 SQLite。
- 官方 live stream state、owner、patch base 只保存在内存中，作为实时同步运行态。
- 启动时清理历史派生缓存表：`projects`、`threads`、`thread_details`，并删除旧库里的 legacy `official_stream_states` 表，然后执行存储压缩。
- 如果 app-server/official IPC 可重新读取，就不要把数据落进 SQLite。

## 后续避免方式

- 新增接口前先判断数据所有权：官方能读的用官方接口读，Web 自己拥有的才持久化。
- 不要为了“兜底”长期保存完整 thread/detail/conversationState。
- 崩溃/重启恢复不要落 SQLite metadata；先等待官方 IPC snapshot，或走 `patches-without-snapshot -> thread/read` 只读 hydrate 补内存基线。
- 性能排查时同时看 SQLite 主文件、WAL 文件和大 JSON 字段体积。
