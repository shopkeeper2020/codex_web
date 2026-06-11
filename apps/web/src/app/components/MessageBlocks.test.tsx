import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageItem } from "../../api";
import { formatReferencedPrompt } from "../textReferences";
import { CommandBlockDetails } from "./messageBlocks/CommandExecutionBlock";
import { renderMessageItem, renderTurnItems } from "./MessageBlocks";

vi.mock("../../i18n/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("MessageBlocks file references", () => {
  it("renders user message actions for ordinary user messages", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-action",
      text: "hello",
    };

    const html = renderToStaticMarkup(
      renderMessageItem(item, "completed", {
        getUserMessageActions: () => ({
          timeLabel: "15:31",
          canEdit: true,
          onEdit: () => undefined,
        }),
      })!,
    );

    expect(html).toContain('data-testid="user-message-actions"');
    expect(html).toContain("15:31");
    expect(html).toContain("复制用户消息");
    expect(html).toContain("编辑用户消息");
  });

  it("keeps canonical userMessage text whitespace intact", () => {
    const item: MessageItem = {
      type: "userMessage",
      id: "user-whitespace",
      clientId: null,
      content: [{ type: "text", text: "  keep surrounding whitespace  " }],
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain("  keep surrounding whitespace  ");
  });

  it("keeps steering guidance messages without user action rows", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-guidance",
      text: "guide current turn",
      intent: "guidance",
    };

    const html = renderToStaticMarkup(
      renderMessageItem(item, "completed", {
        getUserMessageActions: () => ({
          timeLabel: "15:31",
          canEdit: true,
          onEdit: () => undefined,
        }),
      })!,
    );

    expect(html).not.toContain('data-testid="user-message-actions"');
    expect(html).not.toContain("复制用户消息");
    expect(html).not.toContain("编辑用户消息");
  });

  it("renders inline editing controls inside the user message bubble", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-editing",
      text: "hello",
    };

    const html = renderToStaticMarkup(
      renderMessageItem(item, "completed", {
        getUserMessageActions: () => ({
          isEditing: true,
          editText: "edited in place",
          onCancelEdit: () => undefined,
          onSubmitEdit: () => undefined,
        }),
      })!,
    );

    expect(html).toContain('data-testid="user-message-editor"');
    expect(html).toContain("edited in place");
    expect(html).toContain("取消");
    expect(html).toContain("发送");
    expect(html).not.toContain('data-testid="user-message-actions"');
  });

  it("renders referenced user prompts as a read-only chip plus request text", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-references",
      text: formatReferencedPrompt("分别列表格", [
        { id: "a", text: "深圳", preview: "深圳" },
        { id: "b", text: "广州", preview: "广州" },
      ]),
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain('data-testid="message-text-reference-chip"');
    expect(html.indexOf('data-testid="message-text-reference-chip"')).toBeLessThan(
      html.indexOf('data-testid="user-message-bubble"'),
    );
    expect(html).toContain("分别列表格");
    expect(html).toContain("&quot;深圳&quot;");
    expect(html).toContain("&quot;广州&quot;");
    expect(html).not.toContain("# Selected text:");
    expect(html).not.toContain("## My request for Codex:");
  });

  it("renders manually structured referenced prompts like Desktop", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-manual-reference",
      text: [
        "# Selected text:",
        "## Selection 1",
        "OpenAI 的编程协作助手",
        "",
        "## My request for Codex:",
        "openai是什么?",
      ].join("\n"),
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain('data-testid="message-text-reference-chip"');
    expect(html).toContain("openai是什么?");
    expect(html).toContain("&quot;OpenAI 的编程协作助手&quot;");
    expect(html).not.toContain("# Selected text:");
  });

  it("renders reference-only prompts as a chip without an empty request bubble", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-reference-only",
      text: formatReferencedPrompt("", [
        { id: "a", text: "人工智能", preview: "人工智能" },
      ]),
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain('data-testid="message-text-reference-chip"');
    expect(html).toContain("&quot;人工智能&quot;");
    expect(html).not.toContain('data-testid="user-message-bubble"');
    expect(html).not.toContain("# Selected text:");
    expect(html).not.toContain("## My request for Codex:");
  });

  it("keeps references read-only while editing only the request bubble", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-reference-editing",
      text: formatReferencedPrompt("openai是什么?", [
        { id: "a", text: "OpenAI 的编程协作助手", preview: "OpenAI 的编程协作助手" },
      ]),
    };

    const html = renderToStaticMarkup(
      renderMessageItem(item, "completed", {
        getUserMessageActions: () => ({
          isEditing: true,
          editText: "openai是什么?",
          onCancelEdit: () => undefined,
          onSubmitEdit: () => undefined,
        }),
      })!,
    );

    expect(html).toContain('data-testid="message-text-reference-chip"');
    expect(html).toContain('data-testid="user-message-editor"');
    expect(html).toContain("openai是什么?");
    expect(html).toContain("&quot;OpenAI 的编程协作助手&quot;");
    expect(html).not.toContain("# Selected text:");
    expect(html).not.toContain("## My request for Codex:");
  });

  it("renders files-mentioned user prompts as request text without a reference chip", () => {
    const item: MessageItem = {
      type: "user",
      id: "user-file-mentioned",
      text: [
        "# Files mentioned by the user:",
        "",
        "## PixPin_2026-06-08_15-54-50.png:",
        "C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-08_15-54-50.png",
        "",
        "## My request for Codex:",
        "幫我完善會話區的交互功能。",
      ].join("\n"),
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain('data-testid="user-message-bubble"');
    expect(html).toContain("幫我完善會話區的交互功能。");
    expect(html).not.toContain('data-testid="message-text-reference-chip"');
    expect(html).not.toContain("# Files mentioned by the user:");
    expect(html).not.toContain("PixPin_2026-06-08_15-54-50.png");
    expect(html).not.toContain("C:/Users/user/AppData/Local/PixPin/Temp");
  });

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

  it("renders local markdown video references as playable media", () => {
    const item: MessageItem = {
      type: "assistant",
      id: "assistant-markdown-video",
      text: '搞掂。\n\n![合併影片](C:\\Users\\user\\Downloads\\result_joined_long_first.mp4)',
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain('data-testid="message-video"');
    expect(html).toContain('aria-label="合併影片"');
    expect(html).toContain("controls");
    expect(html).toContain("/api/files/content?path=");
    expect(html).not.toContain("<img");
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

  it("summarizes canonical web search items without dropping them", () => {
    const items: MessageItem[] = [
      {
        type: "webSearch",
        id: "search-official-a",
        query: "codex desktop ipc",
        action: null,
      },
      {
        type: "webSearch",
        id: "search-official-b",
        query: "agent message phase",
        action: { type: "search", query: "agent message phase" },
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "completed")}</>);

    expect(html).toContain("已搜索网页");
    expect(html).toContain("2 次");
    expect(html).not.toContain("unsupported-message-item");
    expect(html).not.toContain("未知内容");
  });

  it("does not infer active state for statusless canonical web search items", () => {
    const items: MessageItem[] = [
      {
        type: "webSearch",
        id: "search-statusless",
        query: "codex desktop ipc",
        action: null,
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "active")}</>);

    expect(html).toContain("已搜索网页");
    expect(html).not.toContain("正在搜索网页");
  });

  it("shows canonical active web search items as still searching", () => {
    const items: MessageItem[] = [
      {
        type: "webSearch",
        id: "search-active",
        query: "codex desktop ipc",
        action: null,
        status: "active",
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "active")}</>);

    expect(html).toContain("正在搜索网页");
    expect(html).not.toContain("已搜索网页");
  });

  it("renders canonical MCP and dynamic tool call items", () => {
    const mcpItem: MessageItem = {
      type: "mcpToolCall",
      id: "mcp-tool-a",
      server: "filesystem",
      tool: "read_file",
      status: "completed",
      arguments: { path: "README.md" },
      pluginId: null,
      result: { content: "ok" },
      error: null,
      durationMs: null,
    };
    const dynamicItem: MessageItem = {
      type: "dynamicToolCall",
      id: "dynamic-tool-a",
      namespace: "web",
      tool: "search_query",
      arguments: { q: "codex" },
      status: "completed",
      contentItems: [{ type: "text", text: "done" }],
      success: true,
      durationMs: null,
    };

    const html = renderToStaticMarkup(
      <>
        {renderMessageItem(mcpItem, "completed")}
        {renderMessageItem(dynamicItem, "completed")}
      </>,
    );

    expect(html).toContain("filesystem / read_file");
    expect(html).toContain("web / search_query");
    expect(html).not.toContain("unsupported-message-item");
  });

  it("renders future official item types through the diagnostic fallback", () => {
    const item = {
      type: "futureOfficialItem",
      id: "future-official-a",
      status: "completed",
      futurePayload: { value: "kept" },
    } as unknown as MessageItem;

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain("未知官方内容");
    expect(html).toContain("futureOfficialItem");
    expect(html).not.toContain("unsupported-message-item");
  });

  it("shows declined commands as rejected instead of successful", () => {
    const item: MessageItem = {
      type: "commandExecution",
      id: "command-declined",
      command: "rm -rf tmp",
      status: "declined",
      aggregatedOutput: null,
      cwd: null,
      processId: null,
      source: null,
      commandActions: [],
      durationMs: null,
      exitCode: null,
    };

    const html = renderToStaticMarkup(<CommandBlockDetails item={item} />);

    expect(html).toContain("已拒绝");
    expect(html).not.toContain("成功");
  });

  it("collapses completed process items once a final answer starts", () => {
    const items: MessageItem[] = [
      {
        type: "userMessage",
        id: "user-final-collapse",
        clientId: null,
        content: [{ type: "text", text: "跑一下测试。" }],
      },
      {
        type: "commandExecution",
        id: "command-final-collapse",
        command: "pnpm test",
        status: "completed",
        aggregatedOutput: "ok",
        cwd: null,
        processId: null,
        source: null,
        commandActions: [],
        durationMs: null,
        exitCode: 0,
      },
      {
        type: "agentMessage",
        id: "final-answer",
        text: "测试已经通过。",
        phase: "final_answer",
        memoryCitation: null,
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "active")}</>);

    expect(html).toContain("已处理");
    expect(html).toContain("测试已经通过。");
    expect(html).toContain("跑一下测试。");
    expect(html).not.toContain("pnpm test");
  });

  it("renders statusless reasoning as completed inside processed context", () => {
    const items: MessageItem[] = [
      {
        type: "reasoning",
        id: "reasoning-processed",
        summary: ["检查测试输出"],
        content: [],
      },
    ];

    const html = renderToStaticMarkup(
      <>{renderTurnItems(items, "active", { disableProcessCollapse: true, processedContext: true })}</>,
    );

    expect(html).toContain("已思考");
    expect(html).not.toContain("正在思考");
  });

  it("keeps the latest statusless reasoning active in a normal active turn", () => {
    const items: MessageItem[] = [
      {
        type: "reasoning",
        id: "reasoning-active",
        summary: ["检查测试输出"],
        content: [],
      },
    ];

    const html = renderToStaticMarkup(
      <>{renderTurnItems(items, "active", { disableProcessCollapse: true })}</>,
    );

    expect(html).toContain("正在思考");
    expect(html).not.toContain("已思考");
  });
});
