import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { installActiveTurnMocks, activeThreadId } from "./fixtures/activeTurn";
import {
  approvalThreadId,
  installApprovalCardMocks,
} from "./fixtures/approvalCard";
import { installLockedAuthMocks } from "./fixtures/authGate";
import { installEmptyThreadListMocks } from "./fixtures/emptyState";
import { installMessageBlockMocks, threadId } from "./fixtures/messageBlocks";
import { expectNoHorizontalOverflow } from "./helpers/layout";

async function prepareStableScreenshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts?.ready);
}

async function waitForShellSettled(page: Page): Promise<void> {
  await expect(page.getByLabel("输入消息")).toBeVisible();
  await expect(page.getByText("正在读取会话内容...")).toHaveCount(0, {
    timeout: 15_000,
  });
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (viewportWidth > 980) {
    await expect(page.getByLabel("运行状态").getByText("loading")).toHaveCount(0, {
      timeout: 15_000,
    });
  }
  await page.waitForTimeout(120);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const screenshot = await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(
      "ui-fidelity",
      `${testInfo.project.name}-${name}.png`,
    ),
  });
  await testInfo.attach(`ui-fidelity-${testInfo.project.name}-${name}`, {
    body: screenshot,
    contentType: "image/png",
  });
}

async function expectDesktopShellGeometry(page: Page): Promise<void> {
  const activityPanel = page.getByLabel("运行状态");
  const composer = page.getByLabel("Composer");

  await expect(activityPanel).toBeVisible();
  await expect(composer).toBeVisible();

  const activityBox = await activityPanel.boundingBox();
  const composerBox = await composer.boundingBox();

  expect(activityBox, "desktop activity panel bounds").not.toBeNull();
  expect(composerBox, "desktop composer bounds").not.toBeNull();

  if (!activityBox || !composerBox) return;

  expect(activityBox.width, "desktop right activity panel width").toBeGreaterThanOrEqual(320);
  expect(
    composerBox.x + composerBox.width,
    "composer should stay left of the right activity panel",
  ).toBeLessThanOrEqual(activityBox.x - 24);
}

