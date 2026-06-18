# Desktop Fidelity Issue Collection

日期：2026-06-11
状态：implementation in progress
范围：消息完成态展示、文件右侧栏可用性、无项目新对话官方能力核对、输入上下文窗口、功能菜单官方接口核对、子智能体入口、子智能体生命周期、上下文自动压缩、`imageView` 图片展示、附件隐藏提示词展示

> 本文先收集今天发现的问题、截图观察和官方/仓库证据。2026-06-11 用户已确认“暂时就订下这些”，随后进入分批实现。本文只给已经完成代码落地并有测试或本地证据支撑的项目打勾；部分落地或仍需官方来源核对的项目不打勾。

## 背景

今天对照 `codex_web` 与官方 Codex Desktop 的实际截图后，发现若干高保真偏差和一个官方能力缺口需要先记录：

1. Composer 底部不应继续显示独立的命令运行活动条；会话正文里的命令执行摘要和可追溯信息保持不变。
   - 追加：会话正文里的进行中状态仍应像 Desktop 一样展示，例如 `正在运行`、`正在编辑`、`正在压缩上下文`，不能只在完成后显示。
2. 完成态 reasoning 不应继续显示“已思考”或可展开的思考占位。
3. 打开文件视图时，右侧文件树缺少单独折叠入口，小屏会挤占文件预览空间。
4. 官方 Codex Desktop 支持“不选择项目”创建聊天，需要核对官方文档和 app-server/schema 后再确定 Web 落地口径。
5. 输入框底部缺少当前上下文窗口用量的圆形进度提示，Desktop hover 会显示具体 token 信息。
6. 输入框功能菜单/斜杠菜单与 Desktop 不一致，需要核对官方是否提供对应菜单或能力列表接口。
7. 子智能体在 Desktop 中有不同图标、hover 模型提示，并且点击后会打开对应子 agent 的侧边聊天。
8. 会话区对智能体创建、等待、关闭等 `collabAgentToolCall` 生命周期还没有适配。
9. 上下文自动压缩 item 的展示与 Desktop 仍需核对和适配。
10. 官方 `imageView` item 在 Web 中没有渲染为图片画廊，而是落到 `未知官方内容 imageView`；Desktop 会按图片原比例换行展示，不显示外层文件卡片和文件名。
11. 附上文件/截图发送后，Desktop 注入的隐藏提示词结构（`# Files mentioned by the user:` / `## My request for Codex:`）不应作为用户正文展示。

## 实施核对状态

更新时间：2026-06-11。

- [x] 问题 1：Composer 底部命令活动条整行隐藏。
  - 已改：`apps/web/src/app/components/ChatMain.tsx` 不再把 command activity row 放到 Composer 活动条。
  - 保留：会话正文里的命令执行摘要、命令数量和展开详情不改动。
  - 已改：会话正文 active 操作不再被 final answer 强制归入 completed process；`running/editing/thinking/writing` 等官方进行中状态会保留为 active。
  - 已改：active 命令/文件变更组默认展开到行级，直接显示 `正在运行 <command>`、`正在编辑 <file>`；完成态仍默认折叠。
  - 已验：Browser 复核 `019eb4cc-4885-7c82-9385-5a52cc2b7efd`，Composer 底部无独立 `已运行 ...` 命令活动条。
  - 已验：`MessageBlocks.test.tsx`、`turnProcessCollapse.test.ts`、`appServerRealtimeReducer.test.ts`、`localLiveThreadStore.test.ts` 覆盖 active 执行/编辑状态。
- [x] 问题 2：完成态隐藏 `已思考` reasoning 占位。
  - 已改：`shouldRenderReasoningItem` 对 completed/statusless reasoning 做完成态过滤。
  - 已验：`MessageBlocks.test.tsx` 相关用例。
- [x] 问题 3：文件右侧栏文件树增加折叠/恢复入口。
  - 已改：`ChatMain.tsx` 与 `App.module.css`，包含本地折叠状态持久化。
  - 待补：窄屏 Playwright 截图验收。
- [x] 问题 4：无项目新对话按官方 `thread/start` 可选 `cwd` 口径接入。
  - 已改：domain/API/server/Web composer 链路支持 `workspaceKind: "projectless"` 与 `cwd: null`。
  - 复审补改：domain 不再用“有 `thread.cwd` 就是 project”兜底；只有官方明确 `workspaceKind: "project"` 才归项目，cwd-only 历史线程保持 `workspaceKind: "unknown"` 与 `projectId: null`。
  - 复审补改：Chat 主界面 projectRoot 只来自 project workspace；projectless/unknown 不再把 `path` 当项目根传给文件树、workspace status、terminal、turn action、编辑消息和侧聊创建。
  - 已验：`threadStartRoute.test.ts` 覆盖不传 `cwd` 的 projectless start。
  - 追加已验：`packages/domain/src/index.test.ts` 覆盖 cwd-only 不推断项目、official projectless 保留语义；`ChatMain.projectRoot.test.ts` 覆盖 projectless/unknown 不暴露 projectRoot。
- [x] 问题 5：输入框上下文窗口圆环接入官方 `thread/tokenUsage/updated`，并使用正确字段。
  - 正确字段：`tokenUsage.last.totalTokens / tokenUsage.modelContextWindow`。
  - 证据：会话 `019eb571-029f-7610-a517-1112930c52c5` 最新 `last=24779`、`window=258400`，对应 Desktop `10% / 25k / 258k`；会话 `019eb4cc-4885-7c82-9385-5a52cc2b7efd` 截图轮次 `last=184881`、`window=258400`，对应 Desktop `72% / 185k / 258k`；同一会话后续最新 API 为 `last=138772`、`window=258400`，对应 Web `54% / 139k / 258k`。
  - 已验：`ContextWindowMeter.test.tsx`；Browser 复核 `019eb4cc-4885-7c82-9385-5a52cc2b7efd` 当前页面显示 `54% / 139k / 258k`，未出现累计 `total` 导致的 `1996% / 5.2m`。
- [ ] 问题 6：输入框功能菜单完整对齐 Desktop。
  - 已部分落地：斜杠菜单改为 Desktop 顺序/命名，补齐 `代码审查`、`压缩`、`派生`；`压缩` 接现有 `thread/compact/start` 链路，并使用 `tokenUsage.last.totalTokens / modelContextWindow` 显示上下文占用。
  - 已部分落地：`计划模式` 继续来自官方 `collaborationMode/list`；技能继续来自官方 `skills/list`；权限入口改用官方 `permissionProfile/list`。
  - 复审补改：`/api/runtime-options` 接收当前 project `cwd` 并传给官方 `permissionProfile/list`，以纳入项目本地 `[permissions.<id>]`；projectless/unknown 不传 cwd。
  - 复审补改：权限默认值不再从 `permissionProfile/list` 的可选列表推断；优先读取官方 `configRequirements/read` 的 `default_permissions` / allow-list fallback，再读取本机 `CODEX_HOME/config.toml` 的 `default_permissions` 或 legacy `sandbox_mode` + `approval_policy`。本机明确配置 full access 时仍映射为 `:danger-full-access`，未配置时不自动放宽到 full access。
  - 已验：`desktopSlashMenu.test.tsx` 覆盖 Desktop 顺序、技能分组和 `压缩` 百分比来源。
  - 追加已验：`runtimeOptionsRoute.test.ts` 覆盖官方 `permissionProfile/list` 收到 `cwd`，以及本机 Codex config 权限默认值被接入；`codexPermissionDefaults.test.ts` 覆盖 `default_permissions`、managed allow-list fallback 和 legacy sandbox 配置映射。
  - 未打勾原因：尚未发现统一官方 Composer 菜单列表接口；`IDE 上下文`、`MCP`、`个性`、`代码审查`、`侧边`、`反馈`、`宠物`、`派生`、`状态`、`目标`、`记忆` 等仍需接入对应官方/host 能力来源，目前只能禁用展示或隐藏，不能算完整完成。
- [ ] 问题 7：子智能体 Desktop 图标、模型提示、点击打开会话。
  - 已部分落地：右侧列表可显示模型 tooltip，点击可打开子 thread 侧边会话，状态可读。
  - 未打勾原因：尚未找到 Desktop 实际图标来源；当前 Web 只是本地像素图标近似，不等于“获取实际图标”。
- [x] 问题 8：会话区适配智能体创建、等待、关闭生命周期。
  - 已改：`collabAgentToolCall` 不再默认落到 raw unknown；domain 聚合 spawn/wait/close 状态。
  - 已验：domain/API/Web 相关测试。
- [x] 问题 9：上下文自动压缩展示与状态收敛。
  - 已改：协议层不再忽略 `thread/compacted`；后端 live store 与前端 realtime reducer 均按官方 `contextCompaction` item lifecycle 收敛 turn/thread 状态。
  - 复审补改：如果只收到 deprecated `thread/compacted` completion notification，会在对应 turn 补最小 `contextCompaction` 展示项；主路径仍以官方 `item/started` / `item/completed` 的 `contextCompaction` item 为准，避免自创额外状态。
  - 已改：会话区展示 Desktop 风格分隔提示，进行中显示 `正在压缩上下文`，完成后显示 `上下文已压缩`。
  - 已验：`appServerRealtimeReducer.test.ts`、`localLiveThreadStore.test.ts`、`officialIpc.test.ts`、`MessageBlocks.test.tsx` 覆盖 item 完成、deprecated completion notification、消息文案和发送按钮状态来源。
- [x] 问题 10：官方 `imageView` 渲染为无文件名图片画廊。
  - 已改：`MessageBlocks.tsx` 对已归一化 `imageView` item 分组渲染，复用现有图片加载和 lightbox，不再落到 unknown raw JSON。
  - 已改：`MessageImages` 支持隐藏 label；`imageView` 使用按原比例缩放、限制高度、不裁剪、无外层文件卡片的展示口径。
  - 已改：图片预览 lightbox 支持鼠标滚轮 `0.3x` 到 `6x` 缩放，放大后可拖动，双击复位。
  - 已验：`MessageBlocks.test.tsx` 覆盖连续 `imageView` 聚合、无 `未知官方内容`、无 caption。
- [x] 问题 11：附件隐藏提示词不再泄漏到用户消息正文。
  - 已改：`textReferences.ts` 不再依赖 `## My request for Codex:` 前必须有固定空行，兼容官方/本地把附件提示拆成多个 content 片段后只剩单换行的情况。
  - 已验：`textReferences.test.ts` 覆盖无固定空行的 files-mentioned prompt；`MessageBlocks.test.tsx` 覆盖带图片附件的 canonical `userMessage`。
- [ ] 横切：超过 2000 行单体文件拆分重构。
  - 已纳入计划。
  - 未打勾原因：本轮仍以修复为主，`apps/server/src/app.ts`、`Composer.tsx`、`ChatMain.tsx` 的拆分还未执行。

## 截图输入

