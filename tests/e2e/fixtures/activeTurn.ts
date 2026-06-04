import type { Page, Route } from "@playwright/test";

export const activeProjectRoot = "C:\\workspace\\codex_web";
export const activeThreadId = "thread-active-composer-e2e";
export const activeTurnId = "turn-active-composer-e2e";

type JsonBody = Record<string, unknown>;
type ActiveTurnMockOptions = {
  threadOverrides?: JsonBody | (() => JsonBody);
  threadDetailOverrides?: JsonBody | (() => JsonBody);
  isArchived?: () => boolean;
};

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function clearMockRoutes(page: Page): Promise<void> {
  for (const pattern of [
    "**/api/domain/thread/list**",
    "**/api/domain/thread/search**",
    "**/api/domain/thread/read**",
    "**/api/domain/side-conversation-create",
    "**/api/domain/side-conversation-close",
    "**/api/runtime-options",
    "**/api/skills**",
    "**/api/files/list**",
    "**/api/approvals",
  ]) {
    await page.unroute(pattern).catch(() => undefined);
  }
}

function resolveThreadOverrides(
  options: ActiveTurnMockOptions = {},
): JsonBody {
  if (!options.threadOverrides) return {};
  return typeof options.threadOverrides === "function"
    ? options.threadOverrides()
    : options.threadOverrides;
}

function resolveThreadDetailOverrides(
  options: ActiveTurnMockOptions = {},
): JsonBody {
  if (!options.threadDetailOverrides) return {};
  return typeof options.threadDetailOverrides === "function"
    ? options.threadDetailOverrides()
    : options.threadDetailOverrides;
}

function activeThread(options: ActiveTurnMockOptions = {}): JsonBody {
  return {
    id: activeThreadId,
    title: "Active turn composer state",
    projectId: activeProjectRoot,
    path: activeProjectRoot,
    updatedAtIso: "2026-05-29T10:00:00.000Z",
    inProgress: true,
    pinned: false,
    owner: null,
    ...resolveThreadOverrides(options),
  };
}

function activeTurn(): JsonBody {
  return {
    id: activeTurnId,
    status: "active",
    items: [
      {
        type: "user",
        id: "active-user-e2e",
        text: "请继续推进 Desktop 高保真 Composer。",
        images: [],
      },
      {
        type: "reasoning",
        id: "stale-active-reasoning-before-command-e2e",
        text: "This reasoning item has already led to a command and should be hidden while the turn continues.",
        collapsed: true,
      },
      {
        type: "command",
        id: "completed-command-before-active-e2e",
        command: "pnpm --filter @codex-web/domain typecheck",
        status: "running",
        output: "domain typecheck passed",
        stdout: "domain typecheck passed",
        stderr: "",
        cwd: activeProjectRoot,
        durationMs: 2100,
        exitCode: 0,
      },
      {
        type: "reasoning",
        id: "stale-active-reasoning-between-commands-e2e",
        text: "This completed reasoning sits between operation items and should not split the operation group.",
        collapsed: true,
      },
      {
        type: "command",
        id: "completed-command-after-hidden-reasoning-e2e",
        command: "pnpm --filter @codex-web/api typecheck",
        status: "running",
        output: "api typecheck passed",
        stdout: "api typecheck passed",
        stderr: "",
        cwd: activeProjectRoot,
        durationMs: 2400,
        exitCode: 0,
      },
      {
        type: "assistant",
        id: "active-assistant-between-operation-groups-e2e",
        text: "旧命令已经完成，接下来只保留真正仍在运行的尾部命令。",
      },
      {
        type: "command",
        id: "active-command-e2e",
        command: "pnpm --filter @codex-web/web build",
        status: "running",
        output: "building client bundle...",
        stdout: "building client bundle...",
        stderr: "",
        cwd: activeProjectRoot,
        durationMs: 8200,
        exitCode: null,
      },
    ],
  };
}

function activeSideConversations(): JsonBody[] {
  return [
    {
      id: "side-chat-ui-e2e",
      title: "ui和ux有什么区别？",
      createdAtIso: "2026-05-31T08:26:05.000Z",
      updatedAtIso: "2026-05-31T08:30:41.000Z",
      inProgress: false,
      hasUnread: false,
      turnCount: 1,
      turns: [
        {
          id: "side-turn-ui-e2e",
          status: "completed",
          items: [
            {
              type: "user",
              id: "side-user-ui-e2e",
              text: "ui和ux有什么区别？",
            },
            {
              type: "assistant",
              id: "side-assistant-ui-e2e",
              text: "UI 是界面，UX 是体验。",
            },
          ],
        },
      ],
    },
  ];
}

export async function installActiveTurnMocks(
  page: Page,
  options: ActiveTurnMockOptions = {},
): Promise<void> {
  await clearMockRoutes(page);
  let sideConversations = activeSideConversations();
  let createdSideConversationCount = 0;
  await page.route("**/api/domain/thread/list**", async (route) => {
    const url = new URL(route.request().url());
    const archived = url.searchParams.get("archived") === "true";
    const isArchived = Boolean(options.isArchived?.());
    await fulfillJson(route, {
      data: {
        projects: [
          {
            id: activeProjectRoot,
            name: "codex_web",
            path: activeProjectRoot,
            source: "official",
          },
        ],
        threads: archived
          ? isArchived
            ? [activeThread(options)]
            : []
          : isArchived
            ? []
            : [activeThread(options)],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread/read**", async (route) => {
    await fulfillJson(route, {
      data: {
        thread: activeThread(options),
        turns: [activeTurn()],
        sideConversations,
        ...resolveThreadDetailOverrides(options),
      },
      source: "e2e-mock",
    });
  });

  await page.route("**/api/domain/thread/search**", async (route) => {
    const searchTerm =
      new URL(route.request().url()).searchParams.get("searchTerm") ?? "";
    const thread = activeThread(options);
    const results = String(thread.title)
      .toLocaleLowerCase()
      .includes(searchTerm.toLocaleLowerCase())
      ? [{ thread, snippet: String(thread.title) }]
      : [];
    await fulfillJson(route, {
      data: {
        results,
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/side-conversation-create", async (route) => {
    createdSideConversationCount += 1;
    const sideConversation = {
      id: `side-chat-created-e2e-${createdSideConversationCount}`,
      title: `侧边聊天 ${sideConversations.length + 1}`,
      createdAtIso: "2026-05-31T08:40:00.000Z",
      updatedAtIso: "2026-05-31T08:40:00.000Z",
      inProgress: false,
      hasUnread: false,
      turnCount: 0,
      turns: [],
    };
    sideConversations = [...sideConversations, sideConversation];
    await fulfillJson(route, {
      data: {
        sideConversation,
        raw: { id: sideConversation.id },
      },
    });
  });

  await page.route("**/api/domain/side-conversation-close", async (route) => {
    const body = route.request().postDataJSON() as {
      sideConversationId?: string;
    };
    const sideConversationId = body.sideConversationId ?? "";
    sideConversations = sideConversations.filter(
      (conversation) => conversation.id !== sideConversationId,
    );
    await fulfillJson(route, {
      data: {
        ok: true,
        sideConversationId,
        discarded: true,
        interrupted: false,
      },
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
              { reasoningEffort: "high", description: "High" },
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
          {
            name: "Plan",
            mode: "plan",
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
        root: activeProjectRoot,
        path: activeProjectRoot,
        relativePath: "",
        parentRelativePath: null,
        entries: [],
        limited: false,
      },
    });
  });

  await page.route("**/api/approvals", async (route) => {
    await fulfillJson(route, { data: [] });
  });
}
