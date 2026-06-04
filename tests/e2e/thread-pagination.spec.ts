import { expect, test, type Page, type Route } from "@playwright/test";

const projectRoot = "C:\\workspace\\codex_web";

type JsonBody = Record<string, unknown>;

function thread(id: string, title: string, archived = false): JsonBody {
  return {
    id,
    title,
    projectId: projectRoot,
    path: projectRoot,
    updatedAtIso: archived
      ? "2026-05-28T00:00:00.000Z"
      : "2026-05-29T00:00:00.000Z",
    inProgress: false,
    owner: null,
  };
}

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installThreadPaginationMocks(page: Page): Promise<{
  normalCursors: string[];
  archivedCursors: string[];
}> {
  const normalCursors: string[] = [];
  const archivedCursors: string[] = [];

  await page.route("**/api/domain/thread/list**", async (route) => {
    const url = new URL(route.request().url());
    const archived = url.searchParams.get("archived") === "true";
    const cursor = url.searchParams.get("cursor") ?? "";
    const cursorLog = archived ? archivedCursors : normalCursors;
    cursorLog.push(cursor);

    const firstPageThread = archived
      ? thread("archived-page-one", "Archived page one", true)
      : thread("thread-page-one", "First page thread");
    const secondPageThread = archived
      ? thread("archived-page-two", "Archived page two", true)
      : thread("thread-page-two", "Second page thread");
    const expectedCursor = archived ? "archived-cursor-two" : "cursor-two";
    const isSecondPage = cursor === expectedCursor;

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
        threads: [isSecondPage ? secondPageThread : firstPageThread],
        nextCursor: isSecondPage ? null : expectedCursor,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread/read**", async (route) => {
    const url = new URL(route.request().url());
    const requestedThreadId =
      url.searchParams.get("threadId") || "thread-page-one";
    const archived = requestedThreadId.startsWith("archived-");
    await fulfillJson(route, {
      data: {
        thread: thread(
          requestedThreadId,
          archived ? "Archived page one" : "First page thread",
          archived,
        ),
        turns: [],
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

  await page.route("**/api/approvals", async (route) => {
    await fulfillJson(route, { data: [] });
  });

  return { normalCursors, archivedCursors };
}

test.describe("thread list pagination", () => {
  test("loads additional normal and archived thread pages with cursors", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "分页 cursor 交互只需要在桌面侧栏验证一次",
    );

    const { normalCursors, archivedCursors } =
      await installThreadPaginationMocks(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const sidebar = page.getByLabel("项目和会话");
    await expect(sidebar.getByText("First page thread")).toBeVisible();
    await expect(sidebar.getByText("Archived page one")).toBeVisible();
    await expect(sidebar.getByText("1+ 个同步会话")).toBeVisible();

    await sidebar.getByRole("button", { name: "加载更多会话" }).click();
    await expect(sidebar.getByText("Second page thread")).toBeVisible();
    expect(normalCursors).toContain("cursor-two");
    await expect(
      sidebar.getByRole("button", { name: "加载更多会话" }),
    ).toHaveCount(0);

    await sidebar.getByRole("button", { name: "加载更多归档" }).click();
    await expect(sidebar.getByText("Archived page two")).toBeVisible();
    expect(archivedCursors).toContain("archived-cursor-two");
    await expect(
      sidebar.getByRole("button", { name: "加载更多归档" }),
    ).toHaveCount(0);
  });
});
