# App-server 核心前缀接口覆盖表

Status: current workspace audit on 2026-06-03.

官方来源：`openai/codex` app-server protocol schema，commit `3389fa5`，文件为 `codex-rs/app-server-protocol/src/protocol/common.rs`。

本地核对入口：

- 主动 RPC wrapper：`apps/server/src/appServerProcess.ts`
- app-server 反向请求 handler：`apps/server/src/app.ts`
- app-server 通知分类：`packages/protocol/src/index.ts`

## 统计口径

本文只覆盖这 4 个核心前缀：

- `thread`：一整条会话、会话列表、归档、标题、目标、设置、压缩、实时语音等。
- `turn`：一次用户输入到一次 agent 输出的执行轮次。
- `item`：turn 内部的细颗粒事件、工具调用、命令输出、文件变更、审批等。
- `serverRequest`：app-server 发起反向请求后，通知客户端该请求已被解决。

状态含义：

- `已接`：本地已有主动 RPC wrapper、ServerRequest handler，或通知已进入重要通知分类。
- `已识别但忽略`：本地协议层识别该通知，但当前不会作为重要实时事件驱动 UI。
- `未接`：当前未找到对应主动 RPC wrapper 或 ServerRequest handler。

## 汇总

| 前缀 | 官方接口数 | 已接 | 已识别但忽略 | 未接 | 主要缺口 |
| --- | ---: | ---: | ---: | ---: | --- |
| `thread` | 51 | 32 | 3 | 16 | 取消订阅、metadata/memory、shell/rollback、loaded/list、turn item 分页、realtime 主动接口 |
| `turn` | 7 | 7 | 0 | 0 | 无 |
| `item` | 19 | 17 | 0 | 2 | `item/tool/requestUserInput`、`item/tool/call` |
| `serverRequest` | 1 | 1 | 0 | 0 | 无 |
| 合计 | 78 | 57 | 3 | 18 | MVP 重点仍是 `item` 的两个 ServerRequest 缺口 |

## `thread`

`thread` 管一整条会话。这里既包括主动请求，也包括 app-server 推送给客户端的会话状态通知。

### ClientRequest

| 接口 | 当前状态 | 功能 |
| --- | --- | --- |
| `thread/start` | 已接 | 创建新 thread，并启动首轮对话。 |
| `thread/resume` | 已接 | 恢复已有 thread，让当前客户端继续订阅和参与后续事件。 |
| `thread/fork` | 已接 | 从已有 thread 分叉出新会话，常用于侧聊或从历史点继续。 |
| `thread/archive` | 已接 | 归档会话，使其从常规会话列表中移出。 |
| `thread/unsubscribe` | 未接 | 取消当前连接对某个 thread 的事件订阅。 |
| `thread/increment_elicitation` | 未接 | 增加该 thread 上等待外部用户交互的计数。 |
| `thread/decrement_elicitation` | 未接 | 减少该 thread 上等待外部用户交互的计数。 |
| `thread/name/set` | 已接 | 设置或更新会话标题。 |
| `thread/goal/set` | 已接 | 设置会话目标。 |
| `thread/goal/get` | 已接 | 读取会话目标。 |
| `thread/goal/clear` | 已接 | 清除会话目标。 |
| `thread/metadata/update` | 未接 | 更新会话元数据，例如外部来源、项目上下文或诊断信息。 |
| `thread/settings/update` | 已接 | 更新 loaded thread 的运行设置，影响后续 turn。 |
| `thread/memoryMode/set` | 未接 | 设置该会话的 memory 参与模式。 |
| `thread/unarchive` | 已接 | 将归档会话恢复到常规会话列表。 |
| `thread/compact/start` | 已接 | 触发会话上下文压缩。 |
| `thread/shellCommand` | 未接 | 在 thread 上执行用户触发的 shell command。 |
| `thread/approveGuardianDeniedAction` | 未接 | 对 Guardian 拒绝的动作执行后续批准流程。 |
| `thread/backgroundTerminals/clean` | 未接 | 清理该 thread 关联的后台终端。 |
| `thread/rollback` | 未接 | 将会话回滚到较早状态，通常用于撤销最后若干 turn。 |
| `thread/list` | 已接 | 分页读取会话列表，支持归档、排序、来源、cwd、searchTerm 等过滤。 |
| `thread/search` | 已接 | 官方会话搜索接口，按搜索词返回匹配会话和命中片段。 |
| `thread/loaded/list` | 未接 | 列出当前 app-server 已加载的 thread。 |
| `thread/read` | 已接 | 读取单条 thread 的详情。 |
| `thread/turns/list` | 已接 | 分页读取某条 thread 的 turn 列表。 |
| `thread/turns/items/list` | 未接 | 分页读取某个 turn 内部的 item 明细。 |
| `thread/inject_items` | 已接 | 向 loaded thread 注入 raw item，用于同步或恢复特定事件。 |
| `thread/realtime/start` | 未接 | 启动 thread 的 realtime 会话能力。 |
| `thread/realtime/appendAudio` | 未接 | 向 realtime 会话追加音频输入。 |
| `thread/realtime/appendText` | 未接 | 向 realtime 会话追加文本输入。 |
| `thread/realtime/stop` | 未接 | 停止 realtime 会话。 |
| `thread/realtime/listVoices` | 未接 | 查询 realtime 可用语音列表。 |

### ServerNotification

