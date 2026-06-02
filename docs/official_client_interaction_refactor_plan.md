# 官方客户端交互逻辑复刻与 Web 改造方案

状态：research-backed refactor plan  
日期：2026-06-02

## 目标

`codex_web` 的目标不是做一个“能调用 Codex app-server 的网页”，而是成为第三个官方风格前端：

```text
Codex Desktop
VS Code Codex Extension
codex_web
```

三端应围绕同一条 thread 看到同一条用户消息、同一段 assistant stream、同一批审批/用户输入/停止/引导结果，并且切换平台继续提问时不分叉、不变慢、不报错。

## 核心结论

用户的理解大方向是对的：app-server 才是真正执行、持久化、鉴权和资源枚举的后端，Desktop 和 VS Code 扩展都是前端/宿主。

但官方前端并不是“各自只连 app-server”。官方还有一层实时协同编排：

```text
官方 Webview UI
  -> AppServerManager
  -> 宿主层：Desktop main / VS Code extension host
  -> app-server JSON-RPC

官方宿主层
  -> \\.\pipe\codex-ipc
  -> thread-stream-state-changed broadcast
  -> thread-follower-* request routing
```

所以 Web 的完美复刻应同时复刻两件事：

- app-server RPC 的使用方式：`thread/list`、`thread/read`、`turn/start`、`turn/steer`、`turn/interrupt`、`model/list`、`skills/list` 等。
- 官方前端间的实时同步方式：IPC owner/follower、stream state snapshot/patch、follower request、owner handoff。

只对接 app-server 可以读写持久状态，但不能保证 live stream 和三端交替操作像官方一样流畅。

## 本轮调研依据

本机已定位官方资源：

- Desktop：`C:\Program Files\WindowsApps\OpenAI.Codex_26.527.7698.0_x64__2p2nqsd0c76g0\app\resources\app.asar`
- VS Code 扩展：`C:\Users\user\.vscode\extensions\openai.chatgpt-26.527.31454-win32-x64`
- 证据索引：`documentation/protocol/official_client_runtime_evidence.md`

关键发现：

- Desktop asar 内存在同源 Webview 资源：`webview/assets/app-server-manager-signals-*.js`、`local-conversation-thread-*.js`、`thread-actions-*.js`。
- VS Code 扩展中也存在同源模块：`webview/assets/app-server-manager-signals-D_Vend68.js`、`app-server-manager-hooks-DYidc9xW.js`。
- 官方 Webview 的 `AppServerManager` 会直接使用 `thread/read`、`thread/list`、`turn/start`、`turn/interrupt` 等 app-server RPC。
- 同一套 manager 也维护 `streamRoles`，区分 owner/follower，并在 follower 场景通过 `thread-follower-*` 转发给 owner。
- Desktop main 层将 IPC follower method 映射成 renderer request，例如 `thread-follower-start-turn-request`、`thread-follower-steer-turn-request`、`thread-follower-interrupt-turn-request`。
- 官方 method version map 比我们当前 MVP 矩阵更完整，除 start/steer/interrupt 外，还包括 approval decision、user input、MCP elicitation、queued follow-ups 等 follower 能力。
- VS Code extension host 中存在 app-server notification 重要性表：高频内容增量、turn/item 状态、approval/server request、realtime 状态会进入重要路径；原始 Codex event、raw response、旧 process output、部分 settings/closed/compacted 通知不会作为主 UI 驱动。
- Desktop asar 的主进程/worker 包中存在 `thread-follower-*` request handler 注册、`thread-stream-state-changed` 广播转发、`client-status-changed` 广播，以及 Webview 到 host 的 `*-for-host` 执行函数。
- 官方 app-server README/source/schema 确认 `turn/start` / `turn/steer` raw RPC 不接受 Web UI 的 `attachments` / `restoreMessage` 包装字段；这些字段只能停留在 official follower / UI 恢复层，直接打 app-server 时必须白名单化为官方字段。
- 官方 app-server 已实现 `clientUserMessageId`、`localImage`、`thread/settings/update`、`permissionProfile/list` 和 `item/permissions/requestApproval`；Web 不应再为这些能力自建另一套不兼容逻辑。

## app-server 对接硬性流程门禁

