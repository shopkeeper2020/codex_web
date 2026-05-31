# 仓库结构

## 默认工作区与运行环境

- 默认项目路径：`C:\workspace\codex_web`
- 默认后端端口：`18930`
- 默认 Vite 开发端口：`18931`
- 默认监听地址：`0.0.0.0`
- 本机已确认基础环境：Node.js `v22.17.0`、npm `11.4.2`、pnpm `10.14.0`、Git `2.53.0`、sqlite3 `3.51.1`、Codex Desktop、VS Code Codex 扩展。

```text
codex_web/
  apps/
    server/      Fastify 后端、IPC bridge、app-server bridge、WebSocket/API
    web/         React + Vite 前端
      public/    Web manifest 与 PWA 图标
  packages/
    api/         前后端共享 API 契约、Zod runtime schema 和派生 TS 类型
    config/      路径、端口、配置解析
    domain/      领域模型、normalizer、owner routing 抽象
    i18n/        共享语言包、翻译 key 类型和 Intl formatter 约定
    protocol/    官方 IPC/app-server wire protocol
    ui/          设计 token 和共享 UI 基础
  docs/          产品、架构、启动和踩坑文档
  documentation/
    protocol/    官方协议研究记录和 fixture 说明
  data/          本地数据目录，默认不提交运行数据
```

## 分层原则