用户提供的截图来源总索引如下；关键截图同时放到对应问题的“截图证据”小节里，方便逐项追溯。

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-64053fb6-673c-4d83-80fa-d86c08dde45e.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8da5e645-9f77-4f8e-a852-db040e706b15.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-c3ef307b-ee92-47a6-a8e6-761f261f321d.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-2b0a6b41-6683-4c85-88be-94f0515e4386.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-3e2863cb-2087-4d2c-b039-cc9f3233642b.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8121cfd1-dd4e-48a2-9cfe-cb2be9481023.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-81e5a0f6-e3af-41c0-9a2d-1fdd21f39b13.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-033c0ddc-18e5-407e-b2f6-e89a8d610e56.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-9699ecb4-f589-431f-b021-1e81b7a26613.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-59dd8b0a-704a-40bd-a90d-2cd1bab1b6a3.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-eb6c8825-8a59-453f-b492-22b7c1c25978.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-430eb713-404f-4b76-822a-a0e36bbdd320.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-16c8e540-355c-4d3c-a283-11b52282d13d.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-a707af1a-8294-416f-9cef-693dfd8cf458.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-1ce19126-a503-4762-b491-9a97353ed3ed.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-e52645ae-43f3-4a91-a1fb-fe83ddffda93.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-fde88ff7-000b-4738-9344-e23612c89c91.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-d250171c-324d-4318-aa1b-cc9d467c6270.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-cbe1a14b-86cf-4c5e-98e2-ea1bf7d9efbd.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-2c4e7e40-6cb0-4c8e-90b8-527959f80ca1.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-504ba477-8b45-45a9-8879-054131af6963.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8e68a875-24da-45b6-a5cc-d563d37cd0c5.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-9bcbdcf8-dd41-4ce6-a328-ca9159c5b380.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-83195813-6da1-4bcb-a95a-35261c2fc8b1.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-9d9e173d-ae30-4b02-a1e5-4c166c096a47.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-15c99ff5-9ab1-458d-afe2-d03dd8e9165c.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-2eda002f-5500-48d3-a528-8d792e63cec2.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-6aab93d2-0a69-41ab-a91e-ab4738869cf6.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-bd2a9628-904b-4a98-92b6-ae8527feb36e.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-fab927b1-0e6b-4427-96a8-05925dd833a3.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-47e425da-f7d7-4d88-858e-76ccd84932de.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-745871a1-fe11-447d-9638-1434e5b9f370.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8e61eada-56bf-42fc-9f3b-a75029958f86.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-f09becc3-aba0-4899-baad-e882f522e670.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-7ce4d4be-f3b5-493f-9a47-e1d71f7ab7cf.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-5d9fa1d6-00ee-4461-af0b-b3b93d6d92a7.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8e88cb23-7853-4ecf-be5e-bf01dadacf67.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-eece1aa9-18f5-44ba-8c2e-a4788e89bb20.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-5cbf6113-9969-43f9-a21c-901d907d93c4.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-73e776ff-5fd4-4670-a6ed-6a35836c3e8e.png`
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-0fabce7d-6016-4690-b596-7f303e157793.png`

截图里重点标注了：

- Web Composer 底部独立活动条出现 `已运行 84 条命令 181s` 或改动后的 `已运行 10s` 这类命令运行摘要整行；这行应隐藏。会话正文内部的命令执行摘要不属于本问题移除范围。
- 会话正文内部的 active lifecycle 不能因隐藏 Composer 底部活动条而丢失；Desktop 会在正文里显示 `正在编辑 <文件>`、`正在运行/执行 <命令>`、`正在压缩上下文` 等状态。
- 完成后的 reasoning 仍出现 `已思考 completed`，且可展开为“推理内容已折叠”。
- 文件右侧栏打开后，文件树固定占据右侧宽度；当前只有整体右侧栏按钮和宽度拖拽，没有文件树自身折叠按钮。
- 官方 Desktop 的项目选择菜单中可见“不使用项目”，左侧也存在“对话/新对话”这类不绑定项目的入口。
- Desktop 输入框底部右侧有当前上下文窗口圆形进度图标；hover 时出现 `背景信息窗口：86% 已用`、`已用 223k 标记，共 258k` 一类具体信息。
- Desktop 输入框功能菜单/斜杠菜单包含 `IDE 上下文`、`MCP`、`个性`、`侧边`、`反馈`、`宠物`、`推理模式`、`模型`、`状态`、`目标`、`计划模式`、`记忆`、`技能` 等条目。
- Web 当前输入框功能菜单显示 `添加照片和文件`、`压缩`、`目标`、`默认模式`、`默认权限`、`自动审查`、`完全访问权限`、`自定义 (config.toml)`、`技能` 等条目，与 Desktop 的分组、命名和能力入口不一致。
- Desktop 右侧摘要里的 `子智能体` 列表为每个 agent 分配不同的彩色像素图标；hover 某个 agent 时显示 `使用 GPT-5.5`；点击 agent 后右侧栏打开该 agent 的侧边聊天，能查看子 agent 会话内容。
- Desktop 会话区会把创建智能体渲染成 `已创建 4 个智能体`，下面列出 `已使用以下指令创建 Heisenberg/Volta/Hilbert/Cicero` 等人类可读摘要。
- Web 当前会把 `collabAgentToolCall` 渲染成 `未知官方内容 collabAgentToolCall`，展开后显示 raw JSON；右侧 `子智能体` 也可能出现 `Agent 019eb4db / spawnAgent` 与命名 agent 混在一起的重复/未归并状态。
- Desktop 会话区会显示 `上下文已自动压缩` 这类分隔提示；自动压缩发生中也会出现 `正在自动压缩上下文`。
- Desktop 会话区会把关闭智能体渲染成 `已关闭 4 个智能体`，下面列出 `已关闭 Heisenberg/Volta/Hilbert/Cicero`。Web 当前仍可能显示多条 `未知官方内容 collabAgentToolCall`。
- 对已完成或已关闭的子 agent，Web 可以不完全照 Desktop 隐藏，但需要清楚标明运行状态，避免用户误以为仍在运行。
- 最新复核截图确认：上下文窗口不是累计 `total_token_usage`，而是当前窗口 `last_token_usage.total_tokens` 对 `model_context_window` 的比例。
- Web 曾把官方 `imageView` item 显示为多条 `未知官方内容 imageView`；Desktop 对照是多张图片按比例换行展示。用户确认修复口径：主要限制高度、保持原比例缩放、不裁剪、不显示外层文件卡片、不显示图片文件名。
- Web 在发送带附件的用户消息时曾把隐藏提示词结构展示在正文里；用户正文只应显示 `## My request for Codex:` 后的真实请求，附件本身继续作为缩略图展示。

## 问题 1：Composer 底部命令活动条应整行隐藏

### 观察

Web Composer 底部会在输入框上方显示一条独立的命令运行活动摘要。早期显示类似：

```text
已运行 84 条命令 181s
```

后续错误理解为“只去掉命令数量”，导致仍显示：

```text
已运行 10s
```

用户最终澄清：要去掉的是 Composer 底部这整行命令活动摘要；会话正文里的命令执行摘要、命令数量和展开详情不要变动。

后续补充：会话正文里的进行中状态也要按 Desktop 方式即时展示，例如正在执行命令、正在编辑文件、正在压缩上下文。隐藏 Composer 底部活动条不等于隐藏正文里的 live lifecycle 行。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-64053fb6-673c-4d83-80fa-d86c08dde45e.png`
  - 红框标出 Web Composer 底部 `已运行 84 条命令 181s`。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8da5e645-9f77-4f8e-a852-db040e706b15.png`
  - 同一会话近景，Composer 底部仍保留命令活动摘要。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-fab927b1-0e6b-4427-96a8-05925dd833a3.png`
  - 红框确认：错误修法只移除了“几条命令”，但留下了 `已运行 10s` 整行；该整行应隐藏。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-73e776ff-5fd4-4670-a6ed-6a35836c3e8e.png`
  - Desktop 正文中显示 `正在编辑 2026-06-11_desktop_fidelity_issue_collection_plan.md +12 -12`，说明 live 文件编辑状态应在正文保留。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-0fabce7d-6016-4690-b596-7f303e157793.png`
  - Web 需要避免只在 completed process 中显示操作摘要，运行中操作应保持 active 行级展示。

### 仓库证据

- `apps/web/src/app/components/ChatMain.tsx`
  - `ComposerActivityStrip` 会组合 `summarizeCommandActivity(activeTurn)` 生成 Composer 底部命令活动行。
- `apps/web/src/app/components/MessageBlocks.tsx`
  - 会话正文里的 `groupedOperationSummary(...)` 负责可展开的命令执行摘要；用户已澄清这部分不要变动。
- `docs/ui_fidelity.md` 当前仍写着“已运行 3 条命令，12s”一类本地验收起点，这与今天截图反馈存在冲突，后续需要更新验收口径。

### 已确认

- 隐藏范围：只隐藏 Composer 底部独立命令活动条。
- 保留范围：会话正文里的命令执行摘要、命令数量、命令详情展开能力保持不变；active 命令/文件编辑应显示 `正在运行` / `正在编辑`，且默认露出到行级。

## 问题 2：完成态 reasoning 仍显示“已思考”

### 观察

完成后 Web 仍显示 `已思考`，展开后出现“思考 / 推理内容已折叠”。用户反馈：Codex 不展示思考内容，官方 Desktop 完成后也不显示该块。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-64053fb6-673c-4d83-80fa-d86c08dde45e.png`
  - 红框标出完成后仍显示的 `已思考`。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8da5e645-9f77-4f8e-a852-db040e706b15.png`
  - 红框标出 `已思考 completed` 展开后仍展示“推理内容已折叠”。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-c3ef307b-ee92-47a6-a8e6-761f261f321d.png`
  - Desktop 对照图中完成态没有保留同类 reasoning 展开块。

### 仓库证据

- `apps/web/src/app/components/MessageBlocks.tsx`
  - `ReasoningMessage(...)` 当前用 `active ? '正在思考' : '已思考'` 作为折叠行 label。
  - 缺少文本时 fallback 为 `推理内容已折叠`。
- `docs/daily_plan/2026-06-11_thread_item_lifecycle_followup_plan.md` 已处理过“已处理展开区中的 statusless reasoning 不再显示正在思考”，但今天的问题更进一步：完成态 reasoning 本身不应继续显示。

### 待确认

- active turn 中是否保留 `正在思考` 动态提示。
- 完成后是否完全隐藏 reasoning item，包括“已思考”折叠行和展开占位。
- 如果官方未来返回可展示的 reasoning summary，是否也仍按 Desktop 完成态隐藏。

## 问题 3：文件右侧栏中的文件树缺少单独折叠按钮

### 观察

打开右侧“文件/打开文件”视图时，右侧文件树在小屏或窄窗口下占用较多空间。当前可以拖拽调整宽度，但缺少一个快速折叠/展开文件树的按钮。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-2b0a6b41-6683-4c85-88be-94f0515e4386.png`
  - 红框标出右侧文件树区域，当前只有整体右侧栏按钮，文件树自身没有折叠入口。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-3e2863cb-2087-4d2c-b039-cc9f3233642b.png`
  - 文件树收起后空间改善的对照状态。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8121cfd1-dd4e-48a2-9cfe-cb2be9481023.png`
  - Web 中右侧文件树固定占宽，左侧会话区被明显压缩。

### 仓库证据

- `apps/web/src/app/components/ChatMain.tsx`
  - `ProjectFilesBrowser(...)` 负责文件树和筛选。
  - 文件 tab 渲染为 `FilePreviewPane + fileTreeResizer + ProjectFilesBrowser`。
  - 当前存在 `fileTreeWidth` 和 `handleFileTreeResizeStart(...)`，说明支持拖拽宽度。
  - 未看到文件树自己的 collapsed/open 状态或折叠按钮。
- `ThreadHeader` 已有“真实右侧栏”的整体打开/折叠按钮，但它会关闭整个右侧栏，不等同于只收起文件树。

### 待确认

- 折叠按钮作用范围是“只折叠文件树，保留文件预览”，还是复用/联动整个右侧栏。
- 折叠后是否保留一个窄图标栏/恢复按钮。
- 折叠状态是否需要按 tab、thread 或浏览器本地状态记忆。

## 问题 4：无项目新对话官方能力

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-81e5a0f6-e3af-41c0-9a2d-1fdd21f39b13.png`
  - Desktop 项目选择菜单中可见 `不使用项目`，左侧也有不绑定项目的“对话/新对话”区域。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-033c0ddc-18e5-407e-b2f6-e89a8d610e56.png`
  - 用户提供 projectless 样本会话 id：`019e830c-a2db-7d61-b807-b1346ed6da33`。

### 官方文档证据

OpenAI Codex manual 当前缓存路径：

- `C:/Users/user/AppData/Local/Temp/openai-docs-cache/codex-manual.md`

关键结论：

- 官方手册明确说明：Codex App 可以不选择项目启动聊天；这些聊天不绑定保存的仓库或项目目录，适合 research、planning、connected-tool workflows 等场景。
- 官方手册说明：无项目聊天会使用 Codex 管理的 `threads` 目录作为工作位置，默认位于 `~/.codex/threads`；可通过 `CODEX_HOME` 改变基础位置。
- `codex://threads/new` / `codex://new` 的 `path=` 参数是可选参数；提供时才打开本地 workspace。
- 官方 app-server quickstart 示例可直接调用 `thread/start`，参数里只带 `model`，随后再 `turn/start`。

