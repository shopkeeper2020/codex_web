# Official ThreadItem Lossless Collapse Plan

日期：2026-06-10
状态：planned
适用范围：官方 ThreadItem 无损接入、domain/API canonical 模型、实时流合并、最终回复识别、过程折叠、前端渲染

## 背景

Desktop 的会话区会在最终回复开始流式输出时，立即把本轮前置执行过程折叠成一行“已处理”，而不是等到 `turn/completed` 后再折叠。

2026-06-10 复查官方 app-server protocol schema、app-server 源码和本机 Codex Desktop bundle 后确认：最终回复识别的直接官方语义是 `ThreadItem.agentMessage.phase`。它不是一个新的流式 delta 字段，而是 `agentMessage` item 本体上的字段。

后续讨论进一步确认：只把 `phase` 补到 Web 自定义 `assistant` item 上是不够的。`codex_web` 是 Codex Desktop 的高保真 Web 复刻，官方 app-server 已经确定的 `ThreadItem` 字段相对稳定，后续通常是增量扩展；如果在 domain/API 入口把官方 item 改名、裁剪或重新包装，后续展示、排障和三端同步都会持续付债。

因此本计划升级为：**官方 ThreadItem 无损接入，domain/API canonical item 使用官方结构和官方 `type`，前端直接按官方 item 渲染；过程折叠只是其中第一个使用 `agentMessage.phase` 的功能。**

## 核心决策

| 决策 | 说明 |
| --- | --- |
| 官方 item `type` 不改名 | `agentMessage` 保持 `agentMessage`，`userMessage` 保持 `userMessage`，`commandExecution` 保持 `commandExecution`。不再把官方 `agentMessage` 映射成 Web `assistant`。 |
| 官方字段不裁剪 | 已知字段显式建模，未知新增字段 passthrough 保留在同一个官方 item 对象上。 |
| 不增加半套适配字段 | 不新增 `renderRole`、`displayKind`、`officialType`、`official.item` 这类并行身份字段。canonical item 本身就是官方 item。 |
| UI 按官方 type 渲染 | 组件可以叫 `AgentMessageBlock`，但数据判断使用 `item.type === "agentMessage"`。 |
| Web 自定义 item 不混入官方链路 | 只有确实非官方来源的扩展项才允许 Web 自定义结构；官方 app-server 数据不得转成 Web 自定义 message item。 |
| 旧 Web shape 只做边界迁移 | 旧的 `assistant/user/command/toolOutput` 等 shape 只能在历史数据入口做一次性迁移，不允许 renderer 长期同时支持两套 canonical item。 |

## 官方证据

本次复查来源：

- Codex manual helper：`C:\Users\user\AppData\Local\Temp\openai-docs-cache\codex-manual.md`
- app-server protocol schema：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server-protocol`
- app-server source：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server`
- Codex Desktop：`OpenAI.Codex 26.608.1337.0`
- Desktop asar：`C:\Program Files\WindowsApps\OpenAI.Codex_26.608.1337.0_x64__2p2nqsd0c76g0\app\resources\app.asar`

关键证据：

| 来源 | 证据 | 结论 |
| --- | --- | --- |
| `schema/typescript/MessagePhase.ts` | `MessagePhase = "commentary" \| "final_answer"`，描述为区分 interim commentary 和 final answer text | `MessagePhase` 是 `agentMessage.phase` 的取值枚举 |
| `schema/typescript/v2/ThreadItem.ts` | `agentMessage` 包含 `id/text/phase/memoryCitation` | `agentMessage` 本体携带最终回复识别与 memory citation 信息 |
| `schema/typescript/v2/ItemStartedNotification.ts` | `item/started` 携带完整 `ThreadItem` | final marker 可在 item 开始时获得 |
| `schema/typescript/v2/AgentMessageDeltaNotification.ts` | delta 只有 `threadId/turnId/itemId/delta` | `item/agentMessage/delta` 不携带 `phase`，不能靠 delta 判断 |
| `app-server-protocol/src/protocol/thread_history.rs` | `preserves_agent_message_phase_in_history` 测试保留 `FinalAnswer` | 历史回放也保留 phase |
| `packages/protocol/src/index.ts` | official broadcast normalization 已为 `agentMessage` 补 `phase: null`、`memoryCitation: null` | 现有 raw Desktop 广播安全层已经承认这两个官方字段 |
| Desktop `app-server-manager-signals-*.js` | active turn 中查找 message phase 是否为 `final_answer` | Desktop 用 phase 作为过程折叠分界 |
| Desktop bundle | 插入 synthetic `worked-for` item，状态为 `working/worked` | “已处理”是 renderer 派生项，不是 app-server 持久字段 |