| 接口 | 当前状态 | 功能 |
| --- | --- | --- |
| `thread/started` | 已接 | 通知客户端 thread 已创建或已启动。 |
| `thread/status/changed` | 已接 | 通知 thread 运行状态变化，例如 idle、running、waiting 等。 |
| `thread/archived` | 已接 | 通知 thread 已归档。 |
| `thread/unarchived` | 已接 | 通知 thread 已恢复归档。 |
| `thread/closed` | 已识别但忽略 | 通知 thread 已关闭；当前协议层识别，但不作为重要实时事件处理。 |
| `thread/name/updated` | 已接 | 通知 thread 标题已更新。 |
| `thread/goal/updated` | 已接 | 通知 thread 目标已更新。 |
| `thread/goal/cleared` | 已接 | 通知 thread 目标已清除。 |
| `thread/settings/updated` | 已识别但忽略 | 通知 thread 设置已更新；当前协议层识别，但不驱动 UI。 |
| `thread/tokenUsage/updated` | 已接 | 通知 token 用量变化。 |
| `thread/compacted` | 已识别但忽略 | 通知上下文压缩完成；当前协议层识别，但不作为重要实时事件处理。 |
| `thread/realtime/started` | 已接 | 通知 realtime 会话已启动。 |
| `thread/realtime/itemAdded` | 已接 | 通知 realtime 会话新增 item。 |
| `thread/realtime/transcript/delta` | 已接 | 通知 realtime 转写文本增量。 |
| `thread/realtime/transcript/done` | 已接 | 通知 realtime 转写文本完成。 |
| `thread/realtime/outputAudio/delta` | 已接 | 通知 realtime 输出音频增量。 |
| `thread/realtime/sdp` | 已接 | 通知 realtime SDP 信息。 |
| `thread/realtime/error` | 已接 | 通知 realtime 错误。 |
| `thread/realtime/closed` | 已接 | 通知 realtime 会话关闭。 |

## `turn`

`turn` 管一次用户输入到一次 agent 输出的执行周期。一个 thread 里可以有多轮 turn。

### ClientRequest

| 接口 | 当前状态 | 功能 |
| --- | --- | --- |
| `turn/start` | 已接 | 在某个 thread 上启动一轮新的用户请求。 |
| `turn/steer` | 已接 | 对正在运行的 turn 追加引导或补充输入。 |
| `turn/interrupt` | 已接 | 中断正在运行的 turn。 |

### ServerNotification

| 接口 | 当前状态 | 功能 |
| --- | --- | --- |
| `turn/started` | 已接 | 通知某个 turn 已开始。 |
| `turn/completed` | 已接 | 通知某个 turn 已完成，通常携带完成状态。 |
| `turn/diff/updated` | 已接 | 通知该 turn 产生的文件 diff 更新。 |
| `turn/plan/updated` | 已接 | 通知该 turn 的 plan 更新。 |

## `item`

`item` 管 turn 内部更细颗粒的内容：agent 消息、reasoning、命令执行、文件变更、工具调用、审批和进度。

### ServerRequest

这些是 app-server 反过来问客户端要响应的接口。是否真正可用，关键看本地是否注册了 handler。

| 接口 | 当前状态 | 功能 |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | 已接 | 请求客户端审批命令执行。 |
| `item/fileChange/requestApproval` | 已接 | 请求客户端审批文件变更。 |
| `item/tool/requestUserInput` | 未接 | 工具执行过程中向用户请求输入，例如表单、选项或补充信息。 |
| `item/permissions/requestApproval` | 已接 | 请求客户端审批额外权限。 |
| `item/tool/call` | 未接 | app-server 请求客户端执行动态工具调用，并返回结果。 |

备注：`item/tool/requestUserInput` 在兼容性映射材料中已有记录，但当前未在 `apps/server/src/app.ts` 注册 official ServerRequest handler，因此这里按未接统计。

### ServerNotification

| 接口 | 当前状态 | 功能 |
| --- | --- | --- |
| `item/started` | 已接 | 通知一个 item 开始。 |
| `item/autoApprovalReview/started` | 已接 | 通知自动审批审查开始。 |
| `item/autoApprovalReview/completed` | 已接 | 通知自动审批审查完成。 |
| `item/completed` | 已接 | 通知一个 item 完成。 |
| `item/agentMessage/delta` | 已接 | 通知 agent 消息文本增量。 |
| `item/plan/delta` | 已接 | 通知 plan 文本或结构增量。 |
| `item/commandExecution/outputDelta` | 已接 | 通知命令执行输出增量。 |
| `item/commandExecution/terminalInteraction` | 已接 | 通知终端交互事件。 |
| `item/fileChange/outputDelta` | 已接 | 通知文件变更输出增量。 |
| `item/fileChange/patchUpdated` | 已接 | 通知 patch 内容更新。 |
| `item/mcpToolCall/progress` | 已接 | 通知 MCP tool call 进度。 |
| `item/reasoning/summaryTextDelta` | 已接 | 通知 reasoning 摘要文本增量。 |
| `item/reasoning/summaryPartAdded` | 已接 | 通知 reasoning 摘要新增部分。 |
| `item/reasoning/textDelta` | 已接 | 通知 reasoning 原始文本增量。 |

## `serverRequest`

`serverRequest` 目前在官方 schema 中只看到通知类接口，用于告诉客户端某个 app-server 反向请求已经结束。

### ServerNotification

| 接口 | 当前状态 | 功能 |
| --- | --- | --- |
| `serverRequest/resolved` | 已接 | 通知某个 ServerRequest 已被响应、取消或解决，客户端可据此关闭等待态。 |

## MVP 视角

从三端同步 MVP 看，优先级最高的缺口不是把所有 `thread` 主动接口铺满，而是先补 `item` 的 ServerRequest：

1. `item/tool/requestUserInput`
2. `item/tool/call`

这两个缺口会直接影响官方工具交互、动态工具调用和用户输入请求是否能在 Web 端闭环。`thread/search` 已经有主动 RPC wrapper，后续重点是确保 UI 搜索弹窗走后端 domain API，而不是前端自己做本地列表过滤。