任何 app-server / official IPC / raw RPC / follower request 改动，都必须先完成官方资料核对，再进入实现：

- 第一来源是 OpenAI 官方 Codex app-server 文档，用于确认官方入口、能力边界和当前术语。
- 字段级判断必须再回到官方 `codex-rs/app-server` 源码、README 和 `app-server-protocol` schema/source，不能只参考 Desktop/VS Code 打包产物中的私有包装字段。
- 已由官方实现的能力必须优先复用，例如 `clientUserMessageId`、`localImage`、`thread/settings/update`、`permissionProfile/list` 和各类 approval request；不要在 Web 侧自建另一套 parallel protocol。
- 实现前要把证据路径、method/field 结论和 Web 转换策略记录到本方案或 `documentation/protocol/official_client_runtime_evidence.md`。
- 没有完成上述核对时，不允许把新字段透传到 app-server，也不允许用“看起来 Desktop 这么传”的方式猜 raw RPC。

## 用户已确认决策

- 本次不是小补丁，而是底层交互的大重构。
- 目标是严格对标 Desktop 和 VS Code 扩展的流畅跨端交互。
- 可以先把当前本地代码做 checkpoint commit，再进入大改。
- fallback 不是硬性目标。为了不分叉、不误开 turn，active owner 不可达时可以优先明确失败。
- Web 端应作为第三个官方风格前端，而不是轮询 app-server 的薄网页。

## 官方实现细节约束

### 1. 宿主层是官方前端的核心，不只是 UI 外壳

官方 Webview 的 `AppServerManager.sendRequest()` 并不直接联网，而是把请求交给宿主层的 `send-cli-request-for-host`。宿主层再调用 app-server JSON-RPC。Desktop 和 VS Code 的区别只是宿主实现不同：

- Desktop：Electron main/worker 负责 IPC client、renderer request、app-server request client。
- VS Code：extension host 负责 IPC client、Webview bridge、app-server request client。
- Web 应对应实现自己的 `WebHostRuntime`，承担同样职责，而不是让浏览器直接理解官方 raw protocol。

### 2. follower request 是主路径，不是可选优化

官方 follower 发送动作时，会先通过 `sendThreadFollowerRequest()` 定向给 owner client。Desktop 主进程注册 request handler 时还会先检查该 conversation 在目标 renderer 中是否为 owner。

这意味着 Web 后端必须把 owner 路由做成底层能力：

| 动作 | official-owned thread | Web-owned thread |
| --- | --- | --- |
| start turn | `thread-follower-start-turn` | 本地 `turn/start` |
| steer turn | `thread-follower-steer-turn` | 本地 steer/start 语义由 Web owner 决定 |
| interrupt | `thread-follower-interrupt-turn` | 本地 `turn/interrupt` |
| compact | `thread-follower-compact-thread` | 本地 compact |
| model/reasoning | `thread-follower-set-model-and-reasoning` | 本地更新运行配置 |
| collaboration mode | `thread-follower-set-collaboration-mode` | 本地更新运行配置 |
| edit last user turn | `thread-follower-edit-last-user-turn` | 本地 rollback/replacement |
| approvals/user input/MCP elicitation | 对应 `thread-follower-*` response | 本地 server request response |

### 3. follower 会忽略本地 app-server 的 turn/item mutation

官方 Webview 中有 follower mutation guard：当 thread 是 follower 时，`turn/*`、`item/*`、`thread/started`、`thread/realtime/itemAdded`、`thread/status/changed`、`thread/tokenUsage/updated`、`error` 等本地 app-server 通知不应直接改写该 thread 的 live UI。

这点非常重要。它解释了 Desktop/扩展为什么不会在同一 active thread 上被 app-server 持久状态和 owner stream 互相覆盖。

Web 必须复刻：

- official-owned active thread：owner IPC state 是 live source。
- follower 收到 app-server notification：只作为诊断、冷启动补底、完成收敛候选，不能覆盖 active owner state。
- Web-owned active thread：Web 本地 app-server notification 才能进入 owner stream publishing。

### 4. 官方 app-server notification 有筛选策略

官方 extension host 维护 notification importance map。它不是把 app-server 每个事件都同等推给 UI，而是分层处理。

主 UI/stream 关键通知：