### 官方 app-server/schema 证据

本机官方源码与 schema 路径：

- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/README.md`
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts`
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/Thread.ts`
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json`

关键结论：

- `ThreadStartParams` 中 `cwd?: string | null`，不是必填字段。
- `ThreadStartParams.json` 顶层没有 `required` 列表，`cwd` 允许 `string | null`。
- `Thread` 返回模型仍包含最终 `cwd: AbsolutePathBuf`，说明即使创建时不传项目，app-server 也会解析出一个实际工作目录。
- app-server README 明确 `thread/start` 创建新 thread，`turn/start` 发送用户输入；`turn/start` 的 `cwd` 也是可选 override。

### 仓库现状证据

- `docs/product_spec.md` 已要求支持 `projectless/global conversations`。
- `docs/ui_fidelity.md` 已写明新对话空状态需要区分项目/全局文案。
- `packages/api/src/index.ts` 的 `threadStartRequestSchema` 允许 `cwd: string | null | undefined`。
- `apps/web/src/app/components/Composer.tsx` 中 `compactProjectLabel(null, ...)` 会显示“不使用项目”。
- `apps/web/src/app/hooks/useRuntimeData.ts` 的 draft 发送路径可以把 `cwd: null` 传入 `startThread(...)`。
- `apps/server/src/app.ts` 的 `/api/domain/thread/start` 当前会执行：

```ts
const cwd = readString(parsed.data.cwd) || config.projectRoot;
```

这意味着 Web API 虽然接受 `cwd: null`，但后端会回退到默认项目根；因此当前还不是真正的 projectless thread。

### 真实 projectless 样本

用户提供了一个官方纯聊天会话 ID：

```text
019e830c-a2db-7d61-b807-b1346ed6da33
```

只读查询结果：

- `GET /api/domain/thread/read?threadId=019e830c-a2db-7d61-b807-b1346ed6da33`
  - `source: "official-ipc"`
  - `thread.owner.source: "official-ipc"`
  - Web domain 投影出的 `thread.projectId` 与 `thread.path` 都是 `C:\Users\user\Desktop\codex_web`
  - 该 detail 有 1 个 completed turn，item 类型为 `userMessage` 1 个、`agentMessage` 6 个
- `GET /api/official-thread-stream-state?threadId=019e830c-a2db-7d61-b807-b1346ed6da33`
  - `conversationState.workspaceKind: "projectless"`
  - `conversationState.path: null`
  - `conversationState.workspaceBrowserRoot: null`
  - `conversationState.projectlessOutputDirectory: null`
  - `conversationState.rolloutPath: C:\Users\user\.codex\sessions\2026\06\01\rollout-2026-06-01T19-58-23-019e830c-a2db-7d61-b807-b1346ed6da33.jsonl`
  - `conversationState.cwd` 与 `latestThreadSettings.cwd` 当前为 `C:\Users\user\Desktop\codex_web`
  - 该 turn 的 `params.cwd` 是 `C:\Users\user\Documents\Codex\2026-06-01\019e81ea-61a1-7413-9a13-5db6f0c18b8c`
- rollout 文件只读核对：
  - `session_meta.payload.cwd` 是 `C:\Users\user\Documents\Codex\2026-06-01\019e81ea-61a1-7413-9a13-5db6f0c18b8c`
  - `turn_context.payload.cwd` 同样是 `C:\Users\user\Documents\Codex\2026-06-01\019e81ea-61a1-7413-9a13-5db6f0c18b8c`
  - `originator: "Codex Desktop"`
  - `source: "vscode"`

这个样本说明：

- 官方 live state 已经明确提供 `workspaceKind: "projectless"`，这比单纯检查 `cwd` 更接近真实语义。
- projectless thread 仍可能有一个实际工作目录；该目录不等于普通项目目录。
- Web 当前 domain detail 会把该会话投影成 `codex_web` 项目 thread，至少在该样本上与官方 `workspaceKind: "projectless"` 冲突。
- 左侧“无项目/对话”分组如果只依赖 `!thread.projectId`，会被这种投影误导。

相关代码触点：

- `packages/domain/src/index.ts`
  - `normalizeOfficialThreadSummary(...)` 当前使用 `const projectId = cwd || null`。
  - `normalizeOfficialThreadList(...)` 会把有 `projectId` 的 thread 归入项目并补 `path: canonicalProjectId`。
- `apps/web/src/app/components/NavigationSidebar.tsx`
  - “无项目”筛选使用 `!thread.projectId`。
- `apps/web/src/app/components/ChatMain.tsx`
  - `projectRoot` 优先从 `selectedThread.projectId` / `selectedThread.path` 派生，可能让 projectless thread 进入项目文件/环境状态路径。

### 待确认

- Web 的“新对话”入口是否默认沿用当前项目，还是应提供明确“不使用项目”选择。
- 当用户选择“不使用项目”时，Web 是否应完全不向 `thread/start` 传 `cwd`，让官方 app-server 自行落到 Codex 管理目录。
- projectless thread 在列表分组、空状态标题、Composer 底部上下文、右侧环境信息和文件浏览里的展示口径。
- projectless thread 是否允许文件浏览；如果允许，是否展示官方返回的 `cwd`，还是隐藏为“无项目”。

## 问题 5：输入框底部缺少上下文窗口圆形进度提示

### 观察

Desktop 在输入框底部、模型/推理强度附近展示一个小型圆形进度图标。用户截图中 hover 后出现：

```text
背景信息窗口：
86% 已用
已用 223k 标记，共 258k
```

Web 当前输入框底部同位置只看到模型与推理强度、麦克风和发送按钮；没有可 hover 查看详情的上下文窗口进度入口。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-9699ecb4-f589-431f-b021-1e81b7a26613.png`
  - Desktop hover tooltip 显示 `背景信息窗口：86% 已用`、`已用 223k 标记，共 258k`。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-59dd8b0a-704a-40bd-a90d-2cd1bab1b6a3.png`
  - Web 当前底部只有小圆点位置/模型区域，缺少完整 hover 信息入口。

### 官方 app-server/schema 证据

- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/README.md`
  - Turn events 章节说明 token usage 会通过 `thread/tokenUsage/updated` 独立流式通知，客户端订阅后可增量渲染。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsage.ts`
  - `ThreadTokenUsage` 包含 `total`、`last`、`modelContextWindow`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/TokenUsageBreakdown.ts`
  - `TokenUsageBreakdown` 包含 `totalTokens`、`inputTokens`、`cachedInputTokens`、`outputTokens`、`reasoningOutputTokens`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsageUpdatedNotification.ts`
  - `thread/tokenUsage/updated` 对应通知包含 `threadId`、`turnId`、`tokenUsage`。

### 仓库现状证据

- `apps/web/src/app/components/Composer.tsx`
  - 输入框底部右侧已有模型/推理强度按钮：`runtimeButton` 显示 `compactModelLabel(selectedModel)` 与 `compactReasoningEffortLabel(selectedEffort)`。
  - 精准搜索未看到 `tokenUsage`、`latestTokenUsage`、`modelContextWindow` 等字段在 Composer 中使用。
- `apps/server/src/app.ts`
  - `/api/runtime-options` 当前只拉取 `model/list` 与 `collaborationMode/list`，不包含 token usage。
- 本轮精准搜索 `apps/server`、`apps/web`、`packages/domain`、`packages/api` 未看到 `thread/tokenUsage/updated` 或 `ThreadTokenUsage` 的 Web/domain 投影使用痕迹。

### 已确认与待确认

- 已确认：Web 应从官方 `thread/tokenUsage/updated` 通知和恢复时 replay 的 token usage 读取上下文窗口用量。
- 已确认：Desktop 圆环使用 `last.totalTokens / modelContextWindow`；`total.totalTokens` 是累计用量，会随多轮对话超过窗口，不能用于背景信息窗口圆环。
- 已确认样本：
  - `019eb571-029f-7610-a517-1112930c52c5`：`last=24779`、`window=258400`，显示约 `10%`、`25k/258k`。
  - `019eb4cc-4885-7c82-9385-5a52cc2b7efd` 截图轮次：`last=184881`、`window=258400`，显示约 `72%`、`185k/258k`。
  - `019eb4cc-4885-7c82-9385-5a52cc2b7efd` 后续最新 API：`last=138772`、`window=258400`，显示约 `54%`、`139k/258k`；若误用累计 `total=5157340` 会得到错误的 `1996%`。
- 待确认：hover 文案是否需要完全跟 Desktop 一致，包括 `标记`、`k` 格式和无数据时的空态。
- 待确认：没有 `modelContextWindow` 时是否显示空态小圆环，还是隐藏该入口。

## 问题 6：输入框功能菜单与 Desktop 不一致

### 观察

用户截图中 Desktop 的输入框功能菜单/斜杠菜单包含：

```text
IDE 上下文
MCP
个性
代码审查
侧边
压缩
反馈
宠物
推理模式
模型
派生
状态
目标
计划模式
记忆
技能
```

修复前 Web 菜单包含：

```text
添加照片和文件
压缩
目标
默认模式
默认权限
自动审查
完全访问权限
自定义 (config.toml)
技能
```

这会让从 Desktop 迁移来的用户误以为 Web 的能力入口、状态入口或术语与官方 Desktop 不一致。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-eb6c8825-8a59-453f-b492-22b7c1c25978.png`
  - Desktop 菜单包含 `IDE 上下文`、`MCP`、`个性`、`侧边`、`反馈`、`宠物`、`推理模式`、`模型`、`状态`、`目标`、`计划模式` 等条目。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-430eb713-404f-4b76-822a-a0e36bbdd320.png`
  - Desktop 菜单滚动后还包含 `记忆`、`技能` 等条目。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-16c8e540-355c-4d3c-a283-11b52282d13d.png`
  - Web 菜单显示 `添加照片和文件`、`压缩`、`默认权限`、`自动审查` 等，与 Desktop 不一致。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-9d9e173d-ae30-4b02-a1e5-4c166c096a47.png`
  - 用户批注要求先仔细查官方是否已有列表接口，不能轻易自建 Web 聚合/菜单逻辑；该约束同样适用于其他功能。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-065b4c00-4186-4393-8978-6c04d6ff3879.png`
  - 最新复核指出 Web 菜单仍需要补齐 Desktop 顶部顺序，包括 `代码审查`、`压缩`、`派生` 等条目。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-d90f80b2-fab1-4937-8c9a-4c546ed348bf.png`
  - 最新复核指出 Desktop 下半段顺序应为 `宠物`、`推理模式`、`模型`、`派生`、`状态`、`目标`、`计划模式`、`记忆`，然后进入 `技能` 分组。

