# UI 高保真验收基准

更新时间：2026-05-31

本文用于指导 `codex_web` 后续复刻官方 Codex Desktop 的 UI 验收。它不是产品代码规范，而是截图对齐、人工验收和视觉回归的共同基准；第一版以浅色主题为准，移动端以可日常使用为准。

参考入口：

- `docs/product_spec.md`
- `docs/mvp_gap_tracker.md`
- `docs/playwright_e2e.md`
- `apps/web/src/styles/tokens.css`
- `apps/web/src/app/App.module.css`

## 1. 验收原则

1. 官方 Codex Desktop 是桌面端视觉和交互的最终参考；`codex_web` 当前 token 只是可测量的本地起点。
2. 先验收浅色主题；暗色主题不进入第一版高保真范围。
3. 高保真不只看像素，还包括信息层级、列表密度、折叠行为、运行状态、禁用状态和流式更新时的稳定性。
4. Playwright 截图用于“人工签收后的回归保护”，不能替代人工与官方 Desktop 的对照。
5. 截图、fixture 和验收记录不得包含私密 thread 正文、真实文件内容、token、密码、邮箱或敏感路径。
6. i18n 是 UI 高保真验收的一部分；第一版至少覆盖 `zh-CN` 和 `en-US`，英文长文案不能造成按钮、菜单、右侧栏、Composer 或移动端横向溢出。

## 2. 页面区域

桌面端主界面按五个一级区域验收：

| 区域       | 验收重点                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| 左侧 rail  | 顶部新建/导航入口、搜索、设置、选中态、hover 态、图标尺寸、分隔与底部停靠顺序贴近官方 Desktop。   |
| 侧栏内容区 | workspace 入口、搜索框、项目列表、会话列表、归档入口、空状态、滚动条与选中态保持官方层级。        |
| 顶栏       | 项目/会话 breadcrumb、标题、运行状态 badge、搜索/重命名/归档/停止/设置等操作入口位置稳定。        |
| 聊天视口   | 居中列宽、thread intro、消息作者、消息正文、结构化块、审批卡、诊断/运行状态块在流式更新时不跳动。 |
| Composer   | 输入框、附件、模型、可选 Plan 模式、追求目标状态条、reasoning effort、Skills、发送/停止、禁用与运行态是核心验收面。 |

官方 Desktop 顶栏右侧按钮需要按真实语义拆分，不把所有“右侧内容”混成一个面板：

- 打开本地环境：最左侧按钮用于 VS Code、File Explorer、Terminal、WSL 等本地环境入口。Web 第一版不实现真实打开能力，可保留占位/菜单信息，不作为阻塞。
- 置顶摘要：第二个按钮用于打开/折叠当前右侧“进度、环境信息、子智能体、来源”等摘要栏。该区域是 pinned summary，不是下面的真实右侧栏。
- 底部命令行：第三个按钮用于打开/折叠下方命令行面板。Web 可先做占位或后续实现，不能影响主聊天区和 Composer 的稳定布局。
- 真实右侧栏：最右侧按钮用于打开/折叠真正的侧边栏。它应是类似浏览器标签页的容器，不预置固定页、不去重、不限制同类页数量；`+` 新建任意类型标签，任意标签可关闭，关闭最后一个标签后回到新建入口。打开真实右侧栏时应自动收起置顶摘要，关闭真实右侧栏时恢复打开前的置顶摘要状态，避免右侧区域同时占用过多宽度。浏览器、审查、终端第一版只占位；文件标签已支持右侧预览和目录滚动。侧边聊天按官方 `sideConversation` stream state 只读同步：置顶摘要按真实侧聊标签数量和标题列出，点击后打开对应右侧标签并复用主聊天渲染 turns；后续发送/新建侧聊也必须走官方 fork/follower 同步路径，不能回到 Web 私有 thread。

新对话空状态需要按 Desktop 单独验收，而不是复用普通 thread 详情页：