## 当前损失统计

当前损失不只是 `phase`。只要官方 item 被转换成 Web 自定义 item，就会丢官方 identity 和未来扩展能力。

| 官方输入 | 当前 Web/domain 输出 | 已确认损失 | 影响 |
| --- | --- | --- | --- |
| `agentMessage` | `assistant` | 官方 `type` identity、`phase`、`memoryCitation`、未来新增字段 | 无法直接按 Desktop 语义识别 final answer；后续查字段要追转换链 |
| `userMessage` | `user` | 官方 `type` identity、`clientId`、原始 `content` 结构、`text_elements` 等未建模字段 | 三端 pending/user message 对齐和富内容展示容易缺信息 |
| `commandExecution` | `command` | 官方 `type` identity，以及未显式映射的官方命令执行字段 | 命令块后续细节展示和状态对齐受限 |
| `webSearch` 等工具类 item | `toolOutput` 或其他 Web item | 官方 `type` identity、`action` 结构、未显式映射字段 | 工具 UI 后续很难还原 Desktop 的真实状态 |
| 未知或未来新增官方 item | `unknown` 或被裁剪 | 完整官方 shape 的可展示/可诊断能力 | 官方增量更新时 Web 需要重新补数据入口 |

当前主要丢失/阻断点：

- `packages/domain/src/index.ts`：`MessageItem` 使用 Web 自定义 union，`agentMessage` 被归一化成 `assistant`，`userMessage` 被归一化成 `user`。
- `packages/api/src/index.ts`：API schema 只允许 Web 自定义 item 字段，未知官方字段会被阻断或剥离。
- `apps/web/src/app/appServerRealtimeReducer.ts`：`item/started`、`item/completed` 归一化为 Web item，未保留完整 `ThreadItem`。
- `apps/server/src/localLiveThreadStore.ts`：本地 live notification 聚合时同样转成 Web item。
- `apps/web/src/app/threadDetailRequests.ts`：live/stored detail merge 基于 Web item 签名，未按官方 type 和官方字段做 canonical 合并。

## 目标行为

1. domain/API 的 canonical `Turn.items` 使用官方 `ThreadItem` 结构和官方 `type`。
2. 官方已知字段完整保留；未知未来字段 passthrough，不因当前 UI 没用而丢弃。
3. `agentMessage.phase` 保留为 `"commentary" | "final_answer" | null`，用于最终回复识别。
4. `agentMessage.memoryCitation` 保留；本次不强行设计 UI，但不能从数据链路丢掉。
5. `item/started` 和 `item/completed` 中出现的完整 `ThreadItem` 必须按 id upsert/merge，不得裁剪。
6. `item/agentMessage/delta` 只追加 `agentMessage.text`；delta 先到时可创建最小 `agentMessage` stub，后续完整 item 到达后补齐字段。
7. 过程折叠优先使用 `item.type === "agentMessage" && item.phase === "final_answer"`。
8. 如果 `phase === null` 或缺失，保留最小旧数据 fallback，但 fallback 只服务旧数据，不成为新 canonical。
9. “已处理”折叠行仍是 renderer-local 派生状态，不写回 app-server、official IPC 或 SQLite。

## 非目标

