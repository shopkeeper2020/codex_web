# pnpm filter 启动 server 时 cwd 不是仓库根目录

## 现象

使用下面命令启动后端：

```powershell
pnpm --filter @codex-web/server start
```

进程可以监听 `18930`，但日志显示：

```text
"root" path "...\apps\server\apps\web\dist" must exist
dataDir: "...\apps\server\data"
```

这会导致静态前端路径错误，并且误生成 `apps/server/data/config.local.json`。

## 根因

`pnpm --filter` 执行 package script 时，Node 进程的 `process.cwd()` 是被过滤出来的 package 目录，也就是 `apps/server`，不是仓库根目录。

后端入口如果直接把 `process.cwd()` 作为 project root，就会把所有相对路径都解析错。

## 影响范围

- 生产静态资源路径会被拼成 `apps/server/apps/web/dist`。
- 数据目录会跑到 `apps/server/data`。
- 首次启动可能输出一个无效的临时 LAN 密码，因为它写入的是错误数据目录。

## 最终解决方案

后端入口 `apps/server/src/index.ts` 不再使用 `process.cwd()`，而是根据 `import.meta.url` 反推仓库根目录：

```ts
const projectRoot = fileURLToPath(new URL('../../..', import.meta.url))
```

这样无论通过仓库根目录、pnpm filter、tsx watch 还是构建后的 `node dist/index.js` 启动，project root 都固定为 `codex_web/`。

## 后续避免方式

- 新增 app/package 的运行时路径不要依赖调用者 cwd。
- 本地私有数据只能落在仓库根 `data/`。
- 如果看到 package 内部出现 `data/`，先判断是否是错误 cwd 造成的运行产物。