- 左侧仍保留当前项目/会话导航，主区域空白居中，顶部只保留必要的 Plus/本地环境入口和右上角最少操作。
- 中心标题使用“我们应该在 `<project>` 中构建什么？”这类项目感知文案；无项目/全局会话时应使用对应的全局文案。
- Composer 居中显示在标题下方，底部一行展示项目、运行模式和分支等当前上下文；不显示置顶摘要、thread 消息、运行详情或右侧栏内容。
- 新对话输入附件时，附件预览同样位于文本输入上方：图片为缩略图，普通文件为文件卡片/文件 chip。

辅助页面也纳入高保真回归：

- 登录页：本机免登录以外的 LAN 密码页，面板宽度、错误态、提交禁用态。
- 搜索弹层：`Ctrl+K`/Header 搜索入口、结果分组、选中行、空结果。
- Settings 弹窗：入口先显示账户/设置小菜单，再进入 General、Projects、Security、Network、Appearance、Account、Diagnostics 弹窗；页签密度、表单行高、错误/成功提示保持可读。
- Debug 页：隐藏工程页可读即可，但布局不能溢出，状态 badge 和 JSON 面板要稳定。

## 3. 组件清单

高保真验收至少覆盖以下组件状态：

| 组件                 | 必测状态                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| rail icon button     | 默认、hover、active、disabled、tooltip/aria label。                                                             |
| workspace button     | 长名称截断、meta 截断、hover、选中工作区标识。                                                                  |
| search box/dialog    | 关闭、打开、输入中、无结果、项目结果、thread 结果、键盘关闭。                                                   |
| project row          | 默认、active、长路径、最近活动、无项目/global thread 分组。                                                     |
| thread row           | 默认、active、长标题、空标题、时间戳、streaming/activity dot。                                                  |
| status badge         | ready、warning、idle、长文本截断。                                                                              |
| activity panel       | 进度、工作区变更、端口、执行端、分支、提交、GitHub CLI、子智能体和来源；Git/工作区状态必须来自后端真实读取，不允许写死示例值。 |
| header action        | 搜索、重命名、归档/恢复、停止/interrupt、设置、移动端更多菜单；无选中会话时会话级操作必须禁用。                 |
| message author       | User、Codex、已思考/正在思考、已运行/正在运行、已编辑/正在编辑、计划、审批、错误、工具输出等图标和 meta；普通界面不暴露 owner/follower 等协议词。 |
| message block        | user、assistant、Markdown/GFM、code fence copy、reasoning、command、file change、plan、approval、image、error、tool output、unknown raw item；未知项在 UI 上显示为中文“未知内容”。 |
| code/output controls | copy、expand/collapse、长输出滚动、stderr、空输出、超长命令。                                                   |
| approval card        | command/file change、diff、changed files、accept、accept for session、decline、cancel、处理中。                 |
| file browser         | 路径栏、上级、文件/目录行、长文件名、权限错误、空目录。                                                         |
| attachment chip      | 图片缩略图、普通文件卡片、移除、上传中、上传错误、长文件名；图片不得退化成长文件名 chip。                      |
| runtime controls     | 模型与 reasoning effort 组合菜单、可选 Plan/目标模式、权限模式、Skills 多选、官方不可用/降级来源提示。                  |
| composer send        | 空输入禁用、发送中、上传中禁用、active turn 下 steer/start 切换、粘贴/拖拽附件。                                |
| settings controls    | tab、输入、select、checkbox、session row、脱敏排障包、诊断导出按钮、错误/成功 notice。                          |

## 4. Token 与几何起点

以下数值来自当前实现，用作本地截图基线的起点。后续若官方 Desktop 实测值不同，应更新 token 并在 PR/验收记录中说明差异来源。

