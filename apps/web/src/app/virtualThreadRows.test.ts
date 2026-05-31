import { describe, expect, it } from "vitest";
import {
  calculateVirtualThreadWindow,
  initialThreadScrollTop,
  shouldVirtualizeThreadRows,
} from "./virtualThreadRows";

describe("virtual thread rows", () => {
  it("only virtualizes large loaded thread lists", () => {
    expect(shouldVirtualizeThreadRows(80)).toBe(false);
    expect(shouldVirtualizeThreadRows(81)).toBe(true);
  });

  it("calculates a bounded window with overscan", () => {
    expect(
      calculateVirtualThreadWindow({
        itemCount: 1_000,
        scrollTop: 46 * 100,
        viewportHeight: 46 * 10,
        rowHeight: 46,
        overscan: 4,
      }),
    ).toEqual({
      startIndex: 96,
      endIndex: 114,
      offsetTop: 46 * 96,
      totalHeight: 46_000,
      viewportHeight: 460,
    });
  });

  it("clamps selected row initial scroll into the available range", () => {
    expect(initialThreadScrollTop(12, 1_000, 46, 460)).toBe(460);
    expect(initialThreadScrollTop(999, 1_000, 46, 460)).toBe(45_540);
    expect(initialThreadScrollTop(-1, 1_000, 46, 460)).toBe(0);
  });
});