- `thread/started`、`thread/name/updated`、`thread/tokenUsage/updated`
- `turn/started`、`turn/completed`、`turn/diff/updated`、`turn/plan/updated`
- `item/started`、`item/completed`
- `item/agentMessage/delta`、`item/plan/delta`
- `item/reasoning/summaryTextDelta`、`item/reasoning/summaryPartAdded`、`item/reasoning/textDelta`
- `item/commandExecution/outputDelta`、`item/commandExecution/terminalInteraction`
- `item/fileChange/outputDelta`、`item/fileChange/patchUpdated`
- `serverRequest/resolved`、`item/mcpToolCall/progress`
- `thread/realtime/*`、`thread/status/changed`
- `thread/archived`、`thread/unarchived`、`thread/goal/*`、`skills/changed`

不应作为主 UI 驱动的通知：

- `rawResponseItem/completed`
- legacy `command/exec/outputDelta`
- legacy `process/outputDelta`、`process/exited`
- 多数 `codex/event/*` raw stream event
- `thread/closed`、`thread/settings/updated`、`thread/compacted`
- `warning`、部分 auth/windows/setup 噪声

Web 后端应复制这种分类：重要通知进入 domain realtime reducer；非重要通知进入 diagnostics 或低优先级 refresh，不触发 active detail 大回读。

### 5. server request/审批是 live flow 的一部分

官方不仅同步 assistant 文本，也同步 pending request：

- command approval：`thread-follower-command-approval-decision`
- file approval：`thread-follower-file-approval-decision`
- permissions approval：`thread-follower-permissions-request-approval-response`
- user input：`thread-follower-submit-user-input`
- MCP elicitation：`thread-follower-submit-mcp-server-elicitation-response`

官方 follower 发现该 request 属于 official owner 时，会把用户的决策转发给 owner；只有本地 owner 才直接回复 app-server server request。

Web 必须建立 pending request registry：

- request id、conversation id、method、owner role、source item id。
- UI 卡片统一从 domain model 渲染。
- 用户动作统一进 `ThreadActionRouter`，由 router 判断走 follower IPC 还是 app-server response。
- owner 广播 resolved 后，所有端移除 pending 卡片。

### 6. client-status-changed 驱动 owner 可达性

官方 worker 会广播 `client-status-changed`。Webview stream coordinator 收到后会做两类动作：

- 新 client 连接时，owner 为自己负责的 streaming conversations 重新广播 snapshot，让新 follower 快速追上 live state。
- owner 断开时，follower 标记该 conversation 需要 resume，并在部分动作上走 unavailable-owner 处理。

Web 后端不能只靠“请求失败了再猜 owner 不可达”。它需要维护：

- clientId、clientType、lastSeen、status。
- threadId -> ownerClientId。
- owner disconnect 时间。
- snapshot rebroadcast 或重新 hydrate 的原因。

### 7. queued follow-ups 与 read state 也属于同步面

官方广播包含：

- `thread-queued-followups-changed`
- `thread-read-state-changed`

queued follow-ups 会影响 active turn 后续动作；read state 会影响列表未读状态。Web 可以不把 owner/follower 显示给普通用户，但这些状态必须进入后端同步模型。

### 8. method version map 必须完整登记

当前已确认的官方 IPC method version：

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

`packages/protocol` 应以这张表作为能力声明源，测试必须覆盖所有 method 是否能被识别、路由、诊断。

### 9. raw app-server RPC 必须按官方 schema 收口

官方 app-server 是执行与持久化后端，但它的 raw RPC 参数边界必须严格遵守：

- `turn/start`：发送 `threadId`、`input`、可选 `clientUserMessageId`、`cwd`、模型/推理/权限/协作模式等官方 settings 字段。
- `turn/steer`：发送 `threadId`、`expectedTurnId`、`input` 和可选 `clientUserMessageId`；不能携带 thread settings override。
- `input` 中的本地图片使用官方 `{ type: "localImage", path }`，避免把大段 data URL 作为 app-server 参数传输。
- `attachments`、`restoreMessage` 是 UI/host 恢复字段，保留给 official follower/renderer，不得直传 raw app-server。
- `clientUserMessageId` 应由 Web 生成并随 start/steer 传入，供 app-server 在 `userMessage.clientId` 中回显，帮助三端对齐同一条用户消息。