- 不修改 official IPC raw request/notification shape。
- 不新增自定义 SQLite 表或影子存储官方已有数据。
- 不把 `owner/follower` 等同步诊断概念暴露给普通用户 UI。
- 不新增 `renderRole`、`displayKind`、`officialType`、`official.item` 等并行身份字段。
- 不继续扩展 `assistant/user/command/toolOutput` 作为官方 app-server 数据的 canonical shape。
- 不为旧官方客户端实现并行兼容层。
- 不借本次改动重构无关侧栏、审批、附件、搜索或同步链路。
- 不改变 `item/agentMessage/delta` 的协议含义。

## 硬性要求

- 每次实际改代码前，先按 `docs/official_first_implementation.md` 复核官方 schema/source，确认 `ThreadItem`、`MessagePhase`、`ItemStartedNotification`、`AgentMessageDeltaNotification` 未变化。
- Phase 0 必须先产出官方 `ThreadItem` variant/字段 inventory；不得凭记忆补字段。
- 实现必须保持最简；禁止大面积兼容、冗余兜底、过度异常处理和无依据 shape 猜测。
- canonical item 必须使用官方 `type`；不得把官方 `agentMessage` 再映射成 `assistant`。
- 官方字段保留在同一个 canonical item 对象上；不要用 raw sidecar 代替 canonical 模型。
- 只允许对 `phase` 做明确白名单归一化：`"commentary"`、`"final_answer"`、`null`。其他值不要创造新语义，可归为 `null` 并保留最小诊断或测试覆盖。
- 前端不得直接消费 app-server raw notification params；但可以消费 domain/API 暴露的 canonical official item。
- delta 没有 `phase`，不能猜；delta 先到只创建最小 `agentMessage` stub，后续 `item/started/completed` 按同 id 补齐。
- 不要把“已处理”折叠状态持久化，不写 SQLite，不发 official IPC。
- 旧 Web shape 的处理只能放在一个边界迁移函数里；renderer 和新 API response 不长期双轨。
- `apps/web/src/app/components/ChatMain.tsx` 当前约 3750 行，`apps/web/src/app/components/MessageBlocks.tsx` 约 2403 行，均超过项目 2000 行标准。本次涉及这两个文件时必须先做边界清晰的拆分准备，不得继续把官方 item 渲染、文本读取、折叠推导等逻辑堆回巨型组件。
- 保持用户现有工作区改动，不执行 `git add`、`git commit`、`git push`。

## 数据模型方案

目标不是在 Web item 上补几个字段，而是让 domain/API 的 `ThreadItem` 接近官方 schema。

示意类型：

```ts
type MessagePhase = "commentary" | "final_answer";

type AgentMessageItem = {
  type: "agentMessage";
  id: string;
  text: string;
  phase: MessagePhase | null;
  memoryCitation: unknown | null;
  [key: string]: unknown;
};

type UserMessageItem = {
  type: "userMessage";
  id: string;
  content: unknown[];
  clientId: string | null;
  [key: string]: unknown;
};

type UnknownOfficialThreadItem = {
  type: string;
  id?: string;
  [key: string]: unknown;
};

type ThreadItem =
  | AgentMessageItem
  | UserMessageItem
  // Continue with official variants from Phase 0 inventory.
  | UnknownOfficialThreadItem;
```

建模规则：

| 输入 | canonical 输出 |
| --- | --- |
| official `agentMessage` | 保留 `type: "agentMessage"`、`id`、`text`、`phase`、`memoryCitation` 和未知字段 |
| official `userMessage` | 保留 `type: "userMessage"`、`id`、`content`、`clientId` 和未知字段；显示文本由 helper 派生 |
| official `commandExecution` | 保留 `type: "commandExecution"` 和官方字段；命令 UI 从官方字段读取 |
| official `webSearch` | 保留 `type: "webSearch"`、`action`、`query` 等官方字段和未知字段 |
| future official item | 保留原始 `type` 和全部字段，渲染层用 unknown official item fallback |
| legacy Web `assistant` | 仅在旧数据入口迁移为 `agentMessage`；不作为新 canonical |
| delta 创建的新 item | 创建最小 `agentMessage` stub：`type/id/text/phase:null/memoryCitation:null` |
| completed full item | 按 id 合并/覆盖 stub，并保留完整官方字段 |

