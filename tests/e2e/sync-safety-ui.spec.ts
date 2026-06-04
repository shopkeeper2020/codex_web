import { expect, test, type Page, type Route } from "@playwright/test";

const projectRoot = "C:\\workspace\\codex_web";
const threadId = "thread-owner-unavailable-e2e";

type JsonBody = Record<string, unknown>;

async function fulfillJson(
  route: Route,
  body: JsonBody,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installOwnerFailureMocks(
  page: Page,
  onTurnStart: (body: JsonBody) => void,
): Promise<void> {
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
        threads: archived
          ? []
          : [
              {
                id: threadId,
                title: "Owner unavailable safety",
                projectId: projectRoot,
                path: projectRoot,
                updatedAtIso: "2026-05-29T00:00:00.000Z",
                inProgress: false,
                owner: {
                  clientId: "desktop-owner",
                  kind: "desktop",
                  source: "official-ipc",
                },
              },
            ],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread/read**", async (route) => {
    await fulfillJson(route, {
      data: {
        thread: {
          id: threadId,
          title: "Owner unavailable safety",
          projectId: projectRoot,
          path: projectRoot,
          updatedAtIso: "2026-05-29T00:00:00.000Z",
          inProgress: false,
          owner: {
            clientId: "desktop-owner",
            kind: "desktop",
            source: "official-ipc",
          },
        },
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

  await page.route("**/api/domain/turn/start", async (route) => {
    onTurnStart(route.request().postDataJSON() as JsonBody);
    await fulfillJson(
      route,
      { error: "official-owner-unavailable:thread" },
      409,
    );
  });
}

test.describe("sync safety UI", () => {
  test("keeps composer text and shows a friendly owner failure after send rejection", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "owner 失败提示链路只需要在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installOwnerFailureMocks(page, (body) => {
      capturedTurnStart = body;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const composer = page.getByLabel("输入消息");
    await expect(composer).toBeVisible();
    await composer.fill("this should not fork locally");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "this should not fork locally",
    });
    await expect(composer).toHaveValue("this should not fork locally");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
    await expect(
      page.getByText("当前会话的官方执行端暂时不可用", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("避免三端状态分叉", { exact: false }),
    ).toBeVisible();
  });
});
