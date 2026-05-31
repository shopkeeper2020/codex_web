# Node ESM 相对导入必须带 `.js`

## 现象

`pnpm build` 通过后，执行：

```powershell
node apps/server/dist/index.js
```

进程立即退出，报错：

```text
ERR_MODULE_NOT_FOUND: Cannot find module ...\apps\server\dist\app
```

## 根因

TypeScript 源码中使用了无扩展名相对导入：

```ts
import { createServer } from './app'
```

在 `"type": "module"` 的 Node ESM 项目里，编译后的 JS 仍然保留无扩展名导入，Node 不会自动补 `.js`。

## 解决方案

server 内部相对导入使用 `.js` 后缀：

```ts
import { createServer } from './app.js'
```

TypeScript 会在源码阶段解析到 `.ts`，编译产物由 Node 正确加载 `.js`。

## 后续避免

- `apps/server` 和 Node 运行的 package 内部相对导入统一写 `.js`。
- 浏览器/Vite-only 代码可按 Vite 规则处理，但共享 Node 代码优先遵守 Node ESM。
