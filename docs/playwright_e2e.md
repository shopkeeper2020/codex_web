# Playwright 视觉与冒烟测试

第一版 Playwright 覆盖 Web shell 的启动冒烟、移动端日常流和人工视觉回归截图入口。

默认访问地址：

```text
http://127.0.0.1:18930/
```

也可以通过环境变量覆盖：

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:18931"
pnpm test:e2e
```

## 运行

先启动目标服务，例如生产后端静态服务：

```powershell
pnpm build
pnpm dev:server
```

默认 `PLAYWRIGHT_BASE_URL` 指向 `18930` 生产后端，因此前端源码改动后要先重新 `pnpm build`。否则测试会命中旧的 `apps/web/dist` 静态包，看起来像页面没有更新。

或开发前端：

```powershell
pnpm dev
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:18931"
pnpm test:e2e
```

执行测试：

```powershell
pnpm test:e2e
```

Playwright 已固定为 `workers: 1`。这些 E2E 直接打同一个本机 `codex_web` 服务、官方 IPC 和 app-server，不是纯前端 mock；并发 workers 会共享真实 thread、缓存和页面加载状态，容易出现 Settings tab 稳定性等待或移动端瞬时横向溢出的假失败。

当前项目包含两组视口：

- `desktop-chromium`: `1920 x 1019`
- `mobile-chromium`: `390 x 844`

移动端真实任务流回归集中在 `tests/e2e/mobile-experience.spec.ts`。该 spec 会在 `desktop-chromium` 自动 skip，只在 `mobile-chromium` 下执行；覆盖移动抽屉开关、Header 搜索、更多操作进入 Settings、Composer 附件/Skills 入口可点击，以及 `390px` 视口下同步/运行折叠面板无横向溢出。

横向溢出断言统一使用 `tests/e2e/helpers/layout.ts`。该 helper 在浏览器内等待 `document/body scrollWidth <= window.innerWidth + 1`，失败时会输出当前 URL、document/body 宽度和疑似撑宽元素，避免真实长线程 + trace 快照把 `expect.poll` 拖成不可定位的假失败。相关踩坑记录见 `docs/pitfalls/2026-05-29_playwright-trace-long-thread-overflow-poll.md`。

测试会检查：

- `#root` 已渲染出应用根节点
- `main` 和 Composer 输入框可见
- 桌面端检查 `codex_web`、Search、Settings 等可见入口；UI baseline 还会检查右侧运行栏默认可见，并确认 Composer 不会压到右侧栏
- 移动端检查“打开导航”按钮可见
- 移动端检查 Header 的搜索直达、更多操作菜单、抽屉项目选择、Composer 的模型、协作模式、Skills、推理强度、发送按钮和运行状态折叠面板在 `390px` 视口内可见可点，且打开菜单/折叠面板后没有页面横向溢出
- 设置直达 `/settings` 会检查 General、Projects、Security、Network、Appearance、Diagnostics tab，其中 General 需要显示 `Storage cleanup`，Diagnostics 需要显示 `Diagnostics controls`、`Realtime events`、`Protocol compatibility`、`Sync readiness` 和 `Follower method capabilities`
- 隐藏 `/debug` 会检查 Debug 标题、Compatibility 卡片、compatibility 状态 badge、`Protocol compatibility` JSON、`Diagnostics export`、`IPC methods` 和 registered follower handler 摘要
- 每组 viewport 生成一张 app shell 截图，输出到 `test-results/e2e/`
- `tests/e2e/ui-fidelity-baseline.spec.ts` 会用固定文件名生成首批 UI 高保真截图矩阵，包含 LAN login gate、thread sync loading、empty thread list、shell、复杂消息块、active turn Composer stop/steer/queue、approval card pending/expanded、Search、Settings General、Settings Diagnostics、Debug；移动端额外包含 drawer、empty drawer 和 Skills 菜单。

单独生成 UI 高保真截图矩阵：

```powershell
pnpm test:e2e -- tests/e2e/ui-fidelity-baseline.spec.ts
```

截图会出现在 Playwright 输出目录下的 `ui-fidelity/<project>-<name>.png`，并作为测试附件展示。它们只是“可复现采样”，人工签收后才能成为长期视觉基线。

如果本机还没有 Playwright 浏览器：

