# Official Client Runtime Evidence

状态：research notes  
日期：2026-06-02

本文件记录 Desktop 与 VS Code Codex 扩展的交互实现证据。目标是支撑 `codex_web` 的三端同步重构，不复制官方大段源码，只记录可验证路径、method 名与行为结论。

## 官方资源路径

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
