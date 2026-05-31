# 启动手册

## 前置条件

当前机器已确认：

```text
Node.js v22.17.0
npm 11.4.2
pnpm 10.14.0
Git 2.53.0
sqlite3 3.51.1
Codex Desktop
VS Code Codex 扩展
```

## 默认端口

- 后端：`18930`
- 前端开发服务器：`18931`
- 监听地址：`0.0.0.0`

## 安装依赖

```powershell
pnpm install
```

## 开发启动

```powershell
pnpm dev
```

访问地址：

```text
前端开发服务器：http://127.0.0.1:18931
后端 API：http://127.0.0.1:18930
会话直达：http://127.0.0.1:18930/thread/<thread-id>
```

单独启动：

```powershell
pnpm dev:server
pnpm dev:web
```

## 生产启动

先构建前后端：

```powershell
pnpm build
```

然后启动后端和构建后的 Web 静态页面：

```powershell
pnpm start
```

`pnpm start` 等价于 `pnpm --filter @codex-web/server start`，会监听 `0.0.0.0:18930` 并从 `apps/web/dist` 提供页面。

前端使用干净浏览器路径保存当前会话状态：

```text
/thread/<thread-id>
/settings
/debug
```

旧的 `#/thread/<thread-id>` 链接会自动迁移到新路径。

`/debug` 是隐藏工程诊断页，不挂在普通导航里。它展示 IPC、app-server、协议 method/version、SQLite cache、recent diagnostics 和脱敏诊断导出，用于官方协议升级或同步异常时排查。普通设置面板的 `Diagnostics` tab 也会展示协议兼容性摘要、同步 readiness 和 `Troubleshooting package` 脱敏排障包，日常排查优先看那里。

## 搜索入口

Desktop Web 左侧 rail 的 `Search` 按钮会打开全局搜索面板；桌面键盘也支持 `Ctrl+K`。移动端顶部的搜索按钮打开同一个面板。

当前搜索范围：

- 官方项目和 Web 本地收藏项目。
- 普通会话。
- 归档会话；点击归档结果会先恢复再打开。

侧边栏内的搜索框仍保留，用于当前导航区域内的轻量过滤。

## 消息中的本地文件预览

Web 会把消息里的本地图片路径和 file change 路径转换成受控预览：

- 图片 path 通过 `/api/files/content` 渲染为 `<img>`。
- file change 没有 diff 但有 path 时，通过 `/api/files/preview` 展示文本内容、图片预览或二进制文件元信息。
- 可访问范围限制在 `data/`、默认项目根、官方项目和 Web 收藏项目内；范围外路径会显示无法预览，不会读取任意磁盘文件。

这套接口只解决 Web 消息展示问题，不改变官方 Desktop/VS Code 的附件引用格式。

## 侧边聊天同步检查

`/api/domain/thread-detail` 会在普通 thread detail 里附带 `sideConversations[]`。该字段来自官方 IPC 的 `sideConversation` stream state，用于 Web 置顶摘要和真实右侧栏按 Desktop 当前侧聊标签数量/标题展示。

```powershell
$threadId = "<主会话 thread id>"
$detail = Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/domain/thread-detail?threadId=$threadId"
$detail.data.sideConversations | Select-Object id,title,turnCount,inProgress
```

期望：Desktop/VS Code 当前打开的侧边聊天会出现在列表里，标题优先使用官方标题或首条用户消息；空白侧聊按实际顺序显示为 `侧边聊天`、`侧边聊天 2`。Web 当前只读展示官方侧聊 turns，不能创建 Web 私有 side thread 来冒充同步。

## 手机添加到主屏幕

构建后的 Web 产物包含：

```text
/manifest.webmanifest
/icons/icon.svg
/icons/maskable-icon.svg
```

移动 Edge/Chrome 访问 `http://<电脑局域网 IP>:18930/` 后，可使用浏览器菜单里的“添加到手机”或“添加到主屏幕”。当前电脑可用的 LAN 地址可在 Web 的 `Settings / Network` 里查看和复制；也可以在本机运行：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/network/lan-access | ConvertTo-Json -Depth 6
```

第一版只提供安装元信息和图标，不注册 service worker，也不提供离线访问；Codex 同步、发消息和流式输出仍然依赖这台 Windows 电脑上的 `codex_web` 后端、官方 Desktop/扩展和官方 app-server 正常运行。

## 构建与检查

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e -- --list
pnpm test:e2e
```

