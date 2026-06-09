# Official IPC v7 Migration Plan

日期：2026-06-09
状态：implemented
适用范围：`codex_web` official IPC、app-server settings、三端实时同步链路

## 执行结果

2026-06-09 已按本计划完成首轮代码迁移：

- `packages/protocol` 已切到 `thread-stream-state-changed: 7`，并将 `thread-follower-update-thread-settings: 1` 作为当前 settings follower method。
- `OfficialIpcBridge` 已记录 stream `revision` / `baseRevision`，正确顺序 patch 才会应用；缺 revision、base mismatch、stale patch 都会拒绝并记录 official IPC 诊断。
- `OfficialIpcBridge` 已补齐 Web -> official owner 的 `sendThreadFollowerUpdateThreadSettings()` 出站 helper，发送 frame 使用 `{ conversationId, threadSettings }`。
- Web-owned snapshot 广播已携带递增 `change.revision`，owner release / archive / handoff 会清理本地 revision state。
- official live stream cache 已收敛为纯内存运行态，不再创建、写入或读取 SQLite `official_stream_states`；旧库 legacy 表会在启动派生缓存清理中删除。
- `apps/server` 已删除旧 split settings runtime handler，Web-owned settings 更新统一进入 `thread-follower-update-thread-settings -> thread/settings/update`。
- compatibility/readiness 测试和当前基线文档已同步到 IPC v7。

## 背景

2026-06-09 复查本机官方客户端后确认：

- Codex Desktop：`26.602.9276.0`
- VS Code Codex 扩展：`openai.chatgpt-26.5601.21317-win32-x64`
- 两端当前 IPC method version map 均使用 `thread-stream-state-changed: 7`
- 两端当前 settings follower method 均使用 `thread-follower-update-thread-settings: 1`
- 当前官方 bundle 未命中旧的 `thread-follower-set-model-and-reasoning` 与 `thread-follower-set-collaboration-mode`

当前 `codex_web` 仍以旧基线运行：

- `thread-stream-state-changed: 6`
- settings follower 拆成 model/reasoning 与 collaboration mode 两条旧路径
- stream cache 尚未把 `baseRevision` / `revision` 作为 patch 应用前置条件

本次迁移目标不是做临时兼容层，而是把 `codex_web` 的官方同步基线直接收口到新版 Desktop / VS Code 行为。

## 总目标

将 `codex_web` 的三端同步协议升级到官方 IPC v7：

1. 使用 `thread-stream-state-changed: 7` 作为唯一当前 stream 协议版本。
2. 使用 `thread-follower-update-thread-settings` 作为唯一当前 settings follower 入口。
3. 删除旧 settings follower 主路径，避免继续维护两套语义。
4. stream cache 按 `baseRevision` / `revision` 防止乱序 patch 破坏 live state。
5. Web-owned owner 广播也生成 v7 revision，让 Desktop / VS Code 将 Web stream 视为同一代协议。
6. 保持前端只消费 domain model，不让 Web UI 直接依赖官方 raw protocol shape。

## 非目标

- 不兼容旧版 Desktop / VS Code 的旧 settings follower method。
- 不保留 v6 stream 作为 parallel runtime path。
- 不新增“猜测式 fallback”来吞掉协议错误。
- 不把官方 raw `conversationState` 持久化到 SQLite。
- 不在前端直接处理 `thread-stream-state-changed` raw payload。
- 不借本次迁移重构无关 UI、样式、附件、审批或会话列表逻辑。

## 迁移原则

### 直接切新版基线

所有当前代码、诊断、测试和文档以 `thread-stream-state-changed: 7` 为基线。旧 method 不作为当前能力展示，也不作为 readiness 通过条件。

### 单一 settings 路径

模型、推理强度、协作模式和后续 thread settings 更新统一进入：

```text
thread-follower-update-thread-settings
  -> threadSettings
  -> app-server thread/settings/update
```

不再维护：

```text
thread-follower-set-model-and-reasoning
thread-follower-set-collaboration-mode
```

### revision 是协议边界，不是可选装饰

v7 patch 必须满足：

```text
incoming.baseRevision === local.revision
incoming.revision > local.revision
```

否则不应用 patch。处理策略是记录诊断、触发只读 hydrate 或等待下一份 snapshot，而不是强行套 patch。

### 删除旧分支，避免屎山

同一个行为只能有一个主实现。删除旧方法、旧测试期望、旧文档表述时必须同提交完成，不留下“新旧都懂一点”的半迁移状态。

### 官方 raw shape 只在协议层停留

`packages/protocol` 负责 IPC frame、method version、revision 校验和 raw patch 应用。`apps/server` 负责转 domain。`apps/web` 不接触官方 raw protocol。

## 目标行为

### official-owned thread