## 前端拆分计划

本计划涉及的前端入口中，`ChatMain.tsx` 和 `MessageBlocks.tsx` 已超过项目标准。官方 ThreadItem canonical 化会扩大消息渲染分发面，如果继续在这两个文件内追加判断，后续维护成本会继续上升。因此 UI 阶段必须把拆分作为实施前置条件，而不是“有空再做”的清理项。

当前行数统计：

| 文件 | 当前行数 | 状态 | 本次要求 |
| --- | ---: | --- | --- |
| `apps/web/src/app/components/ChatMain.tsx` | 3750 | 超过 2000 行 | 折叠布局和 turn 派生逻辑不得继续内联堆叠，必须抽到 helper/hook |
| `apps/web/src/app/components/MessageBlocks.tsx` | 2403 | 超过 2000 行 | 官方 item 渲染分发和具体 block 组件必须拆出边界 |

建议拆分目标：

| 新文件/目录 | 责任边界 | 迁移内容 |
| --- | --- | --- |
| `apps/web/src/app/officialThreadItems.ts` | official ThreadItem 文本读取、类型 guard、legacy Web shape 边界迁移 helper | `agentMessage/userMessage/commandExecution/webSearch` 的读取和展示辅助，不包含 React |
| `apps/web/src/app/turnProcessCollapse.ts` | 最终回复识别、过程区切分、active operation guard、折叠状态输入模型 | 从 `ChatMain.tsx` 中抽离 turn layout 推导逻辑 |
| `apps/web/src/app/components/messageBlocks/AgentMessageBlock.tsx` | 渲染 `agentMessage` 正文、Markdown、图片、memory citation 占位扩展点 | 从 `MessageBlocks.tsx` 中拆出 assistant/agent message 渲染 |
| `apps/web/src/app/components/messageBlocks/UserMessageBlock.tsx` | 渲染 `userMessage`，从官方 `content` 派生文本和附件展示 | 从 `MessageBlocks.tsx` 中拆出 user 渲染 |
| `apps/web/src/app/components/messageBlocks/CommandExecutionBlock.tsx` | 渲染 `commandExecution` 状态、命令、输出、cwd/duration/exit code | 从 `MessageBlocks.tsx` 中拆出现有 command block |
| `apps/web/src/app/components/messageBlocks/ToolOrOfficialUnknownBlock.tsx` | 渲染 webSearch、未知 official item 和诊断 fallback | 避免 `MessageBlocks.tsx` 继续积累工具分支 |
| `apps/web/src/app/components/messageBlocks/index.ts` | 消息块导出和渲染分发表入口 | 让 `MessageBlocks.tsx` 收敛为薄入口或逐步被替代 |

拆分约束：

- 拆分必须保持现有视觉和交互，不借机重做样式。
- 每个新组件只接受 canonical official item 或 helper 处理后的 view model，不接 app-server raw notification params。
- `ChatMain.tsx` 不新增大段折叠算法，只调用 `turnProcessCollapse.ts` 的纯函数结果。
- `MessageBlocks.tsx` 不新增大型 switch 分支；新增 official item 渲染优先放入 `messageBlocks/` 子组件。
- 拆分后至少为 `officialThreadItems.ts`、`turnProcessCollapse.ts` 和主要 message block 增加或调整单测。
- 如果某次 Phase 无法完成完整拆分，必须先抽纯函数和分发表，不能继续扩大巨型组件作为临时方案。

## 折叠规则方案

最终回复定位：

1. 在 turn items 中优先查找第一个 `item.type === "agentMessage" && item.phase === "final_answer"`。
2. 若 active turn 中没有 final phase，则 fallback 到旧数据序列规则；该 fallback 不得要求 renderer 支持旧 `assistant` canonical。
3. `item.type === "agentMessage" && item.phase === "commentary"` 一律不作为最终回复。
4. 最终回复后如果又出现命令、工具、文件变更、审批等非静默过程项，折叠布局必须失效，回到原始顺序，避免隐藏正在运行的状态。
5. active operation 不进入“已处理”折叠区。
6. `userMessage` 和 steer/guidance 用户消息始终可见，不进入过程折叠区。

