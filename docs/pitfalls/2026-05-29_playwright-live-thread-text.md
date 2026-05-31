# Playwright 文本断言会被真实会话正文干扰

日期：2026-05-29。

## 现象

新增侧栏断言时使用：

```ts
await expect(page.getByText("全部会话")).toBeVisible();
```

Playwright 严格模式报错，因为页面里同时存在侧栏按钮和当前真实会话正文里的同名文字。

同类问题也出现在移动端运行状态测试中：`page.getByText("pending calls")` / `page.getByText("Realtime")` 会同时命中 Runtime details / Sync status 控件和真实会话里展示过的代码块文本。Debug 页里 `getByText("IPC methods")` 也会同时命中标题和 `0 IPC methods` 这类说明文字。

## 根因

`codex_web` 的 e2e 测试跑在真实后端和真实会话数据上。聊天主区域可能展示当前开发过程中的任意文本，所以纯文本定位容易命中消息正文。

## 影响范围

所有面向 app shell 的测试，如果使用 `getByText()` 查询短文案，都可能被真实 thread 内容污染。

## 最终解决方案

优先按语义角色、label 或稳定容器定位，例如：

```ts
await expect(page.getByRole("button", { name: /全部会话/ })).toBeVisible();
await expect(
  page.getByRole("dialog", { name: "Settings / Diagnostics" }),
).toBeVisible();
const runtimePanel = page
  .getByRole("button", { name: /Runtime details/ })
  .locator("xpath=..");
await expect(
  runtimePanel.getByText("pending calls", { exact: true }),
).toBeVisible();
await expect(
  debugRegion.getByText("IPC methods", { exact: true }),
).toBeVisible();
```

## 后续避免方式

- Shell 控件优先用 `getByRole`、`getByLabel`。
- 状态标签如果只能用文本定位，至少加 `{ exact: true }`，或先把范围收敛到对应 panel/dialog。
- 只有断言聊天正文时才使用宽泛 `getByText`。
- 对可能出现在消息中的短中文文案，避免全页面文本定位。