### 官方 app-server/schema 证据

本轮在官方 app-server README 和 schema 中确认到多组分散列表接口：

- `model/list`：模型、reasoning effort、speed tier、service tier 等模型能力信息。
- `collaborationMode/list`：协作模式预设，例如 Plan / Default。
- `permissionProfile/list`：权限 profile 列表，可按 `cwd` 纳入项目本地配置。
- `experimentalFeature/list`：实验功能 flag 列表，可按 `threadId` 计算当前 thread 配置状态。
- `skills/list`：按一个或多个 `cwd` 列出技能。
- `hooks/list`：按一个或多个 `cwd` 列出 hooks。
- `plugin/list` / `plugin/installed`：插件市场和已安装插件状态；README 标注仍在 under development。
- `app/list`：官方 README 中列出的可用 app 列表接口；schema 中对应 `AppsListParams.ts` / `AppsListResponse.ts`。
- `mcpServerStatus/list`：枚举 MCP server、tools、auth status、server info、resource/resource templates，支持 `threadId` 和分页。
- `modelProvider/capabilities/read`：读取当前 provider 级能力。
- `configRequirements/read`：读取 managed requirements/allow-list 约束，可影响功能是否可选。

本轮未在官方 README/schema 的已查范围内看到一个直接命名为“输入功能菜单列表”或能一次返回 Desktop 菜单完整结构的统一接口。这个结论只作为当前计划依据；正式实现前必须按 `docs/official_first_implementation.md` 再复查当前版本官方文档、schema、源码和 Desktop/VS Code host 证据，避免官方新增接口后仍维护 Web 自有逻辑。

### 官方列表接口补查结论（2026-06-11 追加）

本轮追加核对了以下官方来源：

- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/README.md`
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/src/protocol/common.rs`
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2`
- `docs/official_first_implementation.md`
- `documentation/protocol/official_codex_ipc_sync.md`
- `documentation/protocol/official_client_runtime_evidence.md`

结论：

1. 暂未发现一个官方 `menu/list`、`command/list` 或“Composer 功能菜单完整列表”接口。
2. 官方已经提供多组更细粒度的列表/状态接口，Web 必须优先薄转发这些接口，不能自己维护另一套业务目录。
3. 接口名需要严格使用官方当前命名，例如是 `app/list`，不是 `apps/list`。
4. `plugin/list`、`plugin/installed`、`plugin/read` 在官方 README 中标注仍处于 under development，本轮计划只记录为候选来源，不作为可立即生产接入的稳定接口。
5. 对未找到列表接口的条目，只能先标为待确认或 Desktop host 专属，不允许写死假 enabled 状态。

| Desktop 菜单/能力         | 已找到的官方来源                                                                                                | 当前判断                                    | 实施约束                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `模型`                    | `model/list`、`modelProvider/capabilities/read`                                                                 | 有官方列表和 provider 能力来源              | 继续从官方读取，不在 Web 写死模型目录                                         |
| `推理模式`                | `model/list` 返回的 supported/default reasoning efforts                                                         | 有官方来源                                  | 推理强度选项跟随所选 model，不做全局硬编码                                    |
| `计划模式` / Default-Plan | `collaborationMode/list`、`thread/settings/update`                                                              | 有官方列表和设置入口                        | Default 仍按既有证据省略 `collaborationMode`                                  |
| `压缩`                    | `thread/compact/start`、`contextCompaction` item、`thread/tokenUsage/updated`                                   | 有官方操作入口和上下文用量来源              | 菜单项可调用现有压缩链路；百分比必须使用 `last.totalTokens`，不是累计 `total` |
| `代码审查`                | `review/start`                                                                                                  | 有官方 action，未找到列表接口               | 入口展示可对齐 Desktop；正式启用前需接官方 review 参数和结果展示              |
| `派生`                    | `thread/fork`                                                                                                   | 有官方 action，未找到列表接口               | 入口展示可对齐 Desktop；正式启用前需接官方 fork 参数和新 thread 展示          |
| 权限类入口                | `permissionProfile/list`、`configRequirements/read`                                                             | 有官方 profile 与 managed constraints       | 替换或约束现有 `PERMISSION_OPTIONS`，不继续只靠本地枚举                       |
| `技能`                    | `skills/list`、`skills/changed`                                                                                 | 有官方列表和变更通知                        | 菜单只显示官方发现的 skills，不自建 skill registry                            |
| `MCP`                     | `mcpServerStatus/list`、`mcpServer/startupStatus/updated`                                                       | 有官方 server/tool/auth/resource 状态       | MCP 菜单和状态从官方读取，不扫描本地配置自拼                                  |
| `目标`                    | `thread/goal/get`、`thread/goal/set`、`thread/goal/clear`、goal 通知                                            | 有官方目标状态接口                          | 目标入口调用官方 goal API，不写 Web 私有目标存储                              |
| `状态`                    | `thread/tokenUsage/updated`、`account/rateLimits/read`、`account/rateLimits/updated`、`thread/settings/updated` | 有多组官方状态来源，但不是统一菜单列表      | 状态菜单要拆成官方状态 view，不把诊断字段暴露给普通用户                       |
| `记忆`                    | `thread/memoryMode/set`、`memory/reset`、`MemoryCitation` item                                                  | 找到操作/引用来源，未找到 memory 菜单列表   | 先标待确认，不做本地“记忆列表”                                                |
| `个性`                    | `Personality` schema、`thread/start` / `turn/start` / `thread/settings/update` 参数                             | 有枚举和设置字段，未找到 `personality/list` | 若展示，优先用官方 schema/配置；继续查 Desktop host 是否有菜单来源            |
| `IDE 上下文`              | 本轮未在 app-server 列表接口中找到                                                                              | 可能属于 Desktop/IDE host 能力              | 实现前继续查官方 Desktop/VS Code host，不自建                                 |
| `侧边`                    | 项目现有文档记录了 official sideConversation stream state                                                       | 不属于 app-server 通用菜单列表              | 复用官方侧聊 state，不创建 Web 私有 thread                                    |
| `反馈`                    | `feedback/upload`                                                                                               | 有官方提交入口，未找到列表接口              | 只能作为 action，需确认 Web 是否暴露                                          |
| `宠物`                    | 本轮未找到 app-server/schema 来源                                                                               | 可能是 Desktop host 或实验能力              | 默认不实现，除非找到官方来源                                                  |
| Apps / connector          | `app/list`、`app/list/updated`、`app://<connector-id>` mention                                                  | 有官方 app/connector 列表和更新通知         | 只用 `app/list`，不要写 `apps/list`；按 accessible/enabled 字段展示           |
| Hooks                     | `hooks/list`                                                                                                    | 有官方 hook 发现接口                        | 若进入菜单，必须显示来源和配置状态                                            |
| 插件                      | `plugin/list`、`plugin/installed`、`plugin/read`                                                                | 有候选接口但官方标注 under development      | 当前只记录，不作为默认生产菜单来源                                            |
| 实验功能                  | `experimentalFeature/list`、`experimentalFeature/enablement/set`                                                | 有官方 feature flag 来源                    | 用于 disabled/隐藏判断，不伪装为普通稳定功能                                  |

同样原则也要覆盖其他功能，不只 Composer 菜单：

| 功能                  | 官方优先来源                                                                                                      | 禁止的 Web 自建路径                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 上下文窗口圆环        | `thread/tokenUsage/updated`、`ThreadTokenUsage.last`、`modelContextWindow`                                        | 不从消息文本估算 token；不使用累计 `total`；不把用量写入 SQLite     |
| projectless 新对话    | `thread/start.cwd?` 可选、官方手册 projectless 说明、Desktop live state `workspaceKind: "projectless"`            | 不把 `cwd: null` 回退成 `config.projectRoot`，不靠 cwd 推断项目归属 |
| 文件树/文件预览       | `fs/readDirectory`、`fs/readFile` 和现有受限文件 API                                                              | 不绕过官方/项目边界直接扫描任意路径；折叠状态只做 UI local state    |
| 子智能体              | `collabAgentToolCall`、`CollabAgentTool`、`CollabAgentStatus`、子 thread `parentThreadId/agentNickname/agentRole` | 不维护 Web 私有 agent registry，不用 raw JSON 当普通展示            |
| 关闭/等待智能体       | `closeAgent`、`wait`、`agentsStates`、子 thread 状态                                                              | 不把已关闭 agent 从状态里抹掉到用户无法区分                         |
| 自动压缩上下文        | `thread/compact/start`、`contextCompaction` item；`thread/compacted` 已 deprecated                                | 不只监听 deprecated 通知，不把压缩显示混入命令数量摘要              |
| rate limit / 状态信息 | `account/rateLimits/read`、`account/rateLimits/updated`                                                           | 不用本地静态文案假装额度状态                                        |

### 仓库现状证据

- `apps/server/src/appServerProcess.ts`
  - 当前 wrapper 已有 `modelList(...)`、`collaborationModeList()`、`permissionProfileList(...)`、`skillsList(...)`。
- `apps/server/src/app.ts`
  - `/api/runtime-options` 当前只聚合 `model/list` 与 `collaborationMode/list`。
  - `/api/skills` 会调用官方 `skills/list`。
  - 本轮未看到 Web server 已暴露 `experimentalFeature/list`、`hooks/list`、`plugin/list`、`app/list`、`mcpServerStatus/list`、`modelProvider/capabilities/read` 或 `configRequirements/read` 的对应 API。
- `apps/web/src/app/components/Composer.tsx`
  - `/` 斜杠菜单已改为调用 `components/composer/desktopSlashMenu.tsx` 构造 Desktop 顺序：`IDE 上下文`、`MCP`、`个性`、`代码审查`、`侧边`、`压缩`、`反馈`、`宠物`、`推理模式`、`模型`、`派生`、`状态`、`目标`、`计划模式`、`记忆`，然后进入 `技能` 分组。
  - `压缩` 使用现有 `onCompactThread`，描述里的占用比例来自 `ThreadTokenUsage.last.totalTokens / modelContextWindow`。
  - 运行中回复的 `引导当前回复` / `排队下一条` 不再混入 Desktop `/` 功能菜单，仍保留在 Composer 底部 `@ 当前/排队` 控件。
  - `PERMISSION_OPTIONS` 当前硬编码为 `默认权限`、`自动审查`、`完全访问权限`、`自定义 (config.toml)`。
  - 右下模型/推理强度菜单单独由 `runtimeMenu` 渲染，来源为 `/api/runtime-options` 中的模型和 reasoning effort。
- `apps/web/src/app/components/composer/desktopSlashMenu.test.tsx`
  - 覆盖 Desktop 菜单顺序、技能分组、`压缩` 使用 last-window token usage，避免再次误用累计 `total`。

### 待确认