折叠行：

- label：`已处理`
- active 且 final answer 已开始：可用 first work item start 到 final answer start 或当前时间展示持续时长。
- completed：优先用官方 turn `durationMs`；缺失时用 `startedAtIso/completedAtIso` 或现有 turn 元数据推导。
- 展开状态只保存在前端本地 state，以 turn id 为 key。

## 实施步骤

| Phase | 目标 | 主要文件 | 具体动作 | 验收标准 | 硬性注意 |
| --- | --- | --- | --- | --- | --- |
| 0 | 复核官方证据和字段 inventory | `docs/official_first_implementation.md`、官方 schema/source、`git status` | 重新确认 `ThreadItem` variants、`agentMessage.phase/memoryCitation`、`ItemStartedNotification`、delta shape；记录当前 dirty worktree | 能列出本次需要支持的官方 item type 和字段来源 | 不改无关文件；不 revert 用户改动 |
| 1 | 定义 canonical official ThreadItem 模型 | `packages/domain/src/index.ts`、domain tests | 用官方 `type` 重建 `Turn.items` 类型；已知字段显式建模，未知字段 passthrough；移除新数据对 `assistant/user/command` canonical 的依赖 | domain 类型中 `agentMessage` 不再变成 `assistant`；未知字段 roundtrip 保留 | 不新增 `renderRole/displayKind/officialType` |
| 2 | 改造 domain 归一化 | `packages/domain/src/index.ts`、`packages/domain/src/index.test.ts` | `normalizeMessageItem` 对 official item 做无损 clone + 最小 schema normalization；旧 Web item 只在边界迁移到官方 type | 测试覆盖 `agentMessage` 保留 type、phase、memoryCitation、未知字段；`userMessage.content/clientId` 保留 | 旧 shape 迁移集中在一个函数 |
| 3 | 扩展 API schema 为 passthrough 官方 item | `packages/api/src/index.ts`、API tests | message item schema 改为官方 type discriminated/loose passthrough；不剥离未知官方字段 | API response 能返回完整官方 item；非法基础结构仍被拒绝 | 不把 raw params 直接暴露为另一套 sidecar |
| 4 | 改造 Web realtime reducer | `apps/web/src/app/appServerRealtimeReducer.ts`、对应测试 | `item/started/completed` upsert 完整 official item；`item/agentMessage/delta` append 到 `agentMessage.text`；delta stub 后续由 full item 补齐 | reducer 测试覆盖 delta 先到、full item 后到、phase 保留、未知字段保留 | delta 没有 phase，不要猜 |
| 5 | 改造 server local live store | `apps/server/src/localLiveThreadStore.ts`、对应测试 | 本地 app-server notification 聚合保留完整 official item；delta 合并不丢已有字段 | server live store 测试覆盖完整 official item roundtrip | 不新增 SQLite 持久化 |
| 6 | 改造 thread detail merge | `apps/web/src/app/threadDetailRequests.ts`、server thread detail tests | 按官方 type/id 合并 live/stored detail；同 id 合并时保留更完整字段；文本去重 helper 改为读取官方 item text | 历史 summary 刷新不丢 live official 字段；不重复 item | 不为字段建单独缓存 |
| 7 | 前端基础 helper 拆分 | `apps/web/src/app/officialThreadItems.ts`、测试 | 抽 official item type guard、文本读取、legacy Web shape 边界迁移 helper；渲染层统一使用这些 helper | helper 单测覆盖 agentMessage/userMessage/commandExecution/webSearch 和 legacy assistant 迁移 | 不把 helper 写进 `ChatMain.tsx` 或 `MessageBlocks.tsx` |
| 8 | 拆分 MessageBlocks 渲染组件 | `apps/web/src/app/components/messageBlocks/*`、`MessageBlocks.tsx`、组件测试 | 建立 `messageBlocks/` 子目录；拆出 `AgentMessageBlock`、`UserMessageBlock`、`CommandExecutionBlock`、unknown/tool block；`MessageBlocks.tsx` 收敛为薄分发入口 | 现有消息块视觉不退化；官方 type fixture 能直接渲染；`MessageBlocks.tsx` 不继续膨胀 | 不新增大型 switch 到巨型文件 |
| 9 | 抽出最终回复识别 helper | `apps/web/src/app/turnProcessCollapse.ts`、测试 | 写纯函数：识别 final `agentMessage` index、process items、post-final invalidation、active operation guard | 单测覆盖 final phase、commentary、phase null fallback、final 后又出现工具 | helper 输入为 official ThreadItem |
| 10 | 接入过程折叠渲染 | `ChatMain.tsx`、`MessageBlocks.tsx` 或拆分后的 turn rendering 入口 | 用 helper 派生布局：userMessage 可见、过程折叠、final agentMessage 可见；展开后渲染过程项；必要时抽 turn rendering 子组件/hook | active final answer 开始时立即出现“已处理”，final 正文继续流式追加 | `ChatMain.tsx` 只接线，不内联大段算法；折叠状态只在 React local state |
| 11 | UI/i18n 收口 | `packages/i18n/src/locales/*.json`、相关组件 | 如当前文案未进 i18n，将 `已处理`、展开/折叠 aria 文案接入 i18n | 中文 UI 与 Desktop 截图一致；英文不出现空文案 | 不在 UI 显示 `phase/final_answer` |
| 12 | 回归测试 | domain/api/server/web vitest、必要 e2e | 跑最小相关测试，再按风险跑 web/server/domain/api/typecheck | 相关测试通过；若 e2e 未跑需说明原因 | 不用 mock 替代真实官方链路验收 |
| 13 | 真实链路验收 | Desktop / VS Code / Web 三端 | 用 Desktop 发起包含命令/工具的 active turn，Web 观察 final answer 开始时是否立即折叠 | Web 与 Desktop 行为一致；展开后过程项仍可读 | 不暴露 owner/follower 给普通用户 |

