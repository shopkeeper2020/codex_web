# 当前实现进展与启动验证说明

更新时间：2026-06-01。

本文汇总当前仓库实现状态、默认端口、关键路径、依赖、官方 IPC/app-server 机制，以及已知限制。更完整的产品目标见 `docs/product_spec.md`，协议研究细节见 `documentation/protocol/official_codex_ipc_sync.md`，日常启动命令见 `docs/startup_runbook.md`。

## 当前阶段

项目处于 Milestone 1：项目基础与真实同步切片。

2026-06-01 续跑修复：侧边聊天补齐 Web 新建、关闭和右侧栏自动加载链路。Web 新建侧聊现在复刻 Desktop 的官方路径：通过 app-server `thread/fork` 创建 `sideConversation`，注入 Desktop 同款 side conversation boundary，再用对应 `sideConversation.id` 的 follower/turn 路径发送消息；不会创建 Web 私有 thread。关闭真实右侧栏里的侧边聊天标签时，后端按 Desktop 行为执行 `discard-conversation-from-cache` 风格的缓存移除，并在必要时先 interrupt 正在运行的 Web-owned 侧聊，而不是误走普通 thread archive。置顶摘要和右侧栏列表只使用明确绑定到当前主会话的 `sideConversation`，空 boundary-only 侧聊和空进度不再展示；打开右上角真实侧栏时会自动把当前会话已有侧聊加载为标签，不再默认给空标签页。粘贴图片上传后 Composer 会把焦点带回输入框，避免 Ctrl+V 后断焦。验证：`pnpm -r typecheck`、`pnpm --filter @codex-web/api test -- src/index.test.ts`、`pnpm --filter @codex-web/server test -- src/sideConversationCreateRoute.test.ts src/sideConversations.test.ts src/syncCoordinator.test.ts`、`pnpm build`、`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium` 均通过。

2026-05-31 续跑修复：修复 Web 新建会话后官方 Desktop 侧边栏 error boundary。现场 Desktop 日志显示 `/api/domain/thread-create` 生成的新会话随后触发官方 `thread/list`，侧边栏 row 渲染报 `Cannot read properties of undefined (reading 'length')`；对应 Web 创建的 session meta 缺少官方 UI 默认带入的 `thread_source`，且 Web 还会立刻广播空 Web-owned stream snapshot。现在 Web 调用 app-server `thread/start` 会补 `threadSource: "user"` 和 `workspaceRoots`，新建会话只 claim local-only owner 供 Web 自己继续 `turn-start` fallback，不再向 Desktop/VS Code 发布空 snapshot；本地 app-server 通知和 approval 事件也会跳过 local-only owner 的 snapshot 广播。验证：`pnpm --filter @codex-web/protocol test -- src/officialIpc.test.ts`、`pnpm --filter @codex-web/protocol build`、`pnpm --filter @codex-web/server test -- src/threadCreateRoute.test.ts src/syncCoordinator.test.ts src/turnRoutes.test.ts`。

2026-05-31 续跑修复：把 Composer 上方的“追求目标”从静态进度展示改为真实 Desktop thread goal 状态。后端新增 `thread/goal/get`、`thread/goal/set`、`thread/goal/clear` app-server bridge 与 `/api/domain/thread-goal-set|thread-goal-clear` 路由，`/api/domain/thread-detail` 会返回 `goal`，且 goal 读取有短超时保护，不会拖住主会话详情加载。前端 Composer 顶部目标条现在只在 thread 有真实 goal 时展示，并提供“编辑目标、暂停/恢复目标、清除目标、显示/隐藏完整目标”四个真实动作；它和右侧 pinned summary 的 plan/progress 步骤分离，也不等同于 Composer 底栏的可选 Plan/目标模式。验证：`pnpm --filter @codex-web/domain test -- src/index.test.ts`、`pnpm --filter @codex-web/api test -- src/index.test.ts`、`pnpm --filter @codex-web/server test -- src/threadGoalRoute.test.ts src/threadDetailRoute.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` 均通过；生产后端已重启，当前主 thread detail 可读到 active goal。

2026-05-31 续跑修复：补齐 Desktop-like Composer 开头斜杠菜单。只有在输入框当前内容以 `/` 开头且尚未输入正文时才打开命令菜单；正文之后的 `/` 会按普通字符发送。菜单中的 Skills 来自真实 `GET /api/skills?cwd=...`，后端继续调用官方 `skills/list` 并保留 `user/repo/system/admin/unknown` scope，因此会随全局技能和项目技能动态变化；功能项只暴露 Web 当前已有真实动作/状态的入口，包括添加附件、active turn 的“引导当前/排队下一条”、可选“目标”模式和权限模式切换。选择多个 Skill 会显示在 Composer 托盘，并在发送时作为 `skills: [{ name, path }]` 进入 `/api/domain/turn-start` / `turn-steer`；目标和权限这类页面状态只切换参数，不写入提示词文本。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/composer-runtime.spec.ts --project=desktop-chromium --project=mobile-chromium`、`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` 均通过。

2026-05-31 续跑修复：侧边聊天从“只能读官方 sideConversation”推进到“已有官方侧聊可从 Web 发送”。右侧栏侧边聊天输入框现在会把消息发送到对应 `sideConversation.id` 的 `/api/domain/turn-start`，复用官方 follower 路径并刷新父会话详情；不会调用 `/api/domain/thread-create`，避免 Web 生成私有分叉。app-shell 回归覆盖两个真实侧边聊天标签：`ui和ux有什么区别？` 和 `侧边聊天 2` 都会以各自 side conversation id 发起 turn-start，且 `thread-create` 调用次数保持为 0。新建全新的侧边聊天/fork 协议仍待确认，当前只对已由 Desktop/官方同步出的侧聊开放发送。

2026-05-31 续跑修复：修复新对话首条发送在真实 app-server 上继续报 `SandboxPolicyDeserialize` 的权限参数问题。根因是 Web 后端已经把 `permissionMode` 放到了正确的 `turn-start` 请求，但 adapter 仍把 `sandboxPolicy` 作为字符串 `"workspace-write"` / `"danger-full-access"` 转发；当前官方 Desktop/app-server 需要 internally tagged enum 对象。现在 `default` / `auto-review` 会发送 `{ type: "workspaceWrite", writableRoots: [], excludeSlashTmp: false, excludeTmpdirEnvVar: false, networkAccess: false }`，`full-access` 会发送 `{ type: "dangerFullAccess" }`，并新增路由测试覆盖 auto-review 和 full-access 两条路径。验证：`pnpm --filter @codex-web/server test -- src/turnRoutes.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/api test -- src/index.test.ts`、`pnpm --filter @codex-web/server build` 均通过；生产后端已从 PID `<pid>` 重启为 PID `<pid>`，`/api/health` 返回 `ok: true`，live 探针不再出现 `SandboxPolicyDeserialize` 字符串类型错误。

2026-05-31 续跑修复：收口用户反馈的移动端新对话与 Composer 细节。共享 API 包已重新 build，`turn-start` / `turn-steer` 运行时 schema 接受 `permissionMode`，现场探针确认带 `permissionMode` 时不再出现 `Unrecognized key`，新对话首条发送也精确保持 `thread-create` 只传 `cwd`、权限/模型/附件只进入随后 `turn-start`。Composer 的“目标”改为可选模式：默认不占底栏、不随每条消息默认发送，从 `+` 输入选项里选择后才显示并下发 Plan payload。附件托盘改成图片缩略图行 + 普通文件卡片/状态行，移动端图片和文件卡片都位于 textarea 上方，不再遮挡输入。验证：`pnpm --filter @codex-web/api test -- src/index.test.ts`、`pnpm --filter @codex-web/api build`、`pnpm --filter @codex-web/server test -- src/turnRoutes.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/composer-runtime.spec.ts --project=desktop-chromium --project=mobile-chromium`、`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` 均通过；生产后端已重启为 PID `<pid>`，`/api/health` 返回 `ok: true`。

2026-05-31 续跑修复：修复当前页面两类现场报错和右侧栏文件交互。前端健康检查改走 `/api/health`，后端同时提供 `/health` 与 `/api/health` JSON，并把 `/api/health` 列为 LAN 登录白名单，避免开发端口或静态前端把 HTML 当 JSON 解析。Composer 的 active turn `引导当前` 现在支持附件：`turn-start` / `turn-steer` 共享 schema 都允许“文本或 attachmentIds”二选一，后端只接受已管理附件；小图片会以内联 image input/restoreMessage 传给官方 owner，普通文件保留受控附件引用，发送成功后关联到 thread。右侧栏文件按钮可从消息文件变更行直接打开对应文件预览；文件浏览区补齐垂直滚动条，进入少量文件的子目录时不再强行撑满高度；置顶摘要也新增“侧边聊天”入口，可打开当前会话对应的右侧侧边聊天标签。

2026-05-31 续跑状态：补齐 Desktop-like 新对话草稿首屏。Web 现在点击“新对话”只进入客户端草稿态，不立即创建空 thread；主区显示项目感知标题、居中 Composer 和上下文行，并隐藏置顶摘要、真实右侧栏、移动运行/详情折叠面板和旧 thread 消息。首条消息发送时才通过现有 `/api/domain/thread-create` 创建 Web-owned thread，再用 `/api/domain/turn-start` 启动第一轮，保持新建会话仍走官方同步边界。桌面/移动 app-shell 回归覆盖“点击新对话不触发 create/turn-start、发送后携带 cwd/model/effort/attachmentIds 并路由到新 thread”。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` 均通过，app-shell 共 `26 passed / 8 skipped`。

