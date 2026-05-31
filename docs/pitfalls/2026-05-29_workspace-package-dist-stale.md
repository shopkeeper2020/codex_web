# pnpm workspace 包导出指向 dist 时要先 build

日期：2026-05-29。

## 现象

`apps/server` 引入 `@codex-web/domain` 新增导出后，直接运行 server typecheck 报错：

```text
Module '"@codex-web/domain"' has no exported member 'normalizeOfficialThreadDetail'
```

但源码 `packages/domain/src/index.ts` 中已经存在该导出。

同类现象也会出现在 `@codex-web/protocol` 和 `@codex-web/api`：源码里给 `OfficialIpcBridge` 新增方法后，直接跑 `apps/server` 的路由测试可能仍加载旧 `packages/protocol/dist/index.js`，导致接口返回 502，例如 `officialIpc.releaseOwnedConversation is not a function`；源码里收紧 API schema 后，server 路由测试可能仍加载旧 `packages/api/dist/index.js`，导致本应 400 的请求仍按旧契约返回 200。

## 原因

当前 workspace package 的 `package.json` exports 指向 `./dist/index.js` 和 `./dist/index.d.ts`。
TypeScript 在 `apps/server` 中解析 `@codex-web/domain` 时读取的是已构建的 `dist` 类型声明，而不是 `src`。

## 解决方案

修改共享包导出后，先构建对应 package：

```powershell
pnpm --filter @codex-web/domain build
pnpm --filter @codex-web/protocol build
pnpm --filter @codex-web/api build
pnpm --filter @codex-web/server typecheck
```

完整验证推荐直接跑：

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## 后续可选优化

后续可以评估 TypeScript project references 或 dev-only export 条件，让开发期直接解析源码。但第一版保持 dist export 更接近发布形态，代价是共享包变更后要记得 build。