| 类别      | 当前起点                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| 字体      | sans：系统 UI 字体栈；mono：`ui-monospace`/Consolas；全局 `letter-spacing: 0`。                            |
| 主背景    | app/sidebar `#f4f4f5`，main/elevated `#ffffff`，subtle `#fafafa`。                                         |
| 文本      | primary `#18181b`，secondary `#52525b`，muted `#71717a`。                                                  |
| 边框/状态 | subtle `#e4e4e7`，strong `#a1a1aa`，success `#15803d`，warning `#b45309`，danger `#991b1b`。               |
| spacing   | `4 / 8 / 12 / 16px` 为基础阶梯，组件内 gap 优先使用 6、7、8、10、12px。                                    |
| radius    | row/control `8px`，workspace/project icon `7px`，composer `16px`，pill `999px`。                           |
| 侧栏      | 默认 `320px`，范围 `260-360px`；rail `52px`；侧栏右边框 1px。                                              |
| 顶栏      | 桌面 `56px`，移动 `52px`；桌面水平 padding `22/18px`，移动 `10px`。                                        |
| 列宽      | chat column `58rem`，右侧栏 `320px`，桌面 chat/right gap `72px`；桌面网格向右对齐，让右侧栏贴近窗口右侧。 |
| 控件      | icon button `32px`，tiny icon `26px`，composer button `36px`，send/stop `38px`，block action `24px`。      |
| 行高      | project row 贴近官方密度，thread row token `28px` 起步，section header `28px`，search box `34px`。         |
| 消息块    | block header `min 36px`，plan row `min 38px`，detail row `min 36px`，file row `min 38px`。                 |
| 层级      | drawer `z=40`，header `z=20`，popover `z=50`；遮罩透明黑约 28%-30%。                                       |

验收容差建议：

- 官方截图对比时，关键几何尺寸允许先以 `±2px` 作为人工判断阈值；列表密度、Composer 高度、顶栏高度优先级最高。
- 文案因真实数据不同可以不完全一致，但行数、截断、省略号和空状态占位应一致。
- 首轮同步期间不能把默认空数组展示成最终空列表；侧栏和主聊天区必须先显示同步中状态，等官方 app-server 返回首个 thread page 后再显示真实空态。
- 浏览器字体渲染、滚动条宽度和系统缩放导致的轻微差异不作为阻塞项；布局错位、遮挡、溢出和状态缺失必须修。

## 5. Composer 验收

Composer 是一级产品面，不能按普通输入框验收。

| 项          | 基准                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 几何        | 桌面 dock padding `12px 24px 20px`，Composer 宽度对齐 chat column，圆角 `16px`，阴影轻，顶部有向白底过渡。                                        |
| 输入区      | 桌面 textarea `min-height: 74px`、padding `17px 18px 9px`；移动端 `min-height: 70px`、padding `15px 15px 7px`。                                   |
| 控件顺序    | 普通状态：`+` 输入选项菜单内放附件、可选目标模式和 Skills，底栏保留权限、已显式选择的目标模式、模型与 reasoning effort 组合菜单、发送；默认协作模式不常驻底栏也不随请求下发；active turn 才额外出现紧凑发送目标切换，用于引导当前或排队下一条。 |
| 追求目标    | Composer 上方的目标条只来自当前 thread 的真实 `goal` 状态，不能用 pinned summary 的 plan/progress 替代；必须提供编辑目标、暂停/恢复目标、清除目标、显示/隐藏完整目标四个真实动作。展开/收起是 Web 本地显示状态，其余动作必须调用后端 goal API 并跟 Desktop 状态同步。 |
| 附件        | 点击、粘贴、拖拽都可达；附件托盘位于文本输入上方，先显示附件再显示文字。托盘分为图片缩略图行和普通文件/状态行：图片一律显示缩略图，普通文件才显示文件图标、名称、大小和移除按钮；长文件名截断只用于普通文件。 |
| Skills      | 菜单宽度、滚动高度、多选 checkbox、已选 chip、加载/空状态、关闭按钮都要可测。                                                                     |
| active turn | 空输入时右侧主按钮切换为停止当前回复；输入文字后默认引导当前回复，可通过紧凑“当前/排队”控件切换发送目标；steer 模式支持携带后端已管理的附件，普通排队/下一条仍可独立选择附件；运行中不重复显示协作模式“目标”控件。 |
| 禁用态      | 无 thread、空输入、发送中、上传中、官方能力不可用时，按钮不可点且 opacity/提示一致。                                                              |
| 移动端      | `390px` 下控件自然换行但仍保持 `+` 输入选项、权限、可选目标、模型与思考深度、发送/停止的可达性；附件缩略图和普通文件卡片必须停留在输入区上方，不遮挡 textarea 或发送按钮；弹出菜单高度受限、可滚动、可点外部或 `Escape` 关闭，不得横向溢出。 |

