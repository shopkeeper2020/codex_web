# 三端同步验收清单

更新时间：2026-05-31

本文用于人工验收官方 Codex Desktop、官方 VS Code Codex 扩展和 `codex_web` 的实时同步。所有测试都应使用不含敏感信息的测试项目、测试 thread 和唯一 marker。

## 1. 验收原则

通过标准：

- 三端看到的是同一条 thread、同一条用户消息、同一段 assistant stream。
- 同一个 marker 在 Web domain detail 中只出现一次。
- Web 发送 official-owned thread 时，后端返回 `mode: official-follower`，IPC diagnostics 中出现 follower success。
- stop、steer、approval 等操作在三端最终一致；rename/archive/unarchive 第一版只要求 Web-owned 操作一致，official-owned 操作在 Web 上明确拒绝或被动收敛，不允许静默本地分叉。
- 追求目标状态来自官方 Desktop/app-server thread goal：Web 的编辑、暂停/恢复、清除和展开/收起只能作用于同一 thread 的真实 goal，不得把 plan/progress 步骤或 Composer 可选 Plan 模式误当成目标。
- owner 不可达、IPC 断开或协议不兼容时，Web 明确失败并暴露诊断，不静默本地分叉。

失败标准：

- 同一条消息出现重复 turn。
- Web 消息只在 Desktop/VS Code 重启后出现，不能实时显示。
- Web 在 official-owned thread 上绕过 follower，直接本地 `turn/start`。
- Desktop/VS Code/Web 任一端看到不同标题、不同归档状态或不同 active turn，且无法通过后续官方 snapshot 收敛。
- 诊断包、截图或记录中包含真实私密会话正文、文件内容、密码、token、secret、邮箱或 raw protocol payload。

## 2. 准备

### 2.1 启动前确认

需要同时打开：

- 官方 Codex Desktop。
- VS Code 中的官方 Codex 扩展。
- `codex_web` 后端与 Web UI。

推荐使用生产静态路径验收：

```powershell
pnpm build
pnpm start
```

开发态也可验收：

```powershell
pnpm dev
```

默认地址：

```text
Web UI：http://127.0.0.1:18930/
前端开发：http://127.0.0.1:18931/
设置页：http://127.0.0.1:18930/settings
隐藏调试页：http://127.0.0.1:18930/debug
```

### 2.2 选择测试对象

选择一个不含敏感内容的测试项目和测试 thread。marker 推荐格式：

```text
codex_web sync acceptance <case-id> <yyyyMMdd-HHmmss>
```

不要使用真实密码、token、客户数据、私密文件内容或生产 thread。

### 2.3 状态检查命令

后端健康：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/health
```

协议兼容性：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/protocol/compatibility | ConvertTo-Json -Depth 8
```

期望：

- `summary.state` 为 `compatible`，或可解释的 `warning`。
- 官方 IPC 已连接。
- app-server 已初始化或正在 warmup 后可恢复。

官方 IPC：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/official-ipc/status | ConvertTo-Json -Depth 10
```

期望：

- `data.supported: true`
- `data.connected: true`
- `data.clientId` 非空
- `data.pipePath: "\\\\.\\pipe\\codex-ipc"`

app-server：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/app-server/status | ConvertTo-Json -Depth 8
```

期望：

- `running: true`
- `initialized: true`
- `lastError: null`

同步 readiness：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/sync/readiness | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/sync/readiness?threadId=<thread-id>" | ConvertTo-Json -Depth 12
```

期望：

- `checks` 中 `official-ipc`、`app-server`、`required-follower-handlers` 为 `pass`。
- `followerHandlers.missingRequired` 为空。
- 可选 follower handler 缺失时显示 `warn`，不阻断 start/steer/interrupt/compact/model/collaboration 验收；当前缺失项应集中在 edit-last-user-turn。
- 带 `threadId` 时，如果三端已经打开该 thread，`thread.hasOfficialStreamState` 应尽量为 `true`；`thread.ownerClientId`、`thread.isWebOwned`、`thread.isExternallyOwned` 和最近 handoff 记录应能解释当前 owner 来源。

脱敏诊断导出：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/diagnostics/export | ConvertTo-Json -Depth 12
```

确认导出不包含会话正文、文件内容、附件二进制、密码、token、secret、邮箱或 raw protocol payload。

### 2.4 同步验收助手

`pnpm sync:doctor` 是命令行验收助手，默认只诊断，不会写入 thread，也不会控制 active turn：

```powershell
pnpm build
pnpm sync:doctor -- --thread <thread-id>
pnpm sync:doctor -- --thread <thread-id> --report data\tmp\sync-report-S00.json
```