- Desktop / VS Code 是 owner 时，Web 接收 v7 snapshot / patches。
- snapshot 更新本地 stream cache revision。
- patch 只有在 `baseRevision` 匹配时应用。
- mismatch 时不覆盖现有 active state，避免把正在流式输出的 UI 回退或套坏。
- Web 发消息、引导、停止仍通过 owner follower request。
- Web 修改下一轮设置时，通过 `thread-follower-update-thread-settings` 发给 owner。

### Web-owned thread

- Web 成为 owner 时，广播 `thread-stream-state-changed` v7。
- Web snapshot 携带递增 `revision`。
- Web patches 如后续实现，也必须携带 `baseRevision` 和 `revision`。
- Desktop / VS Code 对 Web-owned thread 发 settings 更新时，Web 只处理 `thread-follower-update-thread-settings`。
- Web 收到 settings 更新后调用官方 app-server `thread/settings/update`，以 app-server loaded thread settings 作为唯一 next-turn 状态源。

### 协议错误

- 缺 revision 的 patches：拒绝应用，记录 `official-ipc-missing-revision` 类诊断。
- `baseRevision` 不匹配：拒绝应用，记录 `official-ipc-revision-mismatch` 类诊断。
- 没有 snapshot 的 patches：保留现有 hydrate 思路，但 hydrate 只读补基线，不声明 owner，不广播回官方客户端。
- 旧 settings method：不注册、不处理、不在 compatibility 中宣称支持。

## 改动顺序

### Phase 1：协议基线切换

目标：先让 `packages/protocol` 成为新版官方 IPC 的单一事实来源。

改动文件：

- `packages/protocol/src/index.ts`
- `packages/protocol/src/officialIpc.test.ts`
- `apps/server/src/diagnosticsExport.ts` 如有快照期望

具体改动：

1. 将 `IPC_METHOD_VERSIONS["thread-stream-state-changed"]` 从 `6` 改为 `7`。
2. 新增 `IPC_METHOD_VERSIONS["thread-follower-update-thread-settings"] = 1`。
3. 从 `IPC_METHOD_VERSIONS` 删除：
   - `thread-follower-set-model-and-reasoning`
   - `thread-follower-set-collaboration-mode`
4. 让 `OFFICIAL_FOLLOWER_METHODS` 自然只暴露新版 follower set。
5. 更新 method version 单测，测试期望必须与 Desktop / VS Code 26.602 / 26.5601 一致。

验收：

- `IPC_METHOD_VERSIONS` 不再包含旧 settings method。
- 单测明确断言 `thread-stream-state-changed` 为 `7`。
- 单测明确断言 `thread-follower-update-thread-settings` 存在。

### Phase 2：stream revision 状态模型

目标：让 official stream cache 知道当前 revision，并用它保护 patch 应用顺序。

改动文件：

- `packages/protocol/src/index.ts`
- `packages/protocol/src/officialIpc.test.ts`

具体改动：

1. 为 `OfficialThreadStreamState` 增加字段：
   - `revision: number | null`
   - `lastBaseRevision?: number | null`
2. 读取 snapshot：
   - 从 `change.revision` 读取 revision。
   - snapshot 无 revision 时记录诊断并拒绝作为 v7 official baseline，除非这是 Web 内部构造前的测试 helper，需要同步改 helper。
3. 读取 patches：
   - 从 `change.baseRevision` 和 `change.revision` 读取数字。
   - 无 existing snapshot 时沿用 `patches-without-snapshot` 只读 hydrate。
   - existing 有 revision 且 `baseRevision !== existing.revision` 时拒绝应用。
   - `revision <= existing.revision` 时视为 stale patch，拒绝应用。
4. 成功应用 patch 后，把 cache revision 更新为 incoming revision。
5. 通知浏览器的 lightweight event 中附带 `revision`，供诊断和幂等使用。

验收：

- 正确顺序 patch 会更新 conversation state 和 revision。
- 乱序 patch 不会修改 conversation state。
- stale patch 不会回退 conversation state。
- patches-without-snapshot 仍只触发 hydrate，不误 claim owner。

### Phase 3：Web-owned v7 广播

目标：Web 作为 owner 时发出的 stream state 也符合 v7。

改动文件：

- `packages/protocol/src/index.ts`
- `apps/server/src/syncCoordinator.ts`
- `packages/protocol/src/officialIpc.test.ts`
- `apps/server/src/syncCoordinator.test.ts`

具体改动：

1. 在 `OfficialIpcBridge` 内维护 Web-owned conversation 的 next revision 计数。
2. `broadcastConversationSnapshot` 构造：

```json
{
  "change": {
    "type": "snapshot",
    "revision": 1,
    "conversationState": {}
  }
}
```

3. 每次 Web-owned snapshot 广播递增 revision。
4. owner handoff、archive、release owner 时清理 revision state。
5. rebroadcast owned snapshot 时使用新的 revision，而不是重复旧 revision。

