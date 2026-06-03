# 会话流式输出设计

更新时间：2026-06-03

本文记录 `codex_web` 主聊天区和侧边聊天区的会话流式输出设计。它面向前端和 domain/API 分层，不是 app-server raw RPC 说明；所有官方协议 shape 都必须先在后端或 `packages/domain` 收敛成 Web 稳定模型，再交给前端渲染。

## 1. 目标

`codex_web` 的会话输出不是普通聊天列表，而是官方 Codex Desktop 的高保真复刻。目标是：

1. 三端围绕同一条 thread 实时看到同一条用户消息、同一段 assistant stream 和同一批执行过程。
2. 前端在最终 assistant 输出开始时，像 Desktop 一样把本轮过程内容折叠成一行“已处理”，而不是等全部输出完成后才折叠。
3. 用户消息和最终回复始终可见；命令、工具、文件变更、阶段性说明等过程内容可展开复看。
4. 普通 UI 不暴露 owner/follower、raw IPC、app-server 私有字段等协议概念。
5. 实现上保持前端、API、domain、server/protocol 的边界清晰，避免前端直接依赖官方 raw protocol shape。

## 2. 参考依据

- `docs/product_spec.md`：MVP 核心 loop 包含 streaming conversation rendering 和 receiving live assistant output。
- `docs/official_client_interaction_refactor_plan.md`：live stream 由 official IPC / app-server notification / domain model 分层驱动，前端消费 domain model。
- `docs/ui_fidelity.md`：聊天视口和 message block 在流式更新时不能跳动、遮挡或重复显示。
- 官方 app-server/source 证据：`Turn.itemsView` 是 app-server 的数据视图控制，`summary` 通常只保留首条 user message 和最终 agent message；Desktop 完成后看到的“已处理”展开/折叠是 renderer 级 UI 行为，不能当作 app-server 持久字段。

## 3. 分层边界

```text
official Desktop / VS Code / local app-server
        |
        v
apps/server + packages/protocol
  - 接官方 IPC 和 app-server
  - 维护 owner/follower、stream cache、snapshot/patch
  - 只在后端处理官方 raw shape
        |
        v
packages/domain
  - 归一化 Thread / Turn / MessageItem
  - 读取 turn 元数据：itemsView、startedAtIso、completedAtIso、durationMs
  - 输出 Web 稳定领域模型
        |
        v
packages/api
  - 用 Zod schema 校验 HTTP/WebSocket envelope
  - 前端只消费导出的 TS 类型
        |
        v
apps/web
  - ChatMain 编排 turn
  - TurnMessages 派生折叠布局
  - MessageBlocks 渲染具体 item
```

前端允许做的事：

- 根据 `Turn` 和 `MessageItem` 派生本地 UI 折叠状态。
- 记录“过程内容是否展开”这类 renderer-local state。
- 根据 domain 状态显示“正在运行 / 已运行 / 已处理”等用户可见文案。

前端不允许做的事：

- 直接判断官方 raw item shape。
- 把“过程折叠/展开”写回 app-server、SQLite 或官方 IPC。
- 通过猜测 Desktop 私有字段来驱动 UI。
- 把 owner/follower 作为普通用户可见文案展示。

## 4. 数据模型

### 4.1 Turn

Web domain 的 `Turn` 是前端渲染的最小会话单位：

```ts
type Turn = {
  id: string
  status: 'idle' | 'active' | 'completed' | 'failed' | 'interrupted' | 'unknown'
  items: MessageItem[]
  itemsView?: 'notLoaded' | 'summary' | 'full' | 'unknown'
  startedAtIso?: string | null
  completedAtIso?: string | null
  durationMs?: number | null
}
```

说明：

- `itemsView` 来自官方 app-server 视图状态，只用于诊断和未来策略，不直接等同 UI 折叠状态。
- `durationMs` 优先用于“已处理 5m 5s”这类 meta；缺失时可由 `startedAtIso/completedAtIso` 推导。
- active turn 若缺少 completedAt，可以用当前时间临时推导已持续时间，但不能写回 domain。

### 4.2 MessageItem

`MessageItem` 是 Web 前端唯一可渲染的消息 item 形状。当前核心类型包括：

- `user`
- `assistant`
- `reasoning`
- `command`
- `fileChange`
- `plan`
- `agentTask`
- `approval`
- `image`
- `error`
- `toolOutput`
- `unknown`

新增官方 item 时，先在 `packages/domain` 扩展稳定类型，前端再增加渲染；不要让 Web 组件识别 raw `agentMessage`、`commandExecution` 等官方字段。

## 5. 渲染结构

### 5.1 组件职责

`ChatMain`：

- 决定当前 thread / side conversation 的 turns。
- 为每个 turn 渲染一个 `TurnMessages`。
- 处理主聊天、侧边聊天、虚拟滚动和 Composer 周边布局。

`TurnMessages`：

- 读取完整 `Turn`。
- 判断是否需要将过程内容折叠。
- 维护本地 `processExpanded`。
- 将用户消息、过程折叠行、最终回复按顺序交给 `renderTurnItems`。

`renderTurnItems`：

- 只负责具体 `MessageItem[]` 的渲染。
- 保留已有 grouped operation、file change summary、reasoning 显隐等规则。
- 不维护 turn 级折叠状态。

`renderMessageItem`：

- 渲染单个 item。
- 不知道自己是否处于最终回复、过程区或侧边聊天。

### 5.2 正常未折叠布局

未达到折叠条件时，turn 按原始 item 顺序渲染：

```text
user message
reasoning / command / tool / file change / progress assistant
assistant stream
```

这适用于：