准备好无敏感测试 thread 后，显式加 `--send` 才会发送 marker：

```powershell
pnpm sync:doctor -- --thread <thread-id> --send --text "codex_web sync doctor $(Get-Date -Format o)"
```

active turn 期间，也可以显式验收 steer 和 interrupt；未传 `--turn` 时会使用 sync readiness 里的 `activeTurnId`：

```powershell
pnpm sync:doctor -- --thread <thread-id> --steer --text "codex_web sync steer $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <thread-id> --interrupt
```

需要留存验收证据时，在任意 `sync:doctor` 命令后追加 `--report <path>`。相对路径按仓库根目录解析，推荐写入 `data/tmp/`，例如：

```powershell
pnpm sync:doctor -- --thread <thread-id> --send --text "<marker>" --report data\tmp\sync-report-S03.json
```

附件验收也可以让 CLI 先上传一个本地测试文件，再把生成的 `attachmentIds` 放进同一次 Web follower 发送。只在无敏感测试文件上使用：

```powershell
pnpm sync:doctor -- --thread <thread-id> --send --text "<marker>" --attachment "<path-to-test-file>" --report data\tmp\sync-report-S11-attachment.json
```

report 只保存 compatibility、sync readiness、recent follower/handoff、marker count、附件数量/字节数等脱敏摘要，不保存 thread 正文、附件内容、附件 id、raw protocol payload、密码、token、secret 或邮箱。即使运行 `--send` 或 `--steer`，report 也会移除 marker/guidance 正文，仅保留 `markerRedacted: true` 和出现次数；终端输出与 `--json` 仍会显示 marker，方便现场人工观察。

它会自动检查：

- `/health`
- `/api/protocol/compatibility`
- `/api/sync/readiness?threadId=<thread-id>`
- `/api/domain/turn-start` 的 `mode`
- `/api/domain/turn-steer` 或 `/api/domain/turn-interrupt` 的 `mode`（仅显式 `--steer` / `--interrupt`）
- `/api/official-ipc/status` 中最近对应 `thread-follower-* success`
- `/api/domain/thread-detail` 中 marker 是否只出现一次
- `--report` 指定时，写出可复盘 JSON 证据包

输出为 `PASS` 只代表 Web 侧 follower 路径、诊断状态和唯一性通过；Desktop 与 VS Code 是否实时可见仍必须按下面矩阵人工观察。

## 3. 三端同步验收矩阵

记录建议：

- `Pass`：三端实时一致，诊断符合期望。
- `Fail`：出现重复、分叉、不可恢复不同步或敏感信息泄露。
- `Blocked`：官方端、账号、网络或协议状态导致无法执行。

