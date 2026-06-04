# MVP 收口看板

更新时间：2026-05-31

本文用于把 `codex_web` 从“真实同步切片”推进到“可日常使用的第一版”。它汇总产品方针、已完成能力、Top 缺口、三端同步验收入口、人工验收步骤和后续 worker 拆分边界。

参考来源：

- `docs/product_spec.md`
- `docs/implementation_status.md`
- UI 高保真验收基准：`docs/ui_fidelity.md`
- 会话流式输出设计：`docs/design/conversation_streaming_output.md`
- i18n 架构规划：`docs/i18n.md`
- `docs/startup_runbook.md`
- `docs/repository_overview.md`
- `docs/troubleshooting_sync.md`
- `documentation/protocol/official_codex_ipc_sync.md`
- 当前仓库 explorer 盘点：`apps/server`、`apps/web`、`packages/*`、`tests/e2e`

## 1. MVP 产品方针

### 1.1 第一优先级：三端实时同步

MVP 的产品定义不是“能在网页聊天”，而是：

```text
官方 Codex Desktop
官方 VS Code Codex 扩展
codex_web
```

三端可以围绕同一条 thread 实时看到同一条消息、同一段 stream、同一个 stop/approval/steer 结果。

因此：

- 官方-owned thread 必须优先走官方 IPC `thread-follower-*`，不能在 Web 侧静默启动本地 `turn/start`。
- Web-owned thread 可以使用本地 app-server，但必须广播 snapshot，并允许官方客户端反向 follower。
- owner/follower 是工程概念，不进入普通用户界面。
- 如果 owner 不明确、IPC 断开或协议不兼容，优先暴露清晰诊断，不用“看似成功”的本地 fallback 制造分叉。

### 1.2 第二优先级：可维护架构

当前架构方向保持不变：

- `apps/web` 只消费 Web/domain model，不直接依赖官方 raw protocol shape。
- `apps/server` 负责官方 IPC、app-server、HTTP/WebSocket、认证、诊断和本地文件访问边界。
- `packages/protocol` 负责官方 wire protocol 和 app-server 辅助。
- `packages/domain` 负责把官方/app-server 数据投影为 Web 稳定领域模型。
- `packages/api` 负责前后端共享 schema 和 runtime validation。
- `packages/ui` 负责设计 token 和共享 UI 出口。

任何 MVP 收口任务都应先保护这些边界，再补具体功能。

### 1.3 UI 策略：Desktop 高保真 + Mobile 可用

第一版主目标是浅色主题下高保真复刻官方 Desktop：

- 侧栏、项目、会话列表、主聊天区、Composer 的信息层级尽量跟随官方 Desktop。
- 复杂消息块不能随意隐藏；reasoning、command、plan、approval、file change、error、tool output 都要能读、能折叠、能复制。
- 移动端不是桌面压缩版，应使用 drawer/单列优先，但保留项目、搜索、发送、停止、设置和必要运行状态。

### 1.4 安全边界

MVP 是个人可信设备/LAN 场景：

- 默认 HTTP + LAN 密码/session，不适合裸露公网。
- 本机免登录，局域网设备需要登录。
- 诊断导出必须脱敏，不包含会话正文、文件内容、附件二进制、密码、token、secret 或 raw protocol payload。
- 删除语义按归档优先，不直接猜测或修改官方持久化文件。

## 2. 当前已完成盘点

### 2.1 基础设施