Playwright 冒烟/截图测试默认访问 `http://127.0.0.1:18930/`，可用 `PLAYWRIGHT_BASE_URL` 覆盖；详细说明见 `docs/playwright_e2e.md`。

如果使用默认 `18930` 生产后端跑 E2E，前端改动后需要先执行 `pnpm build`，否则正在运行的后端仍会提供旧的 `apps/web/dist` 静态包。

完整 Playwright 首次运行前可能需要下载浏览器：

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

真实三端同步烟测默认跳过；需要手动指定一个真实 thread id 才会发送消息：

```powershell
$env:LIVE_SYNC_THREAD_ID = "<真实 thread id>"
$env:LIVE_SYNC_TEXT = "codex_web live sync smoke $(Get-Date -Format o)"
pnpm test:e2e -- --grep "live sync smoke"
Remove-Item Env:\LIVE_SYNC_THREAD_ID
Remove-Item Env:\LIVE_SYNC_TEXT
```

该测试会实际向指定会话发送一条消息，运行前请确认 Desktop/VS Code/Web 都打开了同一条 thread，便于人工确认三端实时同步。

active turn 的 steer/interrupt 烟测同样是显式开启：

```powershell
$env:LIVE_SYNC_THREAD_ID = "<真实 thread id>"
$env:LIVE_SYNC_STEER_TEXT = "codex_web live steer $(Get-Date -Format o)"
pnpm test:e2e -- --grep "steers an active turn"
Remove-Item Env:\LIVE_SYNC_STEER_TEXT

$env:LIVE_SYNC_INTERRUPT = "1"
pnpm test:e2e -- --grep "interrupts an active turn"
Remove-Item Env:\LIVE_SYNC_INTERRUPT
Remove-Item Env:\LIVE_SYNC_THREAD_ID
```

如果 readiness 里没有 `activeTurnId`，可以额外设置 `$env:LIVE_SYNC_TURN_ID = "<active turn id>"`。interrupt 测试会真实停止目标 active turn，只能在无敏感测试 thread 上运行。

附件发送烟测也是 opt-in，会上传一个临时文本附件并通过 Web follower 发送：

```powershell
$env:LIVE_SYNC_THREAD_ID = "<真实 thread id>"
$env:LIVE_SYNC_ATTACHMENT = "1"
$env:LIVE_SYNC_ATTACHMENT_TEXT = "codex_web live attachment $(Get-Date -Format o)"
pnpm test:e2e -- --grep "sends an uploaded attachment"
Remove-Item Env:\LIVE_SYNC_ATTACHMENT
Remove-Item Env:\LIVE_SYNC_ATTACHMENT_TEXT
Remove-Item Env:\LIVE_SYNC_THREAD_ID
```

该测试只证明 Web 上传、Web 本地附件内容读取、`attachmentIds` 进入 `/api/domain/turn-start`、官方 follower success 和 Web detail marker 唯一；Desktop/VS Code 是否能复看附件仍需人工观察。

也可以使用 CLI 验收助手。默认只做诊断，不会发送消息或控制 active turn：

```powershell
pnpm build
pnpm sync:doctor -- --thread <thread-id>
```

确认目标是无敏感测试 thread 后，再显式发送 marker：

```powershell
pnpm sync:doctor -- --thread <thread-id> --send --text "codex_web sync doctor $(Get-Date -Format o)"
```

附件路径也可以走同一个验收助手；它会先上传本地文件，再把后端校验后的 `attachmentIds` 放进 `/api/domain/turn-start`：

```powershell
pnpm sync:doctor -- --thread <thread-id> --send --text "codex_web sync attachment $(Get-Date -Format o)" --attachment "<无敏感测试文件路径>" --report data\tmp\sync-report-S11-attachment.json
```

active turn 期间可辅助验收 steer 和 interrupt；未传 `--turn` 时会使用 sync readiness 报告的 `activeTurnId`：

```powershell
pnpm sync:doctor -- --thread <thread-id> --steer --text "codex_web sync steer $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <thread-id> --interrupt
```