| ID  | 场景                             | 操作端                  | 观察端                          | 关键步骤                                         | 期望诊断/结果                                                                                     |
| --- | -------------------------------- | ----------------------- | ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| S01 | Desktop 发起 official-owned turn | Desktop                 | VS Code + Web                   | 三端打开同一 thread，Desktop 发送 marker         | Web 实时显示同一消息和 stream，无重复                                                             |
| S02 | VS Code 发起 official-owned turn | VS Code                 | Desktop + Web                   | 三端打开同一 thread，VS Code 发送 marker         | Web 实时显示同一消息和 stream，无重复                                                             |
| S03 | Web 发送到 Desktop-owned thread  | Web                     | Desktop + VS Code               | Desktop 打开 thread 后 Web 发送 marker           | `/api/domain/turn-start` 返回 `official-follower`，`recentFollowerRequests` success，三端实时显示 |
| S04 | Web 发送到 VS Code-owned thread  | Web                     | Desktop + VS Code               | VS Code 打开 thread 后 Web 发送 marker           | discovery 或 target owner 成功，三端实时显示                                                      |
| S05 | Web active turn steer            | Web                     | Desktop + VS Code               | 在 active turn 中选择“引导当前”，发送补充指令    | `thread-follower-steer-turn` success，owner 继续同一 active turn                                  |
| S06 | Web interrupt/stop               | Web                     | Desktop + VS Code               | active turn 中点击停止                           | `thread-follower-interrupt-turn` success，三端均停止同一 turn                                     |
| S07 | Desktop interrupt，Web 观察      | Desktop                 | VS Code + Web                   | Desktop 停止 active turn                         | Web active 状态消失或显示最终停止状态                                                             |
| S08 | VS Code interrupt，Web 观察      | VS Code                 | Desktop + Web                   | VS Code 停止 active turn                         | Web active 状态消失或显示最终停止状态                                                             |
| S09 | 命令审批                         | Web                     | Desktop + VS Code               | 触发 command approval，在 Web 批准/拒绝          | owner 收到 decision，三端结果一致，按钮防重复                                                     |
| S10 | 文件变更审批                     | Web                     | Desktop + VS Code               | 触发 file change approval，在 Web 批准/拒绝      | diff/文件列表可读，decision 后三端状态一致                                                        |
| S11 | Web 图片附件                     | Web                     | Desktop + VS Code               | 上传图片并发送 marker                            | 发送成功，三端可复看或有明确降级；不泄露敏感路径                                                  |
| S12 | Web 普通文件附件                 | Web                     | Desktop + VS Code               | 上传无敏感内容的小文件并发送 marker              | 发送成功，附件引用可解释；孤立清理不删已关联附件                                                  |
| S13 | Runtime options                  | Web                     | Desktop + VS Code               | 切换模型、reasoning、Default/Plan、Skills 后发送 | 实际 turn 参数被 owner 接受；若官方覆盖，Web 显示最终状态                                         |
| S14 | Web-owned 重命名 thread          | Web                     | Desktop + VS Code               | 修改 Web-owned 测试 thread 标题                  | 三端最终标题一致；official-owned thread 在 Web 上明确拒绝，不本地分叉                             |
| S15 | Web-owned 归档/恢复              | Web                     | Desktop + VS Code               | 归档 Web-owned 测试 thread，再恢复打开           | 不 hard delete；三端列表最终一致；official-owned thread 在 Web 上明确拒绝或等待官方状态被动收敛   |
| S16 | Web 新建 thread                  | Web                     | Desktop + VS Code               | 在测试项目中新建 thread 并发送 marker            | Web-owned 或官方 owner 路径明确；三端可见，无分叉                                                 |
| S17 | Web-owned handoff                | Desktop 或 VS Code      | Web                             | Web-owned thread 后官方端继续/广播               | Web 记录 handoff 并释放本地 owner，后续不误判                                                     |
| S18 | owner 不可达安全                 | Web                     | Web diagnostics                 | 关闭/移走 owner 后在 official-known thread 发送  | 返回 409/503 或明确错误，不本地分叉                                                               |
| S19 | IPC 断开安全                     | Web                     | Web diagnostics                 | 官方 IPC 不可用时尝试 official-known thread 发送 | 显示 offline/error，不静默 `turn/start`                                                           |
| S20 | 后端重启恢复                     | Web + Desktop + VS Code | 三端                            | active 或 idle 后重启 Web 后端并刷新 Web         | 状态可恢复；不产生重复发送                                                                        |
| S21 | Web 多浏览器                     | Web A                   | Web B + Desktop + VS Code       | 两个 Web 客户端打开同一 thread，Web A 发送       | Web B 实时更新，官方两端一致                                                                      |
| S22 | 移动端发送                       | Mobile Web              | Desktop + VS Code + Desktop Web | 手机浏览器登录后发送 marker                      | 移动端无横向溢出，三端实时显示                                                                    |
| S23 | 搜索打开归档结果                 | Web                     | Desktop + VS Code               | 搜索归档 thread，点击恢复并打开                  | 恢复后 thread 可同步，列表状态一致                                                                |
| S24 | debug/diagnostics 可读           | Web                     | 验收记录                        | 打开 `/settings` Diagnostics 和 `/debug`         | compatibility、sync readiness、IPC、app-server、method map、导出信息可定位问题且脱敏              |
| S25 | 追求目标状态同步                 | Web                     | Desktop + VS Code               | 在已有 goal 的 thread 上编辑、暂停/恢复、清除目标 | Web 调用 `thread/goal/*`，Desktop/Web 展示同一目标状态；plan/progress 与 Composer Plan 模式不混淆 |

## 4. 详细人工步骤

### 4.1 基础实时观察

1. 在 Desktop、VS Code、Web 同时打开同一条测试 thread。
2. 从 Desktop 发送 `S01` marker。
3. 确认 VS Code 和 Web 不刷新页面也能看到同一条用户消息和 assistant stream。
4. 从 VS Code 发送 `S02` marker。
5. 确认 Desktop 和 Web 实时显示。
6. 在 Web 打开同一 thread detail，确认两个 marker 各只出现一次。

### 4.2 Web follower 发送

1. 保持 Desktop 或 VS Code 打开目标 thread。
2. 在 Web 发送 `S03` 或 `S04` marker，或运行 `pnpm sync:doctor -- --thread <thread-id> --send --text "<marker>"`。
3. 检查返回路径：Web UI 成功发送，Desktop/VS Code 实时显示。
4. 查询 IPC 状态：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/official-ipc/status | ConvertTo-Json -Depth 10
```

5. 在 `recentFollowerRequests` 中确认：

```json
{
  "method": "thread-follower-start-turn",
  "result": "success",
  "handledByClientId": "<owner-client-id>"
}
```

6. 查询 Web detail，确认 marker 只出现一次：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/domain/thread-detail?threadId=<thread-id>" | ConvertTo-Json -Depth 12
```

