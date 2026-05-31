# 移动端 Composer 被聊天区覆盖

## 现象

Playwright mobile viewport 中，Composer 底部控件可见，但点击 `Skills` 按钮时被上方聊天区元素拦截。错误表现为 `chatViewport` 内的 `statusTile` intercepts pointer events。

## 根因

根布局只设置了 `min-height: 100dvh`，页面整体仍可被浏览器滚动。Playwright 为了点击底部控件执行 `scrollIntoView` 后，聊天区和 Composer 在页面坐标上发生覆盖；视觉上按钮可见，但实际 pointer hit test 落到了聊天区。

## 影响范围

- 移动端底部 Composer 控件点击不可靠。
- 所有需要点击底部横向滚动控件的 e2e 都可能超时。

## 最终解决方案

- `.app`、`.main`、`.desktopSidebar` 固定 `height: 100dvh` 并设置 `overflow: hidden`。
- `.chatViewport` 作为内部滚动区。
- `.composerDock` 明确 `position: relative` 和更高 `z-index`。

这样页面本身不滚动，聊天区内部滚动，底部 Composer 始终处于独立可点击层。

## 后续避免方式

移动端新增底部控件后，必须用 Playwright 在 mobile viewport 中真实点击，而不是只检查元素可见。