- Desktop 菜单是否由多个官方接口加 Desktop host 本地能力组合而成，而不是单个 app-server menu API。
- Web 后续应对齐 Desktop 的哪些菜单项、顺序、图标和文案；哪些条目属于 Desktop/IDE host 专属能力，需要隐藏、禁用或另做状态说明。
- `IDE 上下文`、`MCP`、`状态`、`记忆`、`技能` 是否都有可依赖的官方读取/设置接口。
- `反馈`、`宠物`、`侧边` 这类入口是否在 Web 目标范围内，还是只作为 Desktop 专属功能记录。
- 权限相关入口是否继续使用 Web 现有四个本地选项，还是应先核对 `permissionProfile/list` 的官方结果。

## 问题 7：子智能体列表缺少 Desktop 图标、模型提示和点击打开会话

### 观察

用户截图中，Desktop 的右侧摘要 `子智能体` 区域有 4 个子 agent：

```text
019eb4db-71c7-7dd2-b94f-271dce4...
019eb4db-85e4-7a93-af96-42c30a9...
019eb4db-99fb-7e70-aecf-c5b15a39...
019eb4db-ae0b-7821-8afa-c10d559...
```

每行左侧不是文字首字母，而是不同颜色的像素图标。hover 到某个子 agent 时，Desktop 显示 `使用 GPT-5.5`。点击第一个子 agent 后，右侧真实侧栏打开一个以该子 agent 图标和 id 开头的聊天 tab，并显示该子 agent 的会话内容。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-a707af1a-8294-416f-9cef-693dfd8cf458.png`
  - Desktop 右侧 `子智能体` 列表显示不同颜色的像素图标和子 agent id。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-1ce19126-a503-4762-b491-9a97353ed3ed.png`
  - hover 某个子 agent 时出现 `使用 GPT-5.5`。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-e52645ae-43f3-4a91-a1fb-fe83ddffda93.png`
  - 点击子 agent 后，右侧栏打开对应子 agent 的侧边聊天。

### 官方 app-server/schema 证据

- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/README.md`
  - `thread/list` 说明 subagent threads 会带 `parentThreadId`。
  - `thread/list` response 会在可用时包含 `agentNickname` 与 `agentRole`。
  - `thread/read` 返回的 thread 也会在可用时包含 `parentThreadId`、`agentNickname`、`agentRole`。
  - `collabToolCall` 描述协作工具调用，包括 `spawn_agent`、`send_input`、`resume_agent`、`wait`、`close_agent`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/Thread.ts`
  - `Thread` 包含 `parentThreadId`、`agentNickname`、`agentRole`。
  - `Thread` 还包含 `modelProvider`，但没有单独的 agent icon 字段。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts`
  - `collabAgentToolCall` 包含 `senderThreadId`、`receiverThreadIds`、`prompt`、`model`、`reasoningEffort`、`agentsStates`。
  - `model` 注释为“spawned agent requested model when applicable”。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/tests/suite/v2/turn_start.rs`
  - `turn_start_emits_spawn_agent_item_with_effective_role_model_metadata_v2` 测试确认：spawn 完成 item 的 `model` 与 `reasoning_effort` 会反映角色配置后的实际生效元数据。

本轮在官方 app-server README/schema 已查范围内没有看到 subagent 专用的 `icon`、`avatar`、`iconPath` 或 `iconName` 字段。Desktop 的彩色像素图标是否来自隐藏 IPC 字段、Desktop renderer 本地算法、还是某个未覆盖的 host 资源，还需要继续确认。

### 真实 subagent 样本

本轮只读查询了截图对应主会话：

```text
019eb4cc-4885-7c82-9385-5a52cc2b7efd
```

`GET /api/domain/thread/read?threadId=019eb4cc-4885-7c82-9385-5a52cc2b7efd` 返回的 `subAgents`：

```text
019eb4db-71c7-7dd2-b94f-271dce4e3208 / Heisenberg / default / pendingInit
019eb4db-85e4-7a93-af96-42c30a9d3b4e / Volta / default / pendingInit
019eb4db-99fb-7e70-aecf-c5b15a394751 / Hilbert / default / pendingInit
019eb4db-ae0b-7821-8afa-c10d559dbf37 / Cicero / default / pendingInit
```

同一 detail 的 `collabAgentToolCall` item 中，每个 `spawnAgent` 都包含：

```text
model: gpt-5.5
reasoningEffort: xhigh
receiverThreadIds: 对应子 agent thread id
receiverThreads[].thread.parentThreadId: 019eb4cc-4885-7c82-9385-5a52cc2b7efd
receiverThreads[].thread.agentNickname: Heisenberg / Volta / Hilbert / Cicero
receiverThreads[].thread.agentRole: default
```

直接读取子 agent thread id 也能拿到子会话内容，例如：

```text
GET /api/domain/thread/read?threadId=019eb4db-71c7-7dd2-b94f-271dce4e3208
```

返回该子 agent 自己的 thread detail，包含 1 个 turn；其他 3 个子 agent id 也可以单独 read。

### 仓库现状证据

- `packages/domain/src/index.ts`
  - `ThreadSubAgent` 当前只有 `id`、`name`、`role`、`status`、`source`，没有 `model`、`reasoningEffort`、`icon` 或可直接打开的 `sideConversationId`。
  - `normalizeAgentTaskMessageItem(...)` 与 `normalizeAgentTaskAgents(...)` 已能从 `collabAgentToolCall` 读取 `model`、`reasoningEffort`、`receiverThreadIds`、`receiverThreads`。
  - `normalizeThreadSubAgents(...)` 会从 thread/detail/turn items 归一化子 agent，但投影后的 `ThreadSubAgent` schema 没有保留模型和图标。
- `packages/api/src/index.ts`
  - `threadSubAgentSchema` 只允许 `id`、`name`、`role`、`status`、`source`。
  - `agentTaskSchema` 包含 `model` 与 `reasoningEffort`，但这是消息 item 里的 agent task 数据，不是右侧 `subAgents` 列表数据。
- `apps/web/src/app/components/ChatMain.tsx`
  - `subAgentRows(...)` 把 `ThreadSubAgent` 映射成 `{ name, role, status, tone }`，`tone` 只是按数组下标轮换。
  - 右侧 `子智能体` 区域渲染为普通 `<div className={styles.agentRow}>`，不是 button；没有 hover tooltip，也没有点击打开子 agent 会话。
  - 图标是 `agent.name.slice(0, 1)` 的圆形字母头像，而不是 Desktop 的像素图标。
  - `侧边聊天` 区域是另一组 `button`，点击会调用 `onOpenSideChat(sideConversation)` 打开右侧聊天 tab；目前未和 `subAgents` 行合并。
- `apps/web/src/app/App.module.css`
  - `.agentAvatar` 是 20px 圆形文字头像，只处理颜色，不包含像素图标资源。

### 待确认

- Desktop 子 agent 彩色像素图标是否能从官方 IPC/app-server 获取，还是需要按 Desktop renderer 的本地规则从 thread id / nickname / index 派生。
- Web 右侧 `subAgents` 是否应保留 nickname，例如 Heisenberg / Volta / Hilbert / Cicero，还是像 Desktop 截图一样主要显示 thread id。
- hover 文案是否只显示模型，例如 `使用 GPT-5.5`，还是也要包含 reasoning effort、role、状态。
- 点击子 agent 后应直接读取对应子 thread 并作为右侧聊天 tab 展示，还是必须映射成现有 `sideConversations` 结构。
- 子 agent 运行中、完成、失败、wait/resume/close 后的状态显示和点击行为。

## 问题 8：会话区未适配智能体创建、等待、关闭生命周期

### 观察

Desktop 对智能体生命周期有专门的人类可读摘要：

```text
已创建 4 个智能体
已使用以下指令创建 Heisenberg: ...
已使用以下指令创建 Volta: ...
已使用以下指令创建 Hilbert: ...
已使用以下指令创建 Cicero: ...
```

关闭时也会显示：

```text
已关闭 4 个智能体
已关闭 Heisenberg
已关闭 Volta
已关闭 Hilbert
已关闭 Cicero
```

Web 当前在同一会话里出现多条：

```text
未知官方内容 collabAgentToolCall
```

展开后是 raw JSON。这说明会话消息区对 `collabAgentToolCall` 的 `spawnAgent`、`wait`、`closeAgent` 等生命周期还没有做 Desktop 口径适配。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-fde88ff7-000b-4738-9344-e23612c89c91.png`
  - Desktop 会话区显示 `已创建 4 个智能体`，并列出各 agent 的创建指令摘要。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-d250171c-324d-4318-aa1b-cc9d467c6270.png`
  - Web 当前将 `collabAgentToolCall` 显示为 `未知官方内容` 并展开 raw JSON。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-2c4e7e40-6cb0-4c8e-90b8-527959f80ca1.png`
  - Web 会话区仍有 `正在思考` 与多条未知 `collabAgentToolCall` 混在同一生命周期里。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-504ba477-8b45-45a9-8879-054131af6963.png`
  - Desktop 右侧子 agent 列表清楚显示命名 agent。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-9bcbdcf8-dd41-4ce6-a328-ca9159c5b380.png`
  - Desktop 会话区显示 `已关闭 4 个智能体` 和每个已关闭 agent。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-83195813-6da1-4bcb-a95a-35261c2fc8b1.png`
  - Web 对关闭/等待后的 `collabAgentToolCall` 仍未转换成人类可读 lifecycle。

### 官方 app-server/schema 证据

- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/CollabAgentTool.ts`
  - `CollabAgentTool` 枚举包含 `spawnAgent`、`sendInput`、`resumeAgent`、`wait`、`closeAgent`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/CollabAgentToolCallStatus.ts`
  - tool call 状态为 `inProgress`、`completed`、`failed`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/CollabAgentStatus.ts`
  - agent 状态为 `pendingInit`、`running`、`interrupted`、`completed`、`errored`、`shutdown`、`notFound`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts`
  - `collabAgentToolCall` 包含 tool、status、senderThreadId、receiverThreadIds、prompt、model、reasoningEffort、agentsStates。

### 真实样本证据

同一主会话 `019eb4cc-4885-7c82-9385-5a52cc2b7efd` 当前 detail 中有 12 个 `collabAgentToolCall`：

```text
spawnAgent completed x 4
wait completed x 4
closeAgent completed x 4
```

4 个 `spawnAgent` 都带 `model: gpt-5.5`、`reasoningEffort: xhigh` 和对应 `receiverThreadIds`。4 个 `closeAgent` 也都带对应 `receiverThreadIds`，可用于关联 Heisenberg、Volta、Hilbert、Cicero。

当前 `subAgents` 投影仍显示：

```text
Heisenberg / pendingInit
Volta / pendingInit
Hilbert / pendingInit
Cicero / pendingInit
```

这与后续 `wait completed`、`closeAgent completed` 的事实不一致，会误导用户判断子 agent 是否仍在运行。

### 仓库现状证据

- `packages/domain/src/index.ts`
  - `collabAgentToolCall` 已是 known official type，且保留 `tool`、`status`、`receiverThreadIds`、`model`、`reasoningEffort`、`agentsStates`。
  - `normalizeAgentTaskMessageItem(...)` 可以生成 `agentTask`，但当前真实 detail 里的 item 仍是 `collabAgentToolCall`，未投影成消息区使用的 `agentTask`。
- `apps/web/src/app/components/MessageBlocks.tsx`
  - 已有 `AgentTaskMessage(...)`，但只处理 `type === 'agentTask'`。
  - `collabAgentToolCall` 未进入 `AgentTaskMessage`，最后落到 `ToolOrOfficialUnknownBlock`。
- `apps/web/src/app/components/messageBlocks/ToolOrOfficialUnknownBlock.tsx`
  - fallback 显示为 `未知官方内容`，meta 为 raw type，例如 `collabAgentToolCall`。
- `apps/web/src/app/components/ChatMain.tsx`
  - 右侧 `subAgentRows(...)` 只用 `ThreadSubAgent.status`；没有从后续 `wait` / `closeAgent` item 合成最新运行状态。

### 待确认

- 会话区是否应按 Desktop 聚合连续的 `spawnAgent`、`wait`、`closeAgent`，还是逐条显示但使用人类可读文案。
- `closeAgent completed` 后右侧子 agent 是隐藏、置灰、还是保留并标明 `已关闭`；用户倾向是可以保留，但必须标明状态。
- 如果 `wait` 返回了完成消息，是否应在主会话中显示摘要、链接到子会话，或只更新状态。
- `sendInput`、`resumeAgent` 后续是否也需要同一套生命周期展示。
- 状态优先级如何合成：`collabAgentStatus`、tool call status、子 thread `Thread.status`、closeAgent item 谁更权威。

## 问题 9：上下文自动压缩展示仍需适配

### 观察

Desktop 在会话中显示居中的分隔提示：

```text
上下文已压缩
```

自动压缩发生过程中也能看到：

```text
正在压缩上下文
```

用户反馈当前 Web 对上下文自动压缩还没有适配到 Desktop 口径：缺少进行中/完成后的分隔提示，并且压缩完成后 Composer 右下角仍停留在停止按钮；切换到其他对话再返回后才恢复发送按钮，说明实时状态没有在完成通知到达时收敛。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-cbe1a14b-86cf-4c5e-98e2-ea1bf7d9efbd.png`
  - Desktop 会话区显示居中的上下文压缩完成分隔提示。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-fde88ff7-000b-4738-9344-e23612c89c91.png`
  - Desktop 运行中可出现上下文压缩进行中提示。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-2c4e7e40-6cb0-4c8e-90b8-527959f80ca1.png`
  - Web 同类长会话里仍与 reasoning/unknown lifecycle 混排，需要核对完成态展示。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8e88cb23-7853-4ecf-be5e-bf01dadacf67.png`
  - Web 压缩发生时可见 `正在压缩上下文`，但 Composer 按钮仍是停止态，需要确认完成事件是否收敛。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-eece1aa9-18f5-44ba-8c2e-a4788e89bb20.png`
  - 压缩后仍停留停止按钮，切换会话前实时状态未正确恢复。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-5cbf6113-9969-43f9-a21c-901d907d93c4.png`
  - 切换会话再返回后显示 `上下文已压缩` 且按钮恢复发送态，说明 thread detail 回放状态正确，问题集中在实时通知处理。

### 官方 app-server/schema 证据

- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/README.md`
  - `thread/compact/start` 的进度会通过同一 thread 的标准 `turn/*` 和 `item/*` 通知发出。
  - 客户端应预期一个 compaction item：`item/started` 带 `item: { "type": "contextCompaction", ... }`，随后 `item/completed` 带同一个 id。
  - ThreadItem 列表中 `contextCompaction` 是 `{ id }`，表示 Codex 已压缩会话历史，可能自动发生。
  - `thread/compacted` 已 deprecated；主展示应使用 `contextCompaction` item lifecycle，但它仍是官方 schema 中的 completion notification，不能在实时链路中忽略。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts`
  - `ThreadItem` union 已包含 `{ "type": "contextCompaction", id: string }`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/json/v2/ContextCompactedNotification.json`
  - `thread/compacted` payload 至少包含 `threadId` 与 `turnId`，可作为兼容完成信号来收敛当前 turn。

