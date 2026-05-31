# Vitest picked up dist-types tests

## 现象

`pnpm test` 运行 `apps/web` 时，同一组测试会从两个位置各跑一次：

```text
src/app/realtimeState.test.ts
dist-types/app/realtimeState.test.js
```

## 根因

Web 包的 TypeScript `outDir` 是 `dist-types/`。Vitest 默认会排除 `dist/`，但不会自动排除 `dist-types/`，因此 `tsc -b` 产出的测试 JS 会被再次收集。

## 影响范围

测试结果会重复计数，未来如果测试有副作用，可能造成误报或重复执行。

## 最终解决方案

在 `apps/web/package.json` 的 test script 中显式排除：

```json
"test": "vitest run --passWithNoTests --exclude \"dist-types/**\""
```

## 后续避免方式

新增非标准构建输出目录时，同步检查 Vitest、Playwright、打包和清理脚本是否会误收集该目录。
