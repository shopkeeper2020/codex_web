# 移动端原生 select 长文案会撑出横向滚动

## 背景

移动端 Composer 使用三行紧凑布局展示附件、模型、协作模式、推理强度、Skills 和发送按钮。推理强度选项可能来自官方 app-server，文案长度不固定。

## 问题现象

`tests/e2e/mobile-experience.spec.ts` 在 `390px` 视口展开 `Runtime details` 后，页面出现横向溢出。截图中推理强度 select 显示 `Balances speed and...` 一类长文案，控件视觉上被截断，但页面 `scrollWidth` 仍大于 `innerWidth`。

## 根因

原生 `select` 的文本内容会参与内部最小宽度计算。即使父级 grid track 使用 `minmax(0, 1fr)`，如果 `.controlSelect` 和内部 `select` 没有限制溢出与省略，长 option 文案仍可能把移动布局撑宽。

## 解法

在共享 Composer 控件样式上限制溢出：

```css
.controlSelect {
  overflow: hidden;
}

.controlSelect select {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

保留 `.composer` 的 `overflow: visible`，避免影响 Skills 菜单弹出；只收紧 select 控件本身。

## 影响范围

移动端 Composer 中所有由官方 runtime options 驱动、文案长度不可控的 select 控件，包括模型、协作模式和推理强度。

## 后续避免方式

- 移动端控件进入 grid/flex 布局时，父项和内部表单控件都要显式 `min-width: 0`。
- 对文案不可控的 select/button 标签，设置 `overflow: hidden`、`text-overflow: ellipsis` 和 `white-space: nowrap`。
- 保留 `tests/e2e/mobile-experience.spec.ts` 的 `390px` 横向溢出检查。