### 10. 官方 settings / permissions 能力优先

官方 app-server 已提供可直接复用的能力：

- `thread/settings/update`：更新 loaded thread 的下一轮模型、推理强度、协作模式等设置，并发 `thread/settings/updated`。
- `permissionProfile/list`：读取官方权限 profile catalog。
- `item/permissions/requestApproval`：`request_permissions` 工具的官方 server request；客户端响应 `permissions` 子集，可选 `scope: "session"`。

Web-owned thread 收到 Desktop/扩展的 model/reasoning/collaboration follower request 时，调用 `thread/settings/update`，以 app-server 的 loaded thread settings 作为唯一 next-turn 状态源。审批系统必须覆盖 permissions request，不能只处理 command/file approval。

## 官方交互模型

### 1. app-server 是执行与持久化后端

官方前端通过宿主层调用 app-server：

- `thread/list`：读取 thread 列表。
- `thread/read`：读取 thread 详情，可带 `includeTurns`。
- `thread/turns/list`：分页读取 turns。
- `turn/start`：启动 turn。
- `turn/steer`：引导 active turn。
- `turn/interrupt`：停止 active turn。
- `thread/goal/*`、`model/list`、`collaborationMode/list`、`skills/list`：读取或更新运行选项和辅助能力。

### 2. IPC 是 live stream 与跨端动作路由

官方 owner 会广播：

- `thread-stream-state-changed`
- `thread-read-state-changed`
- `thread-archived`
- `thread-unarchived`
- `thread-queued-followups-changed`

官方 follower 会发送：

- `thread-follower-start-turn`
- `thread-follower-steer-turn`
- `thread-follower-interrupt-turn`
- `thread-follower-compact-thread`
- `thread-follower-set-model-and-reasoning`
- `thread-follower-set-collaboration-mode`
- `thread-follower-edit-last-user-turn`
- `thread-follower-command-approval-decision`
- `thread-follower-file-approval-decision`
- `thread-follower-permissions-request-approval-response`
- `thread-follower-submit-user-input`
- `thread-follower-submit-mcp-server-elicitation-response`
- `thread-follower-set-queued-follow-ups-state`

这说明完美复刻不能只实现“发送消息、停止、引导”。审批、用户输入、MCP elicitation、queued follow-ups 也应进入后续同步能力矩阵。

### 3. owner/follower 是工程概念，不是用户概念

普通 UI 不应显示 owner/follower。但后端必须严格维护：

- 当前 thread 谁是 owner。
- 当前 owner 是否可达。
- 当前 active turn id。
- 哪些动作必须发给 owner。
- 哪些动作可以本地执行。
- 何时必须拒绝而不是 fallback。

## 当前 Web 偏差

### 偏差 1：active detail 过度回读 app-server

当前 `/api/domain/thread-detail` 在存在 official IPC state 时，只有非 active 且内容完整才直接返回 official cache。active 时经常继续读 `appServer.threadRead({ includeTurns: true })` 做校验/合并。

这会造成：

- Web 收到了 IPC patch，却又等待 app-server 持久状态。
- app-server 刚完成、刚切平台、刚恢复时可能比 IPC live state 慢。
- active streaming 阶段响应速度接近轮询体验。
- app-server 读到空 rollout 或旧状态时，Web 容易报错或显示空 active turn。

### 偏差 2：浏览器实时通道只推轻量事件，前端再拉详情

当前后端已有 WebSocket `/api/realtime`，不是纯轮询。但它主要告诉前端“某 thread 变了”，前端随后调用 `/api/domain/thread-detail`。

这比官方 Webview 直接消费本地 `AppServerManager` state 慢一层。若 detail 端又回读 app-server，延迟会叠加。

### 偏差 3：active polling 兜底存在感太强

前端 active thread 每 1.5 秒静默刷新详情。这本应只是丢事件后的兜底，但当前会参与主体验，造成：

- 流式输出颗粒度变粗。
- 文本选择和滚动状态更容易被刷新打扰。
- 用户感知像 polling，而不是实时 stream。

### 偏差 4：部分 follower 能力缺失