## 推荐测试用例

Domain：

- raw `agentMessage` -> domain item 仍是 `type: "agentMessage"`。
- raw `agentMessage.phase = "final_answer"` -> canonical `agentMessage.phase = "final_answer"`。
- raw `agentMessage.phase = "commentary"` -> canonical `agentMessage.phase = "commentary"`。
- raw `agentMessage.phase = "unknown"` -> canonical `agentMessage.phase = null`。
- raw `agentMessage.memoryCitation` 和未知字段 roundtrip 保留。
- raw `userMessage.clientId/content/text_elements` roundtrip 保留。
- legacy `{ type: "assistant" }` 只在边界迁移为 `agentMessage`，新输出不再产生 `assistant`。

API：

- official `agentMessage`、`userMessage`、`commandExecution` 能通过 schema。
- 未知官方字段不会被剥离。
- 缺少基础 `type` 的 item 仍走 unknown/fallback，不污染官方 canonical。

Realtime reducer：

- `item/started` 带 full `agentMessage` 后，后续 `item/agentMessage/delta` 保留 `phase/memoryCitation/unknownField`。
- delta 先到创建最小 `agentMessage` stub；随后 `item/completed` 带 full item 后补齐字段。
- `commentary` agentMessage 不触发 final folding。

Collapse helper：

- `userMessage + commandExecution completed + agentMessage(final_answer)` -> command 进入“已处理”，agentMessage 可见。
- `userMessage + agentMessage(commentary) + commandExecution + agentMessage(final_answer)` -> commentary 和 command 都属于过程区。
- `userMessage + commandExecution active + agentMessage(final_answer)` -> active command 不被折叠。
- `agentMessage(final_answer) + commandExecution` -> 取消折叠，按原始顺序显示。
- `phase null` 的旧数据仍走最小 fallback。

