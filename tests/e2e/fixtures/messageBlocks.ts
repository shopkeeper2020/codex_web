import type { Page, Route } from "@playwright/test";

export const projectRoot = "C:\\workspace\\codex_web";
export const threadId = "thread-message-blocks-e2e";
export const activeStatusThreadId = "thread-active-status-message-blocks-e2e";

type JsonBody = Record<string, unknown>;

const visiblePreviewSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220" viewBox="0 0 420 220">',
  '<rect width="420" height="220" rx="18" fill="#f4f4f5"/>',
  '<rect x="22" y="22" width="376" height="176" rx="14" fill="#ffffff" stroke="#d4d4d8"/>',
  '<path d="M56 152 132 82l58 54 46-42 128 58" fill="none" stroke="#52525b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>',
  '<circle cx="310" cy="72" r="22" fill="#dbeafe" stroke="#60a5fa" stroke-width="8"/>',
  '<text x="52" y="54" font-family="Segoe UI, sans-serif" font-size="18" font-weight="700" fill="#18181b">Image preview</text>',
  '</svg>',
].join("");

const visiblePreviewUrl = `data:image/svg+xml;utf8,${encodeURIComponent(visiblePreviewSvg)}`;

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function clearMockRoutes(page: Page): Promise<void> {
  for (const pattern of [
    "**/api/auth/status",
    "**/api/domain/thread/list**",
    "**/api/domain/thread/read**",
    "**/api/runtime-options",
    "**/api/skills**",
    "**/api/files/list**",
    "**/api/files/preview**",
    "**/api/files/content**",
    "**/api/approvals",
  ]) {
    await page.unroute(pattern).catch(() => undefined);
  }
}

function thread(): JsonBody {
  return {
    id: threadId,
    title: "Complex domain message blocks",
    projectId: projectRoot,
    path: projectRoot,
    updatedAtIso: "2026-05-29T09:00:00.000Z",
    inProgress: false,
    owner: null,
  };
}