- `apps/web` 不直接读取官方 raw protocol。
- `apps/server` 负责连接官方 IPC、app-server 和浏览器。
- `packages/protocol` 只描述 wire protocol 和传输适配。
- `packages/api` 放 Web HTTP/WebSocket 契约的 runtime schema 和派生类型；后端负责 parse/validate，前端只消费导出的 TS 类型。
- `packages/domain` 把官方/app-server 数据转换成 Web 自己的 domain model。
- `packages/i18n` 是正式架构层，负责 `zh-CN` / `en-US` 语言包、翻译 key 类型和 `Intl` formatter 约定；`apps/web/src/i18n` 负责 React provider、语言偏好持久化和 `useI18n()`。前端用户可见文案应从 i18n key 获取，不继续在组件中散写。
- `packages/ui` 管理高保真 UI 的共享 token 出口；导出的 token 必须指向 `apps/web/src/styles/tokens.css` 中真实存在的 CSS variables。
- `apps/web/src/app/components/MessageBlocks.tsx` 负责消息 item 与审批卡片渲染；`apps/web/src/app/components/Composer.tsx` 负责输入、附件、模型/模式/推理强度、Skills 和发送模式；`apps/web/src/app/components/NavigationSidebar.tsx` 负责桌面侧栏、rail 和移动抽屉；`apps/web/src/app/components/ThreadHeader.tsx` 负责桌面/移动 header 与同步状态 badge；`apps/web/src/app/components/ChatMain.tsx` 负责聊天主区、只读文件面板和移动运行折叠面板；`apps/web/src/app/components/SearchPanel.tsx` 负责全局搜索弹层；`apps/web/src/app/components/LoginGate.tsx` 负责 LAN 登录门禁。
- `apps/web/src/app/hooks/useAuthGate.ts` 负责认证门禁状态；`apps/web/src/app/hooks/useRuntimeData.ts` 负责运行态数据、实时事件、thread 操作和发送动作；`apps/web/src/app/routes.ts` 负责浏览器路由解析与切换；`apps/web/src/app/App.tsx` 只保留页面编排和局部 UI 状态。
- `apps/web/src/app/threadListPages.ts` 负责普通/归档会话分页合并与去重；前端列表通过 `/api/domain/threads?cursor=...` 继续读取 app-server cursor page，不直接读取官方持久化文件。
- `apps/web/src/app/virtualThreadRows.ts` 负责长会话列表的轻量 window 计算；`NavigationSidebar` 在已加载会话超过阈值后只渲染当前滚动窗口附近的行，避免大量 thread button 常驻 DOM。
- `apps/web/src/app/components/StatusBadge.tsx` 提供跨 header/message/settings 复用的状态徽标。
- `tests/e2e/helpers/layout.ts` 提供 Playwright 横向溢出断言和失败 offender 诊断；移动端布局测试应复用它，避免只留下不可定位的 `toBeTruthy` 超时；内部可横向滚动的 `pre/code` 不应被误判为页面级溢出。`tests/e2e/composer-runtime.spec.ts` 覆盖 Composer 选中的模型、推理强度、Plan 模式、Skills 和附件是否进入 `/api/domain/turn-start` 请求体，也覆盖 `Enter` 发送与 `Shift+Enter` 换行，并覆盖移动端附件+Skills 发送闭环；`tests/e2e/mobile-experience.spec.ts` 覆盖移动抽屉、搜索、Settings、附件/Skills、运行状态折叠面板和手机视口停止 active turn；`tests/e2e/thread-pagination.spec.ts` 覆盖普通/归档会话加载更多是否携带 app-server cursor 并合并下一页；`tests/e2e/long-thread-list.spec.ts` 覆盖长会话列表 windowing 和深处会话可达性；`tests/e2e/sync-safety-ui.spec.ts` 覆盖 owner 失败时 Web 的友好错误和 Composer 文本保留；`tests/e2e/approval-card.spec.ts` 覆盖审批卡片展示、决策请求体和重复点击保护，并覆盖移动端审批可用性；`tests/e2e/message-blocks.spec.ts` 覆盖复杂 domain message item 渲染和展开/折叠交互，并覆盖移动端复杂消息块布局。
- Web 设置只通过后端 API 修改 `data/config.local.json`，前端不得直接读写本地配置文件或安全字段。
- LAN session 管理只暴露 session 派生 id、时间、IP 和 User-Agent，不暴露 cookie token 或 token hash；密码重置命令会轮换 session secret 并清空旧 session。
- `/api/diagnostics/export` 是唯一面向复制/分享的诊断出口；它必须走白名单字段和递归脱敏，不得复用 raw IPC frame、conversationState、auth config、session store 或附件内容。
- Composer 运行时选项通过 `apps/server/src/runtimeOptions.ts` 从官方 `model/list` / `collaborationMode/list` 归一化；前端只消费 Web 自己的 `RuntimeOptions` shape。
- Skills 通过 `apps/server/src/skills.ts` 从官方 `skills/list` 归一化；前端发送时仍使用官方 `UserInput` 的 `{ type: "skill", name, path }` shape。
- Sync readiness 通过 `apps/server/src/syncReadiness.ts` 统一构建 handler 覆盖、thread owner、recent follower 和 owner handoff 诊断；`apps/server/src/app.ts` 只负责 `/api/sync/readiness` 路由挂载。
- Web-owned thread 的生命周期边界必须由后端协议层维护：Web 新建/继续时可广播本端 snapshot，外部官方客户端重新广播时释放 Web owner，Web 归档成功后要释放本端 owner 和 cached stream state，失去 Web ownership 后要清理 cached runtime owner-state，避免归档或 handoff 后的残留 owner/settings 继续接管 follower 请求。
- 官方客户端发出的 `thread-archived` / `thread-unarchived` 广播只作为被动收敛信号：协议层释放相关 cached stream state/ownership，并由后端转成 `official.threadArchived` / `official.threadUnarchived` realtime event，前端据此刷新列表和当前 detail。
- Web 新建 thread 前必须确认官方 IPC 已初始化出 Web `clientId`；没有 owner 身份时不要调用本地 app-server `thread/start`。如果 app-server 已创建但 Web-owned snapshot 未建立，路由必须返回失败、记录诊断且不写入 Web 投影缓存。
- 对明确 external-owned 的 thread，不要直接调用本地 app-server 做 rename/archive/unarchive mutation；先返回 `official-owner-action-required:*`，直到实现官方 action/follower 路径。Web-owned rename 后刷新详情时也必须复查 owner，owner 已被官方端接管时不要重广播本地 snapshot。
- 对 external-owned 的空 official snapshot，`/api/domain/thread-detail` 可以临时读取 app-server 补足展示数据，但不得写入 `thread_details` cache。
- 本地 app-server 通知和 approval 事件不能自己决定 owner；`apps/server/src/syncCoordinator.ts` 只有在 `officialIpc.isOwnedConversation(threadId)` 明确为真时才允许调度本地 snapshot 广播，并在 debounce 执行前、thread/read 后再次复查 owner。
- 消息和会话类型以 `packages/domain` 为唯一来源；`apps/web/src/api.ts` 只 re-export domain 类型，不再复制 `Thread` / `MessageItem` / `Attachment` 等结构。
- 新增 HTTP 请求体、响应 envelope 和 WebSocket event 时优先在 `packages/api` 定义 schema，再接入 `apps/server` route 和 `apps/web/src/api.ts`/WebSocket 消费端。当前已接入 `/api/domain/turn-start`、`/api/domain/turn-steer`、`/api/domain/turn-interrupt`、`/api/domain/threads`、`/api/domain/thread-detail` 和 known realtime event union；`turn-start` 公开请求只允许后端管理的 `attachmentIds`，不要让浏览器 raw attachment shape 穿透到官方 follower；official thread payload 需要同时兼容 `threadId` 与 `conversationId`，由前端统一提取后刷新列表/detail；connected event 需要携带 `serverInstanceId/serverStartedAtIso`，供前端在后端重启后清理旧 cacheVersion。
- `packages/domain` 的 `MessageItem` 必须优先扩展为稳定的 Web domain model，再由前端渲染；不要让前端直接判断官方 raw item shape。
- 官方账号、rate limit 和 config requirements 通过 `/api/account/status` 只读展示；不要在文档或日志中写入真实邮箱、token 或账号敏感信息。
- 前端路由使用 clean browser paths，例如 `/thread/:threadId`；旧 hash route 只作为兼容入口，不应继续扩展。
- `/settings` 是设置/诊断抽屉的直达入口；`/debug` 是隐藏工程诊断页，不应放入普通 Desktop-like 导航。
- `apps/web/public/manifest.webmanifest` 提供移动端添加到主屏幕所需的基础元信息；第一版不注册 service worker，不做离线缓存。

## 默认数据落点

```text
data/
  config.local.json
  codex-web.sqlite
  attachments/
  logs/
    server.log
  tmp/
```

`config.local.json` 保存端口、主题、诊断开关和 LAN 密码 hash；该文件是本机私有运行配置，不能提交。

`config.local.json` 的 `projects.favorites` 保存 Web 本地收藏项目路径；官方项目仍来自 app-server thread/list，Web 收藏只是补充。

`attachments/` 保存 Web 上传文件的持久副本；SQLite 的 `attachments` 表保存 id、文件名、MIME、大小、sha256、thread/turn 关联和本地路径。附件目录默认不提交。

`logs/server.log` 保存普通 Fastify JSON 日志；官方 IPC 原始帧摘要默认不写入普通日志，需要在设置面板显式开启。