UI / e2e：

- active stream 中 final `agentMessage` item 一出现，即可看到“已处理”行。
- final `agentMessage.text` 继续追加，不被折叠行吞掉。
- 展开“已处理”后，命令、工具、文件变更仍可读。
- 移动端无横向溢出，Composer 不被折叠行遮挡。

## 建议命令

按改动范围逐步运行：

```powershell
pnpm --filter @codex-web/domain test
pnpm --filter @codex-web/api test
pnpm --filter @codex-web/server test
pnpm --filter @codex-web/web test
pnpm typecheck
```

如果改到实际 UI 折叠渲染，再补：

```powershell
pnpm test:e2e -- tests/e2e/message-blocks.spec.ts
```

真实三端同步验收仍按 `docs/sync_acceptance_checklist.md` 和 `docs/troubleshooting_sync.md` 走官方链路，不用 mock 数据替代。

## 交付清单

- [x] domain/API canonical `Turn.items` 使用官方 `ThreadItem.type`。
- [x] 新数据不再产生 Web 自定义 `assistant/user/command` 作为官方 item 的 canonical shape。
- [x] `agentMessage.phase`、`agentMessage.memoryCitation` 和未知字段不丢。
- [x] `userMessage.clientId/content` 等官方字段不丢。
- [x] app-server realtime reducer 和 local live store 保留完整 official item。
- [x] thread detail merge 不丢 official item 字段。
- [x] `officialThreadItems.ts` 承接 official item type guard、文本读取和 legacy shape 边界迁移。
- [x] `turnProcessCollapse.ts` 承接最终回复识别和过程折叠推导。
- [x] `MessageBlocks.tsx` 的官方 item 渲染迁移到 `components/messageBlocks/` 子组件，避免继续膨胀。
- [x] `ChatMain.tsx` 只负责接线和状态，不内联新增折叠算法。
- [x] 前端渲染按 official type 分发。
- [x] 前端折叠逻辑优先使用 `agentMessage.phase === "final_answer"`。
- [x] `commentary` 不触发最终回复折叠。
- [x] `phase === null` 保留最小旧数据 fallback。
- [x] “已处理”仍为 renderer-local 派生项，不持久化。
- [x] 单元测试覆盖 official type 保留、未知字段保留、final phase、commentary、delta 合并、fallback。
- [x] 至少一次真实 Desktop -> Web active stream 人工验收。

## 风险与回滚

| 风险 | 影响 | 控制方式 |
| --- | --- | --- |
| 一次迁移范围过大 | UI 渲染和 API 消费面同时变化 | 按 Phase 推进；先让 domain/API 同时通过官方 fixture，再改 UI |
| 旧 Web shape 残留 | renderer 双轨、后续难维护 | 旧 shape 只在边界迁移；新增测试禁止新输出产生 `assistant` canonical |
| provider 不发 phase | final answer 无法靠官方 marker 判断 | 保留最小旧数据序列 fallback |
| delta 先于 item started 到达 | 初始 item 只有 text delta | 用最小 `agentMessage` stub，full item 到达后合并 |
| 把 commentary 当 final | 过早折叠过程说明 | 明确 `commentary` 不触发 final |
| passthrough 变成无约束垃圾桶 | 难排障、难测试 | 已知字段显式建模，未知字段只保留不解释；测试覆盖 roundtrip |
| helper 逻辑塞进巨型组件 | 后续难维护 | 抽纯函数和单测，减少 `ChatMain.tsx`/`MessageBlocks.tsx` 增量 |

## 子 agent 执行提示

执行时先从 Phase 0 开始，不要直接写 UI。第一优先级是把 domain/API 的 canonical item 从 Web 自定义 shape 改成官方 `ThreadItem` shape，并用测试防止 `agentMessage -> assistant` 这类改名继续发生。

若发现官方 schema 与本文不一致，停止实现并更新本计划，不要凭本文继续猜接口。完成每个 Phase 后跑对应最小测试，再进入下一阶段。
