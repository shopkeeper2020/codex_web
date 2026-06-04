# Web 新建会话导致 Desktop 报错与侧栏同步慢

## 现象

- 从 Web 新建会话并发送第一条消息时，官方 Desktop 可能进入 error boundary，显示“糟糕，出错了”。
- 新会话首条消息也可能在 Web 端直接失败，提示 `no rollout found for thread id ...`。
- 修复报错后，Web 新建的会话已经能在 Desktop 打开和渲染，但 Desktop 侧栏不会立刻出现该会话，通常要等一段时间、重启 Desktop，或 Desktop 自己刷新最近会话列表后才出现。
- VS Code 扩展新建会话时，Desktop 侧栏同步明显更快。

## 根因

这是两个相邻但不同的问题。

第一类报错来自 Web-owned `thread-stream-state-changed` snapshot 不够像官方 Desktop 内部的 live conversation state。官方 Desktop 的侧栏和本地任务行会读取一些 UI 默认字段，例如 `requests.length`、turn `diff/hookRuns/commandExecutionStartedAtMsById`、message `clientId`、agent message `phase/memoryCitation`、`turnsPagination`、`workspaceKind` 等。Web 直接广播 app-server 原始或半成形快照时，Desktop renderer 可能读到 `undefined.length` 并进入 error boundary。

2026-06-03 复现的“Cannot read properties of null (reading 'settings')”属于同一类 live snapshot 形状问题的一个具体变体：Web normalizer 曾把 Default/空协作模式补成 `latestCollaborationMode: null`，而官方证据要求 Default 模式完全省略 `collaborationMode`。Desktop 恢复 Web-owned 会话时会沿 live state 读取协作模式的 `.settings`，因此读到 `null` 会直接崩溃。该问题不在 raw app-server rollout，`thread/read(includeTurns:true)` 能正常返回。

2026-06-03 复现的新会话 `no rollout found for thread id ...` 是另一条官方 lifecycle 边界：OpenAI Codex app-server README 明确 `thread/start` 用于新会话，`turn/start` 用于发送用户输入，`thread/resume` 用于继续已有会话。Web 在 `thread/start` 后、首轮 `turn/start` 前如果先调用 `thread/resume`，而此时 rollout 还没有 materialize，就会把一个新空 thread 误走成“恢复已持久化会话”，从而报 no rollout。

第二类“侧栏同步慢”不是持久化失败。现场确认 Web 新建的 thread 已经立即写入官方 `state_5.sqlite`，`thread/list` 能读到。慢的是 Desktop webview 内存里的 recent-list。官方 Desktop 对外部 owner 发来的 `thread-stream-state-changed` snapshot 只执行：

- `setConversation(...)`
- `markConversationStreaming(...)`
- `notifyConversationCallbacks(conversationId)`
- `setConversationStreamRole(... follower ...)`

这条路径不会调用 `ensureRecentConversationId(...)`，也不会通知 any-conversation/recent-list callbacks。官方 owner 自己创建会话时则会通过本地 app-server `thread/started` 通知进入 `upsertConversationFromThread(...)`，该路径会调用 `ensureRecentConversationId(...)`。这解释了为什么 VS Code 扩展创建会话更快，而 Web-owned 新会话要等 Desktop 自己 refresh。

## 影响范围

- 只影响 Web-owned 新 thread 或 Web-owned live snapshot 广播。
- official-owned thread 的 follower start/steer/interrupt 路径不应因此改成本地 app-server fallback。
- app-server `thread/start` / `turn/start` raw RPC 参数本身不是这次问题的根因，清洗时不要把 UI/IPC 包装字段混入 raw RPC。

## 最终解决方案

1. Web 创建 thread 时，raw app-server `thread/start` 只发送官方字段：`cwd` 和 `threadSource: "user"`。
2. `thread/start` 成功后，Web 立即建立 Web-owned idle snapshot，并通过 `thread-stream-state-changed` 广播给官方客户端。这个 snapshot 必须补齐 Desktop UI 安全字段：
   - top-level：`status`、`threadRuntimeStatus`、`requests: []`、`title/name`、`hasUnreadTurn`、`resumeState`、`latest*`、`currentPermissions`、`workspaceKind`、`workspaceBrowserRoot`、`projectlessOutputDirectory`、`turnsPagination`
   - turns/items：`itemsView`、`diff: []`、`hookRuns: []`、`commandExecutionStartedAtMsById: {}`、`durationMs`、`completedAt`、`userMessage.clientId`、`agentMessage.phase`、`agentMessage.memoryCitation`
3. 首轮 `turn/start` 前再广播 active pending snapshot，pending `userMessage.clientId` 要和 `clientUserMessageId` 对齐。
4. 如果该 thread 是 Web-owned 且当前 stream state 明确是空 `turns: []`，首轮本地执行只调用官方 `turn/start`；已有/非空 thread 继续先 `thread/resume` 再 `turn/start`。
5. Web 新建 thread 并成功广播 idle snapshot 后，再发送官方 IPC `thread-unarchived` 生命周期广播。对于新 thread，这不是数据变更，而是借用官方 Desktop 已存在的 `handleThreadUnarchived(...) -> refreshRecentConversations()` 路径，提醒 Desktop 刷新 recent-list。
6. Default/空协作模式在 live snapshot 中一律省略：删除 top-level `latestCollaborationMode` 以及 turn `params.collaborationMode: null` / `{ mode: "default" }`。非默认模式才保留，并保证 `settings` 是对象；`webSearch.openPage/findInPage` 的 `url`/`pattern` 进入 Desktop 前也要归一为字符串。

当前关键实现锚点：

- `packages/protocol/src/index.ts`
  - `normalizeOfficialBroadcastConversationState(...)`
  - `normalizeOfficialBroadcastTurn(...)`
  - `normalizeOfficialBroadcastThreadItem(...)`
  - `OfficialIpcBridge.broadcastConversationSnapshot(...)`
  - `OfficialIpcBridge.broadcastThreadUnarchived(...)`
- `apps/server/src/app.ts`
  - `buildIdleLocalThreadSnapshot(...)`
  - `buildPendingLocalTurnSnapshot(...)`
  - `/api/domain/thread/start`

## 后续避免方式

- 修改 official IPC / app-server raw shape 前，必须重新核对官方 app-server 文档、生成的 `app-server-protocol` schema，以及当前 Desktop/VS Code bundle 行为。
- 不要把 Desktop 私有 Webview host action 当成 IPC bus API。`refresh-recent-conversations-for-host` 是 Desktop webview 调宿主的私有 action，Web 后端不能直接发给 Desktop。
- 不要伪造 app-server notification `thread/started` 给 Desktop。当前可接受的刷新触发是官方 IPC 生命周期广播 `thread-unarchived`，且只用于 Web 新建 thread 后的 recent-list refresh。
- 不要用 `null` 作为“官方字段已补齐”的占位。对官方 Default/缺省语义，优先省略字段；只有 Desktop UI 明确需要数组/对象默认值时，才补 `[]` 或 `{}`。
- 清洗冗余尝试时，优先保留 schema-safe snapshot 归一化、idle snapshot、pending snapshot、`thread-unarchived` recent refresh 这四个最小闭环；其他诊断、重复广播、实验性 owner 猜测逻辑可以逐项用测试和手测回退验证。