2026-05-31 续跑修复：修复 Web 会话区在实时事件和 active turn 轮询下持续重建/自动滚动，导致用户难以选中文字复制的问题。消息列表不再包含隐藏的移动端辅助面板，自动滚动只在切换线程、消息增加或底部附近内容变化时触发，并会在用户存在文本选区时暂停；静默详情刷新也会在选区存在时跳过应用，避免 ReactMarkdown 文本节点被替换。实时事件刷新合并到短 debounce 窗口，active polling 降低会话列表刷新频率；工作区 Git 状态从“每个实时事件刷新”改为文件变更即时刷新 + 30 秒兜底。浏览器探针确认当前构建无 console/page error、无 4xx/5xx，6 秒内 `/api/domain/threads=4`、`/api/domain/thread-detail=2`、`/api/workspace/status=1`，选区保持稳定；`/health` 返回 `ok: true`。验证：`pnpm --filter @codex-web/i18n build`、`pnpm --filter @codex-web/i18n typecheck`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium` 均通过。

2026-05-31 续跑校正：侧边聊天已从“等待同步占位”推进为读取官方 `sideConversation` stream state。后端在 `/api/domain/thread-detail` 中新增 `sideConversations[]`，会从官方 IPC 缓存按当前主会话 cwd/source/host 和近期 cacheVersion 选择真实侧边聊天，派生标题优先使用官方标题或首条 user 文本，空白标签按实际顺序显示为“侧边聊天”“侧边聊天 2”等；旧的空白已关闭标签会被过滤，避免 Web 误显示 stale side tab。前端置顶摘要按真实数量和标题渲染侧边聊天入口，点击后在真实右侧栏打开对应标签并复用主聊天消息渲染展示 turns；仍不走 Web 私有 `thread-create` / `turn-start` 创建分叉，发送侧聊消息的官方 fork/follower 写入路径后续继续接。现场验证当前主会话返回 2 个侧聊：`ui和ux有什么区别？` 与 `侧边聊天 2`。验证：`pnpm --filter @codex-web/domain build`、`pnpm --filter @codex-web/api build`、`pnpm --filter @codex-web/server test -- src/threadDetailRoute.test.ts src/sideConversations.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium` 均通过；生产服务已重启，`/api/health` 返回 `ok: true`。

2026-05-31 续跑状态：补齐 Desktop 顶栏“置顶摘要”和真实右侧栏的互斥交互。打开真实右侧栏时会临时收起置顶摘要，折叠真实右侧栏后按打开前状态恢复；若真实右侧栏打开时用户主动点击置顶摘要，则切回置顶摘要并关闭真实右侧栏，避免两块右侧内容同时挤占聊天区。`tests/e2e/app-shell.spec.ts` 已覆盖恢复状态和互斥切换两条分支。

2026-05-31 附件高保真收口：Desktop 新对话空状态已补首版草稿入口和桌面/移动回归；Composer 和新对话附件托盘已区分图片与普通文件，图片始终在文本上方以缩略图展示，普通文件使用文件卡片、大小和长文件名截断。后续仍需用真实 Desktop 截图做像素签收。

2026-05-31 续跑状态：消息中的项目文件引用开始按 Desktop-like 文件引用组件处理，而不是普通 Markdown 链接。当前前端会识别 Markdown 链接、绝对路径和常见相对路径/文件名引用；点击文件 chip 会打开轻量菜单，可复制路径、复制相对路径，或在真实右侧栏中新建“文件”标签页打开。这样避免浏览器把 `docs/*.md` 这类项目文件误解析成当前 thread URL，同时为后续右侧文件标签页预览/定位打基础。中英文菜单文案已接入 i18n。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/i18n build`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/message-blocks.spec.ts --project=desktop-chromium` 均通过；生产服务已重启到最新构建，监听 `0.0.0.0:18930`，`/health` 返回 `ok: true`。

2026-05-31 续跑状态：继续收紧 Desktop-like 文件变更消息块。`file change` / “已编辑文件”现在保持两级折叠：聊天区默认只显示浅灰摘要；展开后显示紧凑文件列表，具体 diff/预览仍按单个文件默认折叠。diff 详情改为块内滚动、双列行号、增删色块和更小的文件卡片间距，避免展开后像调试面板一样占满聊天区。回归补充确认展开外层摘要后 diff sentinel 仍隐藏，只有点击具体文件行才展示。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e -- tests/e2e/message-blocks.spec.ts --project=desktop-chromium`、`pnpm test:e2e -- tests/e2e/message-blocks.spec.ts --project=mobile-chromium` 均通过；生产服务随后重启到最新构建。

2026-05-30 关机恢复续跑：`18930` 当前仍监听 `0.0.0.0`，PID `<pid>`，`/health` 返回 `ok: true`；官方 IPC connected，`cachedConversationCount=3`，必需 follower handlers 全部注册；app-server initialized，只有既有 `state db discrepancy during read_repair_rollout_path: upsert_needed (fast path)` warning。`pnpm sync:doctor -- --json --report data\tmp\sync-report-after-resume-20260530-223614.json` 返回 `ok: true`，报告只包含脱敏 readiness/compatibility 证据。`/api/runtime-options` 仍来自 app-server，默认模型 `gpt-5.5`、默认推理强度 `xhigh`；LAN URL 当前为 `http://192.168.1.10:18930/`。同时确认原生语音转写链路所需的 Desktop app-server 登录态探针只记录可用性，不输出 token、账号或认证方式明文。

2026-05-30 续跑状态：Web 麦克风入口已从早期热键桥改为复刻 Codex Desktop 应用内听写链路。前端只使用浏览器录音 API 采集音频，不使用浏览器 SpeechRecognition；停止录音后上传到 `/api/native-dictation/transcribe`。后端通过同一个 Codex app-server 调 `getAuthStatus({ includeToken: true })` 取得官方登录 token，按 Desktop main 进程行为请求 `https://chatgpt.com/backend-api/transcribe`，携带 `Authorization`、`ChatGPT-Account-Id`、`originator: Codex Desktop` 等 header，401 时刷新 token 重试一次。转写成功后只把文本插入 Composer，不把 token、音频或转写文本写入诊断日志。验证：`pnpm --filter @codex-web/api build`、`pnpm --filter @codex-web/server exec vitest run src/nativeTranscription.test.ts src/nativeDictationRoute.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/server build`、`pnpm --filter @codex-web/web build` 均通过；生产服务已重启到新构建。

2026-05-30 续跑状态：修复 Desktop active turn 流式输出在 Web 侧变成“有进行中状态但没有尾部内容”的问题。现场确认 `/api/official-ipc/status` 已 connected，且 `/api/official-thread-stream-state` 能读到 `isInProgress=true`、`threadRuntimeStatus.type=active`，但官方 snapshot 中最后一个 active turn 的 `items=[]`，旧 `/api/domain/thread-detail` 因为历史 turns 非空而直接返回 `official-ipc`，没有触发 app-server 只读回读，导致 Web 看不到 live tail；同时 thread list 只信 app-server list，列表行也可能显示 `inProgress=false`。现在 server 会识别 external-owned 官方详情里的“空 active turn”，改走 app-server `thread/read` 只读返回并 hydrate official stream cache，不写 SQLite detail cache、不广播、不声明 Web owner；thread list 也会用 official stream cache 覆盖当前页的 owner / inProgress / updatedAt。前端在当前会话处于 active 时增加 1.5 秒轻量详情轮询，作为 WebSocket 漏事件后的兜底。

2026-05-30 续跑状态：修复 Web 后端重启/重连后“connected 但没有 Desktop 流式输出”的官方 IPC 缓存恢复问题。根因是 Desktop/VS Code 在某些时机只继续广播 `thread-stream-state-changed` patches，不会给刚重连的 Web bridge 重发 snapshot；旧实现收到 `patches` 但本地没有基线时只能丢弃，导致 `/api/official-ipc/status` 显示 connected 但 `cachedConversationCount=0`，前端只能退回 app-server 历史读取，因此看不到 live stream 和 active 运行态。本轮修复包括：协议层不再过滤非 `local` 的 `hostId`，`initialize` 超时放宽到 60 秒，active 状态读取兼容 `running/editing/thinking/in_progress` 等官方状态对象；服务端收到 `patches-without-snapshot` 诊断通知后，会用 app-server `thread/read` 只读补一份 thread 基线写入 official stream cache，但不广播给官方端、不声明 Web owner，后续 Desktop patch 可继续套在该基线上。成功补底或后续成功应用 snapshot/patch 后会清掉旧 `official-ipc-patches-without-snapshot:<threadId>` 错误。验证：`pnpm --filter @codex-web/protocol test`、`pnpm --filter @codex-web/protocol typecheck`、`pnpm --filter @codex-web/protocol build`、`pnpm --filter @codex-web/server test -- --run src/officialIpcEvents.test.ts src/threadDetailRoute.test.ts src/syncReadiness.test.ts src/turnRoutes.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build` 均通过；生产服务已重启，`/health` 返回 `ok: true`，`/api/official-ipc/status` 当前显示 connected、`cachedConversationCount=1`、`lastError=null`，原始帧诊断已关闭。

2026-05-30 关机恢复续跑：`18930` 服务在重启后仍可访问，`pnpm sync:doctor -- --json --report data\tmp\sync-report-after-shutdown-20260530-092356.json` 返回 `ok: true`，官方 IPC connected、app-server initialized、必需 follower handlers 全部通过，仍只有既有 app-server read-repair warning 与可选 `thread-follower-edit-last-user-turn` warning。为进一步收紧重连体验，`/api/domain/thread-detail` 在遇到 external-owned 但内容不足的官方 snapshot 时，继续使用 app-server `thread/read` 只读返回详情，同时把这份基线灌入 official stream cache，不写 SQLite detail cache、不广播、不声明 Web owner，避免后续 owner patch 套在空快照上。验证：`pnpm --filter @codex-web/server test -- --run src/threadDetailRoute.test.ts src/officialIpcEvents.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build`、`pnpm --filter @codex-web/protocol build` 均通过；生产服务已重启，`/health` 正常，当前 `official-ipc/status` 为 connected、`cachedConversationCount=1`、`lastError=null`，打开 `<thread-id>` 的 thread detail 返回 `source=official-ipc`、`turnCount=120`。

2026-05-30 续跑状态：修复官方 raw status 形态导致的“正在运行 / 正在编辑 / 正在思考”在 Web 上缺失或收敛错误的问题。`packages/domain` 现在会把官方可能返回的字符串状态和对象状态统一归一化，例如 `active`、`running`、`editing`、`thinking`、`in_progress` 等都会进入 Web domain 的 active 状态；command、file change、reasoning 和 turn status 都走同一套判断，避免前端拿到 `{ type: "running" }` 这类官方 shape 时退回完成态或 unknown。移动端 Composer 同时补了回归：当官方模型默认 reasoning 是 `medium`，但 Web 当前运行默认值是 `xhigh` 时，手机端必须显示并发送“超高”。验证：`pnpm --filter @codex-web/domain test`、`pnpm --filter @codex-web/domain typecheck`、`pnpm --filter @codex-web/domain build`、`pnpm --filter @codex-web/api typecheck`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/web typecheck`、`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium -g "active running"`、`pnpm exec playwright test tests/e2e/composer-runtime.spec.ts --project=mobile-chromium -g "extra-high"` 均通过。生产服务已从最新构建重启，监听 `0.0.0.0:18930`，PID `<pid>`；`/health` 返回 `ok: true`，`/api/runtime-options` 当前默认 `reasoningEffort` 为 `xhigh`。

2026-05-30 续跑状态：关机恢复后重新确认生产服务与官方同步状态。`18930` 当前监听 `0.0.0.0`，PID `<pid>`，`/health` 返回 `ok: true`；`/api/sync/readiness` 显示官方 IPC connected、app-server initialized、必需 follower handlers 全部通过，仍只有既有的 app-server read-repair warning 和可选 `thread-follower-edit-last-user-turn` warning。为防止手机端再次丢失运行态摘要，`tests/e2e/message-blocks.spec.ts` 的 active 状态回归已从桌面扩展到移动端，同一用例现在同时覆盖“正在运行 / 正在编辑 / 正在思考”。验证：`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`5 passed / 3 skipped`；只读同步诊断 `pnpm sync:doctor -- --json --report data\tmp\sync-report-after-shutdown-20260530-081220.json` 返回 `ok: true`，报告只记录脱敏状态与兼容性结果。

2026-05-30 续跑状态：修复 active turn 中“正在运行 / 正在编辑 / 正在思考”摘要丢失或误收敛的问题。此前操作组在遇到尾部 reasoning 时会被强制标记完成，导致仍在跑的命令显示成“已运行”；纯文件变更卡片也没有拿到 turn active 状态，尾部编辑容易显示为“已编辑”。现在 active status 统一识别 `active/running/editing/writing/in_progress/streaming`，尾部文件变更会显示“正在编辑”，命令后接思考时保留“正在运行”，尾部 reasoning 继续显示“正在思考”。同时把消息块滚动到底部按钮回归用例调整为等待初始自动滚动结束，避免测试误判。验证：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium` 通过，`3 passed / 1 skipped`。

2026-05-30 续跑状态：修复 Composer 附件入口在 active turn 下看起来像失效的问题。此前当前会话正在生成时，Composer 默认处于“引导当前回复”，附件按钮因为 steer 路径不支持附件而被禁用，用户会误以为“添加照片和文件”没有实现；现在点击添加照片/文件仍会打开文件选择器，选择后自动切到“排队下一条消息”，附件按下一条 turn 发送，不会误投到当前 steer。验证：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/composer-runtime.spec.ts --project=desktop-chromium` 通过，`4 passed / 1 skipped`。

2026-05-30 续跑状态：关机恢复后继续校准 Desktop-like 聊天与 Composer 体验。当前生产服务已从最新 `dist` 重启，监听 `0.0.0.0:18930`，PID `<pid>`，`/health` 返回 `ok: true`。本轮补齐了聊天图片的 Desktop-like 放大预览，图片 lightbox 改为 portal 挂到 `document.body`，避免被顶栏 stacking context 截住；消息区增加“滚动到底部”按钮，阅读旧消息时可一键回到最新进展；Composer 的移动端弹出菜单支持点外部和 `Escape` 关闭，并把移动端附件入口、Skills、模式和模型/思考深度组合回归到当前分组交互。验证：`pnpm build` 通过，`pnpm test` 通过，`pnpm --filter @codex-web/web typecheck` 与 `pnpm --filter @codex-web/web build` 通过；`pnpm test:e2e -- tests/e2e/app-shell.spec.ts tests/e2e/composer-runtime.spec.ts tests/e2e/message-blocks.spec.ts --project=desktop-chromium` 通过，`14 passed / 6 skipped`；同一组 `--project=mobile-chromium` 通过，`14 passed / 6 skipped`。随后运行只读同步诊断 `pnpm sync:doctor -- --json --report data\tmp\sync-report-continuation-20260530-070741.json`，结果 `ok: true`：官方 IPC connected、app-server initialized、必需 follower handler 6 个已注册；当前兼容性为 `warning`，原因是官方 app-server 返回 `failed to refresh remote installed plugins cache`，可选缺口仍是 `thread-follower-edit-last-user-turn`。该 report 位于被 `.gitignore` 忽略的 `data/tmp/`，不进入仓库。

2026-05-30 续跑状态：收紧 `sync:doctor --report` 的脱敏边界。此前 CLI report 会写完整 `result`，其中可能包含 `--send` marker 或 `--steer` guidance 文本；现在新增 `buildSyncDoctorReport()`，report 文件改写为专用脱敏结果，移除 `marker` 字段，仅保留 `markerRedacted`、action、mode、follower success、marker occurrence、checks 和 evidence。终端输出与 `--json` 仍保留 marker 供现场人工观察，但长期排障材料应保存 `--report` 文件。新增单测覆盖带 `SECRET` marker 的 report 不包含正文。验证：`pnpm --filter @codex-web/server test -- src/syncDoctor.test.ts src/diagnosticsExport.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build` 均通过；重新 build 后实跑 `pnpm sync:doctor -- --json --report data\tmp\sync-report-diagnose-redacted-after-build.json`，报告文件存在、无 `marker` 字段、不含默认 marker 文本，当前诊断为 `ok: true`，仅保留官方 app-server read-repair warning 和可选 `thread-follower-edit-last-user-turn` warning。

2026-05-30 续跑状态：补齐 UI fidelity 专用回归入口并修正基线与最新 Desktop-like 行为的偏差。根 `package.json` 新增 `pnpm test:e2e:ui-fidelity`，固定运行 `tests/e2e/ui-fidelity-baseline.spec.ts`；视觉基线 fixture 现在断言完成态 reasoning 不可见、命令/文件组摘要和“上下文已自动压缩”可见。operation active 判定同步修正为：`durationMs` 只表示已持续时间，不能单独作为完成证据；命令只有出现 `exitCode` 或 terminal status 时才从“正在执行”收敛，避免 active turn 中带 duration 的命令误显示为已运行。`docs/ui_fidelity.md` 更新为当前 `320px` 左栏、`320px` 右栏、`72px` chat gap 和 Settings 小菜单 + 弹窗路径；`docs/mvp_gap_tracker.md` 同步更新视觉基线缺口状态。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build`、`pnpm test:e2e:ui-fidelity -- --project=desktop-chromium --project=mobile-chromium` 均通过，UI fidelity 覆盖桌面/移动共 `10 passed`。

2026-05-30 续跑状态：继续按 Desktop 截图收紧对话区与壳层 UI。消息块的 operation grouping 修正为先跳过完成态 reasoning，再合并相邻命令/文件/工具项，避免“隐藏思考”把命令组拆成多段；外层“正在执行/已运行”不再只信任 item.status，而是结合 turn 是否仍 active、命令 exitCode/duration 和终态 status 收敛，解决内部已完成但外层仍显示正在的问题。桌面壳层同步压缩：左栏默认宽度改为 `320px`、右侧运行栏改为 `320px`、聊天间距收窄；项目、会话和归档默认只展示前 5 条并提供“展开显示”；底部 Settings 改为先打开账户/设置小菜单，再进入居中的 `Settings / Diagnostics` 弹窗，避免直接弹出抽屉。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build`、`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium`、`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium -g "root shell|1920px desktop chat geometry|opens settings"`、仓库级 `pnpm typecheck`、`pnpm build` 均通过。生产服务已重启到新构建，监听 `0.0.0.0:18930`，PID `<pid>`；`/health` 返回 `ok: true`。

2026-05-30 续跑状态：消息里的本地文件可见性已补齐。后端新增受限的 `/api/files/preview` 与 `/api/files/content`，只允许读取 `data/`、默认项目根、官方项目和 Web 收藏项目内的文件；图片路径会转成浏览器可访问的受控内容 URL，文件变更在没有 diff 但有 path 时会按文本/图片/二进制类型展示预览。前端消息块同步收紧 Desktop 行为：完成后的 reasoning 不再占聊天区，`contextCompaction` 只显示不可展开的“上下文已自动压缩”分隔线，命令/文件/工具组采用两级折叠，先展开执行摘要，再按单条命令或文件打开详情。验证：`pnpm --filter @codex-web/api test -- src/index.test.ts`、`pnpm --filter @codex-web/server test -- src/filePreview.test.ts src/fileBrowser.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build`、`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium`、`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium -g "1920px desktop chat geometry"`、仓库级 `pnpm build` 均通过。生产服务已重启到新构建，监听 `0.0.0.0:18930`，PID `<pid>`；`/health` 返回 `ok: true`，对 `data\tmp\current-desktop-1920.png` 的 `/api/files/preview` 与 `/api/files/content` 均返回 200。

2026-05-30 续跑状态：Settings / Diagnostics 新增 `Sync acceptance` 面板，基于当前选中的 thread 生成可复制的 `pnpm sync:doctor` start/steer/interrupt 命令，并自动带 `--report data\tmp\sync-report-<kind>-<timestamp>.json`。这个面板不主动发送消息、不隐藏真实三端人工观察步骤，只把 P0 同步验收入口从文档命令前移到产品内，方便 Desktop、VS Code、Web 同开一条 thread 时快速生成 marker、steer 和 interrupt 的脱敏证据包。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build`、`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium -g "opens settings"`、仓库级 `pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。生产服务已重启到新构建，监听 `0.0.0.0:18930`，PID `<pid>`；`/health` 返回 `ok: true`。当前 `/api/sync/readiness` 显示官方 IPC connected、app-server initialized、必需 follower handler 全部通过；app-server 仍报告 `state db discrepancy during read_repair_rollout_path: upsert_needed (fast path)` warning，compatibility 因此为 `warning`，可选缺口仍是 `thread-follower-edit-last-user-turn`。

2026-05-30 续跑状态：补齐了手机/LAN 试用入口的可见能力。后端新增 `/api/network/lan-access`，由 `apps/server/src/lanAccess.ts` 枚举当前 Windows 网卡的非内网回环 IPv4 地址，并过滤明显的虚拟/TUN/VPN 网卡，结合当前运行端口返回可复制的 LAN URL、本机 URL 和 bind warning；共享 API 契约新增 `lanAccessSchema` / `lanAccessResponseSchema`，前端 `Settings / Network` 现在会显示“LAN access”地址列表并支持复制，不再需要靠口头查询当前电脑 IP。该接口不会返回 LAN 密码或 session secret。新增 `apps/server/src/lanAccess.test.ts`、`apps/server/src/lanAccessRoute.test.ts`，并扩展 `tests/e2e/app-shell.spec.ts` 的 Settings 回归，锁住 LAN URL 展示和复制按钮。验证：`pnpm --filter @codex-web/api test -- src/index.test.ts`、`pnpm --filter @codex-web/api build`、`pnpm --filter @codex-web/server test -- src/lanAccess.test.ts src/lanAccessRoute.test.ts`、`pnpm --filter @codex-web/server test`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build`、`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium -g "opens settings"`、仓库级 `pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。生产服务已重启到新构建，监听 `0.0.0.0:18930`，PID `<pid>`；`/health` 返回 `ok: true`，`/api/network/lan-access` 当前返回 WLAN 地址 `http://192.168.1.10:18930/` 作为 LAN URL，同时也列出本机 `http://127.0.0.1:18930/`。

2026-05-30 续跑状态：右侧运行栏的 Git/工作区信息已从前端硬编码改为后端真实读取。新增 `/api/workspace/status?cwd=<project-root>`，后端只允许读取默认项目根、官方项目或 Web 收藏项目路径内的工作区，并返回 Git 仓库、分支、upstream、ahead/behind、短提交、变更文件数、增删行数、未跟踪文件和 GitHub CLI 状态；前端右侧栏现在用该接口展示“变更 / 分支 / 提交 / GitHub”，不再写死 `main`、`本地工作区` 或 `CLI 不可用`。共享 API 契约已补 `workspaceStatusSchema` / `workspaceStatusResponseSchema`，并新增 `apps/server/src/workspaceStatus.test.ts` 和 `apps/server/src/workspaceStatusRoute.test.ts`。`/api/diagnostics/export` 也已把默认项目的 `workspace` 摘要纳入脱敏排障包，方便后续对齐右侧栏状态、Git 分支和 GitHub CLI 状态。验证：`pnpm --filter @codex-web/api build`、`pnpm --filter @codex-web/api test -- src/index.test.ts`、`pnpm --filter @codex-web/api typecheck`、`pnpm --filter @codex-web/server test -- src/workspaceStatus.test.ts src/workspaceStatusRoute.test.ts`、`pnpm --filter @codex-web/server test -- src/diagnosticsExport.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build` 均通过；随后仓库级 `pnpm typecheck`、`pnpm test`、`pnpm build` 也通过。生产服务已重启到新构建，监听 `0.0.0.0:18930`，PID `<pid>`；`/health` 返回 `ok: true`，`/api/workspace/status?cwd=C:\workspace\codex_web` 返回脱敏 workspace 摘要，`/api/diagnostics/export` 仅保留 branch、changedFiles 和 GitHub CLI status 等非凭据字段。`tests/e2e/app-shell.spec.ts` 的 1920 桌面几何回归已加入稳定 mock，断言右侧栏会展示后端返回的分支、提交、增删行和 GitHub 登录状态，防止重新退回硬编码；`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium -g "1920px desktop chat geometry"` 通过。`pnpm sync:doctor -- --json --report data\tmp\sync-doctor-report-workspace-status.json` 通过，仍只有 app-server read-repair warning 和可选 `thread-follower-edit-last-user-turn` warning。

2026-05-29 续跑状态：关机恢复后本机生产服务已重新确认可访问，`/health` 返回 `ok: true`，`/api/sync/readiness` 显示官方 IPC connected、app-server initialized、必需 follower handler 全部注册，仍只有可选的 `thread-follower-edit-last-user-turn` 处于 risky/未注册状态。UI 复刻方向继续按 Desktop 截图收紧：聊天区的 reasoning、command、file change、tool output 默认使用浅灰折叠摘要，active 状态有轻量动效；连续命令/文件/工具输出会合并成一条操作摘要，展开后仍保留每个块的命令、cwd、exit、duration、输出、diff 和复制入口；Composer 已取消显眼的“引导当前/排队下一条”大按钮条，active turn 时才显示底部紧凑“发送目标”下拉控件，普通状态只保留协作/目标控件，空输入且有 active turn 时主按钮直接显示停止图标，避免输入框占用右侧栏和正文空间。首轮会话列表读取现在有独立 loading 态：侧栏 workspace、全部会话行、会话/归档空态和主区 intro 会显示“正在同步会话”，并且未选中 thread 时不再渲染“这个会话暂时没有可展示内容”的假空消息。

本轮快速校验：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm --filter @codex-web/web test` 通过，`17 passed`；`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/mobile-experience.spec.ts tests/e2e/composer-runtime.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`9 passed / 9 skipped`。按用户提供的 Desktop 对照尺寸 `1920 x 1020` 生成了 `test-results/e2e/manual-desktop-1920x1020-after-target-control.png`，截图量测显示 Composer 位于 `457-1349px`，右侧栏位于 `1421-1781px`，两者不重叠，页面无横向溢出。

随后针对关机/重启后可能出现的 stale official owner clientId 补了协议恢复路径：follower start/steer/interrupt 在定向旧 `targetClientId` 失败且错误形态像路由/目标 client 失效时，会自动追加一次无 `targetClientId` discovery 请求。验证：`pnpm --filter @codex-web/protocol test` 通过，`18 passed`；`pnpm --filter @codex-web/protocol typecheck`、`pnpm --filter @codex-web/protocol build`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/server build` 均通过；`pnpm sync:doctor -- --json --report data\tmp\sync-doctor-report-stale-owner-retry.json` 通过。最后仓库级 `pnpm typecheck` 与 `pnpm test` 均通过，当前单元测试汇总为 protocol `18 passed`、api `21 passed`、server `79 passed`、web `17 passed`、ui `2 passed`、domain `5 passed`。

重启后实测还看到 direct target 与 discovery 均返回 generic `official-ipc-request-failed:thread-follower-*` 的路径。后端 fallback policy 已把这类泛化 follower 请求失败纳入 recoverable routing failure：如果 thread 已有官方 stream state，HTTP 层返回 `official-owner-unavailable`/409 并保留 Composer 文本；如果没有官方状态，则返回 `official-owner-required`，仍不静默调用本地 app-server 造成分叉。补充验证：`pnpm --filter @codex-web/server test -- src/turnFallback.test.ts` 通过，`5 passed`；`pnpm --filter @codex-web/server typecheck` 通过。随后全量 `pnpm typecheck`、`pnpm test` 和 `pnpm build` 均通过，生产服务已重启到新构建，监听 `0.0.0.0:18930`，新 PID 为 `<pid>`；`/health` 返回 `ok: true`，`/api/sync/readiness` 显示官方 IPC connected、app-server initialized、必需 follower handler 全部通过，可选 `thread-follower-edit-last-user-turn` 仍为 warn。当前 compatibility summary 因官方 app-server `state db discrepancy during read_repair_rollout_path: upsert_needed (fast path)` 为 warning，但 app-server check 仍为 pass。`pnpm sync:doctor -- --json --report data\tmp\sync-doctor-report-post-build-restart.json` 通过并写出脱敏证据包。

随后继续按 Desktop 对照尺寸收紧主布局骨架：桌面侧栏默认宽度改为 `370px`；聊天主列、右侧状态栏和 Composer 组成的桌面网格改为向右对齐，右侧状态栏宽度 `376px`、与聊天列间距 `100px`；Composer 卡片和聊天列左右边界对齐。新的 `1920 x 1020` 截图为 `test-results/e2e/manual-desktop-1920x1020-aligned-composer.png`，量测显示 main `370-1920px`、chat/composer `498-1426px`、右侧栏 `1526-1902px`，无横向溢出。新增 `tests/e2e/app-shell.spec.ts` 的 1920 桌面几何回归，`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`17 passed / 5 skipped`。

右侧运行栏也继续贴近 Desktop：环境信息改成图标化紧凑行，包含变更事件、本地端口、执行端、分支、提交和 GitHub 状态；普通桌面主界面不再直接显示 `owner` 协议词，而是显示“执行端：Desktop / VS Code、Web 或自动”。新的截图为 `test-results/e2e/manual-desktop-1920x1020-activity-panel.png`，右侧栏宽度仍为 `376px`，文本检查确认不含 `owner`，无横向溢出。`tests/e2e/app-shell.spec.ts` 已补充右侧栏产品语义断言。

Composer 普通状态下的发送目标控件已进一步收口：非 active turn 不再显示 steer/queue 用的“发送目标”下拉，避免和官方协作模式里的“目标”重复；active turn 时仍显示该下拉用于“引导当前/排队下一条”。同时前端运行状态刷新从 `Promise.all` 改成逐项 `Promise.allSettled`：account/compatibility 等非核心状态接口短暂失败时，config、官方 IPC、app-server 仍会独立更新，避免右侧栏长期停在 `loading` 或 `等待`。`tests/e2e/app-shell.spec.ts` 已断言普通桌面 Composer 不出现 `发送目标`，并能显示本地端口 `18930`。

active turn Composer 的发送目标文案继续贴近 Desktop 语义：`steer` 选项显示为“当前”，`start` 选项显示为“排队”，避免与协作模式的“目标”重复，底栏在运行中不再出现“目标 / 目标”的双重控件。验证截图为 `test-results/e2e/manual-desktop-1920x1020-after-target-label.png`，底栏显示“当前 / 目标 / 5.5 / 中”，右侧运行栏仍完整可见。

消息块默认折叠行为继续收紧：未知官方 raw item 现在与 tool output 一样默认只显示浅灰摘要和 rawType，不再直接展开 JSON；用户点击摘要后才显示可复制的 raw payload。验证：`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`2 passed / 2 skipped`。

无会话上下文下的顶栏操作也已收紧：当首轮同步后列表为空或当前没有选中 thread 时，桌面端“重命名会话 / 归档会话 / 停止当前回复”按钮禁用；移动端更多菜单里的对应 menuitem 同步禁用，避免触发无意义 prompt/confirm 或“没有可中断 active turn”的噪音。验证：`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium -g "first thread sync"` 通过，`2 passed`。

Settings 的 Diagnostics 页新增了 `Troubleshooting package` 卡片，复用 `/api/diagnostics/export` 生成脱敏排障 JSON，并在界面中明确它包含 IPC、app-server、protocol、cache、recent diagnostics，同时排除会话正文、附件内容、密码、token 和 session secret；同一卡片支持复制到剪贴板或下载为 `codex-web-diagnostics-<timestamp>.json`。`docs/troubleshooting_sync.md` 已补充同步异常材料收集流程、推荐 `sync:doctor --report` 命令和敏感信息禁止清单。它们用于同步异常、官方协议升级或 app-server 诊断时一起留存。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium -g "opens settings"` 通过，`2 passed`；`/health` 返回 `ok: true`，`/api/sync/readiness` 仍显示官方 IPC connected、app-server initialized、必需 follower handler 通过，可选 `thread-follower-edit-last-user-turn` 为 warn。

`/api/diagnostics/export` 已纳入共享 API 契约：`packages/api` 新增 `diagnosticsExportSchema` 和 `diagnosticsExportResponseSchema`，后端发送前会用该 schema 校验脱敏排障包，前端 `getDiagnosticsExport()` 也改为同一 schema 解析，不再依赖手写松散类型。`apps/server/src/diagnosticsExport.test.ts` 同步校验 builder 输出能通过共享 schema。验证：`pnpm --filter @codex-web/api test`、`pnpm --filter @codex-web/api typecheck`、`pnpm --filter @codex-web/api build`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/server test -- src/diagnosticsExport.test.ts`、`pnpm --filter @codex-web/web test` 均通过；随后仓库级 `pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。生产服务已重启为 PID `<pid>`，继续监听 `0.0.0.0:18930`；`/health` 返回 `ok: true`，`/api/diagnostics/export` 返回 schemaVersion `1` 且 safety omitted 列表完整，`/api/sync/readiness` 显示官方 IPC connected、app-server initialized、必需 follower handler 通过，compatibility 为 `compatible`，仅可选 `thread-follower-edit-last-user-turn` 为 warn。

普通 Markdown 消息块继续向 Desktop 体验靠拢：assistant/user 正文里的 fenced code block 现在渲染为带语言栏和复制按钮的紧凑代码块，外链会用新标签页打开；GFM 表格、列表、加粗等仍由 `react-markdown`/`remark-gfm` 渲染。`tests/e2e/message-blocks.spec.ts` 已加入 assistant Markdown fixture，覆盖代码块、表格、复制按钮和移动端无横向溢出。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`2 passed / 2 skipped`。

桌面 UI 高保真回归基准已改为 `1920 x 1019`，贴近当前用户提供的 1920 宽 Desktop/浏览器对照截图；`tests/e2e/ui-fidelity-baseline.spec.ts` 现在会在桌面 shell 截图前断言右侧运行栏默认可见、宽度不小于 `320px`，并且 Composer 右边界必须至少与右侧栏保持 `24px` 间距，防止输入框再次压住右侧栏。`Composer` 表单补充了稳定的 `aria-label="Composer"` 供几何回归定位。验证：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm --filter @codex-web/web test` 通过，`17 passed`；`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium` 通过，`1 passed`；`/health` 返回 `ok: true`。

消息区执行摘要进一步贴近 Desktop：`reasoning` 折叠态从英文 `Reasoning / collapsed` 改成浅灰中文“已思考/正在思考”，`command`、`file change`、`tool output` 即使只有单条也统一进入“已运行 N 条命令 / N 个文件变更 / N 个工具输出”的紧凑折叠摘要，不再把 `Command / completed` 或工具标题直接铺在聊天区。展开后仍保留命令、cwd、exit、duration、stdout/stderr、diff、raw output 和复制入口。`tests/e2e/message-blocks.spec.ts` 已更新桌面与移动端断言，确认默认只显示摘要、展开后可读详情、tool output 标题默认隐藏且无横向溢出。验证：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm --filter @codex-web/web test` 通过，`17 passed`；`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`2 passed / 2 skipped`。

UI 高保真截图矩阵新增复杂消息块样本：`tests/e2e/fixtures/messageBlocks.ts` 抽出脱敏 message item fixture，`tests/e2e/message-blocks.spec.ts` 和 `tests/e2e/ui-fidelity-baseline.spec.ts` 共用同一份数据。baseline 现在除 shell/search/settings/debug 外，还会生成 `desktop-chromium-message-blocks.png` 和 `mobile-chromium-message-blocks.png`，覆盖 Markdown/GFM、代码块复制、reasoning 折叠摘要、command/file/tool 执行摘要、plan、approval、image、error 和 unknown fallback。复杂消息块截图前会等待 thread detail 与右侧运行栏稳定，并继续断言无横向溢出、桌面 Composer 不压住右侧栏。验证：`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`2 passed / 2 skipped`；`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`2 passed`。

UI baseline 继续补齐 active turn + Composer 样本：`tests/e2e/fixtures/activeTurn.ts` 新增脱敏 active turn fixture，覆盖 active reasoning、running command、侧栏 live 标记、右侧“正在生成回复”和 Composer 的三种运行态。`tests/e2e/ui-fidelity-baseline.spec.ts` 现在额外生成 `active-composer-stop`、`active-composer-steer` 与 `active-composer-queue` 截图：空输入时验证 Composer 内停止按钮可见；输入文字后验证“发送目标”为 `steer/当前`，主按钮切回发送；再切到 `start/排队` 并保留发送按钮。为避免不同 fixture 在同一 page 内串 route，UI baseline 把 active composer 截图拆成独立用例。消息块 fixture 里的图片也从 1x1 透明像素换成可见的脱敏 SVG 预览，`message-blocks.spec.ts` 会检查图片 natural width，防止视觉基线里出现空白图片块。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`2 passed / 2 skipped`；`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`4 passed`。随后补充 `active-composer-queue` 后，`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`4 passed`。

UI baseline 继续补齐审批卡片样本：`tests/e2e/fixtures/approvalCard.ts` 抽出脱敏 pending approval fixture，`tests/e2e/approval-card.spec.ts` 与 `tests/e2e/ui-fidelity-baseline.spec.ts` 共用同一份审批数据。baseline 现在额外生成 `approval-card-pending` 与 `approval-card-expanded` 截图，覆盖待审批摘要、文件变更上下文、按钮区、changed files、diff 默认折叠和展开后长 diff 无横向溢出。验证：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm exec playwright test tests/e2e/approval-card.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`2 passed / 2 skipped`；`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`6 passed`。

LAN 登录入口也补入 E2E 与视觉基线：`LoginGate` 表单和密码输入增加稳定 aria label，`tests/e2e/fixtures/authGate.ts` 提供脱敏 locked auth/login mock；`app-shell.spec.ts` 会验证局域网设备进入前必须输入密码、空密码禁用、错误密码显示中文错误、正确密码后进入主 shell，且不会把真实密码写入 fixture。UI baseline 新增 `login-gate` 截图，覆盖桌面 `1920 x 1019` 与移动 `390 x 844` 登录首屏。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web build` 通过；`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`21 passed / 5 skipped`；`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`8 passed`。

空列表与首轮同步状态也进入视觉基线：`tests/e2e/fixtures/emptyState.ts` 提供脱敏空项目/空会话 fixture，并支持延迟 thread list 响应用来截图“正在同步会话”状态。`tests/e2e/ui-fidelity-baseline.spec.ts` 现在额外生成 `thread-sync-loading`、`empty-thread-list` 和移动端 `empty-mobile-drawer` 截图，确认首轮读取时不会提前显示“这个会话暂时没有可展示内容”，同步完成后空列表/空抽屉无横向溢出。验证：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium` 通过，`10 passed`。

认证与 LAN 安全相关接口也纳入共享 API 契约：`packages/api` 新增 `authStatusResponseSchema`、`authLoginRequestSchema`、`authSessionsResponseSchema`、session revoke 响应、revoke count 响应、通用 ok 响应和 `lanPasswordUpdateRequestSchema`；后端 `/api/auth/status|login|logout|sessions|sessions/revoke|sessions/revoke-others|sessions/revoke-all` 与 `/api/settings/password` 改为使用这些 schema 解析/发送，前端 `apps/web/src/api.ts` 同步改为同一 schema 解析。登录密码 schema 保留原始字符串、不做 trim，避免首尾空格密码被悄悄改写；session id 等普通标识仍会 trim。新增 `apps/server/src/authRoutes.test.ts` 覆盖真实 Fastify route 的短密码 400、错误登录 401、正确登录、session 列表和 revoke envelope。验证：`pnpm --filter @codex-web/api build`、`pnpm --filter @codex-web/api test`、`pnpm --filter @codex-web/server test -- src/authRoutes.test.ts`、`pnpm --filter @codex-web/server typecheck`、`pnpm --filter @codex-web/web typecheck` 均通过。

普通界面继续去协议化：移动端折叠面板从 `Sync status` / `Runtime details` 改为“运行状态 / 运行详情”，状态卡不再展示 `Owner`、`IPC`、`Realtime` 等工程词，统一使用“Desktop”“实时事件”“执行端”“app-server”等产品语义；消息块中的 Plan、Approval、Image、Error、Unknown item 等也改为中文标签。右侧栏不再硬编码假的 `Noether` 子智能体，没有真实官方事件时显示“暂无子智能体 / 等待官方事件”。验证：`pnpm --filter @codex-web/web typecheck`、`pnpm --filter @codex-web/web test`、`pnpm --filter @codex-web/web build`、`pnpm exec playwright test tests/e2e/mobile-experience.spec.ts --project=mobile-chromium`、`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=mobile-chromium -g "secondary runtime panels|root shell"`、`pnpm exec playwright test tests/e2e/message-blocks.spec.ts --project=desktop-chromium --project=mobile-chromium`、`pnpm exec playwright test tests/e2e/approval-card.spec.ts --project=desktop-chromium --project=mobile-chromium`、`pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=mobile-chromium`、`pnpm exec playwright test tests/e2e/app-shell.spec.ts --project=desktop-chromium -g "1920px desktop chat geometry"` 和 `pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium -g "repeatable shell"` 均通过。

已经落地的基础设施：

- pnpm workspace：根目录统一管理 `apps/*` 和 `packages/*`。
- 后端：`apps/server`，Fastify API、WebSocket 事件通道、官方 IPC bridge、Codex app-server JSON-RPC 子进程 bridge。
- app-server warmup：后端启动后会主动初始化官方 `codex app-server`，并在 diagnostics 中记录 `warmup-completed` 或 `warmup-failed`，提前暴露官方命令/协议兼容问题。
- app-server stderr 分类：官方 app-server 的结构化 WARN 会进入 `lastWarning`，不会误占 `lastError`；真正 ERROR、spawn error、exit 和 JSON-RPC 失败仍保留在 `lastError`。
- 安全基础：`apps/server/src/auth` 提供 LAN 密码、session cookie、本机免登录、`/api/auth/status|login|logout`，`/health` 保持公开。
- Security 会话管理：Web 设置面板可以查看 LAN session、撤销单个 session、撤销其他 session、撤销全部 session；后端提供 `codex-web auth reset` / `pnpm --filter @codex-web/server auth:reset` 生成新随机密码并清空旧 session。
- 同步验收助手：后端 CLI 提供 `codex-web sync doctor` / `pnpm sync:doctor`。默认只检查 `/health`、协议兼容性和 sync readiness；显式 `--send` 时才会通过 `/api/domain/turn-start` 向测试 thread 发送 marker，并检查 `official-follower`、最近 follower success 和 Web detail 唯一性；显式 `--steer` / `--interrupt` 时辅助验收 active turn 引导和停止；`--report <path>` 可额外写出脱敏 JSON 证据包，包含 compatibility、readiness、recent follower/handoff 和 marker 计数摘要，不保存 thread 正文。该工具用于缩短三端人工验收反馈回路，不能替代 Desktop/VS Code 的实时观察。
- Web 设置：设置/诊断面板已按 General、Projects、Security、Network、Appearance、Account、Diagnostics 分层。General 展示总览和附件存储清理；Projects 管理本地收藏项目；Security 修改 LAN 密码并管理 LAN session；Network 修改监听 host/port 和 Vite 开发端口；Appearance 展示当前浅色主题状态；Account 只读展示官方账号；Diagnostics 提供原始帧摘要开关、运行快照、协议兼容性摘要、sync readiness、follower handler 覆盖面、follower method capability matrix 和 JSON。端口类配置保存后需要重启服务生效。
- 诊断导出：设置/诊断面板可以复制或下载 `/api/diagnostics/export` 生成的脱敏 JSON；Diagnostics 页的 `Troubleshooting package` 卡片会说明包含/排除范围，日常排查可把它和 `sync:doctor --report` 的脱敏证据包一起保存，用于定位启动、IPC、app-server、缓存、协议兼容和运行事件问题。该接口现在由 `packages/api` 的共享 schema 约束，后端发送和前端读取都会校验同一份契约。
- 普通日志：后端 Fastify JSON 日志稳定写入 `data/logs/server.log`；官方 IPC 原始帧摘要仍默认关闭，需要在设置面板手动开启。
- 项目列表、文件浏览与工作区状态：官方 thread/list 推导出的项目仍是主来源；Web 额外支持本地收藏项目路径，保存到 `data/config.local.json` 的 `projects.favorites`，并通过 `/api/projects/favorites` 与官方项目列表合并展示。侧边栏可按项目过滤会话，新建会话会优先使用当前选中项目 cwd；Settings 可查看、添加和移除 Web 本地收藏项目。会话主区已加入只读项目文件浏览，后端 `/api/files/list` 只允许列出官方项目、Web 收藏项目或默认项目根目录内的目录项；右侧运行栏使用 `/api/workspace/status` 读取同一批允许项目根内的 Git/GitHub CLI 状态，避免前端硬编码示例分支或提交；`apps/server/src/fileBrowser.test.ts` 覆盖目录排序、limit、拒绝 `..` 逃逸和拒绝文件路径浏览，`apps/server/src/workspaceStatusRoute.test.ts` 覆盖工作区状态路由的允许根与拒绝根。
- 附件底座：Composer 支持文件选择、拖拽和粘贴上传，后端通过 multipart 持久化到 `data/attachments/`，SQLite 保存附件元数据，发送 turn 时可携带 attachment id 对应的本地持久路径引用；发送前会拒绝缺失 attachment id 和已绑定到其他 thread 的附件，发送成功后会把原本孤立的附件关联到当前 thread，避免后续 Storage cleanup 误删；`/api/attachments/:id/content` 提供受控预览/下载，Composer 对图片附件显示缩略图。Settings 的 Storage cleanup 只清理未绑定 thread、turn 和官方引用的孤立附件，已关联附件默认永久保留。
- 前端：`apps/web`，React + Vite Desktop-like shell、真实 thread 列表、thread detail 渲染、侧栏搜索、全局项目/会话搜索面板、新建会话入口、Composer 发送、官方 app-server 驱动的模型/协作模式/推理强度/Skills 选择、附件托盘、增强审批卡片、当前 turn 停止入口，以及 active turn 下的“引导当前 / 排队下一条”发送模式。Composer 已从 `App.tsx` 拆到 `apps/web/src/app/components/Composer.tsx`，支持 `Enter` 发送、`Shift+Enter` 换行，并在发送/上传/禁用态同步禁用 textarea 与运行时控件，避免上传中的键盘发送绕过按钮状态；桌面侧栏/rail/移动抽屉已拆到 `apps/web/src/app/components/NavigationSidebar.tsx`；桌面/移动 header 和同步状态 badge 已拆到 `apps/web/src/app/components/ThreadHeader.tsx`；聊天主区、只读文件面板和移动运行折叠面板已拆到 `apps/web/src/app/components/ChatMain.tsx`；全局搜索弹层已拆到 `apps/web/src/app/components/SearchPanel.tsx`；LAN 登录门禁已拆到 `apps/web/src/app/components/LoginGate.tsx`；认证状态已拆到 `apps/web/src/app/hooks/useAuthGate.ts`；运行态数据、实时事件和 thread 操作已拆到 `apps/web/src/app/hooks/useRuntimeData.ts`；浏览器路由 helper 已拆到 `apps/web/src/app/routes.ts`。`App.tsx` 现在只保留页面编排和局部 UI 状态。会话列表已接入官方 app-server cursor 分页，侧栏会用 `+` 标记仍有更多数据，并可分别加载普通会话和归档会话，分页合并逻辑位于 `apps/web/src/app/threadListPages.ts`；普通/归档会话超过阈值后会用 `apps/web/src/app/virtualThreadRows.ts` 做轻量 windowing，只渲染当前滚动窗口附近的行，同时保留深处会话可滚动访问。移动端 Composer 已使用三行紧凑布局，长模型/推理强度选项会省略显示以避免小屏横向滚动，图片/data URL 消息块也会在 `390px` 视口内截断而不撑出页面，并保留 Skills 菜单可操作性；移动端 Header 保留搜索直达，并把重命名、归档、停止和设置收纳到紧凑操作菜单；移动抽屉选择项目/会话后会收起，回到主会话视图；文件、同步状态和运行详情在手机端默认折叠，减少正文前后的诊断噪音。实时刷新已加入基础抗竞态保护：旧 cacheVersion 的官方 realtime 事件不会触发回退刷新，过期的 thread detail 请求响应不会覆盖当前会话详情；WebSocket 断线会退避重连，`connected` event 携带 `serverInstanceId/serverStartedAtIso`，后端重启后前端会清空旧 cacheVersion，避免把新服务低版本事件误判为 stale；主区 Sync status 会显示当前 thread 的 owner 来源摘要；owner/IPC 相关后端错误码会在 Web 中映射成面向用户的中文提示，避免把 `official-owner-*` 原始错误直接暴露为唯一信息。
- PWA 基础：`apps/web/public/manifest.webmanifest` 和 SVG 图标已接入 Vite 构建产物，移动浏览器可以识别为可安装 Web 应用；第一版不注册 service worker，也不承诺离线能力。
- 消息模型：`packages/domain` 已把 user、assistant、reasoning、command、fileChange、plan、approval、image、error、toolOutput、unknown 作为一等公民 item；Web 端消息块已能渲染 Markdown/GFM 正文、带复制入口的 fenced code block、计划、审批、图片、错误、工具输出、webSearch 工具输出，以及带 cwd/duration/exit code/stdout/stderr 的命令块。命令输出、diff、tool output、错误详情和未知 raw item 支持复制、展开/折叠和横向滚动。
- 前端路由：使用干净浏览器路径 `/thread/:threadId` 表示当前会话状态；旧的 `#/thread/:threadId` 链接会自动迁移到新路径。
- 真实同步验收支架：`tests/e2e/live-sync.spec.ts` 默认跳过，设置 `LIVE_SYNC_THREAD_ID` 后才会向真实 thread 发送 marker，检查 `/api/domain/turn-start` 走 `official-follower`、`recentFollowerRequests` 出现 success，并确认 Web detail 中只出现一次 marker；额外设置 `LIVE_SYNC_STEER_TEXT` 或 `LIVE_SYNC_INTERRUPT=1` 时可显式验收 active turn steer/interrupt 的官方 follower success；额外设置 `LIVE_SYNC_ATTACHMENT=1` 时可上传无敏感文本附件并验收 Web 上传/发送闭环。`tests/e2e/composer-runtime.spec.ts` 使用稳定 mock 数据验证 Composer 的模型、推理强度、Plan 协作模式、Skills 和附件 id 会进入 `/api/domain/turn-start` 请求体，发送成功后清空附件托盘，并覆盖 `Enter` 发送、`Shift+Enter` 换行；移动项目还覆盖长文件名附件 chip、Skills 选择、发送 body 和横向溢出断言。`tests/e2e/mobile-experience.spec.ts` 覆盖移动抽屉、搜索、Settings、附件/Skills 入口、运行状态折叠面板，以及手机视口下从更多菜单停止 active turn 的请求体。`tests/e2e/thread-pagination.spec.ts` 使用稳定 mock 数据验证普通/归档会话的 app-server cursor 加载更多交互。`tests/e2e/sync-safety-ui.spec.ts` 验证 official owner 不可用时 Web 显示中文友好错误并保留 Composer 文本。`tests/e2e/approval-card.spec.ts` 验证 pending approval 卡片展示命令/文件/diff 细节、决策 body 和重复点击保护，并补了移动端审批决策与无横向溢出检查。`tests/e2e/message-blocks.spec.ts` 使用稳定 mock 数据覆盖 reasoning、command、fileChange、plan、approval、image、error、toolOutput 和 unknown 消息块渲染，并验证展开/折叠交互无页面错误；移动项目会抽查复杂消息块和展开态布局。Playwright 固定 `workers: 1`，避免多个浏览器 worker 并发访问同一个真实 app-server/官方 IPC 导致假失败。Desktop/VS Code 侧实时显示和附件复看仍需第一版人工验收；人工验收矩阵已整理到 `docs/sync_acceptance_checklist.md`。
- 路由诊断面：`/settings` 可直达设置/诊断抽屉，Diagnostics tab 会展示后端 `/api/protocol/compatibility` 给出的 `summary.state/reason/methodCount`，并调用 `/api/sync/readiness` 汇总官方 IPC、app-server、必需 follower handler、可选 follower handler、当前 thread 缓存/owner 和最近 handoff 状态；sync readiness 构建逻辑已拆到 `apps/server/src/syncReadiness.ts` 并有独立单测，便于后续协议 handler 变更时维护；`adapter.followerMethodCapabilities` 会区分 implemented、candidate、research-required 和 risky 方法，避免把未安全实现的官方内部方法误报成可用；隐藏 `/debug` 页面同样展示 Compatibility 卡片和状态 badge，并保留 IPC、app-server、协议 method/version、已注册 follower handler 数量、SQLite cache、recent diagnostics 和脱敏导出。
- 共享包：`packages/config`、`packages/domain`、`packages/protocol`、`packages/ui`。
- API 契约：`packages/api` 已建立 Zod schema + TS 类型出口，覆盖 `/health`、`/api/domain/turn-start`、`/api/domain/turn-steer`、`/api/domain/turn-interrupt` 请求体、`/api/domain/threads`、`/api/domain/thread-detail`、`/api/files/list`、`/api/workspace/status`、`/api/network/lan-access`、`/api/diagnostics`、`/api/diagnostics/export`、`/api/cache/status`、`/api/account/status`、`/api/runtime-options`、`/api/skills`、`/api/official-ipc/status`、`/api/app-server/status`、`/api/protocol/compatibility`、`/api/sync/readiness` 响应 envelope、known realtime event union，以及 settings、favorite projects、attachments storage/list/upload/cleanup、approvals、thread create/rename/archive/unarchive 的契约。`turn-start` 公开请求只接受 Web 管理的 `attachmentIds`，会拒绝 raw `attachments`，避免浏览器绕过附件归属校验直接穿透官方 follower；`MessageItem` 使用 discriminated union 校验每类 domain item 的必需字段，未知官方 raw item 必须先被 domain 层归一化为受控的 `unknown` item。realtime event schema 已显式覆盖 connected、unparsed、websocket.error、diagnostic.event、appServer.notification、official thread stream/archive/unarchive/status 和 approval requested/resolved；connected event 携带 `serverInstanceId/serverStartedAtIso`，官方 thread payload 同时接受 `threadId` 与 `conversationId`。后端 turn route、thread list/detail、file browser、workspace status、LAN access、diagnostics/export、cache status、account/runtime/skills、official IPC status、app-server status、protocol compatibility、sync readiness、settings、favorite projects、attachments storage/list/upload/cleanup、approvals 和 thread create/rename/archive/unarchive 已用 schema 做 runtime validation；前端 API client/WebSocket 消费端和 health/config、thread list/detail、file browser、workspace status、LAN access、diagnostics/export、cache status、account/runtime/skills、official IPC status/app-server status/protocol compatibility/sync readiness、settings、favorites、attachments、approvals、thread action 读取使用同一套 schema/type。
- 本地缓存：`data/codex_web.sqlite`，Drizzle schema 与初始迁移位于 `apps/server/src/db/` 和 `apps/server/drizzle/`。
- 官方 IPC 协议辅助：`packages/protocol/src/index.ts` 中包含命名管道连接、帧解析、初始化、stream cache、follower start/steer/interrupt/compact、Web-owned 模型/推理强度/协作模式 owner-state、Web-owned conversation 显式释放、patch 应用、最近 follower 请求诊断和 `registeredRequestHandlers` 状态摘要。`apps/server/src/syncCoordinator.ts` 已把 Web-owned follower handler 和本地 owner snapshot 广播从 `app.ts` 抽离，便于后续补 owner 恢复、更多 follower 方法和重连验收。
- 官方 follower 请求对重启后的 stale owner clientId 已有防护：`thread-follower-start-turn`、`thread-follower-steer-turn` 和 `thread-follower-interrupt-turn` 会先尝试缓存的 `targetClientId`；如果定向请求失败形态像路由/目标客户端失效，则追加一次无 `targetClientId` 的 discovery 请求，让官方 IPC router 重新选择当前 owner。真实 owner 返回的业务错误不会被吞掉或转成本地 fallback，避免重复 turn。
- 轻量协议测试：`packages/protocol/src/officialIpc.test.ts` 覆盖 conversation id 读取、add/replace/remove patch 应用、active turn id 兼容读取、patch 早于 snapshot 的恢复通知、Web-owned thread 被官方客户端重新广播时的 owner handoff 释放，local-only Web owner 不发布 stream state，以及 Web-owned conversation 被归档/关闭类操作显式释放时会清掉本地 owner 与 cached stream state。该测试还包含一个 fake official IPC peer，用真实 4 字节 length framed JSON socket 验证初始化、follower start-turn/steer/interrupt 定向到当前官方 owner、无缓存 owner 时走 discovery、recent follower diagnostics 成功/失败记录、Web-owned snapshot 广播、client discovery、registered request handler 响应，以及高版本 discovery/request 不误调用 handler。`apps/server/src/turnFallback.test.ts` 覆盖官方 follower 失败时是否允许本地 app-server fallback。`apps/server/src/protocolCompatibility.test.ts` 覆盖协议兼容性 summary 的 compatible、warning、offline 和 error 判定。
- Thread/turn 路由安全测试：`apps/server/src/turnRoutes.test.ts` 使用 fake official IPC/app-server 跑真实 Fastify `/api/domain/turn-start|turn-steer|turn-interrupt` 路由，覆盖 official-known owner 不可达时返回 409、owner 状态未知且 IPC 断开时返回 503、三条路径都不会调用本地 app-server fallback，以及 turn-start 失败时不会错误关联附件；同时保留 Web-owned conversation 才允许本地 app-server fallback 的正向用例。`apps/server/src/threadDetailRoute.test.ts` 覆盖 external-owned 空 snapshot 的只读 hydrate：Web 可以临时读 app-server 详情用于展示，但不会把该结果写入 SQLite thread detail cache；无官方 state 的 app-server detail 仍会正常缓存。`apps/server/src/threadCreateRoute.test.ts` 使用真实 `OfficialIpcBridge` ownership 逻辑验证 `/api/domain/thread-create` 会把 Web 新建 thread claim 为 local-only Web owner，不写入官方 stream state，并且 `thread/start` 会带 `threadSource: "user"` / `workspaceRoots`；如果官方 IPC 尚未初始化出 Web `clientId`，则返回 503 且不调用本地 app-server `thread/start`；如果 app-server 已创建但 local-only owner 未建立，则返回 503、不写入 SQLite thread/detail cache 并记录诊断，避免创建一个没有 owner 身份的 thread。`apps/server/src/threadRenameRoute.test.ts` 锁住重命名 owner 边界：外部 Desktop/VS Code owned thread 会 409 拒绝本地 rename mutation；只有已经 Web-owned 且允许广播的 thread 才会重广播 rename snapshot；如果重命名后的 detail refresh 期间 owner 被官方端接管，Web 不会再广播本地 rename snapshot 覆盖官方状态。`apps/server/src/threadArchiveRoute.test.ts` 锁住归档 owner 边界：Web-owned thread 归档成功后释放 Web owner 和本地 cached stream state；外部 Desktop/VS Code owned thread 会 409 拒绝本地 archive mutation，不会被 Web 清掉官方 owner cache。`apps/server/src/threadUnarchiveRoute.test.ts` 覆盖外部 owned thread 的 unarchive 也会 409 拒绝，避免本地恢复操作与官方 live cache 分叉。

## 端口与访问地址

默认监听地址为 `0.0.0.0`。

| 用途                  | 默认端口 | 本机地址                 |
| --------------------- | -------: | ------------------------ |
| 后端 API/生产静态文件 |  `18930` | `http://127.0.0.1:18930` |
| 前端 Vite 开发服务器  |  `18931` | `http://127.0.0.1:18931` |

说明：

- 当前仓库配置以 `18930/18931` 为准。
- `documentation/protocol/official_codex_ipc_sync.md` 中的 `18923` 是早期验证项目示例端口，不是当前 `codex_web` 默认端口。
- 后端端口可通过 `data/config.local.json` 覆盖；默认配置由 `packages/config/src/index.ts` 提供。
- 会话直达链接使用 `/thread/<thread-id>`；设置直达 `/settings`；隐藏调试页 `/debug`。构建后的后端会把非 API 路径回退到前端 `index.html`。

配置示例：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 18930
  },
  "dev": {
    "frontendPort": 18931
  },
  "ui": {
    "theme": "light"
  },
  "diagnostics": {
    "rawFrameLogging": false
  },
  "projects": {
    "favorites": ["C:\\workspace\\codex_web"]
  }
}
```

## 关键路径

```text
C:\workspace\codex_web\
  apps/server/                 Fastify 后端和官方 bridge
  apps/web/                    React/Vite 前端
  apps/web/public/             Web manifest 和应用图标
  packages/config/             默认端口、data/config.local.json、data 目录初始化
  packages/domain/             官方 conversationState 到 Web domain model 的转换
  packages/protocol/           官方 IPC wire protocol、stream cache、follower 请求
  docs/product_spec.md         产品规格和 milestone 规划
  docs/startup_runbook.md      启动、检查和清理手册
  documentation/protocol/      官方 IPC 研究记录
  data/                        本地配置、附件、日志、临时文件和未来数据库
```

默认数据目录由 `packages/config` 初始化：

```text
data/
  config.local.json
  auth.sessions.json
  attachments/
  logs/
    server.log
  tmp/
```

`data/config.local.json` 中的 `auth.passwordHash` 和 `auth.sessionSecret` 是本机安全配置；`data/auth.sessions.json` 只保存 session token hash 和访问元数据。二者已加入 `.gitignore`，不要提交。

## 依赖与运行环境

`docs/startup_runbook.md` 记录的本机已确认版本：

```text
Node.js v22.17.0
npm 11.4.2
pnpm 10.14.0
Git 2.53.0
sqlite3 3.51.1
Codex Desktop
VS Code Codex 扩展
```

主要运行依赖：

- 后端：Fastify 5、`@fastify/static`、`@fastify/websocket`、`@fastify/cookie`、Zod。
- 前端：React 19、Vite 7、lucide-react。
- 测试/构建：TypeScript 5.9、Vitest 3、tsx、Prettier。

## 启动方式

安装依赖：

```powershell
pnpm install
```

开发模式同时启动后端和前端：

```powershell
pnpm dev
```

单独启动：

```powershell
pnpm dev:server
pnpm dev:web
```

构建后的后端会从 `apps/web/dist` 提供前端静态文件；开发时通常访问 Vite 端口 `18931`。

生产模式启动：

```powershell
pnpm build
pnpm start
```

`pnpm start` 会运行 `@codex-web/server` 的 `node dist/index.js`，监听 `0.0.0.0:18930` 并提供构建后的 Web UI。

## 后端 API 面

当前后端已暴露的主要接口：

```text
GET  /health
GET  /api/auth/status
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/sessions
POST /api/auth/sessions/revoke
POST /api/auth/sessions/revoke-others
POST /api/auth/sessions/revoke-all
GET  /api/config
GET  /api/network/lan-access
POST /api/settings
POST /api/settings/password
GET  /api/files/list?root=<project-root>&path=<relative-path>
GET  /api/workspace/status?cwd=<project-root>
GET  /api/diagnostics
GET  /api/diagnostics/export
GET  /api/official-ipc/status
GET  /api/protocol/compatibility
GET  /api/sync/readiness?threadId=<thread-id>
GET  /api/app-server/status
GET  /api/account/status
GET  /api/runtime-options
GET  /api/skills?cwd=<cwd>&forceReload=true
GET  /api/cache/status
GET  /api/approvals
POST /api/approvals/decision
GET  /api/attachments/storage
POST /api/attachments/cleanup
GET  /api/attachments?threadId=<thread-id>
POST /api/attachments?threadId=<thread-id>
POST /api/rpc
GET  /api/threads?limit=30
GET  /api/thread-read?threadId=<thread-id>
GET  /api/official-thread-stream-state?threadId=<thread-id>
GET  /api/domain/threads?limit=30
GET  /api/domain/thread-detail?threadId=<thread-id>
POST /api/domain/thread-create
POST /api/domain/thread-rename
POST /api/domain/thread-archive
POST /api/domain/thread-unarchive
POST /api/domain/turn-start
POST /api/domain/turn-steer
POST /api/domain/turn-interrupt
POST /api/official-ipc/thread-follower-start-turn
POST /api/official-ipc/thread-follower-steer-turn
POST /api/official-ipc/thread-follower-interrupt-turn
WS   /api/realtime
```

## 官方 IPC 与 app-server 机制

当前实现采用后端 bridge，而不是让浏览器直接连官方本地协议。

```text
Browser UI
  |
  | HTTP / WebSocket
  v
Fastify backend
  |                         |
  | JSON-RPC over stdio     | framed JSON IPC
  v                         v
codex app-server            \\.\pipe\codex-ipc
                            |
                            v
                 Codex Desktop / VS Code Codex
```

官方 IPC 要点：

- Windows 命名管道：`\\.\pipe\codex-ipc`。
- 帧格式：4 字节 little-endian payload length + UTF-8 JSON payload。
- 当前已知方法版本集中在 `packages/protocol/src/index.ts` 的 `IPC_METHOD_VERSIONS`。
- bridge 启动后发送 `initialize`，拿到 `clientId`。
- 官方 IPC 原始帧摘要日志默认关闭；在 Web 设置面板开启后，`/api/official-ipc/status` 会暴露最近帧的方向、类型、方法、request id 和脱敏摘要，用于协议升级诊断。
- owner 客户端广播 `thread-stream-state-changed` snapshot/patches。
- Web 后端缓存每个 conversation 最新 `conversationState`。
- 如果收到 patches 但本地没有 snapshot，协议层不会静默丢弃；它会记录 `official-ipc-patches-without-snapshot:<thread-id>` 并发出 `patches-without-snapshot` 通知，促使 Web 走 app-server 读一次权威 thread detail。
- 对官方客户端 owned thread，Web 发送消息时应走 `thread-follower-start-turn`，不能直接调用自己的 app-server `turn/start`，否则通常只会写入持久化数据而无法进入官方实时流。
- 对 external-owned thread detail，官方 IPC stream cache 是 owner/source 的权威来源；如果官方 snapshot 暂时为空，Web 可以用 app-server 做一次只读 hydrate 以展示历史内容，但不把该结果写入 `thread_details` cache。
- active turn 期间的引导应走 `thread-follower-steer-turn`，参数中携带 `expectedTurnId`，避免把 stale UI 输入投递到错误 turn。
- 如果 Web 自己通过本地 app-server 成为某个 thread 的执行端，后端会注册 `thread-follower-start-turn` / `thread-follower-interrupt-turn` handler，并只在确认当前 thread 为 Web-owned 时，把本地 app-server 通知节流转换为 `thread-stream-state-changed` snapshot 广播，供 Desktop/扩展实时跟随；owner 未知的本地通知不会触发 Web snapshot 广播，debounce 期间或 thread/read 期间失去 Web ownership 时也会放弃广播，避免误 claim 官方 thread 或归档后复活 Web owner/cache。
- Web 新建 thread 前必须已有官方 IPC `clientId`，否则后端返回 `official-ipc-owner-not-ready`；新建成功后还会确认 local-only Web owner 已建立，再把 thread 写入 Web 投影缓存。`thread/start` 参数必须补 `threadSource: "user"` 和 `workspaceRoots`，避免官方 Desktop 读到缺少来源 metadata 的本地会话。
- 如果 Desktop/扩展随后又广播同一个 conversation 的 snapshot/patch，Web 会撤销本地 `ownedConversationIds` 标记，并在 `/api/official-ipc/status` 的 `recentOwnershipHandoffs` 中记录 handoff，避免 Web 误以为自己仍是 owner 而产生分叉。
- 官方 follower 失败时的本地 app-server fallback 已收紧：只有明确 Web-owned conversation 才允许本地兜底；官方 owner 不可用、IPC 未连接或 owner 状态未知时返回 409/503，并记录 `official-follower-fallback-denied`，避免把历史官方 thread 静默分叉成 Web 本地执行。
- Web 的 rename/archive/unarchive 在明确 external-owned 时会返回 `official-owner-action-required:*`，暂不走本地 app-server mutation；后续只有找到官方 action/follower 路径后才应放开这些操作。
- 对官方客户端发出的 `thread-archived` / `thread-unarchived` 广播，Web 只做被动收敛：协议层释放相关 stream cache/ownership 并发出 `official.threadArchived` / `official.threadUnarchived` realtime event，前端收到后刷新列表和当前 thread detail，不主动伪造官方 mutation。
- Web app-server client request 已接住 `item/commandExecution/requestApproval` 和 `item/fileChange/requestApproval`。这些请求会挂起等待 Web 审批卡片返回 `{ decision }`，而不是被立即 `not implemented` 拒绝。审批对象会尽量归一化 command、cwd、grant root、file path、changed files、diff/patch 和 session 级授权建议；Web 卡片支持文件路径/变更文件展示、diff 展开/复制、决策处理中状态和重复点击保护。approval requested/resolved 事件只会在确认 Web-owned 时触发本地 owner snapshot 调度，尽量让 Web-owned 审批等待态/决策态通过官方 IPC 广播给 Desktop/VS Code；`apps/server/src/approvals.test.ts` 已覆盖 approval requested/resolved 事件、API-safe payload、重复决策 404 路径和 app-server 停止时的 rejectAll cancel 行为，`apps/server/src/syncCoordinator.test.ts` 已覆盖 approval 事件触发 snapshot 与 unknown-owner 不广播保护。真实 official-owned approval 的三端一致性仍需按验收清单人工确认。

app-server 要点：

- `apps/server/src/appServerProcess.ts` 会在后端启动时 warm up `codex app-server`，后续 RPC 仍会复用同一子进程；如果 warmup 失败，后续请求仍会再次尝试初始化。
- 初始化方法为 JSON-RPC `initialize`，声明 `experimentalApi: true`，之后支持 `thread/list`、`thread/read`、`thread/archive`、`thread/unarchive`、`model/list`、`collaborationMode/list`、`skills/list`、`account/read`、`account/rateLimits/read`、`configRequirements/read`、`turn/start`、`turn/steer`、`turn/interrupt` 和通用 `/api/rpc` 转发。
- `/api/runtime-options` 会把官方 `model/list` 与 `collaborationMode/list` 归一化成 Web 自己的模型、推理强度和 Default/Plan 协作模式；接口失败时返回 `gpt-5.5` / `gpt-5` 与 Default/Plan 的保守 fallback，并在 diagnostics 记录 warning。
- `/api/skills` 会按 cwd 调用官方 `skills/list`，归一化出 enabled Skills；Composer 发送时把选中的 Skills 作为 `{ type: "skill", name, path }` 追加到 `turn/start` 或 `turn/steer` 的 `input` 数组。
- `/api/account/status` 提供官方账号只读状态、rate limit 摘要和 config requirements；Web 只展示，不做登录/退出操作。
- 当前 `resolveCodexCommand()` 优先使用 `CODEX_WEB_CODEX_COMMAND`，其次查找 VS Code Codex 扩展内置 `codex.exe`，最后才回退到 PATH 中的 `codex`。
- 如果碰到 WindowsApps 中 `codex.exe` 权限问题，见 `docs/pitfalls/2026-05-29_windowsapps-codex-denied.md`。
- `/api/domain/thread-detail` 优先读取官方 IPC 实时缓存；如果官方缓存存在但 normalizer 不能得到有效 turns，会记录 `official-thread-detail-empty-fallback` 并尝试 app-server `thread/read`，避免 UI 被半截官方缓存压成空白。

## SQLite/Drizzle 缓存

第一版 SQLite 只作为 Web 自己的投影缓存，不替代官方 session 文件和 app-server。

当前表：

- `projects`：官方项目投影和 Web 本地收藏项目投影。
- `threads`：会话列表索引、owner 摘要和更新时间。
- `thread_details`：打开过的 thread detail，保存 Web domain model JSON。
- `attachments`：Web 上传附件的元数据、sha256、持久文件路径和可选 thread/turn/official reference 关联；清理逻辑只会删除三类关联都为空的孤立记录和其安全目录内文件。

生成迁移：

```powershell
pnpm db:generate
```

运行时仍由 `apps/server/src/db/index.ts` 执行保守的 `CREATE TABLE IF NOT EXISTS`，保证第一版启动不依赖手动迁移步骤。

## 脱敏诊断导出

`/api/diagnostics/export` 会返回面向排障的安全摘要：

- app 基本版本、项目路径、数据目录、当前 host/port、浅色主题和诊断开关。
- 官方 IPC 连接状态、client id、pipe path、stream cache 计数、owned 计数、已注册 request handler、最近 follower 请求结果、最近 owner handoff 和最后错误。
- 当前 Web adapter 声明的官方 IPC method/version map。
- app-server 运行状态、PID、初始化状态、pending call 数、最后错误和最后警告。
- SQLite 缓存计数。
- 最近诊断事件，递归脱敏敏感字段。

不会导出：

- LAN 密码 hash、session secret、cookie、session token hash。
- 官方账号邮箱。
- raw IPC frame payload、conversationState、thread 消息正文。
- 附件文件内容。

命令行检查：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/diagnostics/export | ConvertTo-Json -Depth 12
```

## 验证命令

轻量静态检查：

```powershell
Test-Path docs/product_spec.md
Test-Path documentation/protocol/official_codex_ipc_sync.md
Test-Path docs/startup_runbook.md
Test-Path packages/protocol/src/index.ts
Test-Path apps/server/src/app.ts
```

类型检查、测试和构建：

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

同步验收助手：

```powershell
pnpm build
pnpm sync:doctor -- --thread <thread-id>
pnpm sync:doctor -- --thread <thread-id> --send --text "codex_web sync doctor $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <thread-id> --steer --text "codex_web sync steer $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <thread-id> --interrupt
```

最近一次本机验证（2026-05-29 22:01 左右，完成 generic follower 请求失败分类、全量构建，并重启生产服务后）：

- `pnpm typecheck`：通过。
- `pnpm test`：通过，protocol 侧 `18 passed`，api 侧 `21 passed`，server 侧 `22 files / 81 passed`，web 侧 `5 files / 17 passed`，当前单元测试合计覆盖 protocol、domain、api、server、web、ui；API 契约测试包含 health、settings/favorites/file browser/diagnostics/cache/account/runtime/skills/attachments/attachments list+upload envelope/approvals/thread action/protocol compatibility envelope、sync readiness envelope、known realtime event union、connected server epoch、raw turn-start attachment 拒绝、concrete message item discriminated union、follower method capability matrix 和 registered request handler status，server 侧包含 protocol compatibility、sync readiness、sync coordinator、Web-owned runtime owner-state、runtime owner-state handoff 清理、approval snapshot scheduling、unknown-owner 本地 snapshot 不广播、debounce/handoff/release 后延迟 snapshot 不广播、thread-create owner-ready guard、thread-create owner 建立失败不写缓存、external-owned thread action guard、rename detail refresh 期间 owner 丢失不重广播、external-owned empty detail readonly hydrate、thread list cursor passthrough、sync doctor CLI 诊断模式只读、发送失败不继续伪轮询和 report path 解析、官方归档/恢复 IPC notification 转 realtime bus event、WebSocket realtime route schema-valid connected/server epoch 事件、诊断导出、approval requested/resolved round-trip、附件清理、发送后附件 thread 关联回归、Web-owned thread-create owner、thread rename/archive/unarchive owner guard、thread archive owner/cache release、turn HTTP 路由层的官方 owner 失败不分叉保护、generic follower request failure 分类、raw attachment 不转发保护，以及 runtime options/Skills/collaborationMode 传入 official follower 的参数贯通和脱敏诊断摘要；protocol 侧还覆盖官方 `thread-archived` / `thread-unarchived` 广播的被动收敛通知、follower start/steer/interrupt framed IPC、stale owner discovery retry 和错误诊断；web 侧包含 realtime cacheVersion、后端 websocket instance 变化后清空旧 cacheVersion、官方归档/恢复 unversioned event 接受、thread detail 请求排序、owner/IPC 错误提示映射、thread list page 合并和长会话列表 virtual window 计算。
- `pnpm build`：通过。
- `pnpm test:e2e`：通过，`34 passed / 28 skipped`，当前按 `workers: 1` 串行访问真实本机服务。跳过项包含需要显式 `LIVE_SYNC_THREAD_ID` / `LIVE_SYNC_STEER_TEXT` / `LIVE_SYNC_INTERRUPT=1` / `LIVE_SYNC_ATTACHMENT=1` 的真实三端同步 start/steer/interrupt/attachment 烟测、桌面视口下只适用于移动端的布局回归，以及移动项目下重复的 mock 驱动链路检查；`tests/e2e/composer-runtime.spec.ts` 已覆盖 Composer 选择模型、推理强度、Plan 协作模式、Skill 和附件后发送到 `/api/domain/turn-start` 的 body，覆盖 `Enter` 发送与 `Shift+Enter` 换行，并新增移动端长文件名附件、Skills 选择、发送 body 和发送后托盘清空；`tests/e2e/thread-pagination.spec.ts` 已覆盖普通/归档会话加载更多按钮使用 app-server cursor 拉取下一页并合并列表；`tests/e2e/long-thread-list.spec.ts` 已覆盖 1000 条已加载会话时只渲染窗口内行、滚到底仍能访问深处会话，并可直接搜索定位第 1000 条深处会话；`tests/e2e/sync-safety-ui.spec.ts` 已覆盖 official owner 不可用时 Web 不清空 Composer 文本且显示中文友好错误；`tests/e2e/approval-card.spec.ts` 已覆盖审批卡片细节展示、决策请求体、按钮禁用和卡片刷新消失，并新增移动端审批决策可用性；`tests/e2e/message-blocks.spec.ts` 已覆盖复杂消息块渲染和展开/折叠交互，并新增移动端复杂消息块无横向溢出烟测；`tests/e2e/mobile-experience.spec.ts` 覆盖移动抽屉、搜索、Settings、附件/Skills 入口、运行状态折叠面板、手机视口下停止 active turn，并已处理真实 active turn 后到导致附件按钮禁用的等待问题；移动端横向溢出断言已统一到 `tests/e2e/helpers/layout.ts`，失败时会输出 offender 诊断，并允许 `pre/code` 等内部滚动区域不被误判为页面级横向溢出；`tests/e2e/ui-fidelity-baseline.spec.ts` 已提供桌面/移动固定命名截图入口，覆盖 shell、Search、Settings、Debug，移动端额外覆盖 drawer 和 Skills 菜单；该视觉基线用例超时已提升到 90 秒，避免真实长线程 full-page screenshot 在移动项目下产生假失败。
- `pnpm sync:doctor -- --json --report data\tmp\sync-doctor-report-post-build-restart.json`：通过，当前本机服务可访问，后端生产服务监听 `0.0.0.0:18930`，本次监听进程 PID 为 `<pid>`；结果为 `ok: true`，并验证 report 输出逻辑可用。注意 CLI 中相对 `--report` 路径会按仓库根目录解析，本次报告落在 `data\tmp\sync-doctor-report-post-build-restart.json`，没有写入 `apps/server/data`。本轮协议兼容性为 `warning`，原因是官方 app-server 的 `state db discrepancy during read_repair_rollout_path: upsert_needed (fast path)` warning；官方 IPC connected、app-server initialized、必需 follower handler 全部通过，可选缺口仍是 `thread-follower-edit-last-user-turn`。CLI help 已验证支持诊断、`--send`、`--steer`、`--interrupt` 和 `--report`。
- 运行态 HTTP 检查：`/health`、`/api/protocol/compatibility`、`/api/sync/readiness` 均可访问；本次 `/api/protocol/compatibility` 显示 7 项 follower method capability matrix，`start/steer/interrupt/compact/set-model-and-reasoning/set-collaboration-mode` 为 implemented 且已注册，`edit-last-user-turn` 为 risky；`/api/sync/readiness` 显示官方 IPC connected、app-server initialized、3 个必需 follower handler 全部注册，剩余 `edit-last-user-turn` 尚未实现并以 warn 展示。

最近一次局部验证（2026-05-31 00:31 左右，收口 `file change` / “已编辑文件”默认折叠与 Desktop-like 展开样式，并记录顶部按钮/真实右侧栏设计约束后）：

- `pnpm --filter @codex-web/web typecheck`：通过。
- `pnpm --filter @codex-web/web build`：通过，Vite 仅提示主 chunk 超过 500 kB。
- 18930 原监听进程 `/health` 超时，确认进程为 `node apps/server/dist/index.js` 后重启到最新构建；新进程 PID 为 `<pid>`，`/health` 返回 `ok: true`。
- `pnpm test:e2e -- tests/e2e/message-blocks.spec.ts --project=desktop-chromium`：通过，`3 passed / 1 skipped`。
- `pnpm test:e2e -- tests/e2e/message-blocks.spec.ts --project=mobile-chromium`：通过，`2 passed / 2 skipped`。
- 本轮 UI 文档新增约束：顶部按钮里的“置顶摘要”和“真实右侧栏”必须拆开实现；真实右侧栏后续采用标签页式容器，文件和侧边聊天为重点，浏览器/审查/终端先占位。

架构目标补充（2026-05-31）：i18n 已从路线规划进入正式架构层。新增 `packages/i18n`、`apps/web/src/i18n`、`i18next + react-i18next` provider、`zh-CN` / `en-US` JSON 资源和翻译 key 类型；顶栏本地环境/置顶摘要/命令行/真实右侧栏开关、移动端顶栏菜单和真实右侧栏标签启动器已先迁移到 `t(key)`。后续新增大面积 UI 前应继续扩大覆盖，避免用户可见文案散落在组件和后端错误字符串里。

当前局部 UI 收口（2026-05-31）：用户消息渲染改为 Desktop-like 纯文本气泡，不再解析 Markdown；长用户消息按行数/字符数自动折叠，并提供“显示更多/收起”切换；聊天区 Markdown 正文字号和行距下调一档，降低 Web 相对 Desktop 过松的问题。该规则已同步到 `docs/ui_fidelity.md`，后续复杂消息块回归需要覆盖用户消息“不渲染 Markdown”和“长文本可折叠”。

右侧栏标签页约束补充（2026-05-31）：真实右侧栏按浏览器式标签容器处理，初始不预置固定标签；`+` 只打开新建入口，每次选择“文件 / 侧边聊天 / 浏览器 / 审查 / 终端”都会追加一个新的标签实例，同类标签允许重复创建，任意标签都可关闭，关闭最后一个标签后回到新建入口。该行为已用 app-shell 回归覆盖，避免后续误改成固定槽位或固定数量。

右侧栏侧边聊天收口（2026-05-31）：侧边聊天标签不再显示协议说明型占位，而是渲染独立的 Desktop-like pane：顶部绑定当前主会话、主体保留子会话滚动区、底部呈现紧凑 Composer 外壳。真实“依附主会话的子聊天”协议仍待官方行为确认，但 UI 层已经按可重复新增/关闭的浏览器标签实例组织，后续接入协议时不需要改固定标签架构。

侧边聊天协议假设补充（2026-05-31）：根据当前 Desktop UI 中的“分叉”入口和侧边聊天表现，侧边聊天更可能是主 thread/turn 派生出的 child/fork thread，而不是把主聊天上下文整体复制到一个独立 prompt。后续实现应优先寻找官方 fork/branch/side-chat 相关协议，并让右侧聊天复用主聊天渲染与 Composer；在协议确认前，不做“把全部上下文硬塞进去”的临时实现，避免后续同步与历史记录分叉。

置顶摘要与真实右侧栏互斥行为补充（2026-05-31）：按 Desktop 交互，打开真实右侧栏时会自动收起置顶摘要，并记住打开前的摘要开合状态；关闭真实右侧栏时再恢复该状态。这样文件标签页/侧边聊天展开时不会和置顶摘要同时挤占主会话区。app-shell 回归已覆盖“原本打开则关闭后恢复打开”和“原本关闭则关闭后保持关闭”两种路径。

右侧栏标签回归验证（2026-05-31）：`pnpm --filter @codex-web/web build` 通过，Vite 仅提示主 chunk 超过 500 kB；随后重启 `18930` 的 Web 服务到最新构建，新 PID 为 `<pid>`，`/health` 返回 `ok: true`；`pnpm test:e2e -- tests/e2e/app-shell.spec.ts --project=desktop-chromium` 通过，`9 passed / 4 skipped`，覆盖无预置标签、`+` 新增入口、同类标签重复创建、侧边聊天 pane、关闭标签和关闭最后一个标签回到启动页。

本轮局部验证（2026-05-31，用户消息纯文本/折叠与字号收紧）：`pnpm --filter @codex-web/web typecheck` 通过；`pnpm --filter @codex-web/web build` 通过，Vite 仍仅提示主 chunk 超过 500 kB；`pnpm test:e2e -- tests/e2e/message-blocks.spec.ts --project=desktop-chromium` 通过，`3 passed / 1 skipped`；`pnpm test:e2e -- tests/e2e/message-blocks.spec.ts --project=mobile-chromium` 通过，`2 passed / 2 skipped`。验证后重启 `18930` 的 `apps/server/dist/index.js` 进程，`/health` 返回 `ok: true`。

后端启动后检查：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/health
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/config
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/official-ipc/status | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/sync/readiness | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/sync/readiness?threadId=<thread-id>" | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/app-server/status | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/account/status | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/runtime-options | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/skills | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/diagnostics/export | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/domain/threads?limit=5&archived=true" | ConvertTo-Json -Depth 8
```

官方 IPC 正常时，`/api/official-ipc/status` 应至少满足：

- `data.supported: true`
- `data.connected: true`
- `data.clientId` 非空
- `data.pipePath: "\\\\.\\pipe\\codex-ipc"`
- `data.registeredRequestHandlers` 至少包含 `thread-follower-start-turn`、`thread-follower-steer-turn` 和 `thread-follower-interrupt-turn`

一次成功的官方-owned thread Web 发送，应在 `data.recentFollowerRequests` 中出现：

```json
{
  "method": "thread-follower-start-turn",
  "result": "success",
  "handledByClientId": "<owner-client-id>"
}
```

## 当前已知限制

- 官方 IPC 是内部、未公开支持的协议；Codex Desktop 或 VS Code 扩展升级后，方法版本和帧 shape 都可能变化。
- 第一版 LAN 访问安全为 HTTP + 密码/session：本机免登录，局域网设备需要登录；不适合直接暴露公网。
- 密码首次启动随机生成并只在后端日志输出一次；之后可在 Web 设置面板修改，或通过 `pnpm --filter @codex-web/server auth:reset` 重置。密码修改和命令行重置都会撤销旧 LAN session。
- 设置面板写入的是 `data/config.local.json`；当前运行进程的监听端口不会热切换，端口变更需要重启服务。
- 当前默认端口是 `18930/18931`；旧文档中的 `18923` 仅作协议研究参考。
- Web 端已经能展示真实列表、项目过滤和真实会话详情，消息块已覆盖更多一等公民 item，并具备基础复制/展开交互，但 UI 仍处于 Milestone 1 质量，距离像素级复刻还需要继续拆组件、补状态和视觉回归。
- 附件已经做了 Web 侧持久化、选择/拖拽/粘贴入口、预览/下载、孤立附件安全清理和发送参数贯通；公开 `turn-start` 只接受后端已管理和校验归属的 `attachmentIds`，不接受浏览器传入 raw attachment 对象；Playwright 已覆盖桌面和移动端浏览器选择文件、上传返回 id、发送 `attachmentIds` 和成功后清空托盘。官方 app-server 对不同附件类型的最终持久引用 shape 仍需用真实图片/文件 turn 继续验证。
- 审批卡片已经支持命令执行和文件变更的批准/拒绝/拒绝并停止；命令类在存在官方 proposed execpolicy amendment 时支持 session 级批准；文件变更类会尽量展示目标文件、变更文件列表和原始 diff/patch。Playwright 已覆盖 pending approval 卡片展示、决策请求体、重复点击保护和刷新为空后消失；真实 official-owned 命令/文件变更审批仍需人工端到端验证。
- Composer 的模型、协作模式、推理强度和 Skills 已经来自官方 app-server。Default 模式发送时省略 `collaborationMode`，Plan 模式发送时携带 `{ mode: "plan", settings: { model, reasoning_effort, developer_instructions } }`。后端会记录 `runtime-options-selected` 脱敏诊断，只保留 model、effort、skillCount、attachmentCount、collaborationMode、collaborationModel 和 collaborationReasoningEffort，不记录正文、skill path 或 developer instructions。该参数链路已有后端 route 单测和 Playwright Composer runtime 请求体 E2E。active turn 期间支持 `turn/steer` 引导当前回复，也可选择排队下一条。Skills 当前支持选择和随消息发送；安装、启停、远程同步和配置写入还未做。
- official-owned rename/archive/unarchive 继续采用保守策略：当前勘察未找到安全的 `thread-follower-rename/archive/unarchive` 官方路径，Web 不对 external-owned thread 做本地 mutation，避免分叉。`thread-follower-edit-last-user-turn` 官方实现依赖 `thread/rollback` + `turn/start`，但 rollback 不恢复本地文件变更且需要精确重建附件/审批/沙箱参数，继续标记为 risky，不在 MVP 暴露。
- `packages/protocol` 与 `packages/domain` 已有轻量测试，domain 覆盖了多类消息 item 归一化；`apps/web` 已有 realtime cacheVersion 与 thread detail 请求排序单测；后端和前端测试仍需要继续补更细的真实交互覆盖。
- Web-owned thread 的完整三端 owner 行为已接入代码路径，但仍需要更系统的真实发送/中断/重连测试；当前高信心路径仍是 Web follow 官方 owner。为避免分叉，非 Web-owned thread 在 owner 未知或 IPC 不可用时不会自动降级为本地 turn/start。
- app-server 子进程按需启动，真实可用性取决于本机 Codex 命令解析、登录状态和官方 app-server 协议兼容性。
- 浏览器不能直接连接 `\\.\pipe\codex-ipc`；必须通过本地后端 bridge。
- 该服务应只面向本机或可信私网，不应把未认证后端暴露到公网。