该命令会组合检查 `/health`、`/api/protocol/compatibility`、`/api/sync/readiness`、`/api/official-ipc/status` 和 `/api/domain/thread-detail`。带 `--send` 时，它会通过 `/api/domain/turn-start` 发送 marker，确认返回 `official-follower`、`recentFollowerRequests` 中有 `thread-follower-start-turn success`，并检查 Web thread detail 中 marker 只出现一次；带 `--attachment` 时，还会检查 Web 上传是否成功，并在 report 中只保留附件数量/字节数、不保存附件 id 或内容；带 `--steer` 或 `--interrupt` 时，它会检查对应 follower success。它仍不能替代 Desktop 和 VS Code 的人工实时观察。

同步或协议异常时，建议同时保存两份脱敏材料；完整清单见 `docs/troubleshooting_sync.md`。

```powershell
pnpm sync:doctor -- --thread <thread-id> --report data\tmp\sync-report.json
```

`sync:doctor --report` 会移除 `--send` marker 和 `--steer` guidance 正文，只保留 marker 是否被移除和出现次数；不要把包含 marker 正文的终端输出或 `--json` 全量输出当作长期排障材料。

然后打开 Web 的 `Settings / Diagnostics`，在 `Troubleshooting package` 点击 `Copy package` 或 `Download package`。该排障包来自 `/api/diagnostics/export`，包含 IPC、app-server、protocol、cache 和 recent diagnostics，不包含会话正文、附件内容、密码、token 或 session secret。

## 官方 IPC 状态检查

后端启动后：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/official-ipc/status
```

期望：

- `connected: true`
- `clientId` 非空
- `pipePath` 为 `\\.\pipe\codex-ipc`

协议兼容性摘要：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/protocol/compatibility | ConvertTo-Json -Depth 8
```

该接口会返回当前 Web adapter 声明的官方 IPC method/version map、官方 IPC 连接状态、app-server 状态、Web 当前注册的 follower request handler、每个 follower 方法的能力矩阵，以及后端归一化的 `summary.state/reason/methodCount`。官方 Desktop/扩展升级后如果同步失效，优先把这个输出和 `/api/diagnostics/export` 一起用于排查。

Web 的 `Settings / Diagnostics` 面板会把同一份数据折叠成 `Compatibility` 行：`compatible` 表示 IPC 已连接且 app-server 已初始化；`warning` 通常代表官方 app-server 有可恢复 WARN；`offline`/`error` 需要查看下方 JSON 和服务日志。