验收：

- Web-owned snapshot outgoing raw frame 带 version 7 和 `change.revision`。
- 同一 thread 连续广播 revision 单调递增。
- archive / handoff 后不会复用旧 revision。

### Phase 4：settings follower 统一迁移

目标：彻底删除旧 settings follower 主路径，统一到官方新版 method。

改动文件：

- `apps/server/src/syncCoordinator.ts`
- `apps/server/src/syncCoordinator.test.ts`
- `apps/server/src/protocolCompatibility.ts`
- `apps/server/src/protocolCompatibility.test.ts`
- `apps/server/src/syncReadiness.test.ts`

具体改动：

1. 删除 `thread-follower-set-model-and-reasoning` request handler。
2. 删除 `thread-follower-set-collaboration-mode` request handler。
3. 注册 `thread-follower-update-thread-settings` handler。
4. handler 参数只接受新版形状：

```json
{
  "conversationId": "thread-id",
  "threadSettings": {
    "model": "gpt-...",
    "effort": "medium",
    "collaborationMode": {
      "mode": "plan",
      "settings": {}
    }
  }
}
```

5. handler 校验：
   - `conversationId` 必须存在。
   - 当前 Web 必须是 local owner。
   - `threadSettings` 必须是对象。
6. handler 执行：

```text
appServer.threadSettingsUpdate({ threadId, ...threadSettings })
```

7. 删除旧 method 的 compatibility capability definition。
8. 新增 `thread-follower-update-thread-settings` capability definition。

验收：

- `registeredRequestHandlers` 包含新版 settings method。
- 不再包含旧两个 settings method。
- Web-owned thread 收到新版 settings request 后调用 `thread/settings/update`。
- 非 Web-owned thread 返回 `no-local-owner`，不本地写状态。

### Phase 5：前端和 API 诊断对齐

目标：让诊断面板和 readiness 展示新版现实，不再提示旧 method 缺口。

改动文件：

- `packages/api/src/index.ts` 如 schema 中有 method 枚举或测试快照
- `apps/web/src/app/components/DebugPage.tsx`
- `apps/web/src/app/components/SettingsDiagnosticsPanel.tsx`
- `apps/server/src/protocolCompatibility.ts`
- `apps/server/src/syncReadiness.test.ts`

具体改动：

1. compatibility 输出新版 method matrix。
2. readiness 可选能力不再显示旧 settings method。
3. diagnostics export 中的 `ipcMethodVersions` 使用新版表。
4. 如 UI 有固定文案，改为从 capability matrix 渲染，不写死旧 method。

验收：

- `/api/protocol/compatibility` method map 与新版表一致。
- `/api/sync/readiness` 不再把旧 settings method 当必需或可选缺口。
- Debug/Settings 诊断页不出现旧 settings method。

### Phase 6：文档收口

目标：文档和实现同步，避免后续按旧研究继续写代码。

改动文件：

- `documentation/protocol/official_codex_ipc_sync.md`
- `documentation/protocol/official_client_runtime_evidence.md`
- `docs/official_client_interaction_refactor_plan.md`
- `docs/startup_runbook.md`
- `docs/troubleshooting_sync.md`
- `docs/implementation_status.md`

具体改动：

1. 更新 method version 表：
   - `thread-stream-state-changed: 7`
   - `thread-follower-update-thread-settings: 1`
   - 删除旧 settings method 当前基线描述。
2. 记录 Desktop `26.602.9276.0` 与 VS Code extension `26.5601.21317` 的证据。
3. 说明 v7 revision 规则和 mismatch 处理方式。
4. 说明 settings 更新统一走 `thread/settings/update`。
5. 标注本次迁移不做旧版官方客户端兼容。

验收：

- `rg "thread-stream-state-changed.*6|set-model-and-reasoning|set-collaboration-mode" docs documentation packages apps` 不再命中当前基线描述。
- 允许历史进展日志保留旧文字，但必须补充“已被 2026-06-09 v7 计划取代”的说明，避免误读。

### Phase 7：集中验证

目标：用自动化和真实运行检查证明新版协议链路闭合。

建议命令：

```powershell
pnpm --filter @codex-web/protocol exec vitest run src/officialIpc.test.ts
pnpm --filter @codex-web/server exec vitest run src/syncCoordinator.test.ts src/protocolCompatibility.test.ts src/syncReadiness.test.ts
pnpm --filter @codex-web/api exec vitest run src/index.test.ts
pnpm --filter @codex-web/web typecheck
pnpm --filter @codex-web/server typecheck
pnpm --filter @codex-web/protocol typecheck
pnpm build
```

