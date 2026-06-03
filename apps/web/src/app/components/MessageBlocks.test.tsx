import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageItem } from "../../api";
import { renderMessageItem, renderTurnItems } from "./MessageBlocks";

vi.mock("../../i18n/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("MessageBlocks file references", () => {
  it("keeps Windows absolute markdown link targets for local file references", () => {
    const item: MessageItem = {
      type: "assistant",
      id: "assistant-file-link",
      text: "[App.module.css](E:/cache/Desktop/codex_web/apps/web/src/app/App.module.css)",
    };

    const html = renderToStaticMarkup(
      renderMessageItem(item, "completed", {
        projectRoot: "E:\\cache\\Desktop\\codex_web",
      })!,
    );

    expect(html).toContain('title="apps/web/src/app/App.module.css"');
    expect(html).toContain("App.module.css");
  });

  it("renders assistant markdown while the turn is still active", () => {
    const item: MessageItem = {
      type: "assistant",
      id: "assistant-stream-markdown",
      text: [
        "清单：",
        "",
        "- **stream-bold-sentinel**",
        "",
        "```ts",
        "const streamCodeSentinel = 42",
        "```",
      ].join("\n"),
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "active")!);

    expect(html).toContain("<li>");
    expect(html).toContain("<strong>stream-bold-sentinel</strong>");
    expect(html).toContain("streamCodeSentinel");
    expect(html).toContain("复制 Markdown 代码");
  });

  it("summarizes web search tool output without generic tool cards", () => {
    const items: MessageItem[] = [
      {
        type: "toolOutput",
        id: "search-a",
        title: "Web search: weather Shenzhen",
        text: "",
        status: null,
        rawType: "webSearch",
      },
      {
        type: "unknown",
        id: "search-b",
        rawType: "webSearch",
        raw: {
          type: "webSearch",
          action: {
            type: "openPage",
            url: "https://m.nmc.cn/publish/forecast/AGD/shenzhen.html",
          },
        },
      },
      {
        type: "unknown",
        id: "search-c",
        rawType: "webSearch",
        raw: {
          type: "webSearch",
          query: "weather Guangdong",
        },
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "completed")}</>);

    expect(html).toContain("已搜索网页");
    expect(html).toContain("3 次");
    expect(html).not.toContain("2 个工具输出");
    expect(html).not.toContain("未知内容");
    expect(html).not.toContain("webSearch");
  });
});
