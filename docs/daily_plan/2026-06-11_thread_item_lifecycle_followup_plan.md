# Official ThreadItem Lifecycle Follow-up Plan

日期：2026-06-11
状态：in_progress
适用范围：`webSearch` 生命周期显示、已处理展开渲染、official 字段 merge、domain official item passthrough、SQLite 派生缓存清理、legacy renderer 边界收口

## 背景

2026-06-10 的主计划已经把目标定为：`Turn.items` 以官方 `ThreadItem` 为 canonical，官方字段不裁剪，未知未来字段 passthrough，前端按 official `type` 渲染，“已处理”折叠只作为 renderer-local 派生状态。

今天复核子 agent 的后续审查意见后，确认还有三个收口问题值得在本轮处理：

1. 展开“已处理”时，statusless official `webSearch` 可能被 active `turnStatus` 误判成“正在搜索网页”。
2. server raw detail merge 对 `phase`、`memoryCitation`、`action` 等 official 字段保护不足，可能用 app-server snapshot 里的空值覆盖 live 里的更完整值。
3. domain `webSearch` normalizer 仍主动剥离 `status/state/searchQuery/search_query`，与“未来官方字段 passthrough”目标不一致。

本方案是 2026-06-10 主计划的延续。前半部分针对字段保真和 lifecycle 展示做最小修复；后半部分继续处理 10 号计划中仍未完全收口的 legacy renderer 边界和 SQLite 影子缓存。

## 官方依据

本次复核来源：

