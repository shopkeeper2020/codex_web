# 移动端图片和 data URL 会撑出横向滚动

日期：2026-05-29。

## 现象

`tests/e2e/mobile-experience.spec.ts` 在 `390px` 视口打开移动端运行折叠面板或 Skills 菜单时，偶发 `document.scrollWidth > window.innerWidth`。

失败截图里的主会话包含图片和很长的 `data:image/png;base64,...` 文本。视觉上图片块没有完全露出，但页面仍可能被真实消息内容撑宽。

## 根因

图片网格沿用了桌面消息块的 `margin-left: 37px`，移动端只重置了普通段落、命令块和状态块的左缩进，没有重置 `.imageGrid`。

同时，图片块和图片说明没有完整设置 `min-width: 0`、`max-width: 100%` 和文本省略。遇到超宽图片、data URL 或长 alt/path 时，grid item 的固有尺寸可能参与横向宽度计算。

## 最终解决方案

- `.imageGrid` 增加 `min-width: 0` 和 `max-width: 100%`。
- `.imageBlock` / `.imageBlock img` 增加 `max-width: 100%` 和 `min-width: 0`。
- `.imageBlock span` 增加省略号截断。
- 移动端 `<= 680px` 的零左缩进列表加入 `.imageGrid`。

## 后续避免方式

- 所有消息附件、图片、diff、命令输出、tool output 都必须在移动端显式限制横向尺寸。
- 有桌面左缩进的消息块，移动端断点要统一重置，不能只覆盖文字段落。
- E2E 的横向溢出检查要保留在真实会话数据上，因为 fixture 很难覆盖历史会话里的超长 data URL。
