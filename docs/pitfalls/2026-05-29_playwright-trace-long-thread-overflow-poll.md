# Playwright trace 加真实长线程拖慢横向溢出轮询

## 现象

全量 `pnpm test:e2e` 串行运行时，移动端用例 `keeps composer attachment and Skills entries tappable` 偶发失败：

- 失败点是 `expectNoHorizontalOverflow` 的 `expect.poll(...).toBeTruthy()`。
- 单独运行同一个 mobile spec 或同一个测试可以通过。
- 失败截图中 Skills 菜单视觉上仍在 `390px` 视口内。

## 根因

该测试会打开真实官方 thread。全量 E2E 运行到该用例时，页面可能已经加载了很大的真实会话 DOM，Playwright 还会在失败路径保留 trace 和完整快照。

原断言使用 Node 侧 `expect.poll` 反复调用 `page.evaluate`。在真实长线程、trace 快照和实时状态刷新同时存在时，断言本身会被拖慢，表现为 Playwright 等待 predicate 超时，而不一定是页面持续存在真实横向溢出。

## 影响范围

- 主要影响移动端布局回归测试的稳定性。
- 不代表 Skills 菜单一定撑出视口。
- 如果未来真的有横向溢出，仍需要能定位具体元素，而不是只看到 `toBeTruthy` timeout。

## 最终解决方案

新增 `tests/e2e/helpers/layout.ts`：

- 使用浏览器内 `page.waitForFunction` 等待 `document.documentElement.scrollWidth` 和 `document.body.scrollWidth` 不超过 `window.innerWidth + 1`。
- 保持原来的严格验收标准，不通过隐藏 overflow 来掩盖真实问题。
- 失败时采集 URL、document/body scrollWidth、viewport width 和前 12 个疑似撑宽元素，方便直接定位 CSS 或内容块。

同时把 `tests/e2e/app-shell.spec.ts` 和 `tests/e2e/mobile-experience.spec.ts` 的横向溢出断言统一改用该 helper。

## 后续避免方式

- 真实 thread E2E 尽量使用浏览器内等待，减少 Node 侧高频轮询和 trace 快照互相放大的开销。
- 横向溢出断言失败时必须输出具体 offender，不再只返回布尔值。
- 如果某个布局测试不需要真实 thread，优先使用小 fixture 或空状态，避免把真实历史会话体量带进纯布局断言。