### 仓库落地

- `packages/protocol/src/index.ts`
  - `thread/compacted` 从 ignored notification 移到 important notification，确保实时层能看到官方完成信号。
- `packages/domain/src/index.ts`
  - `contextCompaction` 已在 known official types 中，并归一化为 `{ type: 'contextCompaction', id }`。
- `packages/api/src/index.ts`
  - API schema 允许 `contextCompaction` item。
- `apps/server/src/localLiveThreadStore.ts`
  - `item/completed` 遇到 `contextCompaction` 时结束 active turn，清空 `activeTurnId`，同步 `thread.inProgress = false`。
  - 收到 `thread/compacted` 时同样收敛当前 turn/thread，避免 deprecated completion notification 被忽略后卡住停止按钮。
- `apps/web/src/app/appServerRealtimeReducer.ts`
  - `contextCompaction` 的 `item/started` 保持 thread active；`item/completed` 立即把 turn 状态改为 completed，并同步 `thread.inProgress = false`。
  - `thread/compacted` 作为兼容完成信号处理，修复“切换会话后才恢复发送按钮”的实时状态缺口。
- `apps/web/src/app/hooks/useRuntimeData.ts`
  - `thread/compacted` 进入快速 detail 刷新通知集合，确保完成后可按官方 state 补齐。
- `apps/web/src/app/components/messageBlocks/ToolOrOfficialUnknownBlock.tsx`
  - `ContextCompactionMessage()` 按 turn active 状态显示 `正在压缩上下文` 或 `上下文已压缩`，不再固定显示旧完成态文案。

### 验证

- `pnpm --filter @codex-web/web test -- appServerRealtimeReducer.test.ts MessageBlocks.test.tsx`
- `pnpm --filter @codex-web/server test -- localLiveThreadStore.test.ts`
- `pnpm --filter @codex-web/protocol test -- officialIpc.test.ts`
- `pnpm --filter @codex-web/web typecheck`
- `pnpm --filter @codex-web/server typecheck`
- `pnpm --filter @codex-web/protocol typecheck`

### 后续可补

- 对真实自动触发压缩的长会话再补一张浏览器截图验收，确认进行中到完成态不再卡停止按钮。
- `/compact` 手动触发与自动压缩应继续共用同一 `contextCompaction` UI，不另起 Web 私有状态。

## 问题 10：官方 `imageView` 图片展示缺失

### 观察

Web 在真实会话 `019eb4cc-4885-7c82-9385-5a52cc2b7efd` 中把多条官方 `imageView` item 渲染成：

```text
未知官方内容 imageView
```

展开后只能看到 raw JSON：

```json
{
  "type": "imageView",
  "id": "...",
  "path": "C:\\Users\\user\\Desktop\\素材\\..."
}
```

Desktop 对照会把这些图片直接渲染成多图画廊，而不是一行一张、不是文件卡片。用户补充的最终展示口径：

- 主要限制高度，按图片原比例缩放。
- 不用固定比例裁剪，不展示被裁剪的效果。
- 不要外层文件卡片/边框。
- 不显示图片文件名。

### 截图证据

- `C:/Users/user/AppData/Local/Temp/codex-clipboard-47e425da-f7d7-4d88-858e-76ccd84932de.png`
  - Web 将连续 `imageView` 显示为 `未知官方内容 imageView`，其中一条展开后可见官方 raw item。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-745871a1-fe11-447d-9638-1434e5b9f370.png`
  - Desktop 同一类图片直接以多图画廊展示。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-8e61eada-56bf-42fc-9f3b-a75029958f86.png`
  - 用户确认更接近目标的方向：图片换行展示，不是逐条 unknown。
- `C:/Users/user/AppData/Local/Temp/codex-clipboard-f09becc3-aba0-4899-baad-e882f522e670.png`
  - 反例：图片被做成外层卡片且显示文件名，不符合最终口径。

### 官方 app-server/schema 证据

- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/README.md`
  - `imageView` 是 agent 调用图片查看工具时发出的官方 item，shape 为 `{ id, path }`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts`
  - `ThreadItem` union 已包含 `{ "type": "imageView", id: string, path: AbsolutePathBuf }`。
- `C:/Users/user/AppData/Local/Temp/openai-codex/codex-rs/app-server/src/thread_history.rs`
  - `ViewImageToolCall` 会被映射为 `ThreadItem::ImageView`。

### 仓库现状证据

- `packages/domain/src/index.ts`
  - 已有 `ImageViewItem` 类型，并把官方 `type === 'imageView'` 投影为 `{ type, id, path }`。
- `packages/api/src/index.ts`
  - API schema 已允许 `officialImageViewItemSchema`。
- `apps/web/src/app/components/MessageBlocks.tsx`
  - 修复前只有 `{ type: 'image' }` 渲染分支，没有 `{ type: 'imageView' }` 分支，因此会落到 unknown fallback。
- `apps/web/src/app/components/messageBlocks/shared.tsx`
  - 现有 `MessageImages` 已具备图片加载、点击预览和本地路径转 `/api/files/content` 的能力；本轮只需复用并增加隐藏 label 的展示模式。

### 已确认

- 这是既有 Web renderer 缺口，不是本轮上下文窗口或功能菜单修改引入。
- 不新增私有协议，不影子存储图片路径；只消费官方 `imageView.path`。
- 复用现有 `/api/files/content` 绝对路径读取能力，不新增文件接口。
- 连续 `imageView` item 聚合成一个 gallery，避免刷屏式逐条展示。

## 关联基准与需要后续修订的文档

- `docs/ui_fidelity.md`
  - 当前基准容易混淆 Composer 底部活动条与会话正文执行摘要；需要拆分为“底部命令活动条隐藏、正文命令摘要保留”两条验收口径。
  - 新对话空状态已提到无项目/全局文案，但未细化 app-server projectless 行为。
  - 需要补充输入框上下文窗口进度提示与 Desktop 功能菜单基准。
  - 需要补充子智能体图标、hover 模型提示、点击打开子 agent 会话的 Desktop 基准。
  - 需要补充智能体创建/等待/关闭、上下文自动压缩的消息区展示基准。
  - 需要补充官方 `imageView` 图片画廊基准：按原比例缩放、限制高度、不裁剪、不显示文件名。
- `docs/mvp_gap_tracker.md`
  - 新对话高保真条目当前重点是项目态草稿和首条发送；需要追加无项目场景验收。
  - 需要追加输入框底部状态/菜单一致性相关缺口。
  - 需要追加子智能体右侧摘要与侧边聊天联动缺口。
  - 需要追加 `collabAgentToolCall` 生命周期与 `contextCompaction` 展示缺口。
- `docs/sync_acceptance_checklist.md`
  - 后续若实现 projectless thread，需要增加三端同步验收项，避免 Web 把 `cwd: null` 误变成默认项目。
  - 后续若对齐子 agent 点击打开会话，需要增加主会话与 subagent thread 同步验收项。
  - 后续若对齐 closeAgent/status，需要增加主会话、子 thread、右侧摘要三者状态一致性验收项。

## 分组设计与解决方案

本节最初是待确认方案；2026-06-11 已开始分批实施，实际完成状态以“实施核对状态”为准。方案基于 2026-06-10/2026-06-11 两份 ThreadItem 计划、`docs/official_first_implementation.md`、当前 Desktop 截图和本轮官方 app-server/schema 证据。

### 总原则

1. 官方优先：凡是 app-server、official IPC 或 schema 已经提供的数据，直接从官方接口/事件进入 backend/domain/API，不写死、不复制到 SQLite。
2. canonical 保真：`Turn.items` 继续以官方 `ThreadItem.type` 为主，`collabAgentToolCall`、`contextCompaction`、`agentMessage`、`webSearch` 等不转成 Web 私有 canonical shape。
3. UI 派生：`已处理`、`已关闭 4 个智能体`、上下文圆环、右侧状态标签等都属于 renderer view model，不写回 official item。
4. Desktop 口径优先：截图中 Desktop 不显示的 Composer 底部命令活动条和完成态 reasoning，Web 也不显示；截图中 Desktop 有专门 lifecycle 的地方，Web 不再落到 `未知官方内容`。
5. 三端同步优先：projectless、subagent thread、token usage、context compaction 都必须能跟官方 Desktop/VS Code 的 live state 收敛。
6. 大文件先拆边界：触及超过 2000 行的单体文件时，先抽 route/component/helper 边界，再接新功能。
7. 官方接口审计先行：每个功能进入实现前，都要先查官方 README、schema、app-server 源码和必要的 Desktop/VS Code host 证据；若已有列表/状态/能力接口，Web 只做薄转发和 view model，不自建业务列表或影子协议。