当前核心 start/steer/interrupt 已覆盖，但官方版本表显示还有多类 follower 方法：

- 审批决策。
- 权限请求响应。
- 用户输入响应。
- MCP elicitation 响应。
- queued follow-ups 状态。
- edit last user turn。

这些能力缺失时，Web 在复杂 turn 中仍可能只能显示卡片，不能像官方端一样继续 owner 的真实流程。

### 偏差 5：某些 fallback 对“完美复刻”过于激进

`turn-start` 在确认 thread 已空闲后本地接管是合理兜底。但 active `steer` 如果 owner 不可达，不应自动转成本地 `turn/start`，除非已经严格证明 owner turn 结束，并且用户动作语义也已经从“引导当前”变为“发送新一轮”。

完美复刻优先级应是：

1. 不分叉。
2. 不误把 active 操作变成新 turn。
3. 再追求本地接管便利性。

## 改造原则

1. Web 后端要模拟官方宿主层，而不是只做 HTTP wrapper。
2. app-server 是执行/持久化源，IPC stream cache 是 active live 源。
3. official-owned active thread 以 IPC state 为第一展示源。
4. app-server `thread/read` 只用于 cold load、补底、完成后收敛、stale active 判定，不应在每个 stream 事件后阻塞展示。
5. 前端仍只消费 Web domain model，不直接依赖官方 raw protocol。
6. 所有跨端动作先路由到 owner；owner 不可达时，active 操作默认失败并显示诊断。
7. fallback 必须显式、可诊断、可测试，不能“看起来成功但制造分叉”。
8. SSE 和 WebSocket 都可以；关键是事件驱动，而不是具体协议名。当前保留 WebSocket，并可增加 SSE 作为 LAN/mobile 兼容 fallback。

## 目标架构

```text
Browser UI
  |
  | WebSocket/SSE: typed realtime domain events
  | HTTP: command/action request
  v
codex_web backend
  |
  | AppServerHostAdapter
  v
official app-server

codex_web backend
  |
  | OfficialIpcHostAdapter
  v
\\.\pipe\codex-ipc
  |
  v
Desktop / VS Code official clients
```

建议重构为八个后端概念：

- `OfficialIpcRuntime`：负责 `\\.\pipe\codex-ipc` 连接、method version、broadcast/request handler、client status。
- `AppServerRuntime`：负责 app-server RPC、notification subscription、server request response、runtime options。
- `ThreadRuntimeStore`：统一保存 threadId -> owner/source、activeTurnId、cacheVersion、queued follow-ups、pending requests、last hydrate reason。
- `OfficialRealtimeStore`：只保存 official stream snapshot/patch，不做 domain 决策。
- `ThreadActionRouter`：决定 start/steer/interrupt/approval/user-input 到底走 follower IPC 还是本地 app-server。
- `ServerRequestRegistry`：统一管理 approval、permissions、user input、MCP elicitation 的 pending/resolved 生命周期。
- `DomainProjector`：把 official raw conversation state 与 app-server raw thread 转为 Web domain model。
- `BrowserRealtimeGateway`：只推 typed domain events，前端不接触官方 raw protocol。

关键边界：

- `packages/protocol` 只描述官方 IPC transport、method、version、request/broadcast 语义。
- `packages/domain` 只描述 Web 可消费的 thread、turn、item、request、diagnostic model。
- `apps/server` 是唯一可以同时接触 official raw protocol 和 app-server raw RPC 的地方。
- `apps/web` 只能调用 domain HTTP action 和消费 domain realtime event。

## 关键流程改造

### 1. Thread detail

目标：

- official-owned active thread：直接由 official stream cache 归一化后返回。
- official snapshot 内容可用时，不阻塞等待 app-server。
- 仅在以下情况回读 app-server：
  - 没有 official cache。
  - patches-without-snapshot，需要补 baseline。
  - official active turn items 为空，且这是已知官方空 snapshot 问题。
  - official active 疑似 stale，需要判断是否已完成。
  - stream 完成后做最终持久状态收敛。

改造点：

