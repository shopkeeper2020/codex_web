# codex_web Agent 入口

默认语言：简体中文。

## 项目定位

`codex_web` 是官方 Codex Desktop 的 Web 版高保真复刻项目。核心目标是与官方 Codex Desktop、官方 VS Code Codex 扩展实现三端实时同步。

## 优先阅读

- 产品规格：`docs/product_spec.md`
- MVP 收口看板：`docs/mvp_gap_tracker.md`
- 三端同步验收清单：`docs/sync_acceptance_checklist.md`
- 三端同步排障材料收集：`docs/troubleshooting_sync.md`
- UI 高保真验收基准：`docs/ui_fidelity.md`
- 启动手册：`docs/startup_runbook.md`
- 仓库结构：`docs/repository_overview.md`
- 官方 IPC 研究：`documentation/protocol/official_codex_ipc_sync.md`
- 踩坑记录：`docs/pitfalls/README.md`

## 协作底线

- 不主动执行 `git add`、`git commit`、`git push`。
- 不把 `codex-mobile` 当成最终架构迁移，只作为协议研究参考。
- 前端不直接依赖官方 raw protocol shape，必须经过 backend/domain 转换。
- owner/follower 只作为协议和诊断概念，不暴露给普通用户。
- 破坏性操作必须走官方可验证路径，不能猜测本地文件结构直接修改。

## 默认运行配置

- 项目目录：`C:\workspace\codex_web`
- 后端端口：`18930`
- 前端开发端口：`18931`
- 默认监听：`0.0.0.0`
- 默认数据目录：`data/`
- 本机私有配置：`data/config.local.json`，包含端口覆盖、主题、诊断开关、LAN 密码 hash 和 session secret，不能提交。