### 分组总览

| 分组                         | 覆盖问题       | 目标                                                  | 核心方案                                                                                                           |
| ---------------------------- | -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A. 消息完成态与生命周期      | 1、2、8、9、10 | 消息区贴近 Desktop，去掉噪声，补齐 official lifecycle | 隐藏 Composer 底部命令活动条；完成态隐藏 reasoning；`collabAgentToolCall`/`contextCompaction`/`imageView` 专门渲染 |
| B. 子智能体与侧边会话        | 7、8           | 右侧子 agent 可读、可点、状态清楚                     | 扩展 `ThreadSubAgent` 投影；从 spawn/wait/close 和子 thread 合成状态；点击读取子 thread 并打开侧边聊天             |
| C. projectless 新对话        | 4              | 真正支持“不使用项目”聊天                              | `cwd: null/undefined` 不再回退项目根；domain 明确 `workspaceKind` 与 `projectId` 分离                              |
| D. Composer 上下文与功能菜单 | 5、6           | 输入框底部能力与 Desktop 对齐                         | 接入 `thread/tokenUsage/updated`；先审计官方菜单/能力列表接口，确认没有统一接口时才做薄 view model 聚合            |
| E. 文件右侧栏可用性          | 3              | 小屏下文件树可折叠                                    | 文件 tree 与 preview 拆成独立面板状态，增加折叠/恢复按钮                                                           |
| F. 结构拆分与验收            | 横切           | 避免继续堆大文件，形成可测边界                        | 拆 `app.ts`、`ChatMain.tsx`、`Composer.tsx`；协议/API 扩展走独立 schema/helper                                     |

### A. 消息完成态与生命周期

覆盖：

- 问题 1：隐藏 Composer 底部独立命令活动条，保留会话正文命令摘要。
- 问题 2：完成后隐藏 `已思考` reasoning 块。
- 问题 8：适配 `spawnAgent`、`wait`、`closeAgent` 等 `collabAgentToolCall`。
- 问题 9：适配 `contextCompaction` 自动压缩展示。
- 问题 10：适配官方 `imageView` 图片画廊展示。

设计：

1. 在 renderer 层新增或扩展纯函数，例如 `messageLifecycleView.ts` / `collabAgentLifecycle.ts`，输入为 canonical official items，输出 Desktop 风格 view model。
2. `ComposerActivityStrip` 不再展示 command activity row；`groupedOperationSummary(...)` 保持会话正文执行摘要和命令数量，避免破坏可追溯信息。
3. `reasoning` 展示改为：
   - active 且还没有 final answer 时允许显示 `正在思考`。
   - 进入已处理区或 turn completed 后隐藏完成态 reasoning，不再显示 `已思考` 和“推理内容已折叠”占位。
4. `collabAgentToolCall` 不再走 unknown fallback：
   - `spawnAgent completed` 聚合为 `已创建 N 个智能体`，列出 nickname/thread id 与 prompt 摘要。
   - `wait inProgress/completed` 用作状态更新，默认不刷一大段 raw JSON。
   - `closeAgent completed` 聚合为 `已关闭 N 个智能体`，列出每个 agent。
   - `failed` 保留错误态和最小诊断入口。
5. `contextCompaction` 直接在主分发中处理：
   - `item/started` 或 live active 阶段显示 `正在自动压缩上下文`。
   - completed/history 阶段显示 `上下文已自动压缩`。
   - 作为居中分隔提示保留，不进命令/工具数量摘要。
6. `imageView` 直接在主分发中处理：
   - 连续 `imageView` 聚合为一个图片 gallery。
   - 使用官方 `path` 走现有文件读取接口，不新增影子图片接口。
   - UI 只限制最大高度和最大宽度，按原比例缩放，不裁剪。
   - 不显示外层文件卡片和文件名，点击图片仍可打开预览。

落地触点：

- `apps/web/src/app/components/MessageBlocks.tsx`
- `apps/web/src/app/components/messageBlocks/*`
- `apps/web/src/app/officialThreadItems.ts`
- `apps/web/src/app/turnProcessCollapse.ts`
- `packages/domain/src/index.ts`
- `packages/api/src/index.ts`

验收：

- Composer 底部不出现独立 `已运行 ...` 命令活动条。
- 会话正文里的命令摘要、命令数量和展开详情仍可正常查看。
- 完成后的消息区不出现 `已思考`。
- `collabAgentToolCall` 不再显示为 `未知官方内容`。
- 创建、等待、关闭子 agent 都有 Desktop 风格摘要。
- 自动压缩进行中/完成态都有专门分隔提示。
- `imageView` 不再显示为 `未知官方内容`，多张图片可换行展示且不裁剪、不显示文件名。

### B. 子智能体与侧边会话

覆盖：

- 问题 7：图标、模型 tooltip、点击打开子 agent 会话。
- 问题 8：已完成/已关闭状态要清楚标明。

设计：

1. domain/API 层扩展 `ThreadSubAgent`，但只承载官方可验证数据和 UI 必需派生字段：
   - `id`
   - `name` / `agentNickname`
   - `role` / `agentRole`
   - `status`
   - `model`
   - `reasoningEffort`
   - `source`
   - `parentThreadId`
2. 状态合成规则采用明确优先级：
   - `closeAgent completed` -> `shutdown` / `已关闭`
   - `CollabAgentState.status` -> `running/completed/errored/...`
   - 子 thread `Thread.status` -> loaded/active/notLoaded 等辅助信息
   - `spawnAgent completed` 只证明已创建，不长期停留在 `pendingInit`
3. 模型 tooltip：
   - 优先使用 `collabAgentToolCall.model`，因为官方测试确认它反映 spawn 后实际生效模型。
   - 文案按 Desktop：`使用 GPT-5.5`；可在详细 tooltip 中补 reasoning effort，但默认不增加噪声。
4. 点击行为：
   - 右侧 `子智能体` 行改为 button。
   - 点击后调用现有 thread read/detail 路径读取子 thread id。
   - 复用右侧侧边聊天容器打开一个 child thread tab，而不是另建 Web 私有 sideConversation。
5. 图标来源：
   - 继续查 Desktop renderer 或官方 hidden 字段是否有 icon/avatar。
   - 如果官方没有字段，采用 deterministic pixel icon view helper，从 `threadId + nickname` 派生颜色和像素图；该 helper 只影响 UI，不写入 domain canonical。
   - 图标算法必须先用截图样本比对，不能为了“看起来像”随意写死 4 个名字。

落地触点：

- `packages/domain/src/index.ts`
- `packages/api/src/index.ts`
- `apps/web/src/app/components/ChatMain.tsx`
- 新增 `apps/web/src/app/subAgentViewModel.ts`
- 可能新增 `apps/web/src/app/components/rightRail/SubAgentsPanel.tsx`

验收：

- 右侧子 agent 显示 nickname 或可识别 thread id，状态不混乱、不重复。
- hover 能看到模型。
- 点击打开对应子 agent 会话内容。
- 已完成和已关闭 agent 可以保留在列表中，但必须置灰/标注 `已完成`、`已关闭` 或等价状态。
- 主会话、子 thread、右侧列表的状态最终一致。

### C. projectless 新对话

覆盖：

- 问题 4：官方 Desktop 支持“不使用项目”创建聊天。

设计：

1. 后端 `thread/start` 保留用户选择语义：
   - 选择项目：传官方 `cwd`。
   - 选择“不使用项目”：不传 `cwd` 或传 `cwd: null`，不再回退 `config.projectRoot`。
2. domain 模型区分两件事：
   - `workspaceKind`: `project` / `projectless` / `unknown`
   - `projectId` / `projectPath`: 只表示真实项目归属
   - `effectiveCwd`: 官方 thread 返回的实际工作目录，仅用于环境/诊断，不等同项目
3. 读取历史 projectless thread 时，优先使用 official live state 的 `conversationState.workspaceKind: "projectless"`。如果只有 app-server `thread.cwd`，不得单靠 cwd 推断成项目。
4. 左侧导航：
   - projectless thread 归入“对话/无项目”分组。
   - 不出现在 `codex_web` 项目下。
5. Composer 项目选择：
   - 保留 `不使用项目`。
   - 发起首条消息时沿用该选择创建 thread。
6. 右侧环境与文件：
   - projectless 显示 `无项目` 或 `Codex 管理目录`，不把 `effectiveCwd` 当普通项目根。
   - 文件浏览默认隐藏或只在官方返回明确可浏览 root 时启用；这点实施前需再按 Desktop 截图确认。

落地触点：

- `apps/server/src/app.ts` 的 `/api/domain/thread/start`
- `packages/domain/src/index.ts`
- `packages/api/src/index.ts`
- `apps/web/src/app/components/NavigationSidebar.tsx`
- `apps/web/src/app/components/Composer.tsx`
- `apps/web/src/app/components/ChatMain.tsx`

验收：

- 选择“不使用项目”后，请求不会把 `cwd` 变成 `config.projectRoot`。
- 用户提供的纯聊天样本不会被投影成 `codex_web` 项目会话。
- 列表分组、Composer 底部、环境卡片和文件面板都能表达 projectless。
- Desktop/VS Code/Web 对同一 projectless thread 不分叉。

### D. Composer 上下文窗口与功能菜单

覆盖：

- 问题 5：输入框底部上下文窗口圆形进度。
- 问题 6：输入框功能菜单与 Desktop 不一致。

设计：上下文窗口。

1. 后端/实时层接入官方 `thread/tokenUsage/updated`：
   - 保存到当前 live thread state 或 thread detail view model。
   - 不写入 SQLite 影子缓存。
   - 恢复 thread 时利用 `thread/resume` 后官方 replay 的 token usage，或从现有 live state 读取。
2. domain/API 增加 `tokenUsage` 投影：
   - `total`
   - `last`
   - `modelContextWindow`
3. 前端新增 `ContextWindowMeter`：
   - 圆形进度：`last.totalTokens / modelContextWindow`。
   - `total.totalTokens` 只代表累计用量，不代表当前背景信息窗口，不用于圆环百分比。
   - 无 `modelContextWindow` 时显示空态小圆环，不误报百分比。
   - hover 文案对齐 Desktop：`背景信息窗口`、`xx% 已用`、`已用 223k 标记，共 258k`。
4. 位置放在 Composer 底部模型/推理强度附近，保持稳定尺寸，避免输入框布局抖动。

设计：功能菜单。

1. 先做官方列表接口审计，不直接设计 Web 自有菜单协议：
   - 复查当前版本 app-server README、schema 和源码里是否存在统一菜单/command/capability list。
   - 复查 Desktop/VS Code host 层是否有私有但可验证的菜单组装来源。
   - 将审计结果写入本文或实现 PR 说明；若发现官方统一接口，优先接入该接口。
