# Fastify Static SPA Fallback

## 现象

根路径 `/` 可以正常加载前端，但直接访问 `/thread/<thread-id>` 时返回 500：

```text
reply.sendFile is not a function
```

Playwright 在 clean route 深链测试中无法找到 `main`，页面实际显示的是上述 JSON 错误。

## 根因

`@fastify/static` 注册时使用了 `decorateReply: false`，因此 `reply.sendFile()` 没有被挂到 reply 对象上。

根路径由静态插件直接命中 `index.html`，不会走自定义 not-found fallback，所以早期测试没有暴露。clean browser route `/thread/:threadId` 会走 fallback，才触发该问题。

## 影响范围

- 所有非 `/api/*` 的前端深链路径。
- 未来 `/project/:projectId`、`/settings` 等 clean route 也会受影响。

## 最终解决方案

在 `apps/server/src/app.ts` 中保留 `decorateReply: false`，但不再调用 `reply.sendFile()`；改为显式读取 `apps/web/dist/index.html` 并以 `text/html` 返回。

## 后续避免方式

- 新增前端路由时必须跑 `pnpm test:e2e`，覆盖直接打开 clean route。
- 不要假设 Fastify reply 上存在 `sendFile`；如果继续关闭 `decorateReply`，SPA fallback 应始终使用显式 `readFile`。