- OpenAI 官方 app-server 文档：`https://developers.openai.com/codex/app-server`
- 本机官方 schema：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server-protocol\schema\typescript\v2\ThreadItem.ts`
- 本机官方 schema：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server-protocol\schema\typescript\v2\ItemStartedNotification.ts`
- 本机官方 schema：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server-protocol\schema\typescript\v2\AgentMessageDeltaNotification.ts`
- 本机官方测试：`C:\Users\user\AppData\Local\Temp\openai-codex\codex-rs\app-server\tests\suite\v2\web_search.rs`
- 项目约束：`docs/official_first_implementation.md`
- SQLite 踩坑记录：`docs/pitfalls/2026-06-02_sqlite-shadow-backend.md`
- 主计划：`docs/daily_plan/2026-06-10_agent_message_phase_collapse_plan.md`

关键结论：

| 证据 | 结论 |
| --- | --- |
| 官方文档 `ThreadItem` 列表中 `webSearch` 为 `{id, query, action?}` | 当前官方 `webSearch` item 本身没有 `status` 字段 |
| `ThreadItem.ts` 中 `webSearch` 为 `{ type: "webSearch", id, query, action }` | canonical 不应给 `webSearch` 注入自定义 `status` |
| `ItemStartedNotification.ts` 携带完整 `ThreadItem` 和 `startedAtMs` | “正在运行”属于 item lifecycle 事件语义，不是 `webSearch` item 字段 |
| `AgentMessageDeltaNotification.ts` 只有 `itemId/delta` | delta 不携带 `phase`，`phase` 只能来自完整 `agentMessage` item |
| 官方 `web_search.rs` 同时等待 `webSearch` started/completed，历史回放只保留 completed item | live 中可用 started/completed 判断生命周期；历史中看到的 `webSearch` 基本应按已完成展示 |
| `docs/official_first_implementation.md` 要求官方已有数据不得复制进 SQLite | thread/list/detail/project 这类官方可读数据不应继续落本地库 |
| `docs/pitfalls/2026-06-02_sqlite-shadow-backend.md` 已确认 `projects`、`threads`、`thread_details` 是影子后端来源 | 本次应移除派生缓存读写入口，只保留启动清理旧库残留 |

因此：**不要新增 canonical `webSearch.status`，也不要把 active `turnStatus` 当成 statusless `webSearch` 的 active 证据。**

## 本次目标

1. statusless official `webSearch` 在普通历史或“已处理”展开区展示为已完成语义，不再因为 turn 仍 active 而显示“正在搜索网页”。
2. 如果未来官方真的给 `webSearch` 增加 `status/state` 等字段，domain/API canonical 必须原样保留，不提前裁剪。
3. server raw detail merge 对 official 核心字段做明确合并规则，避免同 id item 的空 snapshot 覆盖 live 完整字段。
4. 所有修复保持 renderer/local 派生边界，不向 official canonical item 注入 Web 自定义字段。
5. 清理 SQLite 中用于官方 thread/list/detail/project 的派生缓存入口，避免后续继续读写旧 Web shape。
6. 将 legacy `user/assistant` renderer 双轨作为 10 号计划延续项纳入，但按独立阶段处理，避免一次性破坏旧 fixture 和热运行状态。

## 非目标

- 不新增 `webSearch.status`、`displayStatus`、`lifecycleStatus` 等字段到 canonical `MessageItem`。
- 不把 `item/started` / `item/completed` 生命周期持久化到 SQLite。
- 不改 official raw request/notification shape。
- 不重做 10 号主计划已经完成的 domain/API canonical 迁移。
- 不为未证实的协议形态增加大面积兼容代码。
- 不把附件表和附件文件暂存一并删除；附件是 Web 上传流程的本地暂存数据，需另行复核官方附件上传/引用能力后再迁移。

## 问题 1：`webSearch` active 判断与“已处理”展开语义

### 当前风险

当前触点：

- `apps/web/src/app/components/MessageBlocks.tsx`
  - `isWebSearchItemActive(...)`
  - `renderTurnItems(...)` 中 `ProcessedTurnItemsMessage` 展开时继续传入原始 `turnStatus`
- `apps/web/src/app/components/messageBlocks/ToolOrOfficialUnknownBlock.tsx`
  - `isWebSearchActiveForTurn(...)`

当前逻辑会把 `status === null` 的 official `webSearch` 在 active turn 中当成 active。由于官方 `webSearch` 本身没有 `status`，这会造成：

- 最终回复已经开始流式输出时，“已处理”展开后的 web search 仍可能显示“正在搜索网页”。
- 历史或 completed item 在 active turn 背景下被误染成 active。
- UI 语义和官方模型冲突：`turnStatus` 是 turn 生命周期，不是 item 的官方状态字段。

### 方案

最小修复原则：

1. `webSearch` active 只来自明确证据：
   - legacy `toolOutput` 继续走现有 operation active 判断；
   - official/future item 若真的有可读 `status`，只在 `status` 是 active 值时显示 active；
   - `status === null` 或缺失时，不因 `turnStatus` active 自动显示 active。
2. `ProcessedTurnItemsMessage` 展开区不应让 statusless process item 继承 active turn 的进行中语义。
3. 如未来要做到精确 started/completed live 窗口，应在 renderer/live 层维护临时 lifecycle view state，按 item id 从 `item/started` / `item/completed` 派生；该状态不得写回 canonical item。

建议改动：

- `MessageBlocks.tsx`
  - 将 `isWebSearchItemActive(...)` 中 official `webSearch` 的最终判断从 `isActiveMessageStatus(status) || status === null` 改为只接受明确 active 状态。
  - `toolOutput` legacy 路径不变。
- `ToolOrOfficialUnknownBlock.tsx`
  - 将 `isWebSearchActiveForTurn(...)` 中 `(!status && item.type === "webSearch")` 的 fallback 移除。
  - 保留对明确 active `status` 的读取，作为未来 official passthrough 字段或 legacy 数据的最小支持。
- 测试覆盖：
  - active turn + statusless `webSearch` 渲染为“已搜索网页”，不是“正在搜索网页”。
  - statusless `webSearch` 在“已处理”展开或 nested render 场景中不显示 active 文案。
  - legacy active `toolOutput` web search 行为不退化。

## 问题 2：server raw detail merge 覆盖 official 字段

### 当前风险

当前触点：

- `apps/server/src/app.ts`
  - `RICH_TEXT_ITEM_KEYS`
  - `mergeItemWithRicherText(...)`
  - `mergeBaseItemWithOther(...)`

当前 merge 只对文本类字段按“更丰富值”保留。对于 official 字段：

- `agentMessage.phase`
- `agentMessage.memoryCitation`
- `webSearch.action`

如果 primary/app-server detail 里同 id item 的字段是 `null` 或较短，而 live item 已经有更完整值，就可能被 `{ ...liveRecord, ...primaryRecord }` 覆盖掉。

最典型风险是：live `agentMessage.phase = "final_answer"`，detail snapshot 同 id `phase = null`，merge 后 final marker 丢失，过程折叠无法稳定识别最终回复。

### 方案

在 server raw detail merge 中增加 official 字段的明确合并规则，但不要引入大面积字段猜测。

建议规则：

| 字段 | 合并规则 |
| --- | --- |
| `agentMessage.phase` | 非空优先；如果任一侧为 `"final_answer"`，保留 `"final_answer"`；否则保留 primary 非空值，再退 live 非空值 |
| `agentMessage.memoryCitation` | 非空优先；两侧均非空时保留 JSON score 更大的值 |
| `webSearch.action` | 非空优先；两侧均非空时保留 JSON score 更大的值 |

实现边界：

- 可新增小型 helper，例如 `mergeOfficialItemField(...)` 或 `mergeOfficialItemRecord(...)`。
- 不要把所有字段都纳入 JSON 长度启发式；只处理已确认的 official 关键字段。
- 不要把这些字段复制进 SQLite 或单独缓存。
- 不要改变 thread item 顺序和 duplicate user item 去重策略。

测试覆盖：

- 同 id `agentMessage`：primary `phase: null`，live `phase: "final_answer"`，merge 后保留 `"final_answer"`。
- 同 id `agentMessage`：primary `memoryCitation: null`，live 有 `memoryCitation`，merge 后不丢。
- 同 id `webSearch`：primary `action: null`，live 有 `action`，merge 后不丢。

## 问题 3：domain `webSearch` passthrough 裁剪

### 当前风险

当前触点：

- `packages/domain/src/index.ts`
  - `normalizeOfficialThreadItem(...)` 的 `type === "webSearch"` 分支

当前代码显式剥离：

```ts
const { search_query, searchQuery, state, status, ...webSearchFields } = record
```

这虽然避免了把历史兼容字段当成当前官方字段解释，但也会把未来官方新增字段提前丢掉。与 10 号主计划里的“官方已知字段完整保留、未知未来字段 passthrough”冲突。

### 方案

domain 层应区分“保留字段”和“解释字段”：

1. 不再主动 destructuring 删除 `status/state/searchQuery/search_query`。
2. 返回 canonical `webSearch` 时保留 `...record`，只覆盖当前官方已知字段：
   - `type: "webSearch"`
   - `id`
   - `query`
   - `action: record.action ?? null`
3. 不合成 `status`。
4. 如果输入没有 `status`，输出也没有 `status`。
5. 如果未来官方或测试 fixture 提供了新字段，domain 原样 passthrough，但 UI 只有在字段有明确官方语义后才解释。

测试覆盖：

- official-shaped `webSearch` 无 `status` 输入，输出仍无 `status`。
- 带未知字段的 `webSearch` roundtrip 保留。
- 带 `state` 或其他未来字段的 `webSearch` roundtrip 保留。
- 不再要求 domain 删除 `state/status` 这类未知字段；只要求不主动合成。

## 问题 4：前端 detail merge 的 official 字段规则未完全对齐

### 当前风险

当前触点：

- `apps/web/src/app/threadDetailRequests.ts`
  - `mergedItemValue(...)`
  - `mergeItemWithLiveData(...)`
- `apps/web/src/app/appServerRealtimeReducer.ts`
  - 同 id item merge
- `apps/server/src/localLiveThreadStore.ts`
  - 同 id item merge

已确认的缺口：

1. `agentMessage.memoryCitation` 在前端 detail merge 中仍是 incoming 非空直接获胜。如果 current/live 是更完整 citation，而 incoming snapshot 只有 `{}` 或较短对象，会丢官方字段。
2. `agentMessage.phase` 必须遵守“任一侧为 `final_answer` 则保留 `final_answer`”，不能让较晚的 `"commentary"` 覆盖 final marker。
3. realtime reducer 和 local live store 的同 id item merge 也必须保护 `phase/memoryCitation/webSearch.action`，避免 `item/started` 已有完整字段、`item/completed` 或 snapshot 带空值时覆盖。

### 方案

复用 server raw detail merge 的语义，但保持 helper 小而明确：

| 字段 | 合并规则 |
| --- | --- |
| `agentMessage.phase` | 任一侧为 `"final_answer"` 则保留 `"final_answer"`；否则 incoming 非空优先，再退 current |
| `agentMessage.memoryCitation` | 非空优先；两侧均非空时保留 JSON score 更大的值 |
| `webSearch.action` | 非空优先；两侧均非空时保留 JSON score 更大的值 |
| `agentMessage.text` | detail merge 中 incoming text 仍是权威 snapshot；realtime delta/started/completed 保留现有文本规则 |

测试覆盖：

- current/live `memoryCitation` 更完整，incoming `{}` 或较短对象时保留 current。
- current/live `phase: "final_answer"`，incoming `phase: "commentary"` 时保留 final marker。
- reducer/local live store 中 started item 有 `phase/action`，completed item 为 `null` 时不丢。
- 输入自带 `webSearch.status` 时 passthrough；输入无 `status` 时不合成。

## 问题 5：“已处理”展开区 statusless process item 继承 active turn

### 当前风险

当前触点：

- `apps/web/src/app/components/messageBlocks/ProcessedTurnItemsMessage.tsx`
  - 展开时将原始 active `turnStatus` 传回 nested `renderTurnItems(...)`
- `apps/web/src/app/components/MessageBlocks.tsx`
  - `isReasoningItemActive(...)`
  - `ReasoningMessage(...)`

6/11 已修 `webSearch`，但同类问题仍存在于 official `reasoning`。官方 `reasoning` item 本身没有稳定 item-level `status`；如果 final answer 已开始、reasoning 被折进“已处理”，展开时继续传 active turn status，UI 可能显示“正在思考”，和“已处理”的语义冲突。

### 方案

建议在 renderer 层引入“processed context”或“force complete”语义，而不是给 canonical item 注入字段：

1. `ProcessedTurnItemsMessage` 展开时应让 nested render 以已处理/完成语义渲染 process items。
2. `reasoning` 在 processed 展开区应可读，但不显示 active 文案；label 应为“已思考”或等价完成态。
3. 不改变普通 active turn 末尾 reasoning 的行为；当前正在思考仍可显示“正在思考”。
4. 不把 `reasoning.status` 写进 canonical item，也不把 turn-level active 状态当成 processed item 的状态。

测试覆盖：

- `userMessage + reasoning(status null) + agentMessage(final_answer)` 在 active turn 中折叠为“已处理”。
- 展开“已处理”后 reasoning 可读，且不出现“正在思考”。
- 普通 active turn 的最后一个 statusless reasoning 仍显示 active 语义。

## 问题 6：renderer legacy `user/assistant` 双轨边界

### 当前风险

10 号主计划要求：

- 旧 Web shape 只做边界迁移。
- 新数据不再产生 Web 自定义 `assistant/user/command/toolOutput` 作为官方 item 的 canonical shape。
- renderer 不长期同时支持两套 canonical item。

当前触点：

- `apps/web/src/app/officialThreadItems.ts`
  - `isUserMessageItem(...)` 仍将 `user` 当作 user message。
  - `isAgentMessageItem(...)` 仍将 `assistant` 当作 agent message。
- `apps/web/src/app/components/messageBlocks/AgentMessageBlock.tsx`
  - `AgentMessageBlockItem` 仍接收 legacy `assistant`。
- 测试 fixture 中仍有较多 `{ type: "assistant" }` / `{ type: "user" }`。

这属于 10 号计划范围，也应作为 11 号延续项纳入；但它不是字段级小修，不能直接删除 renderer 支持，否则可能影响旧 fixture、热运行内存 state 和仍未迁移的边界测试。

### 方案

按独立阶段收口：

1. 先确认所有新 app-server / official IPC / domain API 输出都已经经过 `normalizeMessageItem(...)`，不再产生 legacy canonical。
2. 为新 API/domain 输出添加禁止 legacy canonical 的测试。
3. 将 legacy `user/assistant/command/toolOutput` 支持集中在边界迁移 helper，而不是 message block 一等分发。
4. 逐步把 renderer component 类型收窄到 official item：
   - `AgentMessageBlock` 只接 `agentMessage`。
   - `UserMessageBlock` 只接 `userMessage`。
   - legacy 数据在进入 renderer 前迁移。
5. 删除或改写测试 fixture 中不再代表真实 canonical 的 legacy item；仅保留明确标注的历史边界测试。

验收标准：

- `renderTurnItems(...)` 的主分发不再把 legacy `assistant/user` 当一等 canonical。
- 旧 SQLite 派生缓存不再作为 legacy 数据来源。
- 新 API response / realtime event / domain normalization 测试禁止输出 legacy official item shape。

## 问题 7：SQLite 官方派生缓存仍有残留入口

### 当前风险

当前触点：

- `apps/server/src/db/schema.ts`
  - `projects`
  - `threads`
  - `threadDetails`
- `apps/server/src/db/index.ts`
  - `upsertProjects(...)`
  - `listProjects(...)`
  - `upsertThreads(...)`
  - `upsertThreadDetail(...)`
  - `readThreadDetail(...)`
  - `deleteThread(...)` 中删除 `threads/thread_details`
  - `status()` / `clearDerivedCaches()` 中 `projectCount/threadCount/threadDetailCount`
- `apps/server/src/app.ts`
  - 启动时 `clearDerivedCaches()`
  - 文件浏览允许根仍从 `database.listProjects()` 读取 known project paths
- 相关测试：
  - `apps/server/src/dbStore.test.ts`
  - `apps/server/src/threadDetailRoute.test.ts`
  - `apps/server/src/threadRenameRoute.test.ts`
  - `packages/api/src/index.test.ts`
  - `apps/server/src/diagnosticsExport.test.ts`

根据 `docs/pitfalls/2026-06-02_sqlite-shadow-backend.md`，这些表属于官方数据的影子缓存来源。虽然当前启动会清掉它们，残留读写方法仍会让后续实现误以为可以继续缓存 official thread/list/detail/project。

### 方案

目标是彻底移除官方派生缓存能力，只保留迁移清理旧库残留：

1. 新数据库不再创建 `projects`、`threads`、`thread_details` 表。
2. 删除 `upsertProjects/listProjects/upsertThreads/upsertThreadDetail/readThreadDetail` 等读写 API。
3. `clearDerivedCaches()` 改为 drop 旧库里的 `projects`、`threads`、`thread_details`、`official_stream_states`，而不是继续维护这些表。
4. `status()` / diagnostics / API schema 移除 `projectCount/threadCount/threadDetailCount`，或改名为只用于 cleanup result 的 legacy dropped count，不再作为常规数据库状态。
5. `deleteThread(...)` 只删除 Web 自定义本地状态：
   - `pinned_threads`
   - 和该 thread 相关的 attachment 关联或附件清理策略
   - 不再删除不存在的 `threads/thread_details`
6. `app.ts` 文件浏览允许根不再调用 `database.listProjects()`；改用：
   - `config.projectRoot`
   - `readFavoriteProjectPaths(config)`
   - `readDesktopWorkspaceRoots()`
   - request 明确传入的 root

测试覆盖：

- 新数据库只创建 Web-owned 表：`pinned_threads`、`attachments`，不创建 `projects/threads/thread_details/official_stream_states`。
- 旧数据库若已有 `projects/threads/thread_details/official_stream_states`，启动或 cleanup 后被 drop。
- thread detail route 在 app-server 失败时不读取 SQLite fallback，直接返回官方错误。
- rename/archive/delete 等路径不再断言 `readThreadDetail(...)`。
- diagnostics/cache status 不再报告官方派生缓存计数。

## 附件边界说明：为什么本次不一起删除

附件表和 thread/list/detail 派生缓存不同。

当前 Web 上传流程：

1. 用户在 Web Composer 选择文件。
2. 浏览器 `POST /api/attachments` 到 Web server。
3. Web server 将文件暂存到 `data/attachments`。
4. SQLite `attachments` 表记录本地暂存元数据：`id/filename/mimeType/size/path/sha256/threadId/turnId/officialReferenceId`。
5. 用户发送 turn/steer 时，Web 根据 `attachmentIds` 读取这些暂存文件，并转换成 app-server 参数。

因此附件当前是 Web 上传 UI 的本地暂存状态，不是官方 thread/detail 的派生缓存。它承载发送前预览、删除、队列、失败重试、未关联附件清理等 Web 端行为。

本次处理原则：

- 不把附件表作为 SQLite shadow backend 一起删除。
- 不把附件文件本体长期伪装成官方 thread 数据。
- 后续需单独复核官方 app-server 是否已有“先上传附件并返回官方 file/reference id”的接口。
- 如果官方已有上传/引用接口，应另开计划迁移：优先走官方附件引用，SQLite 仅保留发送前最小 UI draft 状态或不保留。

## 推荐实施顺序

1. 复核当前工作区状态：`git status --short`，只改本方案列出的文件。
2. 字段和 lifecycle 小修：
   - domain `webSearch` passthrough。
   - server raw detail merge。
   - web realtime reducer / local live store / threadDetailRequests merge 对齐。
   - webSearch 和 reasoning 的 statusless processed 展示。
3. SQLite 影子缓存清理：
   - 删除官方派生缓存读写 API。
   - 新库不再创建 `projects/threads/thread_details`。
   - 旧库启动/cleanup drop 残留表。
   - 文件浏览 root 来源改为配置/官方 workspace roots，不再从 SQLite project cache 读取。
4. legacy renderer 边界收口：
   - 新 API/domain 输出禁止 legacy official item。
   - legacy `user/assistant` 迁移集中在边界 helper。
   - renderer component 类型逐步收窄到 official item。
5. 跑最小相关测试、typecheck、diff check。
6. 最后补真实 Desktop -> Web active stream 人工验收。

## 建议验证命令

按本次改动范围运行：

```powershell
corepack pnpm --filter @codex-web/domain test -- index.test.ts
corepack pnpm --filter @codex-web/api test -- index.test.ts
corepack pnpm --filter @codex-web/server exec vitest run src/threadDetailRoute.test.ts src/localLiveThreadStore.test.ts --passWithNoTests
corepack pnpm --filter @codex-web/server exec vitest run src/dbStore.test.ts src/threadRenameRoute.test.ts src/threadStartRoute.test.ts --passWithNoTests
corepack pnpm --filter @codex-web/web test -- appServerRealtimeReducer.test.ts threadDetailRequests.test.ts MessageBlocks.test.tsx officialThreadItems.test.ts turnProcessCollapse.test.ts
corepack pnpm typecheck
git diff --check
```

说明：

- 如果 server 包测试脚本在 Windows 上触发 `workspaceStatus.test.ts` 临时 git 目录 EBUSY/timeout，可单独重跑该测试确认是否为既有不稳定项。
- 真实 Desktop -> Web active stream 人工验收仍是 10 号主计划的最后未完成项，本次修复后建议补做。
- SQLite 清理后如调整 diagnostics/cache status schema，补跑 `packages/api` 和 diagnostics export 相关测试。

## 交付清单

- [x] `webSearch` canonical item 不新增自定义 `status`。
- [x] statusless official `webSearch` 不再因 active `turnStatus` 显示为“正在搜索网页”。
- [x] “已处理”展开区中的 statusless `webSearch` 展示为已完成语义。
- [x] server raw detail merge 保留 live `agentMessage.phase = "final_answer"`。
- [x] server raw detail merge 不丢 `agentMessage.memoryCitation`。
- [x] server raw detail merge 不丢 `webSearch.action`。
- [x] domain `webSearch` normalizer 不再主动裁剪未来字段。
- [x] domain `webSearch` 不合成 `status`。
- [x] 相关 domain/server/web 测试通过。
- [x] `corepack pnpm typecheck` 通过。
- [x] `git diff --check` 无 whitespace error。
- [x] web reducer/local live store 同 id merge 保留 `phase/memoryCitation/webSearch.action`。
- [x] 前端 detail merge 对 `memoryCitation` 使用非空且更丰富优先。
- [x] 前端 detail merge 保证 `final_answer` 不被 `commentary` 覆盖。
- [x] “已处理”展开区中的 statusless `reasoning` 不再显示“正在思考”。
- [x] 新 SQLite 数据库不再创建 `projects/threads/thread_details` 派生缓存表。
- [x] 旧 SQLite 数据库中的 `projects/threads/thread_details/official_stream_states` 会在启动或 cleanup 时 drop。
- [x] server DB API 移除 official thread/list/detail/project 派生缓存读写方法。
- [x] 文件浏览允许根不再依赖 SQLite project cache。
- [x] diagnostics/API schema 不再把官方派生缓存计数当常规数据库状态。
- [x] 附件表保留为 Web 上传暂存状态，不与 thread/detail 派生缓存一起删除。
- [x] legacy `user/assistant` renderer 双轨收口方案落地：legacy 只在边界迁移，新 renderer 主路径消费 official item。
- [x] 新 API/domain/realtime 输出测试禁止产生 legacy official canonical item。

## 子 agent 执行提示

本次重点是守住两个边界：

1. canonical item 必须继续像官方 `ThreadItem`，不要为了 UI 方便往里面塞 Web 自定义字段。
2. UI 可以派生“正在/已完成”展示，但派生依据必须是明确 lifecycle 或明确 status；不能把缺字段当成 active。

如果执行时发现官方 schema 已经和本文不一致，先停止并更新方案，不要凭本文继续实现。
