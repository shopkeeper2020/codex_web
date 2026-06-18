import type { ReactElement } from "react";
import type { ThreadTokenUsage } from "@codex-web/domain";
import styles from "../../App.module.css";

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function usagePercent(tokenUsage: ThreadTokenUsage | null | undefined): number | null {
  const used = tokenUsage?.last.totalTokens ?? 0;
  const windowSize = tokenUsage?.modelContextWindow ?? 0;
  if (used <= 0 || windowSize <= 0) return null;
  return (used / windowSize) * 100;
}

export function ContextWindowMeter({
  tokenUsage,
}: {
  tokenUsage?: ThreadTokenUsage | null;
}): ReactElement {
  const percent = usagePercent(tokenUsage);
  const used = tokenUsage?.last.totalTokens ?? 0;
  const windowSize = tokenUsage?.modelContextWindow ?? 0;
  const displayPercent = percent == null ? null : Math.round(percent);
  const strokeDasharray = 100;
  const strokeDashoffset = percent == null ? 100 : 100 - percent;
  const title =
    percent == null
      ? "背景信息窗口：暂无上下文用量"
      : `背景信息窗口：${displayPercent}% 已用，已用 ${formatTokenCount(used)} 标记，共 ${formatTokenCount(windowSize)}`;

  return (
    <span
      aria-label={title}
      className={styles.contextWindowMeter}
      role="img"
      tabIndex={0}
      title={title}
    >
      <svg aria-hidden="true" viewBox="0 0 36 36">
        <circle className={styles.contextWindowMeterTrack} cx="18" cy="18" r="14" />
        <circle
          className={styles.contextWindowMeterValue}
          cx="18"
          cy="18"
          r="14"
          pathLength={100}
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
        />
      </svg>
      <span className={styles.contextWindowMeterTooltip}>
        <strong>背景信息窗口：</strong>
        {percent == null ? (
          <span>暂无上下文用量</span>
        ) : (
          <>
            <span>{displayPercent}% 已用</span>
            <span>
              已用 {formatTokenCount(used)} 标记，共 {formatTokenCount(windowSize)}
            </span>
          </>
        )}
      </span>
    </span>
  );
}
