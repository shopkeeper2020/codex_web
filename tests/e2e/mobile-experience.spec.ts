import {
  expect,
  type Locator,
  type Page,
  type Route,
  test,
} from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/layout";

const projectRoot = "C:\\workspace\\codex_web";
const activeThreadId = "thread-mobile-active-turn";
const activeTurnId = "turn-mobile-active";

type JsonBody = Record<string, unknown>;

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function expectWithinViewport(
  page: Page,
  locator: Locator,
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (viewport?.width ?? 390) + 1,
  );
}

async function switchComposerToQueuedMode(page: Page): Promise<void> {
  const attachmentButton = page.getByRole("button", { name: "添加附件" });
  await expect(attachmentButton).toBeVisible();
  await expect(async () => {
    const targetSelect = page.getByLabel("发送目标");
    if (
      (await targetSelect.count()) > 0 &&
      (await targetSelect.first().isVisible())
    ) {
      await targetSelect.first().selectOption("start");
    }
    await expect(attachmentButton).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

function activeThread(): JsonBody {
  return {
    id: activeThreadId,
    title: "Mobile active turn",
    projectId: projectRoot,
    path: projectRoot,
    updatedAtIso: "2026-05-29T08:00:00.000Z",
    inProgress: true,
    owner: null,
  };
}

async function installActiveTurnMocks(
  page: Page,
  onInterrupt: (body: JsonBody) => void,
): Promise<void> {
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
        threads: archived ? [] : [activeThread()],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread-detail**", async (route) => {
    await fulfillJson(route, {
      data: {
        thread: activeThread(),
        turns: [
          {
            id: activeTurnId,
            status: "active",
            items: [
              {
                type: "assistant",
                id: "assistant-active-mobile",
                text: "Streaming on mobile",
              },
            ],
          },
        ],
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
      data: { skills: [], errors: [], source: "app-server", warnings: [] },
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

  await page.route("**/api/domain/turn-interrupt", async (route) => {
    onInterrupt(route.request().postDataJSON() as JsonBody);
    await fulfillJson(route, {
      data: { mode: "official-follower", result: { ok: true } },
    });
  });
}

test.describe("codex_web mobile real task flow", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "mobile experience regressions only run in the mobile project",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390);
    await expectNoHorizontalOverflow(page);
  });

  test("opens drawer, searches globally, and reaches settings from mobile actions", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "打开导航" }).first().click();
    await expect(page.getByRole("button", { name: "关闭导航" })).toBeVisible();
    await expect(page.getByLabel("项目和会话").last()).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByRole("button", { name: "关闭导航" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "搜索" }).click();
    const searchDialog = page.getByRole("dialog", { name: "Search" });
    await expect(searchDialog).toBeVisible();
    await expect(page.getByLabel("全局搜索")).toBeFocused();
    await page.getByLabel("全局搜索").fill("mobile-flow-no-match");
    await expect(
      searchDialog.getByRole("heading", { name: "Projects" }),
    ).toBeVisible();
    await expect(
      searchDialog.getByRole("heading", { name: "Threads" }),
    ).toBeVisible();
    await expect(searchDialog.getByText("没有匹配项目")).toBeVisible();
    await expect(searchDialog.getByText("没有匹配会话")).toBeVisible();
    await searchDialog
      .locator("header")
      .getByRole("button", { name: "关闭搜索" })
      .click();
    await expect(searchDialog).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "更多操作" }).click();
    const actionMenu = page.getByRole("menu", { name: "会话操作" });
    await expect(actionMenu).toBeVisible();
    await actionMenu.getByRole("menuitem", { name: "设置与诊断" }).click();

    const settingsDialog = page.getByRole("dialog", {
      name: "Settings / Diagnostics",
    });
    await expect(settingsDialog).toBeVisible();
    await expect(
      settingsDialog.getByRole("tab", { name: "General" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Storage cleanup" }),
    ).toBeVisible();
    await expect(settingsDialog.getByText("Attachments")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps composer attachment and Skills entries tappable", async ({
    page,
  }) => {
    await switchComposerToQueuedMode(page);

    const attachmentButton = page.getByRole("button", { name: "添加附件" });
    await expectWithinViewport(page, attachmentButton);
    await expect(attachmentButton).toBeEnabled();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await attachmentButton.click();
    const fileChooser = await fileChooserPromise;
    expect(fileChooser.isMultiple()).toBeTruthy();

    const skillsButton = page.getByRole("button", {
      name: "Skills",
      exact: true,
    });
    await expectWithinViewport(page, skillsButton);
    await expect(skillsButton).toBeEnabled();
    await skillsButton.click();
    await expect(skillsButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Skills menu")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "关闭 Skills" }).click();
    await expect(skillsButton).toHaveAttribute("aria-expanded", "false");
  });

  test("keeps runtime and sync foldouts inside the 390px viewport", async ({
    page,
  }) => {
    const syncFoldout = page.getByRole("button", { name: /运行状态/ });
    const runtimeFoldout = page.getByRole("button", {
      name: /运行详情/,
    });
    const syncFoldoutPanel = syncFoldout.locator("xpath=..");
    const runtimeFoldoutPanel = runtimeFoldout.locator("xpath=..");

    await expectWithinViewport(page, syncFoldout);
    await expectWithinViewport(page, runtimeFoldout);
    await expect(syncFoldout).toHaveAttribute("aria-expanded", "false");
    await expect(runtimeFoldout).toHaveAttribute("aria-expanded", "false");

    await syncFoldout.click();
    await expect(syncFoldout).toHaveAttribute("aria-expanded", "true");
    await expect(
      syncFoldoutPanel.getByText("实时事件", { exact: true }),
    ).toBeVisible();
    await expect(syncFoldoutPanel.getByText("Owner")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await runtimeFoldout.click();
    await expect(runtimeFoldout).toHaveAttribute("aria-expanded", "true");
    await expect(
      runtimeFoldoutPanel.getByText("等待调用", { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("codex_web mobile active turn controls", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "mobile active turn regressions only run in the mobile project",
    );
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("interrupts the active turn from the mobile action menu", async ({
    page,
  }) => {
    let capturedInterrupt: JsonBody | null = null;
    await installActiveTurnMocks(page, (body) => {
      capturedInterrupt = body;
    });

    await page.goto(`/thread/${activeThreadId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByLabel("发送目标")).toBeVisible();
    await expect(page.getByLabel("发送目标")).toHaveValue("steer");
    await expect(page.getByLabel("发送目标")).toContainText("当前");

    await page.getByRole("button", { name: "更多操作" }).click();
    const actionMenu = page.getByRole("menu", { name: "会话操作" });
    await expect(actionMenu).toBeVisible();
    const stopItem = actionMenu.getByRole("menuitem", {
      name: "停止当前回复",
    });
    await expect(stopItem).toBeEnabled();
    await stopItem.click();

    await expect.poll(() => capturedInterrupt).not.toBeNull();
    expect(capturedInterrupt).toMatchObject({
      threadId: activeThreadId,
      turnId: activeTurnId,
    });
    await expect(actionMenu).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("shows a Desktop-like composer stop button while an active turn is running", async ({
    page,
  }) => {
    let capturedInterrupt: JsonBody | null = null;
    await installActiveTurnMocks(page, (body) => {
      capturedInterrupt = body;
    });

    await page.goto(`/thread/${activeThreadId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("main")).toBeVisible();

    const composerStopButton = page
      .locator("form")
      .getByRole("button", { name: "停止当前回复" });
    await expect(composerStopButton).toBeVisible();
    await expect(composerStopButton).toBeEnabled();
    await composerStopButton.click();

    await expect.poll(() => capturedInterrupt).not.toBeNull();
    expect(capturedInterrupt).toMatchObject({
      threadId: activeThreadId,
      turnId: activeTurnId,
    });
    await expectNoHorizontalOverflow(page);
  });
});