运行态检查：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/protocol/compatibility | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/sync/readiness | ConvertTo-Json -Depth 12
Invoke-RestMethod -Uri http://127.0.0.1:18930/api/official-ipc/status | ConvertTo-Json -Depth 12
```

真实三端手测：

1. Desktop 打开一个 thread 并发送消息，Web 应实时看到 v7 stream。
2. VS Code 扩展打开一个 thread 并发送消息，Web 应实时看到 v7 stream。
3. Web 新建 thread 并发送消息，Desktop / VS Code 应看到 Web-owned v7 snapshot。
4. Web-owned thread 在 Desktop / VS Code 修改模型、推理强度或协作模式，Web owner 应收到 `thread-follower-update-thread-settings` 并调用 `thread/settings/update`。
5. 人为制造 stale patch 或重连场景时，Web 不应套错 patch，不应把 active turn 回退成旧状态。

## 预期文件级变动清单

### 必改

- `packages/protocol/src/index.ts`
  - method version map
  - stream state revision 字段
  - snapshot/patch revision 校验
  - Web-owned broadcast revision

- `packages/protocol/src/officialIpc.test.ts`
  - v7 method map
  - revision success / mismatch / stale tests
  - outgoing Web-owned v7 broadcast tests

- `apps/server/src/syncCoordinator.ts`
  - 删除旧 settings handlers
  - 新增 `thread-follower-update-thread-settings`

- `apps/server/src/syncCoordinator.test.ts`
  - 新 settings handler 测试
  - 旧 method 不再注册测试

- `apps/server/src/protocolCompatibility.ts`
  - capability matrix 改为新版 settings method

- `apps/server/src/protocolCompatibility.test.ts`
  - snapshot / expectation 更新

- `apps/server/src/syncReadiness.test.ts`
  - readiness method expectation 更新

### 视测试结果调整

- `packages/api/src/index.ts`
  - 如 API schema 固定了旧 method，需要更新。

- `apps/web/src/app/components/DebugPage.tsx`
- `apps/web/src/app/components/SettingsDiagnosticsPanel.tsx`
  - 如 UI 文案或表格假设旧 method，需要删除。

- `apps/server/src/diagnosticsExport.ts`
  - 如导出测试固定旧 method count，需要更新。

### 文档

- `documentation/protocol/official_codex_ipc_sync.md`
- `documentation/protocol/official_client_runtime_evidence.md`
- `docs/official_client_interaction_refactor_plan.md`
- `docs/startup_runbook.md`
- `docs/troubleshooting_sync.md`
- `docs/implementation_status.md`

## 代码质量护栏

### 禁止事项

- 禁止保留“新旧 method 都处理”的长期分支。
- 禁止把旧 method 包一层转发到新 method 后继续在 compatibility 里展示为 implemented。
- 禁止在 revision mismatch 时继续强行 apply patch。
- 禁止在 `apps/web` 中加入官方 IPC raw field 判断。
- 禁止为未观测到的旧 frame shape 写大面积 defensive fallback。
- 禁止把 settings 暂存到本地 SQLite 作为 next-turn 状态源。

### 推荐拆分

本次迁移建议按以下提交或 PR 边界拆：

1. `protocol: switch official IPC registry to v7`
2. `protocol: enforce stream revision ordering`
3. `server: replace split settings followers with update-thread-settings`
4. `diagnostics: align compatibility and readiness with IPC v7`
5. `docs: record official IPC v7 migration evidence`

每个提交都应能独立通过对应测试，不把所有修复堆到最后。

### 命名约束

- 使用 `revision` 表示当前官方 stream revision。
- 使用 `baseRevision` 表示 patch 基线。
- 使用 `threadSettings` 表示 follower settings payload。
- 不再新增 `latestModel`、`latestReasoningEffort`、`latestCollaborationMode` 这类 Web-owned shadow state。

## 回滚策略

本计划不做运行时兼容，但仍需要工程回滚点：

1. 修改前保留 git checkpoint。
2. Phase 1 和 Phase 2 合并前必须保证 protocol 测试通过。
3. 如果真实 Desktop / VS Code v7 手测失败，回滚整个迁移分支，而不是在主线里加旧 method fallback。
4. 回滚后重新采集官方 bundle evidence，再决定是否修正 v7 实现。

## 完成标准

满足以下条件才算迁移完成：

- `IPC_METHOD_VERSIONS` 使用 v7 当前基线。
- 旧 settings follower method 不再出现在当前实现和诊断 capability matrix 中。
- Web-owned snapshot outgoing frame 带 `version: 7` 和递增 `change.revision`。
- incoming patches 受 `baseRevision` / `revision` 保护。
- `/api/protocol/compatibility` 和 `/api/sync/readiness` 展示新版 method。
- Desktop、VS Code、Web 三端手测通过：
  - official-owned stream 到 Web
  - Web-owned stream 到 official clients
  - settings update follower request 到 Web owner
  - revision mismatch 不破坏 active stream