- 还没有可识别的最终 assistant 输出。
- 过程项中仍有 active command/tool/fileChange。
- assistant 输出后又出现新的非静默过程项。
- item 数量太少，不值得折叠。

### 5.3 已折叠布局

达到折叠条件后，turn 渲染为：

```text
user message
已处理 5m 5s  >
assistant final output
```

点击“已处理”后：

```text
user message
已处理 5m 5s  v
  progress assistant
  command/tool/fileChange summaries
  other process items
assistant final output
```

如果 turn 中间有后续用户引导消息，用户消息仍按它在最终回复之前的相对顺序保留；过程折叠行只出现一次。

## 6. 折叠触发规则

折叠是 renderer 派生行为，不是持久状态。

当前规则：

1. 在 turn 尾部向前寻找最后一个可见 assistant 输出。
2. 该 assistant 前面必须存在可折叠过程项。
3. 过程项中必须存在实质活动，例如 command、fileChange、toolOutput、plan、approval、error、unknown 等；只有 assistant/reasoning 时不强制折叠。
4. 最后 assistant 后面不能有新的非静默 item。若后面又来了命令、工具或文件变更，说明当前 assistant 不再能视作最终回复，先回到未折叠布局。
5. 过程项里不能有 active operation。仍在运行的命令或工具必须保持可见。
6. 用户消息不进入折叠区，始终可见。

这条规则满足两个关键行为：

- **最终输出开始时立即折叠**：active turn 中只要最终 assistant stream 出现在尾部，前面的已完成过程会立刻收起。
- **避免误藏执行状态**：如果流式过程中又出现新工具或命令，折叠暂时失效，用户能看到正在执行的内容。

未来如果 domain 接入官方 `agentMessage.phase` 或更明确的 final marker，应优先使用官方语义，再保留当前序列规则作为 fallback。

## 7. 流式更新行为

流式输出期间，Web 应保持以下不变量：

1. 最新 assistant 文本继续追加在最终回复位置，不能被折叠行吞掉。
2. 折叠行出现时不改变 Composer 布局，不遮挡输入区。
3. 用户在展开过程区后，后续 token 更新不应重置 `processExpanded`，除非 turn id 改变或布局条件失效。
4. 当前 active operation 不被藏进“已处理”。
5. 完成后若 `durationMs` 从 app-server 回填，折叠行 meta 可以从“已持续”或空值收敛为最终时长。
6. 侧边聊天复用同一套 turn rendering，不为 side conversation 建另一套消息渲染。

## 8. UI 文案与视觉

默认文案：

- 折叠行 label：`已处理`
- meta：`5m 5s`、`12s`、`800ms` 等紧凑时长
- 展开按钮 aria：`展开内容`
- 折叠按钮 aria：`折叠内容`

视觉原则：

- 折叠行复用 Desktop-like message author/toggle 视觉，不做大卡片。
- 折叠行是过程摘要，不是 assistant 正文的一部分。
- 展开后仍复用原有 command/file/tool 渲染，不另做嵌套卡片体系。
- 普通用户界面不显示 `itemsView`、`owner`、`follower`、`rawType` 等工程词，除非是 Debug/Diagnostics。

## 9. 状态矩阵

| 场景 | 期望 |
| --- | --- |
| 只有 user + assistant | 不显示“已处理” |
| user + command + assistant final | command 默认折叠，user/final 可见 |
| active command 仍运行中 | command 保持可见，不折叠 |
| assistant final 开始流式输出 | 立即折叠前置完成过程 |
| assistant 后又出现 command/tool | 暂时取消折叠，按原始顺序展示 |
| 用户 steer 插入新 user message | 用户消息保持可见，不进入过程折叠 |
| completed turn 有 durationMs | 折叠行显示最终耗时 |
| completed turn 无 durationMs | 尽量用 started/completed 推导；无法推导则不显示 meta |
| app-server `itemsView=summary` | 只渲染已有 items，不伪造过程折叠 |
| side conversation | 与主聊天使用同一套 TurnMessages |

## 10. 测试策略

单元测试：

- `packages/domain`：官方 turn 的 `itemsView/start/completed/durationMs` 能归一化到 domain。
- `packages/api`：turn schema 放行新增元数据。
- `apps/web`：`TurnMessages` 默认折叠已完成过程，并保留用户消息和最终回复。

E2E / UI 回归：

- `tests/e2e/message-blocks.spec.ts` 继续覆盖复杂消息块和折叠交互。
- 后续应新增一个 active stream fixture，覆盖“最终 assistant 开始输出时立即折叠”的桌面截图。
- 移动端需要确认折叠行、展开后的 command/output 不造成页面级横向溢出。

人工验收：

1. Desktop 发起一个包含命令/工具的 turn，Web 观察最终回复开始时是否立即出现“已处理”。
2. Web 发起 Web-owned turn，Desktop/VS Code 观察过程和最终回复是否同步且不崩溃。
3. 展开“已处理”，确认过程项仍可读、可复制、可展开。
4. 检查用户 steer 消息是否保留在可见流里。

## 11. 后续扩展

优先级建议：

1. 接入官方 `agentMessage.phase` 或等价 final marker，用更强语义识别最终回复。
2. 为 active stream 的“已处理”折叠补 Playwright fixture 和截图基线。
3. 将折叠行文案迁移到 `packages/i18n`。
4. 若超长 thread 的 turn 级虚拟化性能不足，再把 `TurnMessages` 拆成可虚拟化的 turn-row 分段，但仍保持折叠状态挂在 turn 级。
5. 右侧栏、左侧栏、设置页设计文档应沿用本文结构：目标、分层边界、数据模型、组件职责、状态矩阵、测试策略。