function complexTurn(): JsonBody {
  return {
    id: "turn-message-blocks-e2e",
    status: "completed",
    items: [
      {
        type: "user",
        id: "user-long-plain-text-e2e",
        text: [
          "Literal user markdown sentinel **must stay plain**.",
          "",
          "```text",
          "user code fence sentinel",
          "```",
          "",
          "Desktop keeps user messages as plain text and only preserves the author's line breaks.",
          "Long user messages should collapse automatically so they do not dominate the chat area.",
          "The user can expand the bubble when they need to inspect the full prompt.",
          "This line intentionally pushes the message beyond the default collapsed height.",
          "Another long line keeps the fixture close to real prompts with architecture notes and code-looking text.",
          "Final visible sentinel after expansion.",
        ].join("\n"),
      },
      {
        type: "assistant",
        id: "assistant-markdown-e2e",
        text: [
          "Markdown renderer **bold sentinel** with [docs](https://example.com).",
          "Local file reference [implementation_status.md](docs/implementation_status.md).",
          "Line file reference [implementation_status.md:12](docs/implementation_status.md:12).",
          "Plain path reference docs/ui_fidelity.md should also behave like a file chip.",
          "",
          "```ts",
          "const markdownCodeSentinel = 'copyable-code';",
          "```",
          "",
          "| Key | Value |",
          "| --- | --- |",
          "| table | markdown-table-sentinel |",
        ].join("\n"),
      },
      {
        type: "agentTask",
        id: "agent-task-e2e",
        title: "spawnAgent",
        status: "completed",
        prompt: [
          "请协助查证 C:\\workspace\\codex_web\\docs\\agent_task_reference.txt 内的 agent task sentinel。",
          "1) docs/agent_task_reference.txt",
          "2) docs/agent_task_reference_extra.md",
          "3) docs/agent_task_reference_notes.txt",
          "4) docs/agent_task_reference_sources.csv",
          "5) docs/agent_task_reference_transcript.log",
          "6) docs/agent_task_reference_appendix.md",
          "7) docs/agent_task_reference_archive.txt",
          "8) docs/agent_task_reference_hidden_tail.txt agent task collapsed tail sentinel",
          "",
          "任务：输出核对结果，并保留 agent task detail sentinel。",
        ].join("\n"),
        model: "gpt-5.5",
        reasoningEffort: "xhigh",
        agents: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Agent 00000000",
            status: "completed",
            prompt: [
              "请协助查证 C:\\workspace\\codex_web\\docs\\agent_task_reference.txt 内的 agent task sentinel。",
              "1) docs/agent_task_reference.txt",
              "2) docs/agent_task_reference_extra.md",
              "3) docs/agent_task_reference_notes.txt",
              "4) docs/agent_task_reference_sources.csv",
              "5) docs/agent_task_reference_transcript.log",
              "6) docs/agent_task_reference_appendix.md",
              "7) docs/agent_task_reference_archive.txt",
              "8) docs/agent_task_reference_hidden_tail.txt agent task collapsed tail sentinel",
              "",
              "任务：输出核对结果，并保留 agent task detail sentinel。",
            ].join("\n"),
            model: "gpt-5.5",
            reasoningEffort: "xhigh",
          },
        ],
        rawType: "collabAgentToolCall",
      },
      {
        type: "reasoning",
        id: "reasoning-e2e",
        text: "Reasoning checks command shape before rendering diff blocks.",
        collapsed: true,
      },
      {
        type: "command",
        id: "command-e2e",
        command: "pnpm exec playwright test tests/e2e/message-blocks.spec.ts",
        status: "running",
        output: "stdout: message block command ran\nstdout: emitted 2 files",
        stdout: "stdout: message block command ran\nstdout: emitted 2 files",
        stderr: "stderr: simulated warning for renderer coverage",
        cwd: projectRoot,
        durationMs: 1534,
        exitCode: 1,
      },
      {
        type: "reasoning",
        id: "hidden-reasoning-between-operations-e2e",
        text: "Completed reasoning between operations should be hidden and should not split command/file grouping.",
        collapsed: true,
      },
      {
        type: "fileChange",
        id: "file-change-e2e",
        path: "apps/web/src/app/components/MessageBlocks.tsx",
        diff: [
          "diff --git a/apps/web/src/app/components/MessageBlocks.tsx b/apps/web/src/app/components/MessageBlocks.tsx",
          "@@",
          "+message-block coverage sentinel",
        ].join("\n"),
        status: "modified",
      },
      {
        type: "fileChange",
        id: "file-preview-e2e",
        path: "src/path-only-preview.ts",
        diff: "",
        status: "modified",
      },
      {
        type: "plan",
        id: "plan-e2e",
        text: "Renderer verification plan",
        status: "active",
        steps: [
          { text: "Render complex items", status: "completed" },
          { text: "Validate interactions do not throw", status: "active" },
        ],
      },
      {
        type: "approval",
        id: "approval-e2e",
        kind: "command",
        title: "Review command approval",
        body: "Approval block body from domain detail.",
        status: "pending",
        command: "node scripts/dangerous-operation.js --dry-run",
        cwd: projectRoot,
        reason: "mock approval item should render inline with the turn",
      },
      {
        type: "image",
        id: "image-e2e",
        image: {
          url: visiblePreviewUrl,
          path: null,
          mimeType: "image/svg+xml",
          alt: "Generated chart preview",
        },
      },
      {
        type: "image",
        id: "path-image-e2e",
        image: {
          url: `${projectRoot}\\data\\tmp\\path-only-preview.png`,
          path: null,
          mimeType: "image/png",
          alt: "Local path screenshot preview",
        },
      },
      {
        type: "error",
        id: "error-e2e",
        message: "Domain renderer failed gracefully",
        code: "E_MESSAGE_BLOCK_E2E",
        detail: "Stack detail sentinel for collapsed error blocks",
      },
      {
        type: "toolOutput",
        id: "tool-output-e2e",
        title: "MCP filesystem scan",
        text: "tool output sentinel: listed README.md and package.json",
        status: "completed",
        rawType: "mcp.files/list",
      },
      {
        type: "unknown",
        id: "context-compaction-e2e",
        rawType: "contextCompaction",
        raw: {
          reason: "previous context compacted",
        },
      },
      {
        type: "unknown",
        id: "steered-e2e",
        rawType: "steered",
        raw: {
          type: "steered",
          id: "internal-steer-event",
        },
      },
      {
        type: "unknown",
        id: "steering-user-message-e2e",
        rawType: "steeringUserMessage",
        raw: {
          type: "steeringUserMessage",
          id: "internal-steering-user-message-event",
          input: [
            { type: "text", text: "raw steering user message sentinel" },
            {
              type: "image",
              url: visiblePreviewUrl,
              mimeType: "image/svg+xml",
              alt: "Steering user attached image",
            },
          ],
        },
      },
      {
        type: "unknown",
        id: "unknown-e2e",
        rawType: "customDomainItem",
        raw: {
          note: "stabilized unknown item",
          value: 42,
        },
      },
    ],
  };
}

