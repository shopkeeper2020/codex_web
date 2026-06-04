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
- 官方客户端交互改造方案：`docs/official_client_interaction_refactor_plan.md`
- 官方客户端 runtime 证据：`documentation/protocol/official_client_runtime_evidence.md`
- 官方优先实现准则：`docs/official_first_implementation.md`
- 踩坑记录：`docs/pitfalls/README.md`

## 协作底线

- 不主动执行 `git add`、`git commit`、`git push`。
- 不把 `codex-mobile` 当成最终架构迁移，只作为协议研究参考。
- 前端不直接依赖官方 raw protocol shape，必须经过 backend/domain 转换。
- owner/follower 只作为协议和诊断概念，不暴露给普通用户。
- 破坏性操作必须走官方可验证路径，不能猜测本地文件结构直接修改。
- 对接或修改 Codex app-server / official IPC / raw RPC 参数、request/notification shape 前，必须先阅读 OpenAI 官方 Codex app-server 文档，并核对官方 `codex-rs/app-server` 源码和 `app-server-protocol` schema；不得凭记忆、旧实现或 Desktop 私有包装字段猜接口。
- 新增或修改功能必须优先按 `docs/official_first_implementation.md` 查找并接入官方接口；官方已有能力不得自行重写。
- 官方已有数据必须优先通过官方接口获取，不写死、不影子存储到本地 SQLite；SQLite 仅用于官方没有覆盖的自定义扩展。
- Web 复刻必须以 Codex Desktop 的实际展现逻辑、交互细节和数据行为为准，避免自行分叉。

## 默认运行配置

- 项目目录：`C:\workspace\codex_web`
- 后端端口：`18930`
- 前端开发端口：`18931`
- 默认监听：`0.0.0.0`
- 默认数据目录：`data/`
- 本机私有配置：`data/config.local.json`，包含端口覆盖、主题、诊断开关、LAN 密码 hash 和 session secret，不能提交。
