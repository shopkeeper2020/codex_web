# Official Client Runtime Evidence

状态：research notes  
日期：2026-06-02

本文件记录 Desktop 与 VS Code Codex 扩展的交互实现证据。目标是支撑 `codex_web` 的三端同步重构，不复制官方大段源码，只记录可验证路径、method 名与行为结论。

## 官方资源路径

官方 app-server 文档/源码：

- Codex manual helper：`C:\Users\user\AppData\Local\Temp\openai-docs-cache\codex-manual.md`
- OpenAI Codex app-server README：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server\README.md`
- OpenAI Codex app-server source：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server`
- OpenAI app-server protocol source/schema：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server-protocol`

Desktop：

- `C:\Program Files\WindowsApps\OpenAI.Codex_26.527.7698.0_x64__2p2nqsd0c76g0\app\resources\app.asar`
- asar 中确认到的相关 bundle：
  - `.vite/build/src-B5wXNbcV.js`
  - `.vite/build/src-DJzHq3CP.js`
  - `.vite/build/worker.js`
  - `webview/assets/app-server-manager-signals-Bpaj8VHp.js`
  - `webview/assets/appgen-settings-page-C8sa36D9.js`
  - `webview/assets/appgen-share-dialog-D_OmT21C.js`
  - `webview/assets/local-conversation-thread-B_mlgmQo.js`
  - `webview/assets/thread-actions-Cs8S1-Cm.js`

VS Code 扩展：

- `C:\Users\user\.vscode\extensions\openai.chatgpt-26.527.31454-win32-x64`
- 已确认相关文件：
  - `out\extension.js`
  - `webview\assets\app-server-manager-signals-D_Vend68.js`
  - `webview\assets\app-server-manager-hooks-DYidc9xW.js`
  - `webview\assets\local-conversation-thread-wr-Xbb7I.js`
  - `webview\assets\thread-actions-DVf650oD.js`

## 官方 app-server 证据摘要

### raw turn 参数边界

OpenAI Codex app-server README 和 `app-server-protocol` schema 确认：

- `turn/start` 的核心输入是 `threadId`、`input` 和可选 `clientUserMessageId`。
- `input` 支持官方 discriminated union：`text`、`image`、`localImage`、`skill`、`mention` 等。
- 图片本地文件应优先使用 `{ type: "localImage", path }`，避免把大段 data URL 当作 raw app-server 参数传输。
- 官方 `codex-rs/app-server-protocol/schema/typescript/v2/UserInput.ts` 显示 `localImage` 是独立 `UserInput` 分支，只需要 `type`、`path` 和可选 `detail`；不要求额外发送 `{ type: "text", text: "<image>" }` 占位。Web 发送链路不得生成该占位，否则会污染用户正文、会话标题和跨端展示；`<image>` 只允许作为旧缓存读取时的兼容过滤目标。
- `turn/steer` 需要 `threadId`、`expectedTurnId`、`input`，可选 `clientUserMessageId`；它不接受线程设置 override。
- `clientUserMessageId` 会回显到对应 `userMessage.clientId`，可作为跨端对齐用户消息的官方锚点。

结论：`attachments`、`restoreMessage` 是官方客户端 UI/IPC 恢复层字段，不属于 raw app-server `turn/start` / `turn/steer` 参数。Web 后端直接调用 app-server 时必须白名单化，只发送官方字段；转发给官方 follower 时可保留 Desktop/VS Code Webview 需要的恢复消息。

### Web-owned 新会话 live snapshot 边界

2026-06-02 复查官方手册和本地生成的 v2 schema 后确认：

- raw `thread/start` 的官方参数包含 `cwd`、`threadSource` 等，不包含 Desktop `start-conversation` 包装层里的 `workspaceRoots`。
- raw `thread/start` 返回的 `Thread.turns` 可以为空；官方 schema 也说明非 `thread/read(includeTurns)` / resume / rollback / fork 场景下 `turns` 可能为空。
- raw `turn/start` 之后 app-server 会发 `turn/started`、item delta、`turn/completed` 等生命周期通知。
- Desktop/VS Code 的三端实时展示不只依赖 raw app-server 通知，而依赖 owner 通过 `thread-stream-state-changed` IPC 广播完整 `conversationState`。
- Desktop 现场日志出现 `Received turn/started for unknown conversation`，说明 Web 本地 owner 在启动首轮 turn 前没有先让官方客户端看到完整 conversation state。
- 2026-06-02 续查发现，仅在首轮 `turn/start` 前广播 active snapshot 仍有空窗：`thread/start` 已经让新会话进入共享 app-server thread list，但 Web 若只 claim local-only owner、不广播 idle snapshot，Desktop 可能先打开一个没有 stream state 的新 conversation。
- 2026-06-02 再次现场复查 Desktop error boundary 和官方 v2 schema 后确认：广播给官方客户端的 live snapshot 不能只满足“能被 Web 渲染”，还必须补齐 `ThreadItem` 必需字段。首轮 pending `userMessage.clientId` 应与本轮 `turn/start.clientUserMessageId` 保持一致；如果没有生成 client id 才能为 `null`。真实 app-server snapshot 中的 `agentMessage`、`webSearch` 等 item 在经由 Web IPC owner 转发前也要补齐 `phase/memoryCitation`、`action.queries` 等 schema 默认值，避免 Desktop 侧栏或 live renderer 读取 `undefined.length`。

结论：Web 新建会话的 `thread/start` 参数本身不是 Desktop 崩溃根因；`thread/start` 成功后应立即广播一个 Desktop 可渲染的 idle snapshot，至少包含官方 `Thread` 必需字段、`status/threadRuntimeStatus: { type: "idle" }` 和 `turns: []`。Web-owned 本地 turn 路径还必须在调用 raw app-server `turn/start` 前，先广播一个 Desktop 可渲染的 active snapshot。该 snapshot 不可为空，至少需要官方 `Thread` 必需字段、`threadRuntimeStatus: { type: "active", activeFlags: [] }`、一个 `status: "inProgress"` 的 pending `Turn`、`itemsView: "full"`、`error/completedAt/durationMs: null`、符合 v2 `ThreadItem.userMessage` shape 的 pending `userMessage`（`clientId` 与 `clientUserMessageId` 对齐），以及 Desktop stream 额外读取的 `diff: []`、`hookRuns: []`、`commandExecutionStartedAtMsById: {}`。后续真实 app-server snapshot 再替换 pending turn，但经 Web owner 广播前仍必须做 schema-safe item normalization。

### thread settings 与权限能力

官方 README 和 source 确认：

- `thread/settings/update` 已是官方 experimental 方法，用于在不新增 turn、不添加 transcript item 的情况下更新 loaded thread 的下一轮设置；设置变更后会发 `thread/settings/updated`。
- `turn/start` settings override 也会更新 thread 的后续默认设置。
- `permissions` profile selection 是官方推荐的新权限选择方式；`sandboxPolicy` 仍兼容，但不能和 `permissions` 同时发送。
- `permissionProfile/list` 可列出内置或项目级 permission profile，例如 `:read-only`、`:workspace`、`:danger-full-access`。
- 内置 `request_permissions` 工具会发 `item/permissions/requestApproval` server request；客户端响应必须返回 `result.permissions`，可选 `scope: "session"`。

结论：Web-owned 线程收到官方 follower 的模型/推理/协作模式变更时，应调用 `thread/settings/update`，以 app-server loaded thread settings 作为唯一 next-turn 状态源。审批系统必须覆盖 `item/permissions/requestApproval`，不能只处理命令和文件审批。

2026-06-03 现场复查 Web 发起的金价会话后补充：

- 该会话的 raw app-server `thread/read(includeTurns:true)` 可正常读取，rollout 文件内没有 `settings` 字段异常；Desktop 报错是恢复/渲染 Web-owned live snapshot 时出现 `Cannot read properties of null (reading 'settings')`。
- 项目已记录的官方证据和当前 OpenAI Codex app-server README 均表明，Default 协作模式应省略 `collaborationMode`，Plan 等非默认模式才发送 `{ mode, settings }`。
- 因此 Web 的 official IPC broadcast normalizer 不能为了补齐 UI 字段写出 `latestCollaborationMode: null`，也不能在 turn `params` 中保留 `collaborationMode: null` 或 `{ mode: "default" }`。Default/空值应删除该字段；非默认模式若缺 `settings`，应补成空对象，避免 Desktop renderer 直接读取 `.settings` 时崩溃。
- 同一会话的 app-server 读取结果里还出现过 `webSearch.action: { type: "openPage", url: null }`。该字段进入官方 live renderer 前应归一为字符串 URL（空值用 `""`），避免后续页面/搜索工具展示路径再读到 `null`。

## Desktop 证据摘要

### 主进程 follower method -> renderer request

Desktop asar `.vite/build/src-B5wXNbcV.js` 中确认存在 follower method 到 renderer request 的映射：

| IPC method | Renderer request |
| --- | --- |
| `thread-follower-start-turn` | `thread-follower-start-turn-request` |
| `thread-follower-compact-thread` | `thread-follower-compact-thread-request` |
| `thread-follower-steer-turn` | `thread-follower-steer-turn-request` |
| `thread-follower-interrupt-turn` | `thread-follower-interrupt-turn-request` |
| `thread-follower-set-model-and-reasoning` | `thread-follower-set-model-and-reasoning-request` |
| `thread-follower-set-collaboration-mode` | `thread-follower-set-collaboration-mode-request` |
| `thread-follower-edit-last-user-turn` | `thread-follower-edit-last-user-turn-request` |
| `thread-follower-command-approval-decision` | `thread-follower-command-approval-decision-request` |
| `thread-follower-file-approval-decision` | `thread-follower-file-approval-decision-request` |
| `thread-follower-permissions-request-approval-response` | `thread-follower-permissions-request-approval-response-request` |
| `thread-follower-submit-user-input` | `thread-follower-submit-user-input-request` |

结论：Desktop 的宿主层显式承担 follower request 转发职责，Web 后端也必须承担同等职责。

### 主进程 IPC broadcast 转发

Desktop asar `.vite/build/src-B5wXNbcV.js` 中确认 renderer host message 会转发为 IPC broadcast：

- `thread-queued-followups-changed`
- `thread-stream-state-changed`
- `thread-read-state-changed`

结论：live stream、queued follow-ups、read state 都属于官方跨端同步面。

### owner predicate request handler

Desktop asar `.vite/build/src-DJzHq3CP.js` 中确认 request handler 注册时会先判断目标 conversation 在 renderer 中是否为 owner，再处理：

- `thread-follower-start-turn`
- `thread-follower-compact-thread`
- `thread-follower-steer-turn`
- `thread-follower-interrupt-turn`
- `thread-follower-set-model-and-reasoning`
- `thread-follower-set-collaboration-mode`
- `thread-follower-edit-last-user-turn`
- approval/user input/MCP elicitation 类 follower method

结论：follower request 不能被任意客户端处理，必须由 owner 处理。

### worker client status

Desktop asar `.vite/build/worker.js` 中确认存在 `client-status-changed` broadcast。

结论：owner 可达性是官方 runtime state，不应只靠 action 请求失败后临时推断。

### Webview host action

Desktop asar `webview/assets/appgen-share-dialog-D_OmT21C.js` 中确认 Webview host 层存在：

- `send-cli-request-for-host`
- `thread-follower-start-turn-for-host`
- `thread-follower-steer-turn-for-host`
- `thread-follower-interrupt-turn-for-host`
- `thread-follower-command-approval-decision-for-host`
- `thread-follower-permissions-request-approval-response-for-host`

结论：Webview 的 UI action 会经 host manager 进入 app-server 或 follower route，而不是 UI 自己直接调用 raw backend。

## VS Code 扩展证据摘要

### AppServerManager host RPC

VS Code `webview/assets/app-server-manager-signals-D_Vend68.js` 中确认 `AppServerManager.sendRequest()` 通过 `send-cli-request-for-host` 调用 app-server。

已确认 app-server RPC 用法：

- `thread/list`
- `thread/read`
- `turn/start`
- `turn/interrupt`
- 相关 runtime/model/skill/list/update 类方法

结论：app-server 是执行与持久化后端，但 Webview 仍通过宿主层调用。

### stream role 与 follower request

VS Code Webview manager 维护：

- `streamRoles`
- `streamingConversations`
- `getStreamRole()`
- `isConversationStreaming()`
- `sendThreadFollowerRequest()`

已确认 follower start 路径会优先发送 `thread-follower-start-turn`。若当前 thread 是 owner，则走本地 `turn/start`。

已确认 interrupt 路径会优先发送 `thread-follower-interrupt-turn`。owner 不可达时官方存在部分 resume/fallback 处理，但 Web 重构优先避免 active 分叉。

结论：start/steer/interrupt 都需要先经过 owner-aware router。

### follower mutation guard

VS Code Webview manager 中确认 follower 会忽略本地 app-server 的 live mutation 类通知。覆盖范围包括：

- `turn/*`
- `item/*`
- `thread/started`
- `thread/realtime/itemAdded`
- `thread/status/changed`
- `thread/tokenUsage/updated`
- `error`

结论：official-owned active thread 的 live source 必须是 owner IPC state，不能被 follower 本地 app-server notification 覆盖。

### pending request / approval forwarding

VS Code Webview manager 中确认以下 follower response method：

- `thread-follower-command-approval-decision`
- `thread-follower-file-approval-decision`
- `thread-follower-permissions-request-approval-response`
- `thread-follower-submit-user-input`
- `thread-follower-submit-mcp-server-elicitation-response`

结论：审批、用户输入、MCP elicitation 是 official live flow 的组成部分，Web 不能只同步 assistant 文本。

### client status 与 snapshot rebroadcast

VS Code Webview stream coordinator 注册：

- `thread-stream-state-changed`
- `client-status-changed`
- conversation patch listener

已确认 owner 会 broadcast conversation snapshot；follower 会根据 owner 可达性标记 needs-resume。

结论：Web 后端需要保存 client status、ownerClientId、snapshot/cacheVersion、needs-resume/hydrate reason。

### IPC client discovery frame shape

VS Code `out/extension.js` 现场版本 `26.5527.31454` 中确认：

- Router 发出的 discovery frame 是 `{ type: "client-discovery-request", requestId, request }`，其中 `request` 子对象才包含 follower `method`、`version` 和 `params`。
- Client 回复 discovery frame 是 `{ type: "client-discovery-response", requestId, response: { canHandle } }`。
- Router 在 `handleClientDiscoveryResponse` 中读取 `response.canHandle`。

结论：Web bridge 不能只按旧研究里的顶层 `method/version/params` 读取 discovery request，也不能只返回顶层 `canHandle`。否则官方 VS Code 扩展会在 `handleClientDiscoveryResponse` 里读取 `undefined.canHandle` 并显示“未知错误”。

### 2026-06-02 Desktop renderer 与广播噪声

现场新建天气会话 `019e886f-3dc1-7141-b1a2-db4f0be7222d` 后，Web server `/api/domain/thread-detail` 只有 200 轮询；VS Code 扩展此前的 `undefined.canHandle` 报错停止在 discovery shape 修复前。最新扩展日志主要剩余大量 `Received broadcast but no handler is configured method=thread-stream-state-changed`，说明重复 snapshot 广播会制造日志风暴，但不是 discovery 硬崩。

同一时间 Desktop Sentry 面包屑中，红屏前最后的明确 renderer 错误是 `Could not find the language 'powershell', did you forget to load/include a language module?`，且关联的是打开排障长会话时的渲染路径，不是天气会话的 raw app-server `thread/start` / `turn/start` 请求失败。Web 闪烁则来自前端实时 reducer 与 domain 归一化不一致：`item/started` 阶段的 `mcpToolOutput` / `webSearch` 先落到 unknown，后续 thread detail 轮询再变成折叠工具组。

再次复现时，Desktop 已成功 `thread/resume` 新线程 `019e888a-1d72-7962-84d2-e17a2af561ba`，`thread/read` 正常；红屏仍发生在恢复/渲染排障长线程 `019e8854-4ea7-7e32-a978-e65d2b88c240` 后。该长线程 rollout 与 Web 广播缓存中包含行首 ````powershell` Markdown fence，官方 Desktop 加载 `highlight-code` 后尝试使用 `powershell` 语言并报错。Web 的协议缓存若直接保存或转发这类官方 snapshot，会让 Desktop 反复进入 error boundary。

结论：保留官方 IPC/request shape 修复；前端实时 reducer 需要与 domain 的 tool/webSearch 识别对齐；协议层应对完全相同的 Web-owned snapshot 做去重以降低扩展端广播噪声；所有进入/发出 official stream cache 的 conversation state 需要把官方 Desktop 不支持的 Markdown fence 语言降级为安全语言。当前只将行首 `powershell` fence 降级为 `text`，不修改原始 rollout，也不改普通正文、命令和 diff 字符串。

### 2026-06-03 Web-owned 新 thread 的 Desktop 侧栏刷新

现场对比 Web 新建的青岛天气 thread 与 VS Code 扩展新建的上海天气 thread 后确认：两者都已及时持久化到官方 `state_5.sqlite`，`thread/list` 能读到；Web 侧慢的是 Desktop webview 内存里的 recent-list。

Desktop `webview/assets/app-server-manager-signals-*.js` 中确认：

- `thread-stream-state-changed` snapshot handler 会把外部 owner 的 conversation state 写入 `threadStore.setConversation(...)`，标记 streaming，并通知该 conversation 自身 callbacks。
- 该 snapshot handler 不调用 `ensureRecentConversationId(...)`，也不调用 any-conversation/recent-list callbacks，因此陌生 thread 不会仅凭 stream snapshot 立即进入 Desktop 侧栏。
- Desktop 自己的 `thread/started` app-server notification 会走 `upsertConversationFromThread(...)`，其中会调用 `ensureRecentConversationId(...)`。
- `thread-unarchived` IPC broadcast 会进入 `handleThreadUnarchived(...)`，该路径调用 `refreshRecentConversations()`。

结论：Web-owned 新 thread 的实时内容同步和 Desktop recent-list 刷新是两条不同路径。Web 必须先广播 schema-safe idle snapshot，确保 Desktop 打开该 thread 时能渲染；随后可以发送 `thread-unarchived` 生命周期广播作为 recent-list refresh 触发。不要尝试直接调用 `refresh-recent-conversations-for-host`，它是 Desktop webview 到宿主的私有 host action，不是 IPC bus API。不要伪造 app-server `thread/started` notification。

### IPC method version map

VS Code `out/extension.js` 中确认 method version map：

| Method | Version |
| --- | ---: |
| `thread-stream-state-changed` | 6 |
| `thread-read-state-changed` | 1 |
| `thread-archived` | 2 |
| `thread-unarchived` | 1 |
| `thread-follower-start-turn` | 1 |
| `thread-follower-compact-thread` | 1 |
| `thread-follower-steer-turn` | 1 |
| `thread-follower-interrupt-turn` | 1 |
| `thread-follower-set-model-and-reasoning` | 1 |
| `thread-follower-set-collaboration-mode` | 1 |
| `thread-follower-edit-last-user-turn` | 1 |
| `thread-follower-command-approval-decision` | 1 |
| `thread-follower-file-approval-decision` | 1 |
| `thread-follower-permissions-request-approval-response` | 1 |
| `thread-follower-submit-user-input` | 1 |
| `thread-follower-submit-mcp-server-elicitation-response` | 1 |
| `thread-follower-set-queued-follow-ups-state` | 1 |
| `thread-queued-followups-changed` | 1 |

结论：`packages/protocol` 应把这张表作为兼容性基线。

### app-server notification importance

VS Code `out/extension.js` 中确认存在 notification importance map。

主 UI/stream 关键通知类别：

- thread/turn/item lifecycle
- assistant/reasoning/plan delta
- command/file output delta
- server request resolved
- MCP progress
- realtime thread events
- archive/unarchive/goal/skills

非主 UI 驱动类别：

- raw response item completed
- legacy process/command output
- 多数 raw `codex/event/*`
- thread closed/settings/compacted
- warning 与部分环境噪声

结论：Web 后端不应把所有 app-server notification 都触发为 detail refetch；需要分类、归一化、限流。

## 对 codex_web 的直接约束

- Web 后端必须复刻官方宿主层，而不是让浏览器直接调用官方 raw protocol。
- official-owned active thread 以 owner IPC state 为 live source。
- Web-owned active thread 才由本地 app-server notification 发布 official stream。
- follower 对 active turn/item 类 notification 必须 guard。
- follower request 必须覆盖 start、steer、interrupt、compact、model/reasoning、collaboration mode、edit last user turn、审批、用户输入、MCP elicitation、queued follow-ups。
- app-server `thread/read` 是 cold load、hydrate、completion convergence 工具，不应成为 active stream 的主刷新机制。
- Browser realtime 应推 domain event，polling 只作为断线兜底。