### 4.3 steer 与 interrupt

1. 让目标 thread 进入 active turn。
2. 在 Web 选择“引导当前”，发送一条无敏感内容的补充指令；或运行 `pnpm sync:doctor -- --thread <thread-id> --steer --text "<guidance>"`。
3. 确认 owner 继续同一个 active turn，而不是开新 turn。
4. 再次进入 active turn 后，在 Web 点击停止；或运行 `pnpm sync:doctor -- --thread <thread-id> --interrupt`。
5. 确认 Desktop、VS Code、Web 都停止同一个 turn。
6. 分别从 Desktop 和 VS Code 停止一次，确认 Web active 状态收敛。

### 4.4 追求目标状态

1. 选择一个 Desktop 已经进入追求目标状态的测试 thread，或在 Desktop 中先创建一个无敏感内容的测试目标。
2. 在 Web 打开同一 thread，确认 Composer 上方显示“进行中的目标/已暂停的目标”和目标正文；右侧 pinned summary 的“进度”仍只展示 plan/progress，不替代目标状态。
3. 在 Web 点击“编辑目标”，保存新的无敏感目标文本。
4. 查询 Web detail，确认 `goal.objective` 已更新：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18930/api/domain/thread-detail?threadId=<thread-id>" | ConvertTo-Json -Depth 12
```

5. 在 Desktop/VS Code 观察同一 thread 的目标状态是否同步更新。
6. 在 Web 依次点击“暂停目标”和“恢复目标”，确认 `goal.status` 在 `paused` / `active` 之间切换，Desktop/VS Code 最终一致。
7. 在 Web 点击“清除目标”，确认 Web 不再显示目标条，Desktop/VS Code 不再显示该目标。
8. “显示/隐藏完整目标”只改变 Web 本地展开状态，不应修改 thread goal。

### 4.5 审批

当前后端单测已覆盖 Web-owned app-server approval request 的 pending 列表、requested/resolved realtime event、decision response shape、重复决策保护和 rejectAll cancel 行为；这里仍然是三端人工验收项，重点确认 official-owned owner 是否收到 Web decision。

1. 在测试项目中触发需要 command approval 的安全命令。
2. 在 Web 审批卡片检查 command、cwd、grant root 等信息是否脱敏且可读。
3. 分别验收批准、拒绝、拒绝并停止。
4. 如有 file change approval，检查目标文件、变更文件列表、diff/patch 展开和复制。
5. 确认 decision 后三端 active 状态和消息状态一致。

### 4.6 附件

1. 准备无敏感内容的小图片和小文本文件。
2. 在 Web 通过按钮、粘贴或拖拽上传。
3. 发送带 marker 的消息。
4. 确认 Web 附件预览/下载可用。
5. 确认 Desktop/VS Code 显示行为符合官方能力；如果官方端不能复看，记录为明确降级而不是静默丢失。
6. 执行孤立附件清理时，确认已关联附件不被删除。

### 4.7 重命名、归档和恢复

1. 在 Web 重命名 Web-owned 测试 thread。
2. 观察 Desktop、VS Code、Web 标题最终一致。
3. 对 official-owned 测试 thread 尝试 Web 重命名，应看到明确拒绝提示，不应产生本地伪成功。
4. 在 Web 归档 Web-owned 测试 thread。
5. 确认不 hard delete，归档列表可见。
6. 从 Web 恢复并打开，确认三端列表最终一致。
7. 对 official-owned 测试 thread 尝试 Web 归档/恢复，应看到明确拒绝提示；如果在官方端执行归档/恢复，Web 应最终刷新或在当前版本记录为被动同步缺口。

### 4.8 Web-owned 与 handoff

1. 在 Web 新建测试 thread 并发送 marker。
2. 确认 Desktop/VS Code 可见该 thread 或能通过官方列表/同步路径跟随。
3. 从 Desktop 或 VS Code 继续该 thread。
4. 查询 `/api/official-ipc/status`，确认 `recentOwnershipHandoffs` 有对应记录。
5. 后续从 Web 继续发送时，不应误以为自己仍是 owner 而造成分叉。

### 4.9 移动端

1. 用手机或移动视口访问 `http://<电脑局域网IP>:18930/`。
2. 使用 LAN 密码登录。
3. 打开导航抽屉，选择项目和测试 thread。
4. 发送 mobile marker。
5. 确认 Desktop、VS Code、桌面 Web 实时显示。
6. 检查 Composer、模型、模式、Skills、推理强度、停止、搜索、更多操作菜单没有横向溢出。

