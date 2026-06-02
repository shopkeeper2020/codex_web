# 三端同步排障材料收集

更新时间：2026-06-03

本文用于在 Desktop、VS Code 扩展、`codex_web` 三端实时同步异常时，收集足够定位问题、又不泄露敏感内容的材料。优先搭配 `docs/sync_acceptance_checklist.md` 和 `docs/startup_runbook.md` 使用。

## 适用场景

- Web 发出的消息没有实时出现在 Desktop 或 VS Code。
- Desktop/VS Code 发出的 stream 没有实时出现在 Web。
- Web 显示 owner/IPC/app-server 相关错误，或 Composer 发送后保留原文。
- Desktop、VS Code 或 Web 重启后，同一 thread 的 owner/follower 状态异常。
- 官方 Desktop 或 VS Code Codex 扩展升级后，协议兼容性变成 `warning`、`offline` 或 `error`。

## 收集顺序

1. 确认三端都打开同一个无敏感测试 thread。
2. 在 Web 打开 `Settings / Diagnostics`。
3. 在 `Troubleshooting package` 点击 `Download package`，保存脱敏 JSON；无法下载时点击 `Copy package`。
4. 运行 `sync:doctor` 生成脱敏报告。`--report` 文件会移除 marker/guidance 正文；终端输出和 `--json` 仍会显示 marker，排障材料只保存 report 文件。
5. 截图三端界面，但只截无敏感测试 thread 或打码后截图。
6. 记录失败动作和时间点，例如“Web 发送 marker 后 Desktop 未实时出现”。

## 推荐命令

只做诊断，不发送消息：

```powershell
pnpm sync:doctor -- --thread <thread-id> --report data\tmp\sync-report.json
```

确认目标 thread 无敏感内容后，发送唯一 marker：

```powershell
pnpm sync:doctor -- --thread <thread-id> --send --text "codex_web sync $(Get-Date -Format o)" --report data\tmp\sync-report-send.json
```

active turn 排障：

```powershell
pnpm sync:doctor -- --thread <thread-id> --steer --text "codex_web steer $(Get-Date -Format o)" --report data\tmp\sync-report-steer.json
pnpm sync:doctor -- --thread <thread-id> --interrupt --report data\tmp\sync-report-interrupt.json
```

## 必要材料

- `Troubleshooting package` 导出的 JSON。
- `sync:doctor --report` 生成的 JSON。
- 失败时的 Web 页面截图。
- Desktop/VS Code 同一 thread 的截图或简短观察记录。
- 操作步骤、发生时间、是否刚重启 Desktop/VS Code/Web。

## 不要提交

- 真实会话正文或私密文件内容。
- 附件二进制、图片原图、完整命令输出中的密钥。
- `data/config.local.json`、`data/auth.sessions.json`。
- 明文 LAN 密码、token、cookie、session secret、邮箱。
- 未打码的个人路径、账号截图或私密项目名。

## 判断线索

- `/api/sync/readiness` 的 required follower handler 必须全部为 pass。
- `recentFollowerRequests` 中如果没有 `thread-follower-start-turn success`，优先怀疑 owner discovery、stale client id 或官方 IPC 连接问题。
- app-server warning 不一定阻塞同步；`lastError`、IPC `connected: false` 或 required handler missing 才更可能是阻塞项。
- 如果 Web 发送失败但 Composer 保留文本，这是安全路径；不要改成本地 app-server fallback，否则会制造分叉。
- Web 新建 thread 后如果 Desktop 红屏，先查 Web-owned `thread-stream-state-changed` snapshot 是否缺 Desktop UI 安全字段，而不是先怀疑 raw `thread/start` / `turn/start` 参数。常见危险字段是 `requests`、`turnsPagination`、turn `diff/hookRuns/commandExecutionStartedAtMsById`、`userMessage.clientId`、`agentMessage.phase/memoryCitation`。
- Web 新建 thread 后如果 Desktop 没有立刻在侧栏显示，但官方 `state_5.sqlite` 或 `thread/list` 已经能读到该 thread，优先判断为 Desktop recent-list refresh 问题。外部 owner 的 stream snapshot 只更新 conversation cache，不会自动 `ensureRecentConversationId`。
- Web 新建 thread 的 recent-list refresh 当前依赖 `thread-unarchived` IPC 生命周期广播触发 Desktop `refreshRecentConversations()`；这条广播只应在 Web 新建 thread 且 idle snapshot 成功广播后发送。

## 后续处理

把上述材料交给实现 agent 后，优先检查：

- `documentation/protocol/official_codex_ipc_sync.md`
- `docs/mvp_gap_tracker.md`
- `docs/sync_acceptance_checklist.md`
- `apps/server/src/turnFallback.ts`
- `packages/protocol/src/officialIpc.ts`
- `apps/server/src/syncReadiness.ts`
- `docs/pitfalls/2026-06-03_web-created-thread-desktop-crash-and-slow-sidebar.md`

如果确认是官方协议变化，先更新协议文档和 compatibility/readiness 诊断，再改实现。