## 6. 消息块验收

消息区必须覆盖官方 Desktop 的主要 item 类型。为了贴近 Desktop 的阅读密度，次要执行详情可以默认折叠，但关键执行信息必须能从摘要判断，并且展开后可复制、横向滚动和复看。

| 类型                | 必须可见                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| user                | 作者、状态 meta、纯文本正文、图片/附件预览；不渲染 Markdown/GFM，长文本默认折叠并可展开/收起。       |
| assistant           | 作者、状态 meta、Markdown/GFM 正文、图片，流式追加时不覆盖 Composer。                                |
| reasoning           | 默认浅灰中文折叠摘要、hover 变深、active 动效、折叠/展开、复制、折叠文案；默认折叠状态跟随官方状态。 |
| command             | 默认浅灰中文折叠摘要，单条命令也不暴露英文块头；展开后显示命令、status、cwd、exit code、duration、stdout、stderr、复制、横向滚动。 |
| file change         | 默认浅灰折叠摘要；展开后显示文件路径、状态、diff、复制；长路径截断但可读。                           |
| plan                | 标题、步骤、每步状态 badge、空步骤 fallback。                                                        |
| approval            | 类型、理由、command/cwd/root/file、changed files、diff、批准/拒绝/停止动作和处理中状态。             |
| image               | 图像实际可见，保留 mime/alt/文件名说明，超高图片不撑破视口。                                         |
| error               | 错误 message、code/detail、复制、展开，危险色不影响可读性。                                          |
| tool output/unknown | 默认浅灰折叠摘要，只露标题、状态或 rawType；展开后显示原始类型、状态、JSON/文本输出、复制，作为协议变化时的兜底可读面。 |

普通 Markdown fenced code block 必须渲染为带语言栏和复制按钮的紧凑代码块；长代码只允许块内横向滚动，不允许撑破桌面聊天列或移动视口。

连续的 `command`、`file change` 和 `tool output` 应合并成一条 Desktop-like 操作摘要，例如“已运行 3 条命令，12s”。即使只有单个执行项，也优先使用同一套中文摘要，而不是显示 `Command / completed` 这类块头。摘要默认折叠，展开后保留每个原始块的命令、cwd、exit、输出、diff 和复制/展开按钮。

当前实现记录：`file change` / “已编辑文件”默认只显示浅灰摘要并折叠，不直接铺开文件列表。展开摘要后先显示紧凑文件列表，单个文件仍默认折叠；继续展开具体文件时才显示 diff 或受限文件预览。diff 详情使用块内滚动、双列行号、加减行色块和紧凑复制入口，避免回退成大面积调试面板。后续还可继续对齐 Desktop 的审查按钮与更完整的文件操作菜单。

运行态摘要必须以 domain 归一化后的状态为准，不直接相信官方 raw shape。官方可能用字符串或对象表达状态，例如 `running`、`editing`、`thinking`、`in_progress`、`{ type: "running" }`；这些都应在 UI 上保留为“正在运行 / 正在编辑 / 正在思考”，直到出现明确终态、exit code 或完成事件后才收敛成已运行/已编辑或隐藏完成态思考。

移动端差异：

- `680px` 以下消息块取消桌面左缩进，正文、命令、审批、文件浏览都占满可用宽度。
- 次要详情可以默认折叠，但必须能展开；折叠摘要不能遮挡作者、状态或操作按钮。
- 长命令、长 diff、长路径只允许组件内部滚动或截断，不允许页面出现横向滚动。

## 7. 移动端差异

第一版移动参考视口为 `390 x 844`。

| 断点        | 行为                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `<= 980px`  | 左侧桌面 sidebar 隐藏，显示移动 Header 菜单；runtime strip 和桌面 header actions 收起；drawer 接管项目/thread 导航。 |
| `<= 680px`  | 顶栏高度 52px，聊天 padding `22px 12px 14px`，thread intro 降低图标/标题尺寸，Settings/Debug 变单列。                |
| `390 x 844` | 必须可登录、打开导航、选项目、选 thread、搜索、打开更多菜单、发消息、停止/interrupt、看设置、中文运行状态/运行详情和主要消息块。 |

