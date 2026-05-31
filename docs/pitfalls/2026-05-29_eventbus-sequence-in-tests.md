# EventBus sequence in tests

## 现象

给官方 IPC archive/unarchive notification 补 server bus 测试时，断言第一条业务事件 `sequence` 为 `1`、第二条为 `2`，本地 Vitest 失败，实际值是更大的数字。

## 根因

`EventBus` 的 `sequence` 是当前 server context 内的全局递增计数。`createServer()` 启动期间可能已经通过 diagnostics、auth、warmup 等路径发布过事件，即使测试是在创建 server 后才订阅 bus，sequence 计数也不会重置。

## 影响范围

影响所有直接订阅 `context.bus` 并断言 realtime event `sequence` 的 server 测试。它不影响生产 realtime 顺序；生产端只需要 sequence 单调递增。

## 最终解决方案

测试只断言业务事件顺序、type、payload，以及后一个 sequence 大于前一个 sequence，不假设绝对起始值。

## 后续避免方式

写 realtime/server bus 测试时，用相对顺序断言：

```ts
expect(Number(events[1]?.sequence)).toBeGreaterThan(
  Number(events[0]?.sequence),
);
```

不要断言 `sequence: 1` 或 `sequence: 2`，除非测试直接 new 一个完全孤立的 `EventBus`。