同步 readiness：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/sync/readiness | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/sync/readiness?threadId=<thread-id>" | ConvertTo-Json -Depth 12
```

该接口面向“三端同步为什么没有实时发生”的排查。无 `threadId` 时检查全局 IPC、app-server、必需 follower handler 和可选 follower handler；带 `threadId` 时还会补充该 thread 是否存在官方实时缓存、当前缓存 owner 来源和最近 handoff。第一版必需 handler 是 `thread-follower-start-turn`、`thread-follower-steer-turn`、`thread-follower-interrupt-turn`；`thread-follower-compact-thread`、`thread-follower-set-model-and-reasoning`、`thread-follower-set-collaboration-mode` 已在 Web-owned conversation 上实现。edit last user turn 仍作为可选高风险缺口以 `warn` 展示。更细的可选方法安全级别见 `/api/protocol/compatibility` 的 `adapter.followerMethodCapabilities`。

## LAN 访问密码

安全规则：

- `GET /health` 和 `GET /api/health` 不需要登录。
- 本机 `127.0.0.1` / `localhost` 请求免登录。
- 静态页面允许加载；局域网设备访问普通 `/api/*` 和 WebSocket 时需要登录 session cookie，前端会显示登录门禁。
- 密码只以 hash 形式存放在 `data/config.local.json`，明文不会写入仓库。
- session 默认有效期为 7 天，记录在 `data/auth.sessions.json`。

首次启动如果 `data/config.local.json` 里还没有 `auth.passwordHash`，后端会生成一个随机 LAN 临时密码，把 hash 写入本地配置，并在后端启动日志里输出一次：

```text
codex_web LAN temporary password: <password>
```

登录接口：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18930/api/auth/login -ContentType application/json -Body '{"password":"<password>"}' -SessionVariable session
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/auth/status -WebSession $session
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18930/api/auth/logout -WebSession $session
```

如果需要修改密码，优先在 Web 右侧设置/诊断面板里修改 `New LAN password`。它会更新 `data/config.local.json` 中的密码 hash，不会把明文写入磁盘。密码修改后会撤销已有 LAN session；局域网设备需要用新密码重新登录。

命令行重置：

```powershell
pnpm build
pnpm --filter @codex-web/server auth:reset
```

该命令会生成新随机密码并输出到终端，写入新的密码 hash，轮换 session secret，并删除 `data/auth.sessions.json` 撤销旧 session。

如果设置面板和命令行都不可用，可停止服务后删除 `data/config.local.json` 中的 `auth.passwordHash`、`auth.passwordGeneratedAtIso` 和 `auth.passwordChangedAtIso` 字段，再重启服务，让后端重新生成临时密码。

## Security session 管理

查看 LAN sessions：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/auth/sessions | ConvertTo-Json -Depth 8
```

撤销单个 session：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18930/api/auth/sessions/revoke -ContentType application/json -Body '{"sessionId":"<session-id>"}'
```

撤销除当前 session 外的其他 session：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18930/api/auth/sessions/revoke-others
```

撤销全部 LAN session：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18930/api/auth/sessions/revoke-all
```

Web 设置/诊断面板也提供同样的设备/session 管理入口。本机访问使用 local bypass，因此 session 列表为空是正常状态。

## Web 设置

右侧设置/诊断面板当前支持：

- `General`：查看基础总览，并清理未绑定任何 thread/turn/官方引用的孤立附件。
- `Projects`：查看、添加和移除 Web 本地收藏项目。
- `Security`：修改 LAN 访问密码，查看和撤销 LAN sessions。
- `Network`：查看/复制当前 LAN 访问地址，并修改监听 host/port 和 Vite 开发服务器端口。
- `Appearance`：展示当前浅色主题状态。
- `Account`：只读展示官方账号、rate limit 和配置要求。
- `Diagnostics`：切换官方 IPC 原始帧摘要日志，查看运行状态、协议兼容性摘要、sync readiness、registered follower handlers、follower method capabilities、recent realtime events、IPC/app-server/config JSON，并复制脱敏诊断 JSON。

注意：

- host/port 和 Vite 端口写入 `data/config.local.json` 后，需要重启服务才会完全生效。
- IPC 原始帧摘要日志会立刻生效，但只记录脱敏摘要，不保存完整消息正文。

## 项目收藏

项目列表优先来自官方 app-server 的 thread/list 投影。Web 可以额外保存本地收藏项目路径，用于手机端快速在常用工作区新建会话。

侧边栏“项目”标题右侧的加号会要求输入 Windows 目录路径；后端会校验该路径必须存在且是目录，然后写入：

```text
data/config.local.json
```

配置字段：

```json
{
  "projects": {
    "favorites": ["C:\\workspace\\codex_web"]
  }
}
```

调试接口：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/projects/favorites
```

Settings / Diagnostics 里也有 `Project favorites`，可查看、添加和移除 Web 本地收藏项目。点击项目行会筛选该项目下的会话，并把新建会话的默认 cwd 切到该项目目录。第一版不做完整项目管理器，只做官方项目补充、本地收藏入口和轻量项目过滤。

## 只读文件浏览

会话主区的 `Files` 区块会展示当前会话所属项目的只读文件列表。第一版只列目录和文件元数据，不读取文件内容、不编辑文件、不上传到官方端。

调试接口：

```powershell
$root = "C:\workspace\codex_web"
$query = [System.Web.HttpUtility]::ParseQueryString("")
$query["root"] = $root
Invoke-RestMethod -Uri ("http://127.0.0.1:18930/api/files/list?" + $query.ToString()) | ConvertTo-Json -Depth 8
```

安全边界：

- `root` 必须是默认项目根、官方项目路径或 Web 收藏项目路径。
- `path` 只能是该 `root` 下的相对目录。
- 后端会校验目标路径仍在项目根内部，拒绝 `..` 逃逸路径和不存在的目录。
- 响应最多返回受限数量的目录项，目录优先、文件其次排序。

## 普通日志

后端普通 Fastify JSON 日志写入：

```text
data/logs/server.log
```

该文件记录 HTTP 请求、启动状态和应用普通日志。协议原始帧不写入该普通日志；官方 IPC 原始帧摘要仍需要在设置/诊断面板里手动开启。

## 诊断导出

设置/诊断面板的 `Copy` 会复制 `/api/diagnostics/export` 返回的脱敏 JSON。该导出用于排查启动、IPC、app-server、缓存和最近诊断事件问题。

命令行导出：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/diagnostics/export | ConvertTo-Json -Depth 12
```

安全边界：

- 不包含 LAN 密码 hash、session secret、cookie、session token hash。
- 不包含官方账号邮箱。
- 不包含 raw IPC frame payload、conversationState 或 thread 消息正文。
- 不包含附件文件内容。
- `app.logPath` 会指向普通日志文件路径，便于排查时定位。

## app-server 状态检查

后端启动后会主动 warm up 官方 `codex app-server`。状态检查：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/app-server/status
```

期望：

- `running: true`
- `initialized: true`
- `lastError: null`
- 普通官方 WARN 应出现在 `lastWarning`，不应占用 `lastError`

如果启动早期还在 warmup，短时间内可能看到 `initialized: false`；几秒后重试即可。失败会写入设置/诊断面板和 `data/logs/server.log`。

## 归档与恢复

当前删除语义按官方 Desktop 的归档处理，不做硬删除。归档列表：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/domain/threads?limit=20&archived=true" | ConvertTo-Json -Depth 8
```

恢复归档会话：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18930/api/domain/thread-unarchive -ContentType application/json -Body '{"threadId":"<thread-id>"}'
```

owner 边界：

- Web-owned thread 归档成功后会释放 Web owner 和本地 cached stream state。
- 明确 external-owned 的 rename/archive/unarchive 当前会返回 `official-owner-action-required:*` / 409，不走本地 app-server mutation，避免和 Desktop/VS Code 的官方 live cache 分叉。
- external-owned 空 official snapshot 的 thread detail 只允许只读 hydrate，不写入 `thread_details` cache。

Web 侧边栏会展示一小段归档列表；点击归档项会恢复并打开该会话。

## 官方账号与兼容状态

Web 只读展示官方账号状态，不实现登录、退出或升级操作：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/account/status | ConvertTo-Json -Depth 10
```

该接口整合：

- `account/read`
- `account/rateLimits/read`
- `configRequirements/read`

设置/诊断面板会展示账号类型、计划、rate limit 摘要和配置要求 JSON。注意不要把邮箱、账号状态等私人信息复制到公开日志或 issue。

## 运行时模型与协作模式

Composer 的模型、协作模式和推理强度来自官方 app-server：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/runtime-options | ConvertTo-Json -Depth 10
```

期望：

- `source.models: "app-server"`
- `source.collaborationModes: "app-server"`
- `models` 中只包含非 hidden 模型。
- `collaborationModes` 至少包含 Default/Plan 或官方当前返回的等价模式。

发送规则：

- Default 模式不发送 `collaborationMode` 字段。
- Plan 模式发送 `collaborationMode: { mode: "plan", settings: { model, reasoning_effort, developer_instructions } }`。
- 如果官方 Plan mode 的 `model` 是 `null`，Web 会用 Composer 当前选择的模型补齐。

## Skills 列表与发送

Composer 的 Skills 菜单来自官方 app-server：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/skills | ConvertTo-Json -Depth 10
```

按项目 cwd 查询：

```powershell
$uri = 'http://127.0.0.1:18930/api/skills?cwd=' + [uri]::EscapeDataString('C:\workspace\codex_web')
Invoke-RestMethod -Uri $uri | ConvertTo-Json -Depth 10
```

发送规则：

- Web 只展示 enabled Skills。
- 选中的 Skill 会作为 `{ type: "skill", name, path }` 追加到 `turn/start` 或 `turn/steer` 的 `input` 数组。
- 当前只做选择和发送；安装、启停、远程同步和 `skills/config/write` 后续再补。

## Active turn 引导

当当前会话存在 active turn 时，Composer 会出现两个发送模式：

- `引导当前`：调用 `/api/domain/turn-steer`，后端优先通过官方 IPC `thread-follower-steer-turn` 转发给当前 owner。
- `排队下一条`：仍调用 `/api/domain/turn-start`，由官方 owner 或 Web app-server 决定是否排队/启动。

`turn-steer` 必须带 `expectedTurnId`，后端会用当前 Web domain detail 中的 active turn id 作为预条件。引导当前 turn 支持后端已管理的 `attachmentIds`；小图片会以内联 image input/restoreMessage 传给官方 owner，普通文件仍保留受控附件引用，发送成功后关联到当前 thread。

如果官方 owner 不可用、IPC 未连接或当前会话没有明确 Web-owned 标记，Web 会拒绝本地 app-server fallback，返回 409/503，并在 diagnostics 里记录 `official-follower-fallback-denied`。这是为了优先避免三端分叉；后续如果要做“手动接管 owner”，应作为显式用户操作实现。

## 实时刷新抗竞态

前端 WebSocket 收到 `official.threadStreamStateChanged` 后会记录每个 thread 的最新 `cacheVersion`。如果后续收到同一 thread 的旧版本事件，Web 会保留事件日志但不触发 thread list/detail 刷新。

Thread detail 拉取也有 request id 保护：用户切换会话或新的 realtime 事件触发了更新后，较早请求的迟到响应不会覆盖当前详情，也不会清掉最新请求的 loading 状态。这部分逻辑由 `apps/web/src/app/realtimeState.test.ts` 和 `apps/web/src/app/threadDetailRequests.test.ts` 覆盖。

## 审批卡片

Web 后端会接住 app-server 发来的审批请求：

```text
item/commandExecution/requestApproval
item/fileChange/requestApproval
```

前端会在当前会话中渲染审批卡片，可执行：

- 批准
- 本轮批准（仅命令类且官方提供 execpolicy amendment 时显示）
- 拒绝
- 拒绝并停止

卡片会尽量展示官方请求里的上下文：

- 命令、cwd、grant root 和 proposed execpolicy amendment。
- 文件变更的目标文件、变更文件列表、diff/patch。
- diff 支持复制和展开/折叠；提交决策时按钮会进入处理中状态，避免重复点击。

调试接口：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/approvals
```

## 消息块交互

命令输出、文件 diff、tool output、错误详情和未知 raw item 支持：

- 复制当前块内容。
- 展开/折叠长内容。
- 保持终端/diff 的横向滚动，不自动折行破坏对齐。

Reasoning 块默认遵循 domain 的折叠状态，可在消息块内展开查看。第一版 diff 仍是简化原始 diff 展示，后续再向 Desktop 的完整 patch 视觉靠近。

## SQLite 缓存状态检查

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/cache/status
```

默认数据库：

```text
data/codex_web.sqlite
```

## 附件上传

Composer 支持文件选择、拖拽和粘贴上传。后端会先把文件持久化到：

```text
data/attachments/<yyyy-mm>/
```

并把元数据写入 SQLite 的 `attachments` 表。当前单文件上传限制为 50 MB。

调试接口：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/attachments?threadId=<thread-id>"
```

存储占用：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/attachments/storage
```

清理未关联附件：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18930/api/attachments/cleanup -ContentType application/json -Body '{}'
```

内容预览/下载接口：

```text
GET /api/attachments/<attachment-id>/content
```

内容接口和清理接口都只允许操作 `data/attachments/` 下的持久化文件。发送消息前，后端会拒绝不存在的 attachment id 和已经绑定到其他 thread 的附件；发送成功后，原本孤立的附件会关联到当前 thread。清理接口只会删除 `thread_id`、`turn_id` 和 `official_reference_id` 都为空的孤立附件；已关联附件默认永久保留，便于后续在 Desktop/扩展/Web 中复看。Composer 会对图片附件显示缩略图，普通附件显示可打开链接。

注意：附件发送到官方 app-server 的参数已经贯通，`turn-start` 和 `turn-steer` 都只接受后端已管理和校验归属的 `attachmentIds`；小图片会补充为官方可见的 image input。官方对普通文件的最终持久引用格式仍需要在后续真实 turn 里继续验证。

如果 `lastError` 指向 WindowsApps 中的 `codex.exe` 权限问题，优先阅读：

```text
docs/pitfalls/2026-05-29_windowsapps-codex-denied.md
```

## 进一步说明

- 当前实现进展、端口、路径、官方 IPC/app-server 机制和已知限制：`docs/implementation_status.md`
- 官方 IPC 协议研究：`documentation/protocol/official_codex_ipc_sync.md`
- 注意：协议研究文档中的 `18923` 是早期验证项目示例端口，当前项目默认使用 `18930/18931`。

## 清理规则

默认可清理：

- `node_modules/`
- `apps/*/dist/`
- `packages/*/dist/`
- `data/logs/`
- `data/tmp/`

不要随意删除：

- `data/*.sqlite`
- `data/attachments/`

附件和数据库可能影响后续复看和诊断。