```powershell
pnpm exec playwright install chromium
```

当前机器已于 `2026-05-29` 安装 Chromium。最近一次全量 `pnpm test:e2e` 记录见 `docs/implementation_status.md`；本轮运行 `pnpm exec playwright test tests/e2e/ui-fidelity-baseline.spec.ts --project=desktop-chromium --project=mobile-chromium` 结果为 `10 passed`，并生成 `1920 x 1019` 桌面 login-gate/thread-sync-loading/empty-thread-list/shell/message-blocks/active-composer stop/steer/queue/approval-card pending/expanded/search/settings/debug 截图，以及 `390 x 844` 移动端对应截图。跳过项主要是需要显式环境变量启用的真实三端同步 smoke，以及桌面视口下只适用于移动端的布局回归。

使用真实 thread 的移动端 Composer 测试需要注意 active turn 状态可能在初始渲染后才抵达；若要测试附件按钮，应先切到“排队下一条”并等待 `添加附件` 保持 enabled。详见 `docs/pitfalls/2026-05-29_playwright-active-turn-composer-mode.md`。

浏览器安装失败时，不影响代码提交前的静态检查；先确认依赖安装成功，再在可联网环境补装 Chromium 即可。

## 三端实时同步验收

`tests/e2e/live-sync.spec.ts` 是显式开启的真实同步烟测，默认会跳过，避免普通回归测试误发消息或消耗模型额度。

使用方式：

```powershell
$env:LIVE_SYNC_THREAD_ID = "<真实 thread id>"
$env:LIVE_SYNC_TEXT = "codex_web live sync smoke $(Get-Date -Format o)"
pnpm test:e2e -- --grep "live sync smoke"
Remove-Item Env:\LIVE_SYNC_THREAD_ID
Remove-Item Env:\LIVE_SYNC_TEXT
```

该测试只在 `desktop-chromium` 项目里执行一次，会检查：

- `/api/protocol/compatibility` 中官方 IPC 已连接、app-server 已初始化。
- `/api/domain/turn-start` 返回 `mode: official-follower`。
- `/api/official-ipc/status` 的 `recentFollowerRequests` 出现当前 thread 的 `thread-follower-start-turn success`。
- `/api/domain/thread-detail` 中恰好出现一次本次发送的 marker 文本。

active turn 的 steer/interrupt 也有 opt-in 测试：

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

这两条同样只在 `desktop-chromium` 执行。未设置 `LIVE_SYNC_STEER_TEXT` 或 `LIVE_SYNC_INTERRUPT=1` 时会跳过；如果 readiness 读不到 active turn，可设置 `LIVE_SYNC_TURN_ID` 指定 turn。

附件路径也有 opt-in 测试：

```powershell
$env:LIVE_SYNC_THREAD_ID = "<真实 thread id>"
$env:LIVE_SYNC_ATTACHMENT = "1"
$env:LIVE_SYNC_ATTACHMENT_TEXT = "codex_web live attachment $(Get-Date -Format o)"
pnpm test:e2e -- --grep "sends an uploaded attachment"
Remove-Item Env:\LIVE_SYNC_ATTACHMENT
Remove-Item Env:\LIVE_SYNC_ATTACHMENT_TEXT
Remove-Item Env:\LIVE_SYNC_THREAD_ID
```

该测试会上传一个小文本附件，确认 Web 本地附件读取、`attachmentIds` 发送、官方 follower success 和 Web detail marker 唯一。它仍不能证明 Desktop/VS Code 的附件复看体验，需要人工观察。

这仍然只是 Web 侧可自动化的同步闭环。Desktop 和 VS Code 是否实时显示同一条 stream，第一版继续按人工验收清单确认：三端同时打开同一个 thread，在 Web 发送 marker 后观察 Desktop/扩展是否实时出现同一条用户消息和后续输出，且没有重复 turn。

人工验收现场也可以优先使用 CLI 助手：

```powershell
pnpm sync:doctor -- --thread <真实 thread id>
pnpm sync:doctor -- --thread <真实 thread id> --send --text "codex_web sync doctor $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <真实 thread id> --steer --text "codex_web sync steer $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <真实 thread id> --interrupt
```

第一条只诊断，不发送；后面几条才会写入 marker、引导 active turn 或停止 active turn，并检查 Web 侧对应 follower 成功。