- `apps/server/src/app.ts` 的 `/api/domain/thread-detail` 增加 `official-active-fast-path`。
- `normalizeOfficialConversationState` 输出应足够支持 active UI。
- app-server hydrate 成功后只更新 official cache，不覆盖 active live source。
- detail response 增加 source 标记，例如 `official-ipc-live`、`official-ipc-hydrated`、`app-server-cold`，用于诊断，不暴露普通 UI。

### 2. Browser realtime

目标：

- 后端收到 official `thread-stream-state-changed` 后，立即推送对应 thread 的 domain-level update。
- 前端不再每次都重新拉完整 detail，至少 active stream 阶段可以消费轻量 domain event 或触发不阻塞的 official cache detail 读取。

改造点：

- 保留 `/api/realtime` WebSocket。
- 可新增 `/api/realtime/events` SSE，作为移动/代理环境 fallback。
- `official.threadStreamStateChanged` payload 不只携带 raw params，应附加：
  - `threadId`
  - `cacheVersion`
  - `isInProgress`
  - `activeTurnId`
  - 可选 `domainPatch` 或 `domainSnapshotSummary`
- 前端 active polling 改为低频兜底，例如 10-15 秒，且只在 WebSocket/SSE 断开或长期无事件时启用。

### 3. Turn start

目标：

- official-owned thread：发送 `thread-follower-start-turn`。
- Web-owned thread：本地 app-server `turn/start`，并发布 Web-owned stream。
- cold new thread：Web 可以通过 app-server 创建并成为 local-only owner，但不能向官方广播空坏状态。
- stale owner：先 directed request，再 discovery；都失败后，只有确认 app-server thread 已空闲，才允许本地接管。

改造点：

- 保持当前 start 的 guarded fallback，但把诊断写得更明确。
- `recentFollowerRequests` 记录 request id、target/discovery、handledByClientId、error class。
- start 成功后不要靠立即 app-server read 推动 UI，等待 official/app-server notification 驱动。

### 4. Turn steer

目标：

- active turn 引导必须作用于同一个 owner turn。
- follower steer 失败时，不自动变成本地 start。

改造点：

- 移除或收紧 `turn-steer-stale-active-fallback`。
- 若 app-server 确认原 active turn 已结束，应返回“当前回复已结束，请作为新消息发送”的 domain error，由前端保留文本并允许用户再次发送。
- 只有用户明确选择“排队/新一轮”时，才走 start 语义。

### 5. Turn interrupt

目标：

- official-owned active thread：发送 `thread-follower-interrupt-turn`。
- Web-owned active thread：本地 `turn/interrupt`。
- owner 不可达：返回明确错误，不本地假停。

改造点：

- 保持 interrupt 不 fallback 的原则。
- 补齐 sub-agent / side conversation active turn id 收集。
- 停止后等待 owner broadcast 收敛 UI。

### 6. Approval / user input / elicitation

目标：

复杂 turn 中，Web 能像 Desktop/扩展一样继续 owner 流程。

改造点：

- 在 `packages/protocol` 增加 follower methods：
  - `thread-follower-command-approval-decision`
  - `thread-follower-file-approval-decision`
  - `thread-follower-permissions-request-approval-response`
  - `thread-follower-submit-user-input`
  - `thread-follower-submit-mcp-server-elicitation-response`
- 在后端 approval coordinator 中按 owner role 路由：
  - official-owned：走 follower method。
  - Web-owned：回 app-server server request response。
- 前端审批卡、用户输入卡、MCP elicitation 卡统一走同一 action router。

### 7. Web-owned stream publishing

目标：

Web 成为 owner 时，Desktop/扩展看到的 stream 速度接近官方 owner。

改造点：

- 当前 650ms snapshot debounce 可保留为保护，但 active token delta 应更快。
- 对 `item/agentMessage/delta`、`item/reasoning/*Delta`、`item/commandExecution/outputDelta` 这类高频事件，采用 100-250ms 合并窗口。
- 对 `turn/started`、`turn/completed`、approval requested/resolved、interrupt 这类状态事件，立即广播。
- 保持“读 app-server 快照前后都复查 ownership”的安全规则。

## 当前代码处理策略

工作区已有若干局部改动，主要集中在：

- `apps/server/src/app.ts`：thread detail 合并 official live items 与 app-server persisted text 的尝试。
- `apps/web/src/app/hooks/useRuntimeData.ts`：active poll interval 与 realtime refresh debounce 的调整。
- `packages/protocol/src/index.ts`：local-only ownership guard。
- 对应测试文件。