移动验收不要求把桌面三栏压缩到同屏；优先保证 conversation-first：

1. 默认看到当前会话和 Composer。
2. 项目/thread 选择通过 drawer 可达。
3. 搜索、Settings、停止/interrupt 通过 Header 或更多菜单可达。
4. 所有菜单和弹层高度受限并可滚动。
5. 页面根不出现横向滚动，输入法弹出后 Composer 不遮住当前输入。

## 8. Playwright 截图基线策略

现有 Playwright 入口见 `docs/playwright_e2e.md`，当前视口为：

- `desktop-chromium`: `1920 x 1019`（按当前用户提供的 1920 宽 Desktop/浏览器截图尺寸作为桌面高保真校验起点）
- `mobile-chromium`: `390 x 844`

建议基线流程：

1. 先准备脱敏 fixture 或测试 thread，内容覆盖长标题、长路径、各类消息块、附件、审批、错误、active turn Composer 和空状态。
2. 运行 `pnpm build` 后启动 `pnpm dev:server`，或设置 `PLAYWRIGHT_BASE_URL` 指向 `18931` 开发前端。
3. 执行 `pnpm test:e2e:ui-fidelity` 生成首批固定命名截图；全量 `pnpm test:e2e` 也会运行该截图入口。
4. 当前截图会写入 Playwright 输出目录下的 `ui-fidelity/<project>-<name>.png`，例如 `desktop-chromium-login-gate.png`、`desktop-chromium-thread-sync-loading.png`、`desktop-chromium-empty-thread-list.png`、`desktop-chromium-new-thread-empty-state.png`、`desktop-chromium-shell.png`、`desktop-chromium-message-blocks.png`、`desktop-chromium-active-composer-stop.png`、`desktop-chromium-active-composer-steer.png`、`desktop-chromium-active-composer-queue.png`、`desktop-chromium-approval-card-pending.png`、`desktop-chromium-approval-card-expanded.png`、`mobile-chromium-login-gate.png`、`mobile-chromium-empty-mobile-drawer.png`、`mobile-chromium-mobile-drawer.png`、`mobile-chromium-mobile-skills.png`。
5. 只把人工签收通过的截图提升为视觉基线。稳定基线建议按视口和页面命名，例如 `ui-fidelity/desktop/shell.png`、`ui-fidelity/mobile/composer.png`；不要把 `test-results/` 中的临时失败截图当长期基线。
6. 基线更新必须在 PR/验收记录中说明：官方 Desktop 参考版本、截图日期、视口、系统缩放、变更原因。
7. 自动截图失败时先排查布局溢出、文本遮挡、缺状态、弹层位置；像素级微差异由人工对照官方截图判断。

桌面 shell、空列表、复杂消息块、active Composer 和 approval card 截图还必须自动检查右侧运行栏默认可见，并且 Composer 的右边界不能压到右侧运行栏；这用于防止“输入框过宽、挡住右侧栏”的回归。空状态截图必须覆盖首轮 thread list 仍在同步时不会显示最终空文案，以及同步完成后的空列表/空抽屉。复杂消息块截图复用脱敏 fixture，必须覆盖 Markdown/GFM、完成态 reasoning 隐藏、active reasoning 可见、command/file/tool 折叠摘要、上下文自动压缩、plan、approval、可见 image preview、error 和 unknown fallback。active Composer 截图必须覆盖空输入停止当前回复、输入文字后默认引导当前回复，以及手动切换为排队下一条。approval card 截图必须覆盖待审批摘要和 diff 展开状态，保留按钮、文件路径、变更文件和长 diff 的无溢出检查。

用户消息需要按 Desktop 行为作为纯文本气泡渲染，不进行 Markdown/GFM 解析；用户原始换行需要保留，`**bold**`、代码围栏和列表符号都应按字面文本展示。过长用户消息默认折叠并显示“显示更多”，展开后可手动收起，避免大段 prompt、规划或粘贴内容占满会话区。消息区默认字号和行距应偏紧凑，优先贴近 Desktop 的阅读密度，而不是网页文章排版。

首批建议截图矩阵：

