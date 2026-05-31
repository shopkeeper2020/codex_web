# Playwright 并发访问真实 app-server 导致假失败

## 现象

全量 `pnpm test:e2e` 使用默认 8 个 workers 时偶发失败：

- 桌面 shell smoke 在 Settings 面板中点击 `Security` tab 时卡在 Playwright 的 visible/enabled/stable 等待。
- 移动端 Composer/Skills 场景在打开 Skills 菜单后短暂出现横向溢出断言失败。

单独复跑失败用例均通过。

## 根因

这些 E2E 不是纯 mock 页面测试，而是直接访问同一个本机 `codex_web` 服务、同一个官方 IPC 命名管道和同一个 `codex app-server`。并发 workers 会共享真实 thread 列表、当前 thread 详情、runtime 缓存、官方 app-server 子进程和页面加载压力。

在真实超长 thread 或官方缓存刷新期间，多个浏览器 worker 同时打开 Settings、Debug、thread detail、Skills 菜单时，页面会出现短暂布局/稳定性抖动。用户实际单端操作不会按这种方式并发抢同一套本机服务。

## 影响范围

- 影响默认 Playwright 全量回归的稳定性。
- 不代表 Composer 拆分或移动布局本身存在稳定复现的横向溢出；失败用例单独复跑已通过。
- 不影响 `pnpm typecheck`、`pnpm test`、`pnpm build`。

## 最终解决方案

在 `playwright.config.ts` 中固定：

```ts
workers: 1;
```

让真实运行态 E2E 串行访问本机服务。修改后默认 `pnpm test:e2e` 结果为 `21 passed / 15 skipped`。

## 后续避免方式

- 真实官方 IPC/app-server 验收测试默认串行。
- 只有当测试完全 mock 掉后端、官方 IPC 和 app-server，并且每个 worker 拥有隔离数据目录时，才重新开启并发。
- 文档中明确：前端源码变更后要先 `pnpm build`，因为默认 E2E 指向 `18930` 的生产静态包。