这些改动可以作为 checkpoint 保存，但大重构不应被它们限制。后续处理原则：

- checkpoint commit 后创建重构分支。
- `packages/protocol` 中可保留有价值的 ownership guard，但 method map、request routing、diagnostics 要按官方完整面重写。
- `apps/web` 中 1.5 秒 active polling 调整应视为临时止血，重构后降级为断线/长期无事件兜底。
- `apps/server/src/app.ts` 中 detail route 的 merge 逻辑不能继续膨胀，应拆到 `DomainProjector` 与 `ThreadRuntimeStore`。
- 新架构成型后，再决定旧 helper 是迁移、删掉还是并入 projector 测试。

## 重构实施策略

### Phase 0：checkpoint 与证据锁定

范围：

- 提交当前本地状态作为 checkpoint。
- 将本文件作为重构设计基线。
- 补充官方 method version map、notification importance map、Desktop/VS Code resource path 到 diagnostics 文档。
- 新建重构分支，避免在 `main` 上直接大拆。

验收：

- `git status` 清晰。
- checkpoint commit 可回退。
- 方案文档明确写入官方依据与用户确认决策。

### Phase 1：协议与 runtime 地基重写

范围：

- `packages/protocol` 建立完整官方 method registry。
- `OfficialIpcRuntime` 支持 broadcast、direct request、discovery request、client status、request history。
- `AppServerRuntime` 支持 notification importance 分类。
- `ThreadRuntimeStore` 支持 owner/source、active state、queued follow-ups、read state、pending request、hydrate reason。
- 现有 `OfficialIpcBridge` 中 scattered ownership/fallback 逻辑迁入 runtime/router。

验收：

- method version map 与官方表一致。
- follower request 只能被 owner handler 接收。
- follower app-server mutation guard 有单测覆盖。
- client disconnect 会更新 owner reachability，而不是等 action 失败后猜测。

### Phase 2：thread detail 与 browser realtime 主路径重写

范围：

- `/api/domain/thread-detail` 改为 domain projector 输出，不直接堆合并逻辑。
- official-owned active thread 使用 official IPC live cache fast path。
- app-server `thread/read` 只用于 cold load、baseline hydrate、完成收敛、stale 判定。
- `/api/realtime` 推 typed domain events，active stream 不再靠 detail refetch 驱动。
- active polling 降为断线兜底，默认 10-15 秒或 WebSocket/SSE 不可用时启用。
- 前端 reducer 以 `threadId + cacheVersion + source` 做幂等更新。

验收：

- Desktop 发起 active stream，Web 不靠 1.5 秒轮询也能持续更新。
- VS Code 发起 active stream，Web 同样持续更新。
- Desktop 完成后切到 Web 继续提问，不报 `official-owner-unavailable`，不重复 turn。
- Web 正在选中文字时，live update 不破坏选区。

### Phase 3：action router 完整复刻

范围：

- start、steer、interrupt 全部先过 `ThreadActionRouter`。
- official-owned action 走 follower IPC。
- Web-owned action 走本地 app-server。
- active steer 不再自动 fallback 为本地 start。
- owner unavailable 时返回明确 domain error，除非是明确的 idle start 接管场景。
- set model/reasoning、collaboration mode、compact、queued follow-ups 进入同一 router。

验收：

- Web 引导 Desktop/VS Code active turn 时作用于同一个 owner turn。
- owner 不可达时不误开新 turn。
- interrupt 由 owner 广播结果收敛 UI。
- idle thread 本地接管路径有明确诊断与测试。

### Phase 4：server request 与复杂 turn 闭环

范围：

- command/file/permissions approval。
- user input。
- MCP elicitation。
- pending request registry。
- resolved broadcast 与 UI 卡片收敛。

验收：

- official-owned 命令审批可由 Web 决策，owner 继续运行。
- official-owned 用户输入请求可由 Web 回复。
- Desktop/扩展/Web 对 pending/resolved 状态最终一致。
- Web-owned 审批也能被 Desktop/扩展实时看到。

### Phase 5：Web-owned owner parity 与长期稳定

范围：

