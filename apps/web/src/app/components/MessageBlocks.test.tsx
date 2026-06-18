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

  it("hides files-mentioned scaffolding for canonical user messages with image attachments", () => {
    const item: MessageItem = {
      type: "userMessage",
      id: "user-file-mentioned-image",
      clientId: null,
      content: [
        {
          type: "localImage",
          path: "C:\\Users\\user\\AppData\\Local\\Temp\\rendered-attachment.png",
          mimeType: "image/png",
          alt: "attached screenshot",
        },
        {
          type: "text",
          text: [
            "# Files mentioned by the user:",
            "",
            "## hidden-transcript-only.png:",
            "C:/Users/user/AppData/Local/Temp/hidden-transcript-only.png",
          ].join("\n"),
        },
        {
          type: "text",
          text: [
            "## My request for Codex:",
            "我希望給圖片預覽的時候，增加鼠標滾輪可以放大縮小拖動的功能",
          ].join("\n"),
        },
      ],
    };

    const html = renderToStaticMarkup(renderMessageItem(item, "completed")!);

    expect(html).toContain('data-testid="user-message-bubble"');
    expect(html).toContain("attached screenshot");
    expect(html).toContain(
      "我希望給圖片預覽的時候，增加鼠標滾輪可以放大縮小拖動的功能",
    );
    expect(html).not.toContain("# Files mentioned by the user:");
    expect(html).not.toContain("## My request for Codex:");
    expect(html).not.toContain("hidden-transcript-only.png");
  });

  it("renders context compaction progress and completion labels", () => {
    const items: MessageItem[] = [
      {
        type: "contextCompaction",
        id: "compact-1",
      },
    ];

    const activeHtml = renderToStaticMarkup(
      <>{renderTurnItems(items, "active")}</>,
    );
    const completedHtml = renderToStaticMarkup(
      <>{renderTurnItems(items, "completed")}</>,
    );

    expect(activeHtml).toContain("正在压缩上下文");
    expect(activeHtml).not.toContain("上下文已自动压缩");
    expect(completedHtml).toContain("上下文已压缩");
    expect(completedHtml).not.toContain("正在压缩上下文");
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

  it("renders canonical imageView items as one unlabeled gallery", () => {
    const items: MessageItem[] = [
      {
        type: "imageView",
        id: "image-view-a",
        path: "C:\\Users\\user\\Desktop\\素材\\1960年代香港校服参考\\SH-SH_SH-1967-001.jpg",
      },
      {
        type: "imageView",
        id: "image-view-b",
        path: "C:\\Users\\user\\Desktop\\素材\\1960年代香港校服参考\\SH-LT_LT-1960-001.jpg",
      },
      {
        type: "imageView",
        id: "image-view-c",
        path: "C:\\Users\\user\\Desktop\\素材\\1960年代香港校服参考\\SH-SH_SH-1967-002.jpg",
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "completed")}</>);

    expect(html).toContain('data-testid="image-view-gallery"');
    expect(html).toContain('data-count="3"');
    expect(html).toContain("/api/files/content?path=");
    expect(html).not.toContain("未知官方内容");
    expect(html).not.toContain("unsupported-message-item");
    expect(html).not.toContain("<span>SH-SH_SH-1967-001.jpg</span>");
    expect(html).not.toContain("<figcaption>");
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

  it("labels completed collab agent wait calls without creation wording", () => {
    const items: MessageItem[] = [
      {
        type: "collabAgentToolCall",
        id: "wait-agents",
        tool: "wait",
        status: "completed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-a", "thread-b"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agentsStates: {
          "thread-a": { status: "completed" },
          "thread-b": { status: "completed" },
        },
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "completed")}</>);

    expect(html).toContain("已等待 2 个智能体");
    expect(html).not.toContain("已创建 2 个智能体");
  });

  it("labels failed collab agent spawn calls without success wording", () => {
    const items: MessageItem[] = [
      {
        type: "collabAgentToolCall",
        id: "spawn-agents",
        tool: "spawnAgent",
        status: "failed",
        senderThreadId: "thread-main",
        receiverThreadIds: ["thread-a"],
        prompt: null,
        model: "gpt-5.5",
        reasoningEffort: "xhigh",
        agentsStates: {
          "thread-a": { status: "notFound" },
        },
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "completed")}</>);

    expect(html).toContain("创建失败 1 个智能体");
    expect(html).not.toContain("已创建 1 个智能体");
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

  it("keeps active command and file edit status visible before a final answer", () => {
    const items: MessageItem[] = [
      {
        type: "userMessage",
        id: "user-active-process",
        clientId: null,
        content: [{ type: "text", text: "继续修。" }],
      },
      {
        type: "commandExecution",
        id: "command-active-process",
        command: "pnpm test",
        status: "running",
        aggregatedOutput: "",
        cwd: null,
        processId: null,
        source: null,
        commandActions: [],
        durationMs: null,
        exitCode: null,
      },
      {
        type: "fileChange",
        id: "file-active-process",
        path: "docs/daily_plan/2026-06-11_desktop_fidelity_issue_collection_plan.md",
        diff: "diff --git a/docs/daily_plan/2026-06-11_desktop_fidelity_issue_collection_plan.md b/docs/daily_plan/2026-06-11_desktop_fidelity_issue_collection_plan.md\n+补充状态",
        status: "editing",
      },
      {
        type: "agentMessage",
        id: "final-active-process",
        text: "我先同步一下进度。",
        phase: "final_answer",
        memoryCitation: null,
      },
    ];

    const html = renderToStaticMarkup(<>{renderTurnItems(items, "active")}</>);

    expect(html).toContain("正在运行");
    expect(html).toContain("pnpm test");
    expect(html).toContain("正在编辑");
    expect(html).toContain(
      "2026-06-11_desktop_fidelity_issue_collection_plan.md",
    );
    expect(html).toContain("我先同步一下进度。");
    expect(html).not.toContain("已处理");
  });

  it("keeps completed operation groups collapsed while the turn continues", () => {
    const items: MessageItem[] = [
      {
        type: "agentMessage",
        id: "before-completed-commands",
        text: "先跑测试。",
        phase: "final_answer",
        memoryCitation: null,
      },
      {
        type: "commandExecution",
        id: "completed-command-1",
        command: "pnpm test",
        status: "completed",
        aggregatedOutput: "",
        cwd: null,
        processId: null,
        source: null,
        commandActions: [],
        durationMs: 1000,
        exitCode: 0,
      },
      {
        type: "commandExecution",
        id: "completed-command-2",
        command: "pnpm typecheck",
        status: "completed",
        aggregatedOutput: "",
        cwd: null,
        processId: null,
        source: null,
        commandActions: [],
        durationMs: 1200,
        exitCode: 0,
      },
      {
        type: "agentMessage",
        id: "after-completed-commands",
        text: "继续检查。",
        phase: "final_answer",
        memoryCitation: null,
      },
    ];

    const html = renderToStaticMarkup(
      <>{renderTurnItems(items, "active", { disableProcessCollapse: true })}</>,
    );

    expect(html).toContain("已运行");
    expect(html).toContain("2 条命令");
    expect(html).not.toContain("pnpm test");
    expect(html).not.toContain("pnpm typecheck");
    expect(html).toContain("继续检查。");
  });

  it("hides statusless reasoning inside processed context", () => {
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

    expect(html).not.toContain("已思考");
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
