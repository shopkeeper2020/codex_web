import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ThreadTokenUsage } from "@codex-web/domain";
import { ContextWindowMeter } from "./ContextWindowMeter";

function tokenUsage(totalTokens: number, lastTokens: number): ThreadTokenUsage {
  return {
    total: {
      totalTokens,
      inputTokens: totalTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    last: {
      totalTokens: lastTokens,
      inputTokens: lastTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    modelContextWindow: 258400,
  };
}

describe("ContextWindowMeter", () => {
  it("uses the latest context window usage rather than cumulative token usage", () => {
    const html = renderToStaticMarkup(
      <ContextWindowMeter tokenUsage={tokenUsage(208710, 24779)} />,
    );

    expect(html).toContain("10% 已用");
    expect(html).toContain("已用 25k 标记，共 258k");
    expect(html).not.toContain("81% 已用");
    expect(html).not.toContain("209k");
  });

  it("matches a long restored desktop session sample", () => {
    const html = renderToStaticMarkup(
      <ContextWindowMeter tokenUsage={tokenUsage(4083976, 184881)} />,
    );

    expect(html).toContain("72% 已用");
    expect(html).toContain("已用 185k 标记，共 258k");
    expect(html).not.toContain("1580% 已用");
    expect(html).not.toContain("4.1m");
  });

  it("keeps using latest-window usage after the same thread continues", () => {
    const html = renderToStaticMarkup(
      <ContextWindowMeter tokenUsage={tokenUsage(5157340, 138772)} />,
    );

    expect(html).toContain("54% 已用");
    expect(html).toContain("已用 139k 标记，共 258k");
    expect(html).not.toContain("1996% 已用");
    expect(html).not.toContain("5.2m");
  });
});
