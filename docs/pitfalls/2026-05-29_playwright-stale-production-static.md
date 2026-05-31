# Playwright 命中旧生产静态包

## 现象

前端源码已经修改，TypeScript 检查通过，但 `pnpm test:e2e` 仍然看不到新 UI。截图显示页面结构是旧版本。

## 根因

Playwright 默认访问 `http://127.0.0.1:18930`，也就是后端提供的生产静态文件。生产后端读取的是 `apps/web/dist`，不会自动使用最新源码。前端源码改动后如果没有重新 `pnpm build`，E2E 会命中旧构建产物。

## 影响范围

- 默认 `PLAYWRIGHT_BASE_URL` 未覆盖时的所有 E2E。
- 所有只改 `apps/web/src/**`、但尚未重新生成 `apps/web/dist` 的场景。

## 最终解决方案

前端改动后先执行：

```powershell
pnpm build
pnpm test:e2e
```

如果想直接测试 Vite 开发服务器，则显式覆盖：

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:18931"
pnpm test:e2e
Remove-Item Env:\PLAYWRIGHT_BASE_URL
```

## 后续避免方式

- 默认生产后端 E2E 前，把 `pnpm build` 当成固定步骤。
- E2E 失败时先查看截图，确认页面 bundle 是否包含刚改的 UI。
- 测试断言尽量限定在具体 dialog/region 内，避免历史会话正文里出现同名文本导致 strict mode 多匹配。