function activeStatusThread(): JsonBody {
  return {
    id: activeStatusThreadId,
    title: "Active status message blocks",
    projectId: projectRoot,
    path: projectRoot,
    updatedAtIso: "2026-05-29T09:30:00.000Z",
    inProgress: true,
    owner: null,
  };
}

function activeCommandReasoningTurn(): JsonBody {
  return {
    id: "turn-active-command-reasoning-e2e",
    status: "active",
    items: [
      {
        type: "assistant",
        id: "assistant-active-command-intro-e2e",
        text: "Active status command intro.",
      },
      {
        type: "command",
        id: "active-command-before-reasoning-e2e",
        command: "pnpm --filter @codex-web/web build",
        status: "inProgress",
        output: "building client bundle...",
        stdout: "building client bundle...",
        stderr: "",
        cwd: projectRoot,
        durationMs: 9400,
        exitCode: null,
      },
      {
        type: "reasoning",
        id: "active-reasoning-after-command-e2e",
        text: "active reasoning sentinel should remain collapsed",
        collapsed: true,
        status: null,
      },
    ],
  };
}

function activeFileChangeTurn(): JsonBody {
  return {
    id: "turn-active-file-change-e2e",
    status: "active",
    items: [
      {
        type: "assistant",
        id: "assistant-active-file-change-intro-e2e",
        text: "Active status file change intro.",
      },
      {
        type: "fileChange",
        id: "active-file-change-e2e",
        path: "docs/implementation_status.md",
        diff: ["@@", "+active edit sentinel"].join("\n"),
        status: null,
      },
    ],
  };
}

async function installMessageBlockMocksWithTurns(page: Page, sourceThread: JsonBody, turns: JsonBody[]): Promise<void> {
  await clearMockRoutes(page);
  await page.route("**/api/domain/thread/list**", async (route) => {
    const url = new URL(route.request().url());
    const archived = url.searchParams.get("archived") === "true";
    await fulfillJson(route, {
      data: {
        projects: [
          {
            id: projectRoot,
            name: "codex_web",
            path: projectRoot,
            source: "official",
          },
        ],
        threads: archived ? [] : [sourceThread],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/auth/status", async (route) => {
    await fulfillJson(route, {
      data: {
        authenticated: true,
        localBypass: true,
        sessionExpiresAtIso: null,
      },
    });
  });

  await page.route("**/api/domain/thread/read**", async (route) => {
    await fulfillJson(route, {
      data: {
        thread: sourceThread,
        turns,
      },
      source: "e2e-mock",
    });
  });

  await page.route("**/api/runtime-options", async (route) => {
    await fulfillJson(route, {
      data: {
        models: [
          {
            id: "default",
            model: "gpt-default",
            displayName: "GPT Default",
            description: "Default test model.",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
            ],
            inputModalities: ["text"],
          },
        ],
        collaborationModes: [
          {
            name: "Default",
            mode: "default",
            model: null,
            reasoningEffort: null,
            developerInstructions: null,
          },
        ],
        defaults: {
          model: "gpt-default",
          reasoningEffort: "medium",
          collaborationModeName: "Default",
        },
        source: {
          models: "app-server",
          collaborationModes: "app-server",
        },
        warnings: [],
      },
    });
  });

  await page.route("**/api/skills**", async (route) => {
    await fulfillJson(route, {
      data: {
        skills: [],
        errors: [],
        source: "app-server",
        warnings: [],
      },
    });
  });

  await page.route("**/api/files/list**", async (route) => {
    await fulfillJson(route, {
      data: {
        root: projectRoot,
        path: projectRoot,
        relativePath: "",
        parentRelativePath: null,
        entries: [],
        limited: false,
      },
    });
  });

  await page.route("**/api/files/preview**", async (route) => {
    await fulfillJson(route, {
      data: {
        path: `${projectRoot}\\src\\path-only-preview.ts`,
        filename: "path-only-preview.ts",
        mimeType: "text/typescript",
        size: 45,
        kind: "text",
        content: "export const filePreviewSentinel = true;\n",
        truncated: false,
      },
    });
  });

  await page.route("**/api/files/content**", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: visiblePreviewSvg,
    });
  });

  await page.route("**/api/approvals", async (route) => {
    await fulfillJson(route, { data: [] });
  });
}

export async function installMessageBlockMocks(page: Page): Promise<void> {
  await installMessageBlockMocksWithTurns(page, thread(), [complexTurn()]);
}

export async function installActiveStatusMessageBlockMocks(page: Page): Promise<void> {
  await installMessageBlockMocksWithTurns(page, activeStatusThread(), [
    activeCommandReasoningTurn(),
    activeFileChangeTurn(),
  ]);
}