2. 如果官方没有统一菜单接口，只允许做“薄聚合”：
   - 聚合层不创造业务语义，只把官方列表接口结果和来源透传成前端 view model。
   - 每个菜单项必须带 `sourceMethod` / `sourceKind`，例如 `model/list` 或 `mcpServerStatus/list`。
   - 不把聚合结果写入 SQLite，不做本地长期缓存。
   - 不为未确认能力写死 enabled 状态。
3. 当前已确认需要纳入审计的官方接口：
   - `model/list`
   - `modelProvider/capabilities/read`
   - `collaborationMode/list`
   - `permissionProfile/list`
   - `experimentalFeature/list`
   - `skills/list`
   - `hooks/list`
   - `mcpServerStatus/list`
   - `configRequirements/read`
   - `app/list`
   - `plugin/list` / `plugin/installed` 仅在官方标注可生产使用后接入
   - `thread/goal/*`、`thread/memoryMode/set`、`memory/reset`、`feedback/upload` 只作为对应条目的官方操作来源，不当成菜单列表来源
   - `account/rateLimits/read`、`thread/tokenUsage/updated`、`thread/settings/updated` 只作为状态来源，不当成菜单列表来源
4. 前端菜单按 Desktop 分组和命名重排，但分组只作为 UI view model：
   - `IDE 上下文`
   - `MCP`
   - `个性`
   - `侧边`
   - `反馈`
   - `宠物`
   - `推理模式`
   - `模型`
   - `状态`
   - `目标`
   - `计划模式`
   - `记忆`
   - `技能`
5. 对 Web 未实现或 Desktop host 专属条目：
   - 不写死假功能。
   - 先显示 disabled 或隐藏，需由用户确认哪种更接近 Desktop/Web 目标。
6. 权限相关条目从 `permissionProfile/list` 和 `configRequirements/read` 来，不继续只依赖硬编码 `PERMISSION_OPTIONS`。
7. MCP 相关条目从 `mcpServerStatus/list` 来，不自建 MCP server/tool/auth 状态列表。
8. Apps/connectors 相关条目只使用官方 `app/list` / `app/list/updated`；本计划不引入不存在的 `apps/list`。
9. `个性`、`IDE 上下文`、`侧边`、`宠物` 等未确认统一列表来源的条目，进入实现前必须继续查 Desktop/VS Code host 证据；没有证据时只允许隐藏或 disabled，不允许实现假功能。

落地触点：

- `apps/server/src/appServerProcess.ts`
- `apps/server/src/app.ts`
- `packages/api/src/index.ts`
- `apps/web/src/app/hooks/useRuntimeData.ts`
- `apps/web/src/app/components/Composer.tsx`
- 新增 `apps/web/src/app/components/composer/ContextWindowMeter.tsx`
- 新增 `apps/web/src/app/components/composer/ComposerCommandMenu.tsx`

验收：

- Composer 底部出现圆形上下文窗口用量，hover 信息清楚。
- 历史恢复、运行中、完成后都能显示最近官方 token usage。
- 功能菜单命名、顺序和可用/不可用状态与 Desktop 基本一致。
- 没有官方来源的能力不伪造成可用功能。

### E. 文件右侧栏可用性

覆盖：

- 问题 3：文件树缺少单独折叠按钮。

设计：

1. 将文件预览和文件树视为右侧文件 tab 内的两个 pane：
   - `FilePreviewPane`
   - `ProjectFilesBrowser`
2. 增加 `fileTreeCollapsed` 状态：
   - 折叠时保留窄按钮或 header 图标，便于恢复。
   - 不关闭整个右侧栏。
   - 不影响已打开文件预览。
3. 折叠状态用 localStorage 记忆，key 与现有 `FILE_TREE_WIDTH_STORAGE_KEY` 同级；不写入 thread/detail。
4. 小屏策略：
   - 到达窄宽度时默认折叠文件树或提供更明显的一键折叠。
   - 仍允许拖拽恢复宽度。
5. 图标使用现有 icon 库，按钮带 tooltip。

落地触点：

- `apps/web/src/app/components/ChatMain.tsx`
- `apps/web/src/app/App.module.css`
- 可能新增 `apps/web/src/app/components/rightRail/FileWorkspacePanel.tsx`

验收：

- 文件树可一键折叠/展开。
- 折叠后文件预览空间明显增加。
- 小屏下不出现输入框、文件树、预览区域互相挤压。
- 整体右侧栏开关和文件树折叠互不混淆。

### F. 大文件拆分重构计划

本次功能触及多个超过或接近 2000 行的单体文件。按项目规范，不能继续把新逻辑堆进去。

当前行数：

| 文件                                            | 当前行数 | 本次处理原则                                                                          |
| ----------------------------------------------- | -------: | ------------------------------------------------------------------------------------- |
| `apps/server/src/app.ts`                        |     5335 | 先拆 route 注册和官方能力聚合 helper，再改 projectless/runtime/token usage 路由       |
| `apps/web/src/app/components/ChatMain.tsx`      |     3728 | 先拆右侧栏、文件 panel、subagent panel、turn layout 接线                              |
| `apps/web/src/app/components/Composer.tsx`      |     2342 | 先拆 command menu、runtime controls、context meter、附件/草稿子组件                   |
| `packages/protocol/src/index.ts`                |     2728 | 若本轮触碰 IPC method map 或 stream state shape，先抽 method map 与 normalizer helper |
| `packages/api/src/index.ts`                     |     1829 | 虽未超过 2000，但扩展 token/subagent/runtime schema 前应准备子 schema 文件，避免越线  |
| `apps/web/src/app/components/MessageBlocks.tsx` |     1319 | 已低于 2000；新增 lifecycle 渲染继续放到 `messageBlocks/` 子组件，避免回涨            |

拆分顺序：

1. 后端 route 拆分：
   - `apps/server/src/routes/threadRoutes.ts`
   - `apps/server/src/routes/runtimeOptionsRoutes.ts`
   - `apps/server/src/routes/tokenUsageRoutes.ts`
   - `apps/server/src/routes/fileRoutes.ts`
   - 先做无行为变化迁移，再接 projectless/token usage/capability 聚合。
2. Composer 拆分：
   - `ComposerCommandMenu.tsx`
   - `ComposerRuntimeControls.tsx`
   - `ContextWindowMeter.tsx`
   - `useComposerRuntimeOptions.ts`
   - 新功能只接入拆分后的子组件。
3. ChatMain/右侧栏拆分：
   - `RightRail.tsx`
   - `EnvironmentPanel.tsx`
   - `SubAgentsPanel.tsx`
   - `FileWorkspacePanel.tsx`
   - `SideThreadPanel.tsx`
4. 消息 lifecycle helper：
   - `collabAgentLifecycle.ts`
   - `messageLifecycleView.ts`
   - `subAgentViewModel.ts`
   - React 组件只消费 view model。
5. API/schema 拆分：
   - token usage、subagent、官方 capability/list view model 的 schema 拆到独立文件或明确分区，再由 `packages/api/src/index.ts` 汇出。

拆分约束：

- 拆分阶段不改变行为，不夹带功能。
- 每个拆分 PR/阶段都跑最小测试和 `git diff --check`。
- 新组件只接 domain/API view model，不直接读 official raw params。
- 不把 owner/follower、raw IPC method 等诊断概念暴露给普通用户。

### 推荐实施顺序

| Phase | 内容                     | 目标                                                                                                                             |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 0     | 方案确认与官方接口审计   | 再次核对 app-server README/schema/source、Desktop/VS Code host 证据、当前 dirty worktree；逐项确认是否已有官方列表/状态/能力接口 |
| 1     | 无行为拆分               | 拆 `app.ts`、`Composer.tsx`、`ChatMain.tsx` 的相关边界                                                                           |
| 2     | projectless 数据语义     | 修 `cwd` 回退、补 `workspaceKind/effectiveCwd`、更新导航/环境展示                                                                |
| 3     | 消息完成态清理           | 隐藏 Composer 底部命令活动条、隐藏完成态 reasoning、补 `contextCompaction` 分发                                                  |
| 4     | 子智能体 lifecycle       | 投影模型/状态，聚合 spawn/wait/close，右侧列表可 hover/click                                                                     |
| 5     | token usage 与上下文圆环 | 接 `thread/tokenUsage/updated`，补 Composer meter                                                                                |
| 6     | 功能菜单对齐             | 先完成官方列表接口审计；若无统一接口，后端仅薄转发/聚合官方列表结果，前端按 Desktop 菜单重排                                     |
| 7     | 文件树折叠               | 文件 tab 增加局部折叠按钮与小屏布局                                                                                              |
| 8     | 文档与验收基准           | 更新 `ui_fidelity`、`mvp_gap_tracker`、`sync_acceptance_checklist`                                                               |
| 9     | 真实三端验收             | Desktop/VS Code/Web 同 thread 验收 projectless、subagent、token usage、compaction                                                |

### 推荐测试与验收

自动化优先：

```powershell
corepack pnpm --filter @codex-web/domain test -- index.test.ts
corepack pnpm --filter @codex-web/api test -- index.test.ts
corepack pnpm --filter @codex-web/server test
corepack pnpm --filter @codex-web/web test
corepack pnpm typecheck
git diff --check
```

按改动范围补充：

- projectless：`threadStartRoute.test.ts`、导航/Composer 单测、真实 `cwd: null` 请求体断言。
- token usage：app-server notification reducer/local live store 测试、Composer meter 组件测试。
- 功能菜单：runtime options route/schema 测试、Composer command menu 测试。
- subagent：domain/API subAgents schema 测试、`collabAgentToolCall` 聚合测试、右侧点击打开子 thread 的组件/e2e。
- file tree：桌面与窄屏 Playwright 截图，验证折叠后无横向溢出。
- lifecycle：MessageBlocks/turnProcessCollapse 测试，覆盖 completed reasoning 隐藏、closeAgent 聚合、contextCompaction。

人工验收：

1. Desktop 创建 projectless 聊天，Web 列表归到无项目，不误归当前项目。
2. Desktop 触发子 agent，Web 显示图标/状态/模型 tooltip，点击可看子 agent 会话。
3. 子 agent 完成或关闭后，Web 保留但明确标注状态。
4. 自动上下文压缩发生时，Web 显示 Desktop 风格分隔提示。
5. Composer hover 上下文圆环显示 token 用量。
6. 功能菜单从 Desktop 迁移用户视角不再出现明显命名/入口错位。

## 后续未完成确认事项

已进入第一轮实现与复核。以下事项仍需要继续确认或补齐官方依据：

1. 完成态执行摘要的保留范围。
2. 完成态 reasoning 是否完全隐藏。
3. 文件树折叠按钮的交互边界。
4. 无项目新对话的入口、展示和官方 app-server 入参边界。
5. 上下文窗口进度提示的数据来源、展示时机和 hover 文案。
6. 输入框功能菜单需要对齐 Desktop 到什么粒度，以及哪些条目属于 Web 范围。
7. 子智能体图标来源、模型 tooltip 文案，以及点击打开子 agent 会话的映射边界。
8. `spawnAgent`、`wait`、`closeAgent` 等智能体生命周期消息的聚合与展示口径。
9. 已完成/已关闭子 agent 是否保留在右侧摘要，以及状态标签如何表达。
10. `contextCompaction` 自动压缩的进行中/完成态展示口径。
11. 功能菜单中 Desktop host 专属条目在 Web 上是隐藏还是禁用展示。
12. projectless thread 的文件面板是隐藏、只读显示 effective cwd，还是按官方返回 root 有条件启用。

未完成项进入后续实施前继续按官方优先准则复核，不补写自造接口。
