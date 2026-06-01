import { expect, test } from "@playwright/test";
import { installLockedAuthMocks } from "./fixtures/authGate";
import {
  activeProjectRoot,
  activeThreadId,
  installActiveTurnMocks,
} from "./fixtures/activeTurn";
import { expectNoHorizontalOverflow } from "./helpers/layout";

test.describe("codex_web app shell", () => {
  test("requires a LAN password before entering from a remote device", async ({
    page,
  }) => {
    const { loginBodies } = await installLockedAuthMocks(page, {
      validPassword: "correct-password",
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const loginForm = page.getByRole("form", { name: "LAN login" });
    await expect(loginForm).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "codex_web" }),
    ).toBeVisible();
    await expect(page.getByText("局域网访问需要输入")).toBeVisible();
    await expect(loginForm.getByLabel("访问密码")).toBeFocused();
    await expect(
      loginForm.getByRole("button", { name: "进入" }),
    ).toBeDisabled();
    await expectNoHorizontalOverflow(page, "locked login form");

    await loginForm.getByLabel("访问密码").fill("wrong-password");
    await loginForm.getByRole("button", { name: "进入" }).click();
    await expect(page.getByText("访问密码错误")).toBeVisible();
    expect(loginBodies[0]).toEqual({ password: "wrong-password" });

    await loginForm.getByLabel("访问密码").fill("correct-password");
    await loginForm.getByRole("button", { name: "进入" }).click();
    await expect(page.locator("main")).toBeVisible();
    expect(loginBodies[1]).toEqual({ password: "correct-password" });
  });

  test("keeps first thread sync in an explicit loading state", async ({
    page,
  }, testInfo) => {
    let releaseThreadRoutes: (() => void) | null = null;
    const threadRoutesReady = new Promise<void>((resolve) => {
      releaseThreadRoutes = resolve;
    });
    await page.route("**/api/domain/threads**", async (route) => {
      await threadRoutesReady;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            projects: [],
            threads: [],
            nextCursor: null,
            backwardsCursor: null,
          },
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "正在同步会话" }),
    ).toBeVisible();
    await expect(page.getByText("这个会话暂时没有可展示内容")).toHaveCount(0);

    releaseThreadRoutes?.();
    if (testInfo.project.name.includes("mobile")) {
      await expect(
        page.getByRole("heading", { name: "选择一个会话" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "更多操作" }).click();
      const actionMenu = page.getByRole("menu", { name: "会话操作" });
      await expect(actionMenu).toBeVisible();
      await expect(
        actionMenu.getByRole("menuitem", { name: "重命名会话" }),
      ).toBeDisabled();
      await expect(
        actionMenu.getByRole("menuitem", { name: "归档会话" }),
      ).toBeDisabled();
      await expect(
        actionMenu.getByRole("menuitem", { name: "停止当前回复" }),
      ).toBeDisabled();
    } else {
      await expect(page.getByText("没有匹配的会话")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "打开本地环境" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "折叠置顶摘要" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "打开命令行" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "打开命令行" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "打开右侧栏" }),
      ).toBeVisible();
    }
  });

  test("renders the root shell and captures a visual smoke screenshot", async ({
    page,
  }, testInfo) => {
    await installActiveTurnMocks(page);
    await page.unroute("**/api/files/list**").catch(() => undefined);
    await page.route("**/api/files/list**", async (route) => {
      const url = new URL(route.request().url());
      const root =
        url.searchParams.get("root") ?? "C:\\workspace\\codex_web";
      const relativePath = url.searchParams.get("path") ?? "";
      const rootEntries = [
        {
          name: "apps",
          path: `${root}\\apps`,
          relativePath: "apps",
          kind: "directory",
          extension: null,
          size: null,
          mtimeIso: "2026-05-31T00:00:00.000Z",
        },
        {
          name: "AGENTS.md",
          path: `${root}\\AGENTS.md`,
          relativePath: "AGENTS.md",
          kind: "file",
          extension: ".md",
          size: 1234,
          mtimeIso: "2026-05-31T00:00:00.000Z",
        },
        ...Array.from({ length: 32 }, (_, index) => ({
          name: `fixture-${String(index + 1).padStart(2, "0")}.ts`,
          path: `${root}\\fixture-${String(index + 1).padStart(2, "0")}.ts`,
          relativePath: `fixture-${String(index + 1).padStart(2, "0")}.ts`,
          kind: "file",
          extension: ".ts",
          size: 2048 + index,
          mtimeIso: "2026-05-31T00:00:00.000Z",
        })),
      ];
      const entries =
        relativePath === "apps"
          ? [
              {
                name: "nested.txt",
                path: `${root}\\apps\\nested.txt`,
                relativePath: "apps/nested.txt",
                kind: "file",
                extension: ".txt",
                size: 88,
                mtimeIso: "2026-05-31T00:00:00.000Z",
              },
            ]
          : rootEntries;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            root,
            path: relativePath ? `${root}\\${relativePath}` : root,
            relativePath,
            parentRelativePath: relativePath ? "" : null,
            entries,
            limited: false,
          },
        }),
      });
    });
    await page.route("**/api/files/preview**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.searchParams.get("path") ?? "AGENTS.md";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            path,
            filename: path.split(/[\\/]/).at(-1) ?? "file.txt",
            mimeType: "text/markdown",
            size: 42,
            kind: "text",
            content: "# AGENTS\n\nright sidebar preview sentinel",
            truncated: false,
          },
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const root = page.locator("#root");
    await expect(root).toBeVisible();
    await expect(page.locator("#root > *")).toHaveCount(1);
    await expectNoHorizontalOverflow(page, "root shell");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByLabel("输入消息")).toBeVisible();
    await expect(page.getByLabel("打开输入选项")).toBeVisible();
    await expect(page.getByLabel("协作模式")).toHaveCount(0);
    await expect(page.getByLabel("模型与思考深度")).toBeVisible();

    const runtimeButton = page.getByRole("button", {
      name: "模型与思考深度",
    });
    await runtimeButton.click();
    await expect(
      page.getByRole("menu", { name: "模型与思考深度" }),
    ).toBeVisible();
    await runtimeButton.click();

    await page.getByLabel("打开输入选项").click();
    const inputMenu = page.getByRole("menu", { name: "输入选项" });
    await expect(inputMenu).toBeVisible();
    await expect(
      inputMenu.getByRole("menuitemradio", { name: "目标" }),
    ).toBeVisible();
    await inputMenu.getByRole("button", { name: "插件" }).click();
    await page.keyboard.press("Escape");
    await expect(inputMenu).toHaveCount(0);

    if (testInfo.project.name.includes("mobile")) {
      await expect(
        page.getByRole("button", { name: "打开导航" }).first(),
      ).toBeVisible();
    } else {
      await expect(page.getByText("codex_web").first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: /全部会话/ }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
      await page.getByRole("button", { name: "Search" }).click();
      const searchDialog = page.getByRole("dialog", { name: "Search" });
      await expect(searchDialog).toBeVisible();
      await page.getByLabel("全局搜索").fill("codex");
      await expect(
        searchDialog.getByRole("heading", { name: "Projects" }),
      ).toBeVisible();
      await searchDialog
        .locator("header")
        .getByRole("button", { name: "关闭搜索" })
        .click();
      await expect(
        page.getByRole("button", { name: "Settings menu" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Settings menu" }).click();
      const settingsMenu = page.getByRole("menu", { name: "账户与设置" });
      await expect(settingsMenu).toBeVisible();
      await expect(
        page.getByRole("dialog", { name: "Settings / Diagnostics" }),
      ).toHaveCount(0);
      await settingsMenu.getByRole("menuitem", { name: "设置" }).click();
      await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
      await page.getByRole("tab", { name: "Security" }).click();
      await expect(
        page.getByRole("heading", { name: "Security sessions" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "关闭设置与诊断" }).last().click();
      await page.getByRole("button", { name: /ui和ux有什么区别/ }).click();
      await expect(
        page.getByRole("complementary", { name: "右侧栏" }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "ui和ux有什么区别？" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "侧边聊天" })
          .getByText(/UI 是/)
          .first(),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "侧边聊天输入" }),
      ).toBeVisible();
      const pinnedSummaryTabList = page.getByRole("tablist", {
        name: "右侧栏标签",
      });
      await pinnedSummaryTabList
        .getByRole("button", { name: /^关闭.*标签$/ })
        .click();
      await expect(pinnedSummaryTabList.getByRole("tab")).toHaveCount(0);
      await page.getByRole("button", { name: "折叠右侧栏" }).click();
      await expect(
        page.getByRole("complementary", { name: "右侧栏" }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "打开右侧栏" }).click();
      await expect(
        page.getByRole("complementary", { name: "右侧栏" }),
      ).toBeVisible();
      const rightTabList = page.getByRole("tablist", { name: "右侧栏标签" });
      const rightSidebar = page.getByRole("complementary", {
        name: "右侧栏",
      });
      await expect(
        rightSidebar.getByRole("button", { name: /文件 浏览项目文件/ }),
      ).toBeVisible();
      await expect(rightTabList.getByRole("tab")).toHaveCount(0);
      await expect(
        rightSidebar.getByRole("button", { name: /文件 浏览项目文件/ }),
      ).toBeVisible();
      await expect(rightSidebar.getByText("Ctrl+P")).toHaveCount(0);
      await expect(rightSidebar.getByText("Ctrl+T")).toHaveCount(0);
      await expect(rightSidebar.getByText("Ctrl+Shift+G")).toHaveCount(0);
      await page.getByRole("button", { name: /文件 浏览项目文件/ }).click();
      await expect(page.getByRole("tab", { name: "打开文件" })).toBeVisible();
      await expect(rightTabList.getByRole("tab")).toHaveCount(1);
      await expect(page.getByText("从工作区目录树中选择文件")).toBeVisible();
      await page.getByRole("button", { name: "新建侧栏标签" }).click();
      await page.getByRole("button", { name: /文件 浏览项目文件/ }).click();
      await expect(page.getByRole("tab", { name: "打开文件" })).toHaveCount(2);
      await page.getByRole("button", { name: "新建侧栏标签" }).click();
      await page.getByRole("button", { name: /侧边聊天 发起侧边对话/ }).click();
      await expect(rightTabList.getByRole("tab")).toHaveCount(3);
      await expect(
        page.getByRole("textbox", { name: "侧边聊天输入" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "新建侧栏标签" }).click();
      await page.getByRole("button", { name: /侧边聊天 发起侧边对话/ }).click();
      await expect(rightTabList.getByRole("tab")).toHaveCount(4);
      await rightTabList
        .getByRole("button", { name: /^关闭.*标签$/ })
        .last()
        .click();
      await expect(rightTabList.getByRole("tab")).toHaveCount(3);
      await rightTabList
        .getByRole("button", { name: /^关闭.*标签$/ })
        .last()
        .click();
      await expect(rightTabList.getByRole("tab")).toHaveCount(2);
      await expect(
        page.getByRole("tab", { name: "打开文件" }).last(),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("separator", { name: "调整右侧栏宽度" }),
      ).toBeVisible();
      await expect(
        page.getByRole("separator", { name: "调整文件树宽度" }),
      ).toBeVisible();
      const rightPanel = page.getByRole("complementary", { name: "右侧栏" });
      const rightPanelBefore = await rightPanel.boundingBox();
      expect(rightPanelBefore).not.toBeNull();
      const rightResize = page.getByRole("separator", {
        name: "调整右侧栏宽度",
      });
      const rightResizeBox = await rightResize.boundingBox();
      expect(rightResizeBox).not.toBeNull();
      await page.mouse.move(
        (rightResizeBox?.x ?? 0) + (rightResizeBox?.width ?? 0) / 2,
        (rightResizeBox?.y ?? 0) + (rightResizeBox?.height ?? 0) / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        (rightResizeBox?.x ?? 0) - 90,
        (rightResizeBox?.y ?? 0) + (rightResizeBox?.height ?? 0) / 2,
      );
      await page.mouse.up();
      await expect
        .poll(async () => (await rightPanel.boundingBox())?.width ?? 0)
        .toBeGreaterThan((rightPanelBefore?.width ?? 0) + 60);
      await expect
        .poll(async () =>
          Number(
            await page.evaluate(() =>
              window.localStorage.getItem("codex_web.rightSidebarWidth"),
            ),
          ),
        )
        .toBeGreaterThan(600);

      const fileList = page.getByRole("list", { name: "项目文件" }).last();
      await expect(fileList).toBeVisible();
      const rightFileList = page.getByTestId("right-file-list");
      const rightFileBrowser = page.getByTestId("right-file-browser");
      await expect
        .poll(
          async () =>
            await rightFileList.evaluate(
              (element) => element.scrollHeight > element.clientHeight,
            ),
        )
        .toBe(true);
      await rightFileList.getByRole("button", { name: /AGENTS\.md/ }).click();
      await expect(
        page.getByText("right sidebar preview sentinel"),
      ).toBeVisible();
      await rightFileList.getByRole("button", { name: /apps/ }).click();
      await expect(
        rightFileList.getByRole("button", { name: /nested\.txt/ }),
      ).toBeVisible();
      await expect
        .poll(
          async () =>
            await rightFileBrowser.evaluate(
              (element) => element.getBoundingClientRect().height,
            ),
        )
        .toBeLessThan(180);
      const fileListBefore = await fileList.boundingBox();
      expect(fileListBefore).not.toBeNull();
      const fileTreeResize = page.getByRole("separator", {
        name: "调整文件树宽度",
      });
      const fileTreeResizeBox = await fileTreeResize.boundingBox();
      expect(fileTreeResizeBox).not.toBeNull();
      await page.mouse.move(
        (fileTreeResizeBox?.x ?? 0) + (fileTreeResizeBox?.width ?? 0) / 2,
        (fileTreeResizeBox?.y ?? 0) + (fileTreeResizeBox?.height ?? 0) / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        (fileTreeResizeBox?.x ?? 0) - 70,
        (fileTreeResizeBox?.y ?? 0) + (fileTreeResizeBox?.height ?? 0) / 2,
      );
      await page.mouse.up();
      await expect
        .poll(async () => (await fileList.boundingBox())?.width ?? 0)
        .toBeGreaterThan((fileListBefore?.width ?? 0) + 40);
      await expect
        .poll(async () =>
          Number(
            await page.evaluate(() =>
              window.localStorage.getItem("codex_web.fileTreeWidth"),
            ),
          ),
        )
        .toBeGreaterThan(300);
      await rightTabList
        .getByRole("button", { name: /^关闭.*标签$/ })
        .first()
        .click();
      await rightTabList
        .getByRole("button", { name: /^关闭.*标签$/ })
        .first()
        .click();
      await expect(rightTabList.getByRole("tab")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /文件 浏览项目文件/ }),
      ).toBeVisible();
      await page.getByRole("button", { name: /审查 查看代码更改/ }).click();
      await expect(page.getByRole("tab", { name: "审查" })).toBeVisible();
    }

    const screenshot = await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`${testInfo.project.name}-app-shell.png`),
    });
    await testInfo.attach(`${testInfo.project.name}-app-shell`, {
      body: screenshot,
      contentType: "image/png",
    });
  });

  test("keeps the project filter unchanged when opening a thread from all sessions", async ({
    page,
  }, testInfo) => {
    await installActiveTurnMocks(page);
    const mcpProjectRoot = "C:\\workspace\\mcp_server";
    const codexThread = {
      id: "thread-codex-web",
      title: "你是谁?",
      projectId: activeProjectRoot,
      path: activeProjectRoot,
      updatedAtIso: "2026-06-01T02:40:00.000Z",
      inProgress: false,
      pinned: false,
      owner: null,
    };
    const mcpThread = {
      id: "thread-mcp-server",
      title: "部署 newapi",
      projectId: mcpProjectRoot,
      path: mcpProjectRoot,
      updatedAtIso: "2026-06-01T02:31:00.000Z",
      inProgress: false,
      pinned: false,
      owner: null,
    };

    await page.unroute("**/api/domain/threads**").catch(() => undefined);
    await page.route("**/api/domain/threads**", async (route) => {
      const url = new URL(route.request().url());
      const archived = url.searchParams.get("archived") === "true";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            projects: [
              {
                id: activeProjectRoot,
                name: "codex_web",
                path: activeProjectRoot,
                source: "official",
              },
              {
                id: mcpProjectRoot,
                name: "mcp_server",
                path: mcpProjectRoot,
                source: "official",
              },
            ],
            threads: archived ? [] : [codexThread, mcpThread],
            nextCursor: null,
            backwardsCursor: null,
          },
        }),
      });
    });
    await page.unroute("**/api/domain/thread-detail**").catch(() => undefined);
    await page.route("**/api/domain/thread-detail**", async (route) => {
      const url = new URL(route.request().url());
      const thread =
        url.searchParams.get("threadId") === mcpThread.id
          ? mcpThread
          : codexThread;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            thread,
            turns: [
              {
                id: `${thread.id}-turn`,
                status: "completed",
                items: [
                  {
                    type: "assistant",
                    id: `${thread.id}-assistant`,
                    text: `${thread.title} thread body`,
                  },
                ],
              },
            ],
            subAgents: [],
            sideConversations: [],
          },
          source: "e2e-mock",
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (testInfo.project.name.includes("mobile")) {
      await page.getByRole("button", { name: "打开导航" }).first().click();
    }

    let sidebar = page.getByLabel("项目和会话").last();
    await expect(sidebar.getByRole("button", { name: /全部会话/ })).toBeVisible();
    await expect(sidebar.getByText("部署 newapi", { exact: true })).toBeVisible();
    await sidebar.getByText("你是谁?", { exact: true }).click();

    await expect(page).toHaveURL(/\/thread\/thread-codex-web$/);
    await expect(page.getByText("你是谁? thread body")).toBeVisible();

    if (testInfo.project.name.includes("mobile")) {
      await page.getByRole("button", { name: "打开导航" }).first().click();
    }
    sidebar = page.getByLabel("项目和会话").last();
    await expect(sidebar.getByRole("button", { name: /全部会话/ })).toBeVisible();
    await expect(sidebar.getByText("部署 newapi", { exact: true })).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "选择项目 codex_web" }),
    ).toHaveAttribute("title", "当前会话所属项目");
  });

  test("restores pinned summary after closing the real right sidebar", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "Desktop-only header interaction",
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const activityPanel = page.getByRole("complementary", {
      name: "运行状态",
    });
    await expect(activityPanel).toBeVisible();

    await page.getByRole("button", { name: "打开右侧栏" }).click();
    await expect(
      page.getByRole("complementary", { name: "右侧栏" }),
    ).toBeVisible();
    await expect(activityPanel).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "打开置顶摘要" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "折叠右侧栏" }).click();
    await expect(
      page.getByRole("complementary", { name: "右侧栏" }),
    ).toHaveCount(0);
    await expect(activityPanel).toBeVisible();
    await expect(
      page.getByRole("button", { name: "折叠置顶摘要" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "打开右侧栏" }).click();
    await expect(
      page.getByRole("complementary", { name: "右侧栏" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "打开置顶摘要" }).click();
    await expect(
      page.getByRole("complementary", { name: "右侧栏" }),
    ).toHaveCount(0);
    await expect(activityPanel).toBeVisible();
    await expect(
      page.getByRole("button", { name: "折叠置顶摘要" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "折叠置顶摘要" }).click();
    await expect(activityPanel).toHaveCount(0);
    await page.getByRole("button", { name: "打开右侧栏" }).click();
    await page.getByRole("button", { name: "折叠右侧栏" }).click();
    await expect(activityPanel).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "打开置顶摘要" }),
    ).toBeVisible();
  });

  test("renders synced Desktop side chats without creating a private thread", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "Desktop-only right sidebar regression",
    );

    await installActiveTurnMocks(page);
    let createCalled = 0;
    const turnStartBodies: Array<Record<string, unknown>> = [];

    await page.route("**/api/domain/thread-create", async (route) => {
      createCalled += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "side chat must use official sync" }),
      });
    });

    await page.route("**/api/domain/turn-start", async (route) => {
      turnStartBodies.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { mode: "official-follower", result: { ok: true } },
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "打开右侧栏" }).click();

    const sideChat = page.getByRole("region", { name: "侧边聊天" });
    await expect(sideChat).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "ui和ux有什么区别？" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("tablist", { name: "右侧栏标签" })
        .getByRole("tab"),
    ).toHaveCount(1);
    await expect(sideChat.getByText("UI 是界面，UX 是体验。")).toBeVisible();
    const firstSideInput = sideChat.getByRole("textbox", {
      name: "侧边聊天输入",
    });
    await expect(firstSideInput).toBeEnabled();
    await firstSideInput.fill("再举一个例子");
    await sideChat.getByRole("button", { name: "发送侧边消息" }).click();
    await expect.poll(() => turnStartBodies.length).toBe(1);
    expect(turnStartBodies[0]).toMatchObject({
      threadId: "side-chat-ui-e2e",
      text: "再举一个例子",
      attachmentIds: [],
    });
    await expect(firstSideInput).toHaveValue("");

    await page.getByRole("button", { name: "新建侧栏标签" }).click();
    await page.getByRole("button", { name: /侧边聊天 发起侧边对话/ }).click();
    await expect(page.getByRole("tab", { name: "侧边聊天 2" })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "侧边聊天" })
        .getByText("当前侧边聊天暂无消息。"),
    ).toHaveCount(0);

    await expect(
      page
        .getByRole("region", { name: "侧边聊天" })
        .getByRole("textbox", { name: "侧边聊天输入" }),
    ).toBeEnabled();
    await page
      .getByRole("region", { name: "侧边聊天" })
      .getByRole("textbox", { name: "侧边聊天输入" })
      .fill("从空白侧聊开始");
    await page
      .getByRole("region", { name: "侧边聊天" })
      .getByRole("button", { name: "发送侧边消息" })
      .click();
    await expect.poll(() => turnStartBodies.length).toBe(2);
    expect(turnStartBodies[1]).toMatchObject({
      threadId: "side-chat-created-e2e-1",
      text: "从空白侧聊开始",
      attachmentIds: [],
    });
    expect(createCalled).toBe(0);
  });

  test("keeps Desktop side chat scroller and composer controls aligned", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "Desktop-only right sidebar regression",
    );

    await installActiveTurnMocks(page, {
      threadDetailOverrides: () => ({
        sideConversations: [
          {
            id: "side-chat-layout-e2e",
            title: "侧边聊天布局回归",
            createdAtIso: "2026-05-31T08:26:05.000Z",
            updatedAtIso: "2026-05-31T08:30:41.000Z",
            inProgress: false,
            hasUnread: false,
            turnCount: 1,
            turns: [
              {
                id: "side-turn-layout-e2e",
                status: "completed",
                items: [
                  {
                    type: "user",
                    id: "side-layout-user-e2e",
                    text: "请检查侧边聊天的滚动和底部控件。",
                  },
                  ...Array.from({ length: 28 }, (_, index) => ({
                    type: "assistant",
                    id: `side-layout-assistant-${index}`,
                    text: `侧边聊天第 ${index + 1} 条布局回归内容，用来撑开滚动区域并检查底部按钮不会被 Composer 遮住。`,
                  })),
                ],
              },
            ],
          },
        ],
      }),
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "打开右侧栏" }).click();

    const sideChat = page.getByRole("region", { name: "侧边聊天" });
    const transcript = sideChat.getByTestId("side-chat-transcript");
    await expect(sideChat).toBeVisible();
    await expect(transcript).toBeVisible();

    await transcript.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const scrollButton = sideChat.getByRole("button", {
      name: "滚动侧边聊天到底部",
    });
    await expect(scrollButton).toBeVisible();
    await scrollButton.click();
    await expect
      .poll(() =>
        transcript.evaluate(
          (element) =>
            element.scrollHeight - element.scrollTop - element.clientHeight,
        ),
      )
      .toBeLessThan(140);
    await expect(
      sideChat.getByText("侧边聊天第 28 条布局回归内容"),
    ).toBeVisible();

    const mainComposer = page.getByRole("form", {
      name: "Composer",
      exact: true,
    });
    const sideComposer = sideChat.getByRole("form", {
      name: "侧边聊天 Composer",
    });
    await expect(mainComposer).toBeVisible();
    await expect(sideComposer).toBeVisible();
    const metrics = await page.evaluate(() => {
      const main = document
        .querySelector('form[aria-label="Composer"]')
        ?.getBoundingClientRect();
      const side = document
        .querySelector('form[aria-label="侧边聊天 Composer"]')
        ?.getBoundingClientRect();
      const sidePermission = document
        .querySelector('form[aria-label="侧边聊天 Composer"] [aria-label="权限设置"]')
        ?.getBoundingClientRect();
      const sideRuntime = document
        .querySelector(
          'form[aria-label="侧边聊天 Composer"] [aria-label="模型与思考深度"]',
        )
        ?.getBoundingClientRect();
      if (!main || !side || !sidePermission || !sideRuntime) {
        throw new Error("composer geometry missing");
      }
      return {
        bottomDelta: Math.abs(main.bottom - side.bottom),
        permissionRightOverflow: sidePermission.right - side.right,
        permissionWidth: sidePermission.width,
        runtimeRightOverflow: sideRuntime.right - side.right,
        runtimeWidth: sideRuntime.width,
      };
    });
    expect(metrics.bottomDelta).toBeLessThanOrEqual(2);
    expect(metrics.permissionWidth).toBeGreaterThan(84);
    expect(metrics.runtimeWidth).toBeGreaterThan(84);
    expect(metrics.permissionRightOverflow).toBeLessThanOrEqual(0);
    expect(metrics.runtimeRightOverflow).toBeLessThanOrEqual(0);
  });

  test("syncs composer goal controls with Desktop thread goal APIs", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "Desktop-only goal controls regression",
    );

    type MockGoal = {
      threadId: string;
      objective: string;
      status: "active" | "paused";
      tokenBudget: number | null;
      tokensUsed: number | null;
      timeUsedSeconds: number | null;
      createdAtIso: string;
      updatedAtIso: string;
    };
    let goal: MockGoal | null = {
      threadId: activeThreadId,
      objective: "查看codex_web的项目文档，继续完成 Desktop 复刻",
      status: "active",
      tokenBudget: null,
      tokensUsed: 1200,
      timeUsedSeconds: 19_850,
      createdAtIso: "2026-05-31T08:00:00.000Z",
      updatedAtIso: "2026-05-31T09:00:00.000Z",
    };
    const setBodies: Array<Record<string, unknown>> = [];
    const clearBodies: Array<Record<string, unknown>> = [];

    await installActiveTurnMocks(page, {
      threadDetailOverrides: () => ({ goal }),
    });
    await page.route("**/api/domain/thread-goal-set", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      setBodies.push(body);
      const nextObjective =
        typeof body.objective === "string" ? body.objective : goal?.objective;
      const nextStatus =
        body.status === "active" || body.status === "paused"
          ? body.status
          : (goal?.status ?? "active");
      goal = {
        ...(goal ?? {
          threadId: activeThreadId,
          tokenBudget: null,
          tokensUsed: null,
          timeUsedSeconds: null,
          createdAtIso: "2026-05-31T08:00:00.000Z",
          updatedAtIso: "2026-05-31T09:00:00.000Z",
        }),
        objective: nextObjective ?? "",
        status: nextStatus,
        updatedAtIso: "2026-05-31T09:05:00.000Z",
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            ok: true,
            mode: "app-server",
            result: { ok: true },
            goal,
            thread: null,
          },
        }),
      });
    });
    await page.route("**/api/domain/thread-goal-clear", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      clearBodies.push(body);
      goal = null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            ok: true,
            mode: "app-server",
            result: { ok: true },
            goal: null,
            thread: null,
          },
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const activityStrip = page.getByLabel("当前活动摘要");
    await expect(activityStrip.getByText("进行中的目标")).toBeVisible();
    await expect(activityStrip.getByText(/查看codex_web/)).toBeVisible();

    await activityStrip.getByRole("button", { name: "显示完整目标" }).click();
    await expect(
      activityStrip
        .locator("p")
        .filter({ hasText: "查看codex_web的项目文档，继续完成 Desktop 复刻" }),
    ).toBeVisible();
    await activityStrip.getByRole("button", { name: "隐藏完整目标" }).click();

    await activityStrip.getByRole("button", { name: "编辑目标" }).click();
    const dialog = page.getByRole("dialog", { name: "编辑目标" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("目标内容")
      .fill("把 Web 目标条接到 Desktop goal 状态");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect.poll(() => setBodies.length).toBe(1);
    expect(setBodies[0]).toMatchObject({
      threadId: activeThreadId,
      objective: "把 Web 目标条接到 Desktop goal 状态",
    });
    await expect(dialog).toHaveCount(0);
    await expect(
      activityStrip.getByText("把 Web 目标条接到 Desktop goal 状态"),
    ).toBeVisible();

    await activityStrip.getByRole("button", { name: "暂停目标" }).click();
    await expect.poll(() => setBodies.length).toBe(2);
    expect(setBodies[1]).toMatchObject({
      threadId: activeThreadId,
      status: "paused",
    });
    await expect(activityStrip.getByText("已暂停的目标")).toBeVisible();

    await activityStrip.getByRole("button", { name: "恢复目标" }).click();
    await expect.poll(() => setBodies.length).toBe(3);
    expect(setBodies[2]).toMatchObject({
      threadId: activeThreadId,
      status: "active",
    });
    await expect(activityStrip.getByText("进行中的目标")).toBeVisible();

    await activityStrip.getByRole("button", { name: "清除目标" }).click();
    await expect.poll(() => clearBodies.length).toBe(1);
    expect(clearBodies[0]).toMatchObject({ threadId: activeThreadId });
    await expect(activityStrip.getByText("进行中的目标")).toHaveCount(0);
  });

  test("wires desktop sidebar hover actions to thread APIs", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "Desktop-only sidebar hover actions",
    );

    let pinned = false;
    let archived = false;
    const pinBodies: Array<Record<string, unknown>> = [];
    const archiveBodies: Array<Record<string, unknown>> = [];
    const stopBodies: Array<Record<string, unknown>> = [];

    await installActiveTurnMocks(page, {
      threadOverrides: () => ({ pinned }),
      isArchived: () => archived,
    });
    await page.route("**/api/domain/thread-pin", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      pinned = Boolean(body.pinned);
      pinBodies.push(body);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            ok: true,
            threadId: activeThreadId,
            pinned,
            result: { source: "e2e" },
          },
        }),
      });
    });
    await page.route("**/api/domain/thread-archive", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      archived = true;
      archiveBodies.push(body);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true, result: { source: "e2e" } } }),
      });
    });
    await page.route("**/api/domain/thread-stop-background", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      stopBodies.push(body);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            ok: true,
            interrupted: 1,
            results: [{ turnId: "turn-active-composer-e2e", ok: true }],
          },
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const activeRow = page
      .getByRole("button", { name: /Active turn composer state/ })
      .first();
    await expect(activeRow).toBeVisible();
    const rowWidths = await activeRow.evaluate((element) => {
      const button = element.getBoundingClientRect();
      const shell = element.parentElement?.getBoundingClientRect();
      return {
        button: button.width,
        shell: shell?.width ?? button.width,
      };
    });
    expect(rowWidths.shell - rowWidths.button).toBeLessThanOrEqual(2);

    await activeRow.hover();
    await page
      .getByRole("button", {
        name: /停止 Active turn composer state 的所有后台终端/,
      })
      .click();
    await expect.poll(() => stopBodies.length).toBe(1);
    expect(stopBodies[0]).toMatchObject({ threadId: activeThreadId });

    await activeRow.hover();
    await page.getByRole("button", { name: "置顶对话" }).click();
    await expect.poll(() => pinBodies.length).toBe(1);
    expect(pinBodies[0]).toMatchObject({
      threadId: activeThreadId,
      pinned: true,
    });
    await expect(page.getByText("置顶", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Active turn composer state/ }).first(),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /Active turn composer state/ })
      .first()
      .hover();
    await page.getByRole("button", { name: "取消置顶对话" }).click();
    await expect.poll(() => pinBodies.length).toBe(2);
    expect(pinBodies[1]).toMatchObject({
      threadId: activeThreadId,
      pinned: false,
    });

    await page
      .getByRole("button", { name: /Active turn composer state/ })
      .first()
      .hover();
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("button", { name: "归档对话" }).click();
    await expect.poll(() => archiveBodies.length).toBe(1);
    expect(archiveBodies[0]).toMatchObject({ threadId: activeThreadId });
    await expect(
      page.getByRole("button", {
        name: /Active turn composer state codex_web live/,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /Active turn composer state 点击恢复/,
      }),
    ).toBeVisible();
  });

  test("opens a Desktop-like draft and creates the synced thread on first send", async ({
    page,
  }, testInfo) => {
    await installActiveTurnMocks(page);
    await page.unroute("**/api/domain/thread-detail**").catch(() => undefined);

    const draftThreadId = "draft-thread-e2e";
    const draftThread = {
      id: draftThreadId,
      title: "Draft synced thread",
      projectId: activeProjectRoot,
      path: activeProjectRoot,
      updatedAtIso: "2026-05-31T08:00:00.000Z",
      inProgress: true,
      owner: null,
    };
    const existingThread = {
      id: activeThreadId,
      title: "Active turn composer state",
      projectId: activeProjectRoot,
      path: activeProjectRoot,
      updatedAtIso: "2026-05-29T10:00:00.000Z",
      inProgress: true,
      owner: null,
    };
    await page.route("**/api/domain/thread-detail**", async (route) => {
      const url = new URL(route.request().url());
      const threadId = url.searchParams.get("threadId");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data:
            threadId === draftThreadId
              ? {
                  thread: draftThread,
                  turns: [
                    {
                      id: "draft-turn-e2e",
                      status: "active",
                      items: [
                        {
                          type: "user",
                          id: "draft-user-e2e",
                          text: "draft first turn",
                          images: [],
                        },
                      ],
                    },
                  ],
                  subAgents: [],
                }
              : {
                  thread: existingThread,
                  turns: [
                    {
                      id: "existing-turn-e2e",
                      status: "completed",
                      items: [
                        {
                          type: "assistant",
                          id: "existing-assistant-e2e",
                          text: "已有同步会话内容",
                          images: [],
                        },
                      ],
                    },
                  ],
                  subAgents: [],
                },
        }),
      });
    });

    let capturedCreateThread: Record<string, unknown> | null = null;
    let capturedTurnStart: Record<string, unknown> | null = null;
    let capturedAttachmentThreadId: string | null | undefined;
    await page.route("**/api/domain/thread-create", async (route) => {
      capturedCreateThread = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { thread: draftThread, raw: {} } }),
      });
    });
    await page.route("**/api/domain/turn-start", async (route) => {
      capturedTurnStart = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { mode: "official-follower", result: { ok: true } },
        }),
      });
    });
    await page.route("**/api/attachments*", async (route) => {
      const url = new URL(route.request().url());
      capturedAttachmentThreadId = url.searchParams.get("threadId");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: "draft-attachment-e2e",
            filename: "draft-note.txt",
            mimeType: "text/plain",
            size: 16,
            path: "C:\\workspace\\codex_web\\data\\attachments\\draft-note.txt",
            sha256:
              "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            createdAtIso: "2026-05-31T08:00:00.000Z",
            threadId: null,
            turnId: null,
            officialReferenceId: null,
          },
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("已有同步会话内容")).toBeVisible();

    if (testInfo.project.name.includes("mobile")) {
      await page.getByRole("button", { name: "打开导航" }).first().click();
      await page.getByRole("button", { name: "新对话" }).click();
    } else {
      await page.getByRole("button", { name: "新对话" }).click();
    }

    await expect(
      page.getByRole("heading", {
        name: "今天想在 codex_web 里推进什么？",
      }),
    ).toBeVisible();
    if (testInfo.project.name.includes("mobile")) {
      await expect(
        page.getByRole("button", { name: /运行状态 实时同步快照/ }),
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByRole("complementary", { name: "运行状态" }),
      ).toHaveCount(0);
    }
    await expect(page.getByLabel("新对话上下文")).toContainText("codex_web");
    await expect(page.getByText("已有同步会话内容")).toHaveCount(0);
    expect(capturedCreateThread).toBeNull();
    expect(capturedTurnStart).toBeNull();

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("打开输入选项").click();
    await page.getByRole("menuitem", { name: "添加照片和文件" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "draft-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("draft attachment", "utf8"),
    });
    await expect(page.getByText("draft-note.txt")).toBeVisible();
    expect(capturedAttachmentThreadId).toBeNull();

    await page.getByLabel("输入消息").fill("draft first turn");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedCreateThread).toEqual({ cwd: activeProjectRoot });
    expect(capturedTurnStart).toMatchObject({
      threadId: draftThreadId,
      text: "draft first turn",
      model: "gpt-default",
      effort: "medium",
      attachmentIds: ["draft-attachment-e2e"],
      permissionMode: "full-access",
    });
    await expect(page).toHaveURL(new RegExp(`/thread/${draftThreadId}$`));
  });

  test("keeps selected chat text stable during active refresh", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "Desktop chat selection regression",
    );

    await installActiveTurnMocks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("旧命令已经完成")).toBeVisible();

    const selectedText = await page.evaluate(() => {
      const chatRegion = document.querySelector(
        '[role="region"][aria-label="会话"]',
      );
      if (!chatRegion) return "";
      const walker = document.createTreeWalker(
        chatRegion,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            return node.textContent?.includes("旧命令已经完成")
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          },
        },
      );
      const node = walker.nextNode();
      if (!node) return "";
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? "";
    });

    expect(selectedText).toContain("旧命令已经完成");
    await page.waitForTimeout(2_200);
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toBe(selectedText);
  });

  test("serves installable app metadata", async ({ request }) => {
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = (await manifestResponse.json()) as {
      name?: string;
      display?: string;
      start_url?: string;
      icons?: Array<{ src?: string; purpose?: string }>;
    };
    expect(manifest.name).toBe("codex_web");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(
      manifest.icons?.some((icon) => icon.src === "/icons/icon.svg"),
    ).toBeTruthy();
    expect(
      manifest.icons?.some((icon) => icon.purpose === "maskable"),
    ).toBeTruthy();

    const iconResponse = await request.get("/icons/icon.svg");
    expect(iconResponse.ok()).toBeTruthy();
    expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");
  });

  test("keeps the 1920px desktop chat geometry close to Codex Desktop", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "desktop geometry regression only runs in the desktop project",
    );

    await page.route("**/api/workspace/status**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            cwd: "C:\\workspace\\codex_web",
            isGitRepository: true,
            branch: "feature/sync-panel",
            upstream: "origin/feature/sync-panel",
            ahead: 1,
            behind: 2,
            commit: "a1b2c3d",
            changedFiles: 3,
            additions: 65,
            deletions: 2,
            hasUntracked: true,
            githubCli: {
              available: true,
              authenticated: false,
              status: "not-authenticated",
            },
            warnings: [],
          },
        }),
      });
    });

    await page.setViewportSize({ width: 1920, height: 1020 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    const activityPanel = page.getByLabel("运行状态");
    await expect(activityPanel).toBeVisible();
    await expect(page.getByLabel("输入消息")).toBeVisible();
    await expect(page.getByLabel("发送目标")).toHaveCount(0);
    await expect(activityPanel.getByText("执行端")).toBeVisible();
    await expect(activityPanel.getByText("18930")).toBeVisible();
    await expect(activityPanel.getByText("feature/sync-panel")).toBeVisible();
    await expect(activityPanel.getByText("a1b2c3d")).toBeVisible();
    await expect(activityPanel.getByText("+65")).toBeVisible();
    await expect(activityPanel.getByText("-2")).toBeVisible();
    await expect(activityPanel.getByText("未登录")).toBeVisible();
    await expect(activityPanel.getByText("owner")).toHaveCount(0);
    await expect(
      activityPanel.getByText("官方暂未提供子智能体列表"),
    ).toHaveCount(0);
    await expect(activityPanel.getByText("Noether")).toHaveCount(0);

    const composerBox = await page.locator("form").boundingBox();
    const activityBox = await activityPanel.boundingBox();

    expect(composerBox).not.toBeNull();
    expect(activityBox).not.toBeNull();
    await expect
      .poll(() =>
        activityPanel.evaluate(
          (element) => getComputedStyle(element).overflowY,
        ),
      )
      .toBe("auto");
    expect(activityBox?.height ?? 0).toBeGreaterThan(850);
    const activityLeft = activityBox?.x ?? 0;
    const activityRight = activityLeft + (activityBox?.width ?? 0);
    const activityBottom = (activityBox?.y ?? 0) + (activityBox?.height ?? 0);
    const composerLeft = composerBox?.x ?? 0;
    const composerRight = composerLeft + (composerBox?.width ?? 0);

    expect(activityRight).toBeGreaterThan(1880);
    expect(activityLeft).toBeGreaterThan(1500);
    expect(activityBottom).toBeGreaterThan(960);
    expect(composerLeft).toBeGreaterThan(440);
    expect(composerRight).toBeLessThan(activityLeft - 60);
    await expectNoHorizontalOverflow(page, "desktop 1920 chat geometry");
  });

  test("lists project files through the read-only browser API", async ({
    request,
  }) => {
    const query = new URLSearchParams({ root: process.cwd(), limit: "80" });
    const response = await request.get(`/api/files/list?${query.toString()}`);
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as {
      data?: {
        root?: string;
        entries?: Array<{
          name?: string;
          kind?: string;
          relativePath?: string;
        }>;
        limited?: boolean;
      };
    };
    expect(payload.data?.root).toBeTruthy();
    expect(payload.data?.limited).toBe(false);
    expect(
      payload.data?.entries?.some(
        (entry) => entry.name === "package.json" && entry.kind === "file",
      ),
    ).toBeTruthy();
  });

  test("supports clean thread routes and migrates legacy hash links", async ({
    page,
    request,
  }) => {
    const response = await request.get(
      "/api/domain/threads?limit=1&archived=false",
    );
    const payload = (await response.json()) as {
      data?: { threads?: Array<{ id?: string }> };
    };
    const threadId = payload.data?.threads?.[0]?.id;
    if (!threadId) {
      test.skip(true, "需要至少一个官方 thread 才能验证 thread route");
      return;
    }

    const encodedThreadId = encodeURIComponent(threadId);
    await page.goto(`/thread/${encodedThreadId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("main")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.pathname))
      .toBe(`/thread/${encodedThreadId}`);

    await page.goto(`/#/thread/${encodedThreadId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("main")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.pathname))
      .toBe(`/thread/${encodedThreadId}`);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  });

  test("opens settings and hidden debug routes directly", async ({ page }) => {
    await page.route("**/api/network/lan-access", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            host: "0.0.0.0",
            port: 18930,
            localUrl: "http://127.0.0.1:18930/",
            urls: [
              {
                name: "Wi-Fi",
                address: "192.168.1.10",
                family: "IPv4",
                url: "http://192.168.1.10:18930/",
              },
            ],
            warnings: [],
          },
        }),
      });
    });

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const settingsDialog = page.getByRole("dialog", {
      name: "Settings / Diagnostics",
    });
    await expect(settingsDialog).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Storage cleanup" }),
    ).toBeVisible();
    await expect(settingsDialog.getByText("Clean unassociated")).toBeVisible();
    await settingsDialog.getByRole("tab", { name: "Projects" }).click();
    await expect(
      settingsDialog.getByRole("heading", { name: "项目收藏" }),
    ).toBeVisible();
    await settingsDialog.getByRole("tab", { name: "Security" }).click();
    await expect(
      settingsDialog.getByRole("heading", { name: "Security sessions" }),
    ).toBeVisible();
    await settingsDialog.getByRole("tab", { name: "Network" }).click();
    await expect(
      settingsDialog.getByRole("heading", { name: "Network" }),
    ).toBeVisible();
    await expect(settingsDialog.getByLabel("Host")).toBeVisible();
    await expect(
      settingsDialog.getByText("http://192.168.1.10:18930/"),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", {
        name: "Copy LAN URL http://192.168.1.10:18930/",
      }),
    ).toBeVisible();
    await settingsDialog.getByRole("tab", { name: "Appearance" }).click();
    await expect(
      settingsDialog.getByRole("heading", { name: "Appearance" }),
    ).toBeVisible();
    await expect(settingsDialog.getByText("light theme")).toBeVisible();
    await settingsDialog.getByRole("tab", { name: "Diagnostics" }).click();
    await expect(
      settingsDialog.getByRole("heading", { name: "Diagnostics controls" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Troubleshooting package" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Sync acceptance" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", { name: "Copy sync start command" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", { name: "Copy sync steer command" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", {
        name: "Copy sync interrupt command",
      }),
    ).toBeVisible();
    await expect(settingsDialog.getByText("不包含会话正文")).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", { name: "Copy package" }).last(),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", { name: "Download package" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Realtime events" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Protocol compatibility" }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", {
        name: "Follower method capabilities",
      }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByText("Compatibility", { exact: true }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByText("Follower handlers", { exact: true }),
    ).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { name: "Sync readiness" }),
    ).toBeVisible();

    await page.goto("/debug", { waitUntil: "domcontentloaded" });
    const debugRegion = page.getByLabel("Debug diagnostics");
    await expect(
      debugRegion.getByRole("heading", { name: "Debug" }),
    ).toBeVisible();
    await expect(
      debugRegion.getByText("Compatibility", { exact: true }),
    ).toBeVisible();
    await expect(
      debugRegion.getByText(
        /^compatibility (compatible|warning|offline|error|checking)$/,
      ),
    ).toBeVisible();
    await expect(debugRegion.getByText("Protocol compatibility")).toBeVisible();
    await expect(
      debugRegion.getByText("Follower method capabilities"),
    ).toBeVisible();
    await expect(debugRegion.getByText("Diagnostics export")).toBeVisible();
    await expect(
      debugRegion.getByText("IPC methods", { exact: true }),
    ).toBeVisible();
    await expect(debugRegion.getByText(/handlers registered$/)).toBeVisible();
  });

  test("opens global search from keyboard and mobile header", async ({
    page,
  }, testInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (testInfo.project.name.includes("mobile")) {
      await page.getByRole("button", { name: "更多操作" }).click();
      await page
        .getByRole("menu", { name: "会话操作" })
        .getByRole("menuitem", { name: "搜索" })
        .click();
    } else {
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+K" : "Control+K",
      );
    }
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
    await expect(page.getByLabel("全局搜索")).toBeFocused();
    await page.getByLabel("全局搜索").fill("zzzzzz-no-match");
    await expect(page.getByText("没有匹配项目")).toBeVisible();
    await expect(page.getByText("没有匹配会话")).toBeVisible();
  });

  test("keeps the mobile composer controls usable without horizontal overflow", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "mobile layout regression only",
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("输入消息")).toBeVisible();

    for (const label of ["打开输入选项", "模型与思考深度"]) {
      const control = page.getByLabel(label);
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      const viewport = page.viewportSize();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (viewport?.width ?? 390) + 1,
      );
    }

    const sendButton = page.getByRole("button", { name: "发送" });
    await expect(sendButton).toBeVisible();
    await page.getByLabel("打开输入选项").click();
    const inputMenu = page.getByRole("menu", { name: "输入选项" });
    await expect(inputMenu).toBeVisible();
    await inputMenu.getByRole("button", { name: "插件" }).click();
    await expect
      .poll(async () => {
        const visibleSkillCount = await inputMenu.getByRole("checkbox").count();
        const statusCount = await inputMenu
          .locator("text=/没有可用 Skills|正在读取/")
          .count();
        return visibleSkillCount + statusCount;
      })
      .toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page, "mobile composer input menu");
  });

  test("opens compact mobile header actions without squeezing the title", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "mobile header only");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "更多操作" })).toBeVisible();
    await expect(page.getByRole("button", { name: "重命名会话" })).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "更多操作" }).click();
    const actionMenu = page.getByLabel("会话操作");
    await expect(actionMenu).toBeVisible();
    await expect(
      actionMenu.getByRole("menuitem", { name: "搜索" }),
    ).toBeVisible();
    await expect(
      actionMenu.getByRole("menuitem", { name: "重命名会话" }),
    ).toBeVisible();
    await expect(
      actionMenu.getByRole("menuitem", { name: "归档会话" }),
    ).toBeVisible();
    await actionMenu.getByRole("menuitem", { name: "设置与诊断" }).click();
    await expect(
      page.getByRole("dialog", { name: "Settings / Diagnostics" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, "mobile settings panel");
  });

  test("closes the mobile drawer after choosing a project filter", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "mobile drawer only");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "打开导航" }).click();
    await expect(page.getByRole("button", { name: "关闭导航" })).toBeVisible();
    await page.getByRole("button", { name: /全部会话/ }).click();
    await expect(page.getByRole("button", { name: "关闭导航" })).toHaveCount(0);
  });

  test("keeps secondary runtime panels folded on mobile until opened", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "mobile foldouts only",
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const syncFoldout = page.getByRole("button", { name: /运行状态/ });
    await expect(syncFoldout).toBeVisible();
    await expect(syncFoldout).toHaveAttribute("aria-expanded", "false");
    await syncFoldout.click();
    await expect(syncFoldout).toHaveAttribute("aria-expanded", "true");
    await expectNoHorizontalOverflow(page, "mobile sync foldout");
  });
});