test.describe("codex_web UI fidelity baseline captures", () => {
  test("captures LAN login gate", async ({ page }, testInfo) => {
    test.setTimeout(30_000);

    await installLockedAuthMocks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const loginForm = page.getByRole("form", { name: "LAN login" });
    await expect(loginForm).toBeVisible();
    await expect(loginForm.getByLabel("访问密码")).toBeVisible();
    await expect(loginForm.getByRole("button", { name: "进入" })).toBeDisabled();
    await expectNoHorizontalOverflow(page, "ui fidelity login gate");
    await prepareStableScreenshot(page);
    await capture(page, testInfo, "login-gate");
  });

  test("captures thread sync loading and empty states", async ({
    page,
  }, testInfo) => {
    test.setTimeout(45_000);

    const { releaseThreadList } = await installEmptyThreadListMocks(page, {
      deferThreadList: true,
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "正在同步会话" }),
    ).toBeVisible();
    await expect(
      page.getByText("这个会话暂时没有可展示内容"),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "ui fidelity thread sync loading");
    await prepareStableScreenshot(page);
    await capture(page, testInfo, "thread-sync-loading");

    releaseThreadList();
    await expect(
      page.getByRole("heading", { name: "选择一个会话" }),
    ).toBeVisible();
    if (!testInfo.project.name.includes("mobile")) {
      await expect(page.getByText("没有匹配的会话")).toBeVisible();
    }
    await expectNoHorizontalOverflow(page, "ui fidelity empty thread list");
    await prepareStableScreenshot(page);
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "empty-thread-list");

    if (testInfo.project.name.includes("mobile")) {
      await page.getByRole("button", { name: "打开导航" }).first().click();
      await expect(
        page.getByRole("button", { name: "关闭导航" }),
      ).toBeVisible();
      await expect(page.getByText("没有匹配的会话").last()).toBeVisible();
      await expectNoHorizontalOverflow(page, "ui fidelity empty mobile drawer");
      await prepareStableScreenshot(page);
      await capture(page, testInfo, "empty-mobile-drawer");
    }
  });

  test("captures repeatable shell, search, settings, and debug screenshots", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await waitForShellSettled(page);
    await prepareStableScreenshot(page);
    await expectNoHorizontalOverflow(page, "ui fidelity shell");
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "shell");

    await installMessageBlockMocks(page);
    await page.goto(`/thread/${threadId}`, { waitUntil: "domcontentloaded" });
    const chat = page.getByLabel("会话", { exact: true });
    await expect(
      chat.getByRole("heading", { name: "Complex domain message blocks" }),
    ).toBeVisible();
    await waitForShellSettled(page);
    await expect(chat.getByText("已思考").first()).toHaveCount(0);
    await expect(chat.getByText("已运行").first()).toBeVisible();
    await expect(chat.getByText("1 条命令，2 个文件变更")).toBeVisible();
    await expect(chat.getByText("上下文已自动压缩")).toBeVisible();
    await expectNoHorizontalOverflow(page, "ui fidelity message blocks");
    await prepareStableScreenshot(page);
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "message-blocks");

    if (testInfo.project.name.includes("mobile")) {
      await page.getByRole("button", { name: "打开导航" }).first().click();
      await expect(
        page.getByRole("button", { name: "关闭导航" }),
      ).toBeVisible();
      await capture(page, testInfo, "mobile-drawer");
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(page.getByRole("button", { name: "关闭导航" })).toHaveCount(
        0,
      );

      await page.getByRole("button", { name: "搜索" }).click();
    } else {
      await page.getByRole("button", { name: "Search" }).click();
    }
    const searchDialog = page.getByRole("dialog", { name: "Search" });
    await expect(searchDialog).toBeVisible();
    await page.getByLabel("全局搜索").fill("ui-fidelity-no-match");
    await capture(page, testInfo, "search-empty");

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const settingsDialog = page.getByRole("dialog", {
      name: "Settings / Diagnostics",
    });
    await expect(settingsDialog).toBeVisible();
    await prepareStableScreenshot(page);
    await capture(page, testInfo, "settings-general");
    await settingsDialog.getByRole("tab", { name: "Diagnostics" }).click();
    await expect(
      settingsDialog.getByRole("heading", { name: "Diagnostics controls" }),
    ).toBeVisible();
    await capture(page, testInfo, "settings-diagnostics");

    await page.goto("/debug", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Debug diagnostics")).toBeVisible();
    await prepareStableScreenshot(page);
    await capture(page, testInfo, "debug");

    if (testInfo.project.name.includes("mobile")) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByLabel("输入消息")).toBeVisible();
      await prepareStableScreenshot(page);
      await page.getByRole("button", { name: "Skills", exact: true }).click();
      await expect(page.getByLabel("Skills menu")).toBeVisible();
      await capture(page, testInfo, "mobile-skills");
    }
  });

  test("captures active turn composer states", async ({ page }, testInfo) => {
    test.setTimeout(45_000);

    await installActiveTurnMocks(page);
    await page.goto(`/thread/${activeThreadId}`, { waitUntil: "domcontentloaded" });
    await waitForShellSettled(page);
    await expect(page.getByText("正在思考").first()).toHaveCount(0);
    await expect(page.getByText("已运行").first()).toBeVisible();
    await expect(page.getByText("2 条命令").first()).toBeVisible();
    await expect(page.getByText("正在执行").first()).toBeVisible();
    const composer = page.getByRole("form", { name: "Composer" });
    await expect(composer.getByRole("button", { name: "停止当前回复" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "ui fidelity active composer stop");
    await prepareStableScreenshot(page);
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "active-composer-stop");

    await composer.getByLabel("输入消息").fill("请沿当前回复继续补充");
    await expect(composer.getByLabel("发送目标")).toHaveValue("steer");
    await expect(composer.getByRole("button", { name: "发送" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "ui fidelity active composer steer");
    await prepareStableScreenshot(page);
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "active-composer-steer");

    await composer.getByLabel("发送目标").selectOption("start");
    await expect(composer.getByLabel("发送目标")).toHaveValue("start");
    await expect(composer.getByRole("button", { name: "发送" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "ui fidelity active composer queue");
    await prepareStableScreenshot(page);
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "active-composer-queue");
  });

  test("captures pending approval card states", async ({ page }, testInfo) => {
    test.setTimeout(45_000);

    await installApprovalCardMocks(page);
    await page.goto(`/thread/${approvalThreadId}`, {
      waitUntil: "domcontentloaded",
    });
    await waitForShellSettled(page);
    await expect(
      page.getByRole("heading", { name: "Apply guarded file changes" }),
    ).toBeVisible();
    await expect(page.getByText("1 个待处理")).toBeVisible();
    await expectNoHorizontalOverflow(page, "ui fidelity approval pending");
    await prepareStableScreenshot(page);
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "approval-card-pending");

    await page.getByRole("button", { name: "展开内容" }).last().click();
    await expect(page.getByText("+expect(decisionBody).toEqual")).toBeVisible();
    await expectNoHorizontalOverflow(page, "ui fidelity approval expanded");
    await prepareStableScreenshot(page);
    if (!testInfo.project.name.includes("mobile")) {
      await expectDesktopShellGeometry(page);
    }
    await capture(page, testInfo, "approval-card-expanded");
  });
});
