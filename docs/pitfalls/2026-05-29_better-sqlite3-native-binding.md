# better-sqlite3 原生 binding 未构建会导致后端启动失败

日期：2026-05-29。

## 现象

后端启动时直接退出，`data/logs/server.err.log` 报错：

```text
Error: Could not locate the bindings file
better-sqlite3.node
```

## 根因

`better-sqlite3` 是 Node 原生模块，需要运行 install/build 脚本下载或编译 `better_sqlite3.node`。当前 pnpm 环境没有自动生成该 binding。

## 影响范围

只影响后端启动和 SQLite 投影缓存。官方 IPC、app-server 协议代码本身不依赖该 binding，但后端启动阶段会打开数据库，所以 binding 缺失会阻塞整个服务。

## 最终解决方案

在本机手动触发依赖自身 install 脚本：

```powershell
pnpm --dir node_modules\.pnpm\better-sqlite3@12.10.0\node_modules\better-sqlite3 run install
```

完成后确认存在：

```powershell
Get-ChildItem -Recurse node_modules\.pnpm\better-sqlite3@12.10.0\node_modules\better-sqlite3 -Filter better_sqlite3.node
```

项目根 `package.json` 已加入：

```json
{
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
}
```

后续重新安装依赖时，pnpm 应允许该依赖执行构建脚本。

## 后续避免方式

- 新环境首次安装后运行 `pnpm rebuild better-sqlite3` 或完整启动一次后检查日志。
- 如果仍不生成 binding，执行上面的 `pnpm --dir ... run install`。
- 未来可把数据库打开改成软失败降级，避免缓存层阻塞协议主链路。
