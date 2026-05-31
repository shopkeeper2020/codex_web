export const THREAD_ROW_HEIGHT_PX = 42;
export const THREAD_ROW_VIRTUALIZE_THRESHOLD = 80;
export const THREAD_ROW_OVERSCAN = 6;
export const THREAD_ROW_MAX_VIEWPORT_PX = 420;

export type VirtualThreadWindow = {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
  viewportHeight: number;
};

export function shouldVirtualizeThreadRows(itemCount: number): boolean {
  return itemCount > THREAD_ROW_VIRTUALIZE_THRESHOLD;
}

export function initialThreadScrollTop(
  selectedIndex: number,
  itemCount: number,
  rowHeight = THREAD_ROW_HEIGHT_PX,
  viewportHeight = THREAD_ROW_MAX_VIEWPORT_PX,
): number {
  if (selectedIndex < 0 || itemCount <= 0) return 0;
  const maxScrollTop = Math.max(0, itemCount * rowHeight - viewportHeight);
  const preferred = Math.max(0, (selectedIndex - 2) * rowHeight);
  return Math.min(maxScrollTop, preferred);
}

export function calculateVirtualThreadWindow({
  itemCount,
  scrollTop,
  rowHeight = THREAD_ROW_HEIGHT_PX,
  viewportHeight = THREAD_ROW_MAX_VIEWPORT_PX,
  overscan = THREAD_ROW_OVERSCAN,
}: {
  itemCount: number;
  scrollTop: number;
  rowHeight?: number;
  viewportHeight?: number;
  overscan?: number;
}): VirtualThreadWindow {
  const safeItemCount = Math.max(0, itemCount);
  const safeRowHeight = Math.max(1, rowHeight);
  const totalHeight = safeItemCount * safeRowHeight;
  const safeViewportHeight = Math.min(Math.max(0, viewportHeight), totalHeight);
  const maxScrollTop = Math.max(0, totalHeight - safeViewportHeight);
  const safeScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);
  const visibleCount =
    safeViewportHeight > 0 ? Math.ceil(safeViewportHeight / safeRowHeight) : 0;
  const startIndex = Math.max(
    0,
    Math.floor(safeScrollTop / safeRowHeight) - overscan,
  );
  const endIndex = Math.min(
    safeItemCount,
    startIndex + visibleCount + overscan * 2,
  );

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * safeRowHeight,
    totalHeight,
    viewportHeight: safeViewportHeight,
  };
}
