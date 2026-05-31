import { expect, test, type Page, type Route } from "@playwright/test";

const projectRoot = "C:\\workspace\\codex_web";
const threadCount = 1_000;

type JsonBody = Record<string, unknown>;

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function thread(index: number): JsonBody {
  return {
    id: `long-thread-${index}`,
    title: `Long list thread ${index.toString().padStart(3, "0")}`,
    projectId: projectRoot,
    path: projectRoot,
    updatedAtIso: "2026-05-29T00:00:00.000Z",
    inProgress: false,
    owner: null,
  };
}

async function installLongThreadListMocks(page: Page): Promise<void> {
  const threads = Array.from({ length: threadCount }, (_, index) =>
    thread(index + 1),
  );

  await page.route("**/api/domain/threads**", async (route) => {
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
        threads: archived ? [] : threads,
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread-detail**", async (route) => {
    const requestedThreadId =
      new URL(route.request().url()).searchParams.get("threadId") ??
      "long-thread-1";
    const requestedThread = threads.find(
      (item) => item.id === requestedThreadId,
    );
    await fulfillJson(route, {
      data: {
        thread: requestedThread ?? thread(1),
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
}

test.describe("long thread list", () => {
  test("windows loaded thread rows while keeping deep rows reachable", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "长列表 windowing 只需要在桌面侧栏验证一次",
    );

    await installLongThreadListMocks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const sidebar = page.getByLabel("项目和会话");
    await expect(sidebar.getByText("1000 synced threads")).toBeVisible();
    await expect(sidebar.getByText("Long list thread 001")).toBeVisible();
    await expect(sidebar.getByText("Long list thread 1000")).toHaveCount(0);

    const renderedRows = sidebar
      .getByRole("button")
      .filter({ hasText: "Long list thread" });
    await expect(renderedRows).toHaveCount(22);

    const window = page.getByTestId("thread-list-window");
    await window.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    await expect(sidebar.getByText("Long list thread 1000")).toBeVisible();
    await expect(sidebar.getByText("Long list thread 001")).toHaveCount(0);
  });

  test("searches across a loaded 1000-thread list without requiring manual scroll", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "长列表搜索范围只需要在桌面侧栏验证一次",
    );

    await installLongThreadListMocks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const sidebar = page.getByLabel("项目和会话");
    await sidebar
      .getByPlaceholder("搜索项目、会话或文件")
      .fill("Long list thread 1000");

    await expect(sidebar.getByText("Long list thread 1000")).toBeVisible();
    await expect(sidebar.getByText("Long list thread 001")).toHaveCount(0);
    await expect(
      sidebar.getByRole("button").filter({ hasText: "Long list thread" }),
    ).toHaveCount(1);
  });
});
