# Playwright active turn 会让 Composer 附件按钮后置禁用

## 现象

移动端 E2E `keeps composer attachment and Skills entries tappable` 偶发超时，`page.waitForEvent("filechooser")` 一直等不到文件选择器。失败快照中 `添加附件` 按钮处于 disabled。

## 根因

测试使用真实 thread 数据。页面初次渲染时 Composer 可能先处于普通发送状态，但 thread detail / realtime 状态随后到达并发现存在 active turn，Composer 会切到“引导当前”模式。该模式不支持附件，因此 `添加附件` 会被禁用。

测试原先只在开始时尝试点一次“排队下一条”。如果 active turn 状态在这之后才抵达，按钮会再次变成 disabled，导致 file chooser 不触发。

## 影响范围

- 移动端 Composer E2E。
- 任何依赖真实 thread active 状态的 Playwright 测试。
- 不代表附件功能本身损坏，而是测试没有等待 Composer 模式稳定。

## 最终解决方案

把 `switchComposerToQueuedMode` 改成等待式逻辑：先定位 `添加附件`，然后在 `expect(...).toPass()` 中反复检查是否出现“排队下一条”，出现就点击，直到附件按钮保持 enabled。

## 后续避免方式

- 使用真实 thread 的 E2E 不要假设初始 UI 状态已经稳定。
- active turn 相关控件要先等目标按钮进入最终可交互状态，再触发 file chooser、menu 或 submit。
- 如果测试目标不是 active turn 行为，应显式切到“排队下一条”并等待附件按钮可用。