- Web-owned active stream 高速 broadcast。
- Web-owned runtime owner-state 与官方 set-model/collaboration 行为一致。
- handoff 时清理 runtime state、pending approvals、queued followups。
- edit last user turn。
- archive/unarchive/read state。
- side conversation/fork 生命周期。
- SSE 仅作为 transport 兼容层，不作为核心实时机制。

验收：

- Web 新建并流式输出时，Desktop/扩展实时看到同一段 stream。
- Desktop/扩展接管同一 thread 后，Web 不残留旧 owner。
- Web-owned 审批、停止、继续在三端一致。
- 三端互发、互停、互审、互引导、切平台继续，均与官方 Desktop/扩展行为一致。

## 建议优先修改文件

- `apps/server/src/app.ts`
  - `/api/domain/thread-detail`
  - `/api/domain/turn-start`
  - `/api/domain/turn-steer`
  - `/api/domain/turn-interrupt`
  - `/api/realtime`

- `apps/server/src/syncCoordinator.ts`
  - Web-owned snapshot/patch broadcast。
  - app-server notification 到 official stream 的发布节奏。

- `packages/protocol/src/index.ts`
  - method version map。
  - follower request helpers。
  - request history diagnostics。

- `packages/api/src/index.ts`
  - realtime event schema。
  - new approval/user-input/elicitation action schema。

- `packages/domain/src/index.ts`
  - official active stream normalize。
  - approval/user-input/elicitation domain item。

- `apps/web/src/app/hooks/useRuntimeData.ts`
  - realtime event reducer。
  - active polling 降级。
  - detail refresh coalescing。

## 测试计划

### 单元测试

- official active state 不回读 app-server 也能返回完整 domain detail。
- empty active snapshot 才触发 hydrate。
- stale active 超时/完成判定不会覆盖 live state。
- steer owner 不可达不自动变成本地 start。
- approval/user-input follower request 成功、失败、discovery、stale owner retry。

### E2E / smoke

- Desktop -> Web：Desktop 发送，Web 实时看 stream。
- VS Code -> Web：扩展发送，Web 实时看 stream。
- Web -> Desktop/VS Code：Web 发送，official owner 接受 follower start。
- active steer：Web 引导 Desktop/VS Code 正在运行的 turn。
- interrupt：Web 停止 official-owned active turn。
- approval：Web 处理 official-owned command/file approval。
- platform switch：Desktop 完成后关闭，在 VS Code 或 Web 继续同一 thread。

### 诊断

- `/api/protocol/compatibility` 展示完整 official method version map。
- `/api/sync/readiness?threadId=...` 展示 active source、owner、cacheVersion、last app-server hydrate reason。
- diagnostics export 保留 follower request summary，但不包含正文、附件内容、token、raw conversationState。

## 非阻塞细化项

1. official owner 不可达且 thread 已空闲时，Web 是否自动接管？

   当前按严格复刻处理：只在明确 idle start 场景允许接管；active `steer/interrupt` 不做本地 fallback。

2. 浏览器传输是否增加 SSE？

   当前不把协议名作为核心问题。WebSocket 可继续做主通道；SSE 仅作为 P5 兼容层。

3. edit last user turn 是否并入第一轮大改？

   当前放入 Phase 5。它涉及 rollback、replacement turn 和可能的文件变更恢复，适合在 owner/follower 地基稳定后做。

4. 是否需要记录官方源码证据索引？

   建议新增 `documentation/protocol/official_client_runtime_evidence.md`，只记录文件路径、method 名、行为摘要，不复制大段官方代码。

## 立即执行路线

按用户已确认方向，先做 checkpoint，再在新分支进行一次性底层重构：

1. checkpoint commit 当前工作区，保留可回退状态。
2. 新建 `codex/official-client-interaction-refactor` 分支。
3. 先重写 `packages/protocol` 和后端 runtime 地基。
4. 再迁移 thread detail、browser realtime、action router。
5. 最后补齐 server request、Web-owned parity 与复杂三端验收。

核心验收标准只有一个：Web 与 Desktop/VS Code 一样，在同一 thread 上流式、切平台、继续提问、审批、引导、停止都不分叉、不靠轮询感刷新、不误报 owner 不可达。