| 视图                   | desktop `1920 x 1019` | mobile `390 x 844` |
| ---------------------- | -------------------- | ------------------ |
| 登录页                 | 需要                 | 需要               |
| 主 shell + 有 thread   | 需要                 | 需要               |
| 空 thread/空列表       | 需要                 | 需要               |
| 消息块全类型           | 需要                 | 需要               |
| active turn + Composer | 需要                 | 需要               |
| 附件 + Skills 菜单     | 需要                 | 需要               |
| 搜索弹层               | 需要                 | 需要               |
| Settings Diagnostics   | 需要                 | 需要               |
| Debug 页               | 需要                 | 可选但建议         |

长期基线应扩展为语言矩阵：核心 shell、Composer、Settings、消息块全类型和真实右侧栏至少分别跑 `zh-CN` 与 `en-US`。中文用于贴近日常主语言，英文用于暴露长文案截断、换行和菜单宽度问题；两种语言都不能出现页面级横向滚动。

## 9. 人工验收表

每轮 UI 高保真签收建议复制下表记录，至少保留日期、官方 Desktop 参考版本、浏览器、视口和结论。

| 编号 | 项目          | 验收问题                                                                                             | 结果 | 备注 |
| ---- | ------------- | ---------------------------------------------------------------------------------------------------- | ---- | ---- |
| 1    | 官方参考      | 已保存同一数据状态下的官方 Desktop 截图，并记录日期/版本/缩放。                                      |      |      |
| 2    | 整体布局      | 五大区域层级、宽度、顶栏、Composer 位置与官方接近。                                                  |      |      |
| 3    | 侧栏密度      | rail、项目行、thread 行、section header 行高和选中态无明显偏差。                                     |      |      |
| 4    | 顶栏操作      | 标题截断、状态 badge、搜索/重命名/归档/停止/设置入口稳定。                                           |      |      |
| 5    | Composer      | 输入区高度、控件顺序、附件、Skills、模型、模式、推理强度、发送/停止状态完整。                        |      |      |
| 6    | 流式状态      | active turn 更新时消息、状态、Composer 不跳动、不遮挡、不重复显示。                                  |      |      |
| 7    | 消息完整性    | user、assistant、reasoning、command、file change、plan、approval、image、error、tool output 都可读。 |      |      |
| 8    | 折叠与复制    | reasoning/command/diff/tool output 的折叠、展开、复制、长输出滚动可用。                              |      |      |
| 9    | 审批卡        | command/file approval 的上下文、diff、按钮和处理中状态清晰。                                         |      |      |
| 10   | 搜索          | 打开、输入、结果、空状态、选择 thread、关闭行为符合预期。                                            |      |      |
| 11   | Settings      | 页签、表单、session、诊断、错误/成功提示无溢出。                                                     |      |      |
| 12   | 移动 drawer   | `390 x 844` 下可打开/关闭、选项目、选 thread、恢复归档项。                                           |      |      |
| 13   | 移动 Composer | 控件换行正确，无横向滚动，输入和发送不被软键盘/安全区遮挡。                                          |      |      |
| 14   | 移动消息      | 结构化块默认折叠合理，展开后长内容只在块内滚动。                                                     |      |      |
| 15   | 新对话空状态  | 项目感知标题、居中 Composer、上下文行和附件预览顺序与 Desktop 接近。                                  |      |      |
| 16   | 无敏感信息    | 截图、fixture、验收记录不含私密正文、文件内容、token 或敏感路径。                                    |      |      |
| 17   | 回归基线      | 通过人工签收的 Playwright 截图已进入稳定基线说明，未签收截图不作基线。                               |      |      |

## 10. 阻塞判定

以下问题应阻塞 UI 高保真签收：

- 桌面端主区域、侧栏或 Composer 与官方 Desktop 信息架构明显不一致。
- Composer 缺少发送核心参数，或 active turn 下无法清楚区分 steer/queue/stop。
- 任一主要消息块类型不可读、无法展开、无法复制关键内容或长输出撑破页面。
- `390 x 844` 移动端不能完成登录、选择 thread、发送、停止和阅读主要消息块。
- 流式更新造成布局跳动、文本重叠、按钮遮挡或 Composer 被覆盖。
- 视觉基线截图含敏感内容，或无法复现同一测试数据状态。