## 5. 可选自动烟测

真实同步烟测默认跳过，只有设置真实 thread id 后才会发送消息：

```powershell
$env:LIVE_SYNC_THREAD_ID = "<真实 thread id>"
$env:LIVE_SYNC_TEXT = "codex_web live sync smoke $(Get-Date -Format o)"
pnpm test:e2e -- --grep "live sync smoke"
Remove-Item Env:\LIVE_SYNC_THREAD_ID
Remove-Item Env:\LIVE_SYNC_TEXT
```

该测试覆盖 Web 侧自动检查：

- `/api/protocol/compatibility` 中官方 IPC 已连接、app-server 已初始化。
- `/api/domain/turn-start` 返回 `mode: official-follower`。
- `/api/official-ipc/status` 的 `recentFollowerRequests` 出现当前 thread 的 `thread-follower-start-turn success`。
- `/api/domain/thread-detail` 中本次 marker 恰好出现一次。

它不能替代 Desktop 和 VS Code 的人工实时观察。

active turn 路径也有 opt-in 烟测：

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

未设置 `LIVE_SYNC_STEER_TEXT` 或 `LIVE_SYNC_INTERRUPT=1` 时，这两条测试会跳过，避免误引导或误停止真实任务。必要时可设置 `LIVE_SYNC_TURN_ID` 指定 active turn；否则测试会从 `/api/sync/readiness?threadId=<id>` 读取 `activeTurnId`。

附件路径有 opt-in 烟测，会上传一个无敏感内容的小文本附件并通过 follower 发送：

```powershell
$env:LIVE_SYNC_THREAD_ID = "<真实 thread id>"
$env:LIVE_SYNC_ATTACHMENT = "1"
$env:LIVE_SYNC_ATTACHMENT_TEXT = "codex_web live attachment $(Get-Date -Format o)"
pnpm test:e2e -- --grep "sends an uploaded attachment"
Remove-Item Env:\LIVE_SYNC_ATTACHMENT
Remove-Item Env:\LIVE_SYNC_ATTACHMENT_TEXT
Remove-Item Env:\LIVE_SYNC_THREAD_ID
```

该测试会确认 Web 本地附件保存和内容读取可用、turn-start 返回预期 mode、最近 `thread-follower-start-turn success` 出现、Web detail 中 marker 只出现一次。官方 Desktop/VS Code 是否能复看附件仍按 S11/S12 人工观察。

CLI 版同步验收助手适合人工验收现场反复运行：

```powershell
pnpm sync:doctor -- --thread <真实 thread id>
pnpm sync:doctor -- --thread <真实 thread id> --send --text "codex_web sync doctor $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <真实 thread id> --send --text "codex_web sync attachment $(Get-Date -Format o)" --attachment "<无敏感测试文件路径>" --report data\tmp\sync-report-S11-attachment.json
pnpm sync:doctor -- --thread <真实 thread id> --steer --text "codex_web sync steer $(Get-Date -Format o)"
pnpm sync:doctor -- --thread <真实 thread id> --interrupt
pnpm sync:doctor -- --thread <真实 thread id> --send --text "codex_web sync report $(Get-Date -Format o)" --report data\tmp\sync-report-S03.json
```

不传 `--send`、`--steer` 或 `--interrupt` 时只做状态检查；传对应 flag 才会写入 marker、引导 active turn 或停止 active turn。`--attachment` 只能和 `--send` 一起使用，用于 S11/S12 的现场观察，不能替代 Desktop/VS Code 是否可复看的人工确认。

## 6. 验收记录模板

```text
日期：
验收人：
codex_web 版本/分支：
官方 Desktop 版本：
VS Code Codex 扩展版本：
测试项目：
测试 thread：
marker 前缀：

状态检查：
- protocol compatibility：
- sync readiness：
- official IPC：
- app-server：

矩阵结果：
- S01：
- S02：
- S03：
- S04：
- S05：
- S06：
- S07：
- S08：
- S09：
- S10：
- S11：
- S12：
- S13：
- S14：
- S15：
- S16：
- S17：
- S18：
- S19：
- S20：
- S21：
- S22：
- S23：
- S24：

遗留问题：
-

脱敏证据：
- 截图：
- sync doctor report：
- diagnostics export：
- recentFollowerRequests 摘要：
```

验收记录不得包含真实私密会话正文、文件内容、密码、token、secret、邮箱或 raw protocol payload。