- pnpm workspace 已建立，包含 `apps/server`、`apps/web` 和 `packages/*`。
- 默认端口为后端 `18930`、前端开发 `18931`。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e` 已形成常规检查入口。
- Playwright 覆盖桌面与移动 shell、设置页、隐藏 debug 页、Composer runtime/attachment/键盘发送请求体链路、移动附件+Skills 发送闭环、移动 active turn 停止、移动审批卡片、移动复杂消息块、thread pagination cursor 链路、长会话列表 windowing、owner 失败 UI、审批卡片决策闭环、复杂消息块渲染和真实同步烟测支架；由于测试连接同一个真实本机服务、官方 IPC 和 app-server，当前固定串行运行，避免并发假失败。

### 2.2 后端与同步

- Fastify 后端已连接官方 `\\.\pipe\codex-ipc`，并管理本地 `codex app-server` 子进程。
- 官方 IPC bridge 已覆盖 framed JSON、initialize、stream cache、snapshot/patch、follower start/steer/interrupt/compact、Web-owned 模型/推理强度/协作模式 owner-state、recent follower diagnostics；协议测试已覆盖 follower start/steer/interrupt 的定向、discovery 和错误记录。
- 官方 IPC bridge 已补齐重连后缺 snapshot 的恢复路径：当 Desktop/VS Code 只广播 patches、Web 本地没有 stream 基线时，协议层发出 `patches-without-snapshot` 诊断，服务端用 app-server `thread/read` 只读补底到 official stream cache，但不广播、不声明 Web owner，避免 `cachedConversationCount=0` 时前端只能读历史而丢失 live stream。
- `/api/domain/thread/read` 对 external-owned 但内容不足的官方 snapshot 也会做同样的只读 official stream cache 补底，不写 SQLite detail cache，减少关机/服务重启后“能读历史但后续 patch 套在空快照上”的风险。
- app-server bridge 已覆盖 thread list/read、archive/unarchive、model/list、collaboration mode、skills、account、turn start/steer/interrupt。
- 官方-owned thread 的本地 fallback 已收紧：owner 不明或 IPC 不可用时返回错误，避免静默分叉；`turnRoutes.test.ts` 已把 `/api/domain/turn/start|turn/steer|turn/interrupt` 的 HTTP 路由级不分叉规则自动化覆盖。
- external-owned 空 snapshot 的 thread detail 只做只读 hydrate，不把 app-server 结果写入 SQLite detail cache，避免 Web 投影缓存覆盖官方 live source。
- Web-owned thread 已有公开 snapshot 广播、local-only owner、start/interrupt handler 和 owner handoff 保护；本地 app-server 通知和 approval 事件只有在确认 Web-owned 且允许广播时才会广播 owner snapshot，且广播执行前/读完后都会复查 owner；runtime owner-state 在失去 Web ownership 后会清理，避免旧模型/推理/协作模式串到后续 turn；`threadStartRoute.test.ts` 已验证 Web 新建 thread 后会通过真实 `OfficialIpcBridge` ownership 逻辑 claim local-only owner、不写官方 stream state，并在官方 IPC 尚未初始化 Web `clientId` 或 local-only owner 未建立时拒绝创建且不写缓存；`threadRenameRoute.test.ts` 已覆盖 external-owned rename 走官方 Desktop 同款 app-server `thread/name/set`，只读 hydrate official cache 且不声明 Web owner，同时覆盖 rename detail refresh 期间 owner 丢失时不重广播；`threadArchiveRoute.test.ts` 和 `threadUnarchiveRoute.test.ts` 仍覆盖 external-owned archive/unarchive guard；Web-owned thread 归档成功后会释放 Web owner/cache，且外部 owned thread 不会被 Web 清掉官方 owner cache。
- 协议兼容性、sync readiness、follower method capability matrix、app-server warmup、普通日志、脱敏诊断导出和 `sync:doctor --report` 脱敏证据包已落地。

### 2.3 前端与产品面

- React/Vite Desktop-like shell 已实现项目/会话列表、thread detail、Composer、搜索、设置/诊断、隐藏 debug 页；Navigation、ThreadHeader、ChatMain、Composer、MessageBlocks、SearchPanel、LoginGate 已拆成独立组件边界，认证、运行态数据和路由 helper 已拆到 `hooks/` 与 `routes.ts`，`App.tsx` 主要保留页面编排。
- 普通会话和归档会话列表已接入 app-server cursor 分页，侧栏以 `+` 提示还有更多数据，并提供“加载更多”入口；项目、会话和归档分组默认只展示前 5 条，可手动“展开显示”，减少左栏信息密度；分页合并 helper 已有 Web 单测。已加载会话超过阈值后会用轻量 virtual window 渲染当前滚动窗口附近的行，降低长列表 DOM 数量。
- Composer 已接入发送、停止、active turn 引导/排队、模型、可选目标模式（Plan）、reasoning effort、Skills、权限模式和附件托盘；当前控件按 Desktop 风格收口为 `+` 输入选项菜单、权限、按需显示的目标模式、模型与思考深度组合菜单和发送/停止按钮，默认模式不在底栏常驻，只有用户显式选择“目标”时才下发 collaboration mode；输入框在空正文开头输入 `/` 会打开 Desktop-like 斜杠菜单，Skills 来自 `/api/skills?cwd=...` 的官方 `skills/list` 动态结果，可覆盖全局和项目技能并支持多选，功能项只切换 Web 真实已有状态/动作且不会写入提示词正文；移动端菜单支持点外部与 `Escape` 关闭；桌面端支持 `Enter` 发送与 `Shift+Enter` 换行，上传中会阻止键盘发送绕过按钮禁用态。active turn 的“引导当前”也可携带后端已管理附件，图片会以官方 `localImage` input 交给 app-server/owner，运行中不重复显示“目标”控件。移动端会优先使用服务端当前 `defaults.reasoningEffort`，例如当前默认 `xhigh` 时显示“超高”，不再被模型自己的默认 `medium` 覆盖。
- Composer 上方的“追求目标”已和 Desktop thread goal 状态对齐：它来自 `/api/domain/thread/read` 的 `goal`，并通过 `/api/domain/thread/goal/set|thread/goal/clear` 调用 app-server 的 `thread/goal/*`，支持编辑、暂停/恢复、清除、显示/隐藏完整目标。该状态不是 pinned summary 里的 plan/progress，也不是 Composer 底栏可选 Plan/目标模式；三者在 UI 和请求参数上必须保持分离，避免把进度步骤误当成持久目标。
- 消息渲染已覆盖 user、assistant、Markdown/GFM 正文、可复制 fenced code block、reasoning、command、file change、plan、approval、image、error、tool output、unknown。domain 层已把官方字符串状态和对象状态统一归一化，避免 `running/editing/thinking/in_progress` 等 active 状态在 Web 上丢失。
- 命令输出、diff、tool output、错误详情和未知 raw item 已有复制、展开/折叠和横向滚动；reasoning、command/file/tool 执行项和 unknown raw item 默认折叠为浅灰摘要，单条命令也不再以英文 `Command` 块头直接铺开，避免协议变化或长输出把聊天区变杂乱。执行组已按 Desktop 行为改为两级折叠：先打开“已运行/正在运行 N 条命令”摘要，再打开单条命令/文件详情；完成后的 reasoning 默认隐藏且不会打断命令/文件合并，active turn 尾部会保留“正在运行 / 正在编辑 / 正在思考”，外层状态会结合 turn active、命令 exit/duration 和终态 status 自动收敛；`contextCompaction` 只显示不可展开的“上下文已自动压缩”分隔线。
- Desktop 壳层继续按官方截图压缩：左侧栏和右侧运行栏默认约 `320px`，聊天列与 Composer 保持与右侧栏分离；底部 Settings 入口先打开账户/设置小菜单，再进入 `Settings / Diagnostics` 弹窗，保留 `/settings` 直达用于测试和排障。
- 图片消息若只有本地 path，会通过后端受限 `/api/files/content` 渲染真实预览，并支持 Desktop-like lightbox 放大查看；file change 若只有 path/空 diff，会通过 `/api/files/preview` 展示文本、图片或二进制元信息，读取范围限制在 `data/`、默认项目根、官方项目和 Web 收藏项目内。
- 聊天视口已有“滚动到底部”按钮：当用户停留在旧消息位置且有新内容或需要回到最新进展时，可一键滚回底部；Playwright 已覆盖桌面端阅读旧消息时该按钮出现并可用。
- 移动端已有抽屉导航、紧凑 Composer、顶部搜索和更多操作菜单，并已用 Playwright 覆盖附件+Skills 发送、active turn 停止、空会话禁用上下文操作、审批卡片和复杂消息块基础布局。

### 2.4 本地能力

- LAN 密码/session、本机免登录、session 撤销和命令行密码重置已落地；Settings / Network 会通过 `/api/network/lan-access` 展示当前可用于手机访问的 LAN URL，并支持复制，避免换 Wi-Fi 或网卡后还要手工查询 IP。
- 设置页已分 General、Projects、Security、Network、Appearance、Account、Diagnostics。
- 项目列表以官方 thread/list 投影为主，Web 添加的项目收藏为补充；添加收藏时会 best-effort 同步到 Desktop saved workspace roots。
- 只读文件浏览已限制在官方项目、Web 收藏项目或默认项目根内。
- 本地文件预览 API 已复用同一批允许根，支持消息中的本地图片路径和文件变更路径安全展示，不开放任意磁盘读取。
- 右侧运行栏的工作区状态已通过后端 `/api/workspace/status` 读取真实 Git/GitHub CLI 信息，并限制在允许项目根内；前端不再硬编码分支、提交或 GitHub 状态。
- 附件上传、图片预览、内容下载、SQLite 元数据和孤立附件清理已落地。

### 2.5 测试覆盖

- `packages/protocol`：IPC patch、conversation id、active turn id、fake official peer、owner handoff、follower start/steer/interrupt framed IPC、discovery 和错误诊断。
- `packages/domain`：多类 message item 归一化；`packages/api` 使用 discriminated union 校验各类 `MessageItem` 的必需字段，未知官方 raw item 必须先归一化为 `unknown`。
- `packages/api`：核心 domain/API envelope schema，以及 connected server epoch、diagnostic、app-server notification、official thread stream/archive/unarchive/status、approval requested/resolved 等 known realtime event union；`turn/start` 公开 schema 会拒绝 raw `attachments`；LAN access、workspace status、file preview 和 diagnostics export 均有共享 response schema。
- `apps/server`：auth config、app-server warning/error、diagnostics export、file browser、file preview、workspace status、LAN access、runtime options、skills、thread actions、thread/start local-only owner/失败不写缓存、thread rename owner guard/owner 丢失不重广播、fallback policy、turn HTTP route safety、raw attachment 不转发保护、protocol compatibility、sync readiness、follower method capability matrix、WebSocket realtime schema-valid 事件、附件清理、审批。
- `apps/web`：realtime cacheVersion、backend server epoch 切换时清空旧 realtime version、thread detail 请求排序、长会话列表 virtual window 计算。
- `tests/e2e`：shell/设置/debug/移动布局、Settings / Network LAN URL 展示、Settings / Diagnostics 同步验收命令入口、Composer runtime/attachment/键盘发送请求体链路、移动附件+Skills 发送闭环、移动 active turn 停止、移动审批卡片、移动复杂消息块、普通/归档会话 cursor 分页、长会话列表 windowing、owner 失败 UI、审批卡片决策闭环、复杂消息块渲染，以及需显式启用的 live sync start/steer/interrupt/attachment smoke。
- `pnpm sync:doctor`：默认只诊断的同步验收助手；显式 `--send` 时向测试 thread 写 marker，并自动检查 Web follower 路径、recent follower success 和 marker 唯一性；`--send` 可附加 `--attachment <path>` 上传无敏感测试文件并随同一次 turn 发送，report 只保留附件数量/字节数并脱敏附件 id；显式 `--steer` / `--interrupt` 时辅助验收 active turn 引导和停止；`--report <path>` 可输出脱敏 JSON 证据包。

最近一次本机验证记录在 `docs/implementation_status.md`：Web typecheck/build 通过；`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`5 passed / 3 skipped`；只读 `pnpm sync:doctor -- --json --report data\tmp\sync-report-after-shutdown-20260530-081220.json` 返回 `ok: true`。真实 Desktop/VS Code 实时可见、真实手机 LAN 使用、official-owned approval 和附件复看仍需人工验收。

## 3. Top 缺口与收口优先级

| 优先级 | 缺口                       | 当前判断                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 收口标准                                                                                                                         |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | --------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| P0     | 真实三端同步人工验收未签收 | 自动烟测和 `pnpm sync:doctor` 可证明 Web 侧 follower start/steer/interrupt 路径，`--report` 可留下脱敏证据包；Settings / Diagnostics 已加入 Sync acceptance 面板，可基于当前 thread 复制 start/steer/interrupt 验收命令；Desktop/VS Code 实时可见仍需人工确认                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 按 `docs/sync_acceptance_checklist.md` 完成 Desktop、VS Code、Web 互发互看，无重复 turn、无分叉                                  |
| P0     | 官方-owned 失败路径安全性  | fallback 决策和 HTTP 路由层均已自动化覆盖：official-known owner 不可达时 active 操作返回 409，owner 未知且 IPC 断开返回 503，不错误关联附件；generic `official-ipc-request-failed:thread-follower-*` 也归类为 owner/routing 不可用，而不是普通 502；`turn/start` 增加受限自动接管：follower 失败后读 app-server 完整 thread，只有确认会话已空闲才退休旧外部 owner cache、claim local-only Web owner 并本地启动新 turn；公开 `turn/start` 会拒绝 raw `attachments`，只允许后端校验过的 `attachmentIds`；external-owned 空 snapshot 的 app-server hydrate 不写入 detail cache；follower steer/interrupt 的 framed IPC、discovery 和错误诊断已有协议测试；针对 Desktop/扩展重启后缓存 owner clientId 变旧的情况，官方 follower start/steer/interrupt 已增加一次受限 discovery 重试，避免直接打到 stale target 后失败；Playwright 已覆盖 Web 发送失败时保留 Composer 文本并显示中文友好错误；仍需真实断 owner、断 IPC、重启官方端验证                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | owner 不可达时 active 操作明确失败；空闲 turn/start 可由 Web 接管，不写入本地分叉 turn                                               |
| P0     | Web-owned thread 三端行为  | 新建 thread 的 local-only Web owner 已有 HTTP 路由级自动化，且 IPC 未初始化 Web `clientId` 或 local-only owner 未建立时不创建无 owner thread、不写 Web 缓存；`thread/start` raw RPC 已按官方 app-server 形状只补 `threadSource: "user"`，不混入 Desktop 内部 `start-conversation` 包装层的 `workspaceRoots`；Web-owned app-server 快照广播前会补齐 Desktop stream turn 形状，避免官方 Desktop 本地任务行/侧边栏读到缺 metadata 的本地会话；external-owned rename 已改为官方 Desktop 同款 app-server `thread/name/set`，只读 hydrate official cache 且不声明 Web owner；external-owned archive/unarchive 仍 409 拒绝本地 mutation；rename 读详情期间 owner 被官方端接管时不重广播；归档已释放 Web-owned owner/cache 且不清外部 owner cache；sync coordinator 已收紧为只有确认 Web-owned 且允许广播才广播本地 snapshot，并覆盖 debounce/读期间 handoff 或 release 后不广播，runtime settings 在 owner 丢失后会清理；WebSocket 已有断线退避重连和 server epoch 清理旧 cacheVersion；protocol/sync coordinator 已覆盖反向 follower、handoff、local-only owner 和 snapshot 广播；仍需系统验证真实新建、继续、interrupt、handoff、重连                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Web 新建/继续不导致 Desktop/VS Code 崩溃；公开广播路径启用时三端可实时跟随；官方恢复 owner 或 Web 归档后 Web 不残留错误 owner      |
| P0     | 审批端到端                 | UI、后端 handler、approval requested/resolved 事件、API-safe payload 和 Web-owned approval snapshot 调度单测已覆盖；Playwright 已覆盖 pending approval 卡片细节展示、decision body、按钮禁用和刷新后消失；真实 official-owned 命令/文件变更审批还需验证                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | command/file approval 在 Web 决策后 owner 正确继续/停止，三端状态一致                                                            |
| P0     | 附件官方引用 shape         | Web 持久化、发送参数、发送后 thread 关联和 opt-in live attachment smoke 已覆盖 Web 上传/发送闭环；`pnpm sync:doctor --send --attachment <path>` 已支持现场上传无敏感测试文件并随同一次 follower turn 发送，脱敏 report 只记录附件数量/字节数；Playwright 已覆盖桌面和移动端浏览器选择文件、上传、`attachmentIds` 进入 turn/start 和发送后托盘清空，并覆盖 active turn 引导携带附件进入 turn/steer；公开请求不接受 raw attachment shape，`turn/start` / `turn/steer` 都只允许后端校验过的 `attachmentIds`，图片会以官方 `localImage` input 补给 app-server/owner，`restoreMessage` 只作为 UI 恢复字段；官方对普通文件的最终引用仍需真实确认                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 图片/普通附件发送后 Web/Desktop/VS Code 可复看或明确降级，不丢附件、不泄露本地敏感路径                                           |
| P1     | UI 高保真                  | 当前为 Milestone 1 质量；已建立 UI baseline 截图入口，并拆出 Navigation、ThreadHeader、ChatMain、Composer、MessageBlocks、SearchPanel、LoginGate 等主要组件边界；聊天区操作块默认折叠、普通 Markdown code fence 已有语言栏和复制入口、右侧运行栏、Composer 普通/active turn 控件和 1920 宽桌面几何已按 Desktop 参考继续收紧；Playwright 桌面视口已改为 `1920 x 1019`，并自动断言右侧运行栏默认可见、Composer 不压住右侧栏；单条 command/file/tool 也已统一成中文浅灰折叠摘要，`file change` / “已编辑文件”已改为默认浅灰折叠摘要，展开后显示紧凑文件列表，单个文件再展开才显示 diff 或受限预览；移动端运行/详情折叠面板和消息块标签继续去协议化，不再把 `Owner`、`IPC`、`Realtime`、`Unknown item` 等工程词直接暴露给普通用户；右侧栏不再硬编码假的子智能体，没有真实官方事件时显示等待状态；首轮 thread 列表同步期间也已有显式 loading 态，避免把未加载完成误显示成空列表/空会话；新增设计约束：Desktop 顶栏的“置顶摘要”和“真实右侧栏”必须拆开实现，真实右侧栏采用浏览器式标签容器，初始不预置固定标签，已有侧聊时打开右侧栏会自动加载当前主会话的侧聊标签，`+` 可通过官方 app-server `thread/fork` + boundary 注入路径新建侧聊，同类标签可重复创建，任意侧聊标签关闭时按 Desktop cache discard 行为移除对应侧聊，关闭最后一个标签后回到新建入口；文件标签已支持右侧预览和目录滚动；侧边聊天已读取官方 `sideConversation` stream state，置顶摘要按当前主会话真实数量/标题列出并过滤空侧聊，已有或新建侧聊都可从 Web 通过对应 `sideConversation.id` 的 `/api/domain/turn/start` 发送，且不会创建 Web 私有 thread；浏览器/审查/终端先占位；尚未达到官方 Desktop 像素/交互复刻 | 对齐 Desktop 截图与行为，补齐 row height、token、Composer 几何、消息块状态                                                       |
| P1     | 新对话与附件高保真         | Desktop 新对话空状态已作为独立验收面落地首版：点击“新对话”进入客户端草稿态，不立即创建空 thread；主区显示项目感知标题、居中 Composer 和上下文行，并隐藏置顶摘要/thread 消息/右侧栏内容；首条发送时才创建 Web-owned thread 并启动 turn，桌面/移动 app-shell 回归已覆盖请求体链路；新建 thread 请求只携带 `cwd`，`permissionMode` 等运行参数只进入首条 `turn/start`，避免 app-server 返回 `Unrecognized key`。附件托盘已拆成图片缩略图行和普通文件/状态行：图片在 Composer 文本上方显示缩略图，普通文件使用文件卡片、大小和长文件名截断；桌面与移动 E2E 已覆盖两类附件顺序、无横向溢出和移动端不遮挡输入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 新对话首屏接近 Desktop；图片上传为缩略图且位于文本上方，普通文件显示文件卡片，桌面/移动均有回归覆盖；剩余为真实 Desktop 截图签收 |
| P1     | i18n 正式架构              | 已把 i18n 作为正式架构层落地：新增 `packages/i18n`、`apps/web/src/i18n`、`i18next + react-i18next` provider、`zh-CN`/`en-US` JSON 资源和翻译 key 类型；顶栏本地环境/置顶摘要/命令行/真实右侧栏开关、移动端顶栏菜单和真实右侧栏标签启动器已先走 `t(key)`。后端用户态错误仍需逐步迁移为 `code + params`，domain 层继续保持语言无关；后续新增 UI surface 必须同步补中英 key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 核心 shell/Composer/Settings/消息状态支持中英切换，Playwright 至少覆盖 zh-CN/en-US 的桌面和移动关键截图                          |
| P1     | 移动端完整日常流           | 已有基础移动布局，Playwright 已覆盖抽屉、搜索、Settings、附件/Skills 入口、附件+Skills 发送闭环、中文运行状态/运行详情折叠面板、手机视口下停止 active turn、移动审批卡片和移动复杂消息块；运行状态面板隐藏 owner/follower 等协议概念，只展示 Desktop 连接、实时事件、执行端和 app-server 状态；仍需真实手机/LAN 使用验收                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 390x844 和真实移动浏览器可完成登录、选项目、开 thread、发送、停止、看诊断                                                        |
| P1     | 归档/恢复/重命名同步       | API 与 UI 路径已存在；rename 已按官方 Desktop 实现走 app-server `thread/name/set`，external-owned rename 会只读 hydrate official cache 且不声明 Web owner；archive/unarchive 边界已有自动化，external-owned 暂时 409 拒绝本地 mutation；已勘察官方 Desktop/VS Code 包，未找到安全的 `thread-follower-archive/unarchive`，当前不应对 official-owned thread 做本地归档/恢复 mutation；已被动识别官方 `thread-archived` / `thread-unarchived` 广播并触发 Web 列表/detail 刷新，protocol/server bus/web helper 侧均有自动化覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 重命名后 Desktop/VS Code/Web 标题最终一致；Web-owned 归档/恢复后列表一致；official-owned 归档/恢复在 Web 上明确提示或被动收敛，冲突以官方状态为准      |
| P1     | Runtime options 同步       | 模型、可选目标模式（Plan）、reasoning、Skills 和权限模式已接入；默认协作模式不常驻底栏也不下发，只有用户从 `+` 菜单选择“目标”时才进入 `/api/domain/turn/start` 请求体；权限模式会在后端转换为官方 app-server 需要的 tagged `sandboxPolicy` 对象，而不是把 `workspace-write` / `danger-full-access` 字符串直接转发；后端已自动化覆盖参数进入 official follower，并记录脱敏 `runtime-options-selected` 诊断；Web-owned runtime owner-state 已覆盖缓存、handoff 清理和显式 turn 参数优先级；Playwright 已覆盖 Composer 选择项和 `permissionMode` 进入 turn 请求体，并覆盖新对话 create-thread 不混入运行参数；仍需真实 Desktop/VS Code owner 接受与回显验收                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 发送后的实际 owner 状态与 Web 展示一致；官方覆盖时 Web 显示最终状态                                                              |
| P1     | API/schema 覆盖面          | 主要后端读写接口已接入共享 schema、后端 validation 和前端解析；`/api/diagnostics/export` 也已纳入共享 `diagnosticsExportResponseSchema`，后端发送前和前端读取时校验同一份脱敏排障包契约；认证与 LAN 安全相关的 `/api/auth/status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | login                                                                                                                            | logout | sessions | sessions/revoke | sessions/revoke-others | sessions/revoke-all`和`/api/settings/password` 已纳入共享 auth/session/password schema，并由真实 Fastify route 测试覆盖；`/api/workspace/status`已纳入`workspaceStatusResponseSchema`，`/api/network/lan-access`已纳入`lanAccessResponseSchema`，二者都有 helper 与 Fastify route 测试覆盖；realtime event 已从宽松基础 envelope 收紧为 known union，并覆盖官方 thread stream/archive/unarchive/status、approval 事件和 connected server epoch；`turn/start`/`turn/steer`已收紧为共享请求体，允许文本或受控`attachmentIds`，并拒绝 raw `attachments`；仍需随新增路由持续补齐 | 新增/高风险接口都有共享 schema、后端 validation、前端类型消费 |
| P1     | 性能与长列表               | 会话列表已支持 app-server cursor 分页和加载更多；Playwright 已覆盖普通/归档会话 cursor 加载更多链路；已加入轻量 virtual window，超过阈值后只渲染当前滚动窗口附近的会话行，Playwright 已覆盖 1000 条已加载会话的窗口化、深处会话可达性和搜索定位第 1000 条会话；真实流式更新性能仍需系统测量                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 大列表滚动、打开 cached thread、streaming 更新无明显卡顿                                                                         |
| P2     | edit-last-user-turn        | 官方 Desktop/VS Code 存在 `thread-follower-edit-last-user-turn-for-host`，但实现依赖 `thread/rollback` 后重启 turn；rollback 不恢复本地文件变更，且需要精确重建正文、agent mode、attachments、approval/sandbox 参数；当前标记为 risky，不作为 MVP 功能开放                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 单独完成风险设计和隔离测试前不暴露 UI；用户通过新 follow-up 修正                                                                 |
| P2     | 视觉回归基线               | Playwright 已有 `tests/e2e/ui-fidelity-baseline.spec.ts` 和 `pnpm test:e2e:ui-fidelity` 专用入口，覆盖登录、同步 loading、空列表、shell、复杂消息块、active Composer、approval、搜索、Settings 和 Debug；文档已明确截图只作为人工签收后的回归保护，并记录完成态 reasoning 隐藏、命令组合并、右侧栏/Composer 几何等自动断言。尚未形成长期保存的“已签收基线图片”目录和更新流程                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 通过人工验收的桌面/移动截图纳入稳定基线目录与更新说明                                                                            |
| P2     | 诊断包 UX                  | `/api/diagnostics/export` 和 `sync:doctor --report` 均已脱敏；`sync:doctor --report` 现在使用专用 report shape，移除 `--send` marker 与 `--steer` guidance 正文，仅保留 `markerRedacted` 和 marker occurrence，避免长期排障材料保存用户输入；Settings / Diagnostics 已增加 `Troubleshooting package` 卡片，说明排障包包含 IPC、app-server、protocol、cache、recent diagnostics，排除会话正文、附件内容、密码、token、session secret，并提供复制和下载 JSON 入口；`docs/troubleshooting_sync.md` 已补同步异常材料收集流程和敏感信息禁止清单；后续还可补 issue 模板                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 不暴露敏感内容，足以定位 IPC/app-server/cache/版本问题                                                                           |

## 4. MVP 验收门槛

MVP 可以进入“第一版可用”前，至少满足：

1. Desktop、VS Code、Web 同时打开同一 thread，任意一端发送后另外两端实时显示同一条消息和同一段 stream。
2. Web 发送 official-owned thread 时，`recentFollowerRequests` 出现 `thread-follower-start-turn success`，并且 marker 在 thread detail 中只出现一次。
3. Web 不能在 owner 未知或 IPC 断开时静默写入本地分叉 turn。
4. Web 能 stop/interrupt 当前 turn，且 Desktop/VS Code/Web 结果一致。
5. Web 能处理至少一类真实 approval，并在三端保持一致。
6. Web 能发送文本、图片/附件、模型/模式/推理强度/Skills 组合中的核心路径，且最终状态可解释。
7. 归档/恢复/重命名不会误删官方持久化数据，三端最终一致。
8. 移动端能完成登录、选择项目/会话、发送、停止和查看主要消息块。
9. 诊断导出不含敏感信息，协议不兼容时能清楚显示 `offline`、`warning` 或 `error`。
10. 常规检查 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e` 通过；真实同步 smoke 按需执行。

完整三端同步矩阵见 `docs/sync_acceptance_checklist.md`。

## 5. 人工验收总流程

详细步骤见 `docs/sync_acceptance_checklist.md`。这里保留收口总线：

1. 启动 Desktop、VS Code Codex 扩展、`codex_web` 后端和 Web UI。
2. 检查 `/api/protocol/compatibility`、`/api/official-ipc/status`、`/api/app-server/status`。
3. 选择不含敏感内容的测试项目和测试 thread。
4. 三端同时打开同一 thread，分别从 Desktop、VS Code、Web 发唯一 marker。
5. 对 Web 发送路径确认 `official-follower`、`recentFollowerRequests success` 和 marker 唯一；可用 `pnpm sync:doctor -- --thread <thread-id> --send --text "<marker>" --report data\tmp\sync-report-S03.json` 辅助并留存脱敏证据。
6. 对 active turn 引导和停止，可用 `pnpm sync:doctor -- --thread <thread-id> --steer --text "<guidance>"` 与 `pnpm sync:doctor -- --thread <thread-id> --interrupt` 辅助，再人工观察官方两端是否实时一致。
7. 覆盖 approval、附件、重命名、归档/恢复、Web-owned 新 thread、移动端。
8. 记录失败项时只保存脱敏诊断、`sync:doctor --report`、截图和 marker，不复制真实会话正文或文件内容。

## 6. 后续 worker 拆分边界

为避免多人并行时互相踩线，后续建议按以下边界拆：

| Worker              | 主责边界                                                                         | 主要路径                                                                                                                 | 不应越界                                     |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Sync/Protocol       | owner/follower、IPC method map、Web-owned handoff、fallback policy、三端真实同步 | `packages/protocol/`、`apps/server/src/threadActions.ts`、`apps/server/src/turnFallback.ts`、`apps/server/src/events.ts` | 不直接改前端视觉结构，除非为暴露诊断字段     |
| Backend/API         | Fastify routes、schema validation、SQLite 投影、附件/审批/项目/设置接口          | `apps/server/src/`、`packages/api/`、`packages/config/`                                                                  | 不让前端直接读取 raw protocol 或本地安全文件 |
| Domain/Normalizer   | conversationState、message item、thread/project domain model                     | `packages/domain/`                                                                                                       | 不在 Web 组件里新增官方 raw shape 判断       |
| Frontend/Desktop UI | Desktop-like shell、消息块、Composer、设置/debug、视觉 token                     | `apps/web/src/`、`packages/ui/`                                                                                          | 不改官方 IPC 路由策略                        |
| Mobile UX           | 390x844 与真实手机交互、drawer、紧凑 Composer、移动菜单                          | `apps/web/src/app/`、`apps/web/src/styles/`、`tests/e2e/`                                                                | 不牺牲桌面信息架构                           |
| Test/QA             | Playwright、真实 sync smoke、fixture、视觉回归说明                               | `tests/e2e/`、`docs/playwright_e2e.md`、相关 `*.test.ts`                                                                 | 不把真实敏感 thread 内容写入 fixture         |
| Docs/Release        | MVP 看板、验收清单、启动手册、实现状态、踩坑索引                                 | `docs/`、`README.md`、`AGENTS.md`                                                                                        | 不记录密码、token、邮箱、私密 thread 内容    |

并行协作原则：

- 修改前先读当前文件，默认别人可能刚改过。
- 不 revert 别人的改动。
- 不主动 `git add`、`git commit`、`git push`。
- 文档引用优先用相对路径。
- 涉及协议、端口、安全、运行方式变化时，同步更新入口索引和相关 runbook。

## 7. 当前建议推进顺序

1. 先完成 `docs/sync_acceptance_checklist.md` 的 P0 人工验收，并把失败项转为具体 issue/worker 任务。
2. 修 P0 同步安全问题：重复 turn、owner 丢失、本地分叉、interrupt/approval 不一致。
3. 补 P0 附件和审批真实路径验收。
4. 收 P1 桌面高保真与移动端日常流。
5. 收 P1 API/schema、性能和视觉回归。
6. 每轮完成后更新 `docs/implementation_status.md` 和本看板状态。
