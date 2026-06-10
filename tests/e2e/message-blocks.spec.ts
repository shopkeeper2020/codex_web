import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/layout";
import {
  activeStatusThreadId,
  installActiveStatusMessageBlockMocks,
  installMessageBlockMocks,
  threadId,
} from "./fixtures/messageBlocks";

test.describe("complex message blocks", () => {
  test("renders domain message item variants and toggles a block", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "复杂消息块渲染只需要在 desktop project 验证",
    );

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await installMessageBlockMocks(page);
    await page.goto(`/thread/${threadId}`, { waitUntil: "domcontentloaded" });

    const chat = page.getByLabel("会话", { exact: true });
    await expect(
      chat.getByRole("heading", { name: "Complex domain message blocks" }),
    ).toBeVisible();
    const activityPanel = page.getByLabel("运行状态");
    await expect(activityPanel.getByText("Render complex items")).toBeVisible();
    await expect(
      activityPanel.getByText("Validate interactions do not throw"),
    ).toBeVisible();

    const firstUserMessage = chat.getByTestId("user-message").first();
    await expect(firstUserMessage.getByTestId("user-message-text")).toContainText(
      "**must stay plain**",
    );
    await expect(firstUserMessage.locator("strong")).toHaveCount(0);
    await expect(
      firstUserMessage.getByRole("button", { name: "展开用户消息" }),
    ).toBeVisible();
    await firstUserMessage.getByRole("button", { name: "展开用户消息" }).click();
    await expect(firstUserMessage.getByText("Final visible sentinel after expansion.")).toBeVisible();
    await firstUserMessage.getByRole("button", { name: "折叠用户消息" }).click();

    await expect(chat.getByText("已思考").first()).toHaveCount(0);
    await expect(chat.getByText("正在执行").first()).toHaveCount(0);
    await expect(chat.getByText("已运行").first()).toBeVisible();
    await expect(chat.getByText("1 条命令，2 个文件变更")).toBeVisible();
    await expect(chat.getByText("bold sentinel")).toBeVisible();
    await expect(chat.getByText("markdownCodeSentinel")).toBeVisible();
    await expect(chat.getByText("markdown-table-sentinel")).toBeVisible();
    await expect(chat.getByText("已生成 1 个智能体")).toBeVisible();
    await expect(chat.getByText("输入：")).toBeVisible();
    await expect(chat.getByText("任务：")).toBeVisible();
    await expect(chat.getByText("agent task detail sentinel")).toBeVisible();
    await expect(
      chat.getByRole("button", { name: "docs/agent_task_reference.txt" }),
    ).toBeVisible();
    const collapsedAgentInput = chat.locator('[class*="agentTaskTextCollapsed"]').first();
    await expect(collapsedAgentInput).toBeVisible();
    await expect
      .poll(() =>
        collapsedAgentInput.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    await chat.getByRole("button", { name: "展开" }).first().click();
    await expect(chat.getByText("agent task collapsed tail sentinel")).toBeVisible();
    await expect(chat.getByText("collabAgentToolCall")).toHaveCount(0);
    const fileReference = chat.getByRole("button", {
      name: "implementation_status.md",
      exact: true,
    });
    await expect(fileReference).toBeVisible();
    await expect(
      chat.getByRole("link", { name: "implementation_status.md" }),
    ).toHaveCount(0);
    await fileReference.click();
    await expect(
      page.getByRole("menuitem", { name: "复制相对路径" }),
    ).toBeVisible();
    await page
      .getByRole("menuitem", { name: "在右侧“文件”标签页打开" })
      .click();
    await expect(
      page.getByRole("complementary", { name: "右侧栏" }),
    ).toBeVisible();
    const rightSidebar = page.getByRole("complementary", { name: "右侧栏" });
    await expect(
      rightSidebar.getByRole("tab", { name: "implementation_status.md" }),
    ).toBeVisible();
    await expect(rightSidebar.getByText("filePreviewSentinel")).toBeVisible();
    const lineReference = chat.getByRole("button", {
      name: "implementation_status.md:12",
      exact: true,
    });
    await expect(lineReference).toBeVisible();
    await lineReference.click();
    await page
      .getByRole("menuitem", { name: "在右侧“文件”标签页打开" })
      .click();
    await expect(
      rightSidebar.getByRole("tab", { name: "implementation_status.md:12" }),
    ).toBeVisible();
    const plainPathReference = chat.getByRole("button", {
      name: "docs/ui_fidelity.md",
    });
    await expect(plainPathReference).toBeVisible();
    await expect(
      chat.getByRole("link", { name: "docs/ui_fidelity.md" }),
    ).toHaveCount(0);
    await plainPathReference.click();
    await expect(
      page.getByRole("menuitem", { name: "复制相对路径" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menuitem", { name: "复制相对路径" }),
    ).toHaveCount(0);
    await expect(
      chat.getByRole("button", { name: "复制 Markdown 代码" }),
    ).toBeVisible();
    await expect(
      chat.getByText(
        "pnpm exec playwright test tests/e2e/message-blocks.spec.ts",
      ),
    ).toHaveCount(0);
    await expect(chat.getByText("exit 1")).toHaveCount(0);
    await expect(chat.getByText("1.5s").first()).toBeVisible();
    await expect(
      chat.getByText("stdout: message block command ran"),
    ).toHaveCount(0);
    await expect(
      chat.getByText("stderr: simulated warning for renderer coverage"),
    ).toHaveCount(0);

    await expect(
      chat.getByText("apps/web/src/app/components/MessageBlocks.tsx").first(),
    ).toHaveCount(0);
    await expect(chat.getByText("src/path-only-preview.ts")).toHaveCount(0);
    await expect(chat.getByText("filePreviewSentinel")).toHaveCount(0);
    await expect(
      chat.getByText("+message-block coverage sentinel"),
    ).toHaveCount(0);

    await expect(chat.getByText("Renderer verification plan")).toHaveCount(0);
    await expect(chat.getByText("Render complex items")).toHaveCount(0);
    await expect(
      chat.getByText("Validate interactions do not throw"),
    ).toHaveCount(0);

    await expect(chat.getByText("Review command approval")).toBeVisible();
    await expect(
      chat.getByText("mock approval item should render inline with the turn"),
    ).toBeVisible();

    await expect(
      chat.getByRole("img", { name: "Generated chart preview" }),
    ).toBeVisible();
    await chat.getByRole("img", { name: "Generated chart preview" }).click();
    const lightbox = page.getByRole("dialog", {
      name: "Generated chart preview",
    });
    await expect(lightbox).toBeVisible();
    await expect(
      lightbox.getByRole("img", { name: "Generated chart preview" }),
    ).toBeVisible();
    await page.getByLabel("关闭图片预览").click();
    await expect(
      page.getByRole("dialog", { name: "Generated chart preview" }),
    ).toHaveCount(0);
    await expect
      .poll(async () =>
        chat
          .getByRole("img", { name: "Generated chart preview" })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(100);
    await expect(chat.getByText("Generated chart preview")).toBeVisible();
    await expect(
      chat.getByRole("img", { name: "Local path screenshot preview" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        chat
          .getByRole("img", { name: "Local path screenshot preview" })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(100);
    await expect(chat.getByText("Local path screenshot preview")).toBeVisible();

    await expect(
      chat.getByText("Domain renderer failed gracefully"),
    ).toBeVisible();
    await expect(chat.getByText("E_MESSAGE_BLOCK_E2E")).toHaveCount(0);

    await expect(chat.getByText("MCP filesystem scan")).toHaveCount(0);
    await expect(chat.getByText("1 个工具输出")).toBeVisible();
    await expect(chat.getByText("mcp.files/list").first()).toHaveCount(0);
    await expect(
      chat.getByText("tool output sentinel: listed README.md and package.json"),
    ).toHaveCount(0);

    await expect(chat.getByText("未知内容", { exact: true })).toBeVisible();
    await expect(chat.getByText("上下文已自动压缩")).toBeVisible();
    await expect(chat.getByText("steered")).toHaveCount(0);
    await expect(chat.getByText("steeringUserMessage")).toHaveCount(0);
    await expect(chat.getByText("raw steering user message sentinel")).toBeVisible();
    await expect(
      chat.getByRole("img", { name: "Steering user attached image" }),
    ).toBeVisible();
    await expect(chat.getByText("customDomainItem").first()).toBeVisible();
    await expect(chat.getByText("stabilized unknown item")).toHaveCount(0);
    await expect(
      chat.getByRole("button", { name: "复制内容" }).first(),
    ).toBeVisible();

    pageErrors.length = 0;
    await chat.getByRole("button", { name: "展开内容" }).first().click();
    await expect(chat.getByText("运行失败")).toBeVisible();
    await expect(
      chat.getByText(
        "pnpm exec playwright test tests/e2e/message-blocks.spec.ts",
      ).first(),
    ).toBeVisible();
    await expect(chat.getByText("stdout: message block command ran")).toHaveCount(0);
    await chat.getByRole("button", { name: "展开执行详情" }).first().click();
    await expect(chat.getByText("Shell").first()).toBeVisible();
    await expect(
      chat.getByText(
        "pnpm exec playwright test tests/e2e/message-blocks.spec.ts",
      ).first(),
    ).toBeVisible();
    await expect(chat.getByText("1.5s").first()).toBeVisible();
    await expect(
      chat.getByText("stdout: message block command ran"),
    ).toBeVisible();
    await expect(
      chat.getByText("stderr: simulated warning for renderer coverage"),
    ).toBeVisible();
    await chat.getByRole("button", { name: "展开连接错误" }).click();
    await expect(chat.getByText("E_MESSAGE_BLOCK_E2E")).toBeVisible();
    await expect(
      chat.getByText("apps/web/src/app/components/MessageBlocks.tsx").first(),
    ).toBeVisible();
    await chat.locator("button").filter({ hasText: "apps/web/src/app/components/MessageBlocks.tsx" }).click();
    await expect(chat.getByTestId("file-change-card").first()).toBeVisible();
    await expect(
      chat.getByText("+message-block coverage sentinel"),
    ).toBeHidden();
    await chat.locator("summary").filter({ hasText: "apps/web/src/app/components/MessageBlocks.tsx" }).click();
    await expect(
      chat.getByText("+message-block coverage sentinel"),
    ).toBeVisible();
    await chat.locator("button").filter({ hasText: "src/path-only-preview.ts" }).click();
    await chat.locator("summary").filter({ hasText: "src/path-only-preview.ts" }).click();
    await expect(chat.getByText("filePreviewSentinel")).toBeVisible();
    await chat.locator("button").filter({ hasText: "未知内容" }).click();
    await expect(chat.getByText("stabilized unknown item")).toBeVisible();
    await chat.getByRole("button", { name: "折叠内容" }).first().click();
    await expect(chat.getByText("已思考").first()).toHaveCount(0);
    await page.waitForTimeout(50);
    expect(pageErrors).toEqual([]);
  });

  test("renders markdown video references as playable media", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "视频播放器回归只需要在 desktop project 验证",
    );

    await installMessageBlockMocks(page);
    await page.goto(`/thread/${threadId}`, { waitUntil: "domcontentloaded" });

    const chat = page.getByLabel("会话", { exact: true });
    const joinedVideo = chat.getByTestId("message-video").first();
    await expect(joinedVideo).toBeVisible();
    await expect(joinedVideo).toHaveAttribute("aria-label", "合併影片");
    await expect(joinedVideo.locator("source")).toHaveAttribute(
      "src",
      /\/api\/files\/content\?/,
    );
    await expect(
      chat.getByRole("img", { name: "合併影片" }),
    ).toHaveCount(0);
    await expect
      .poll(() => joinedVideo.evaluate((video) => (video as HTMLVideoElement).controls))
      .toBe(true);
    await expectNoHorizontalOverflow(page, "desktop markdown video media");
  });

  test("keeps active running, editing, and thinking summaries visible", async ({
    page,
  }) => {
    await installActiveStatusMessageBlockMocks(page);
    await page.goto(`/thread/${activeStatusThreadId}`, { waitUntil: "domcontentloaded" });

    const chat = page.getByLabel("会话", { exact: true });
    await expect(
      chat.getByRole("heading", { name: "Active status message blocks" }),
    ).toBeVisible();
    await expect(chat.getByText("正在运行").first()).toBeVisible();
    await expect(chat.getByText("1 条命令，已持续 9.4s")).toBeVisible();
    await expect(chat.getByText("正在思考").first()).toBeVisible();
    await expect(chat.getByText("active reasoning sentinel")).toHaveCount(0);
    await expect(chat.getByText("正在编辑").first()).toBeVisible();
    await expect(chat.getByText("1 个文件").first()).toBeVisible();
    await expect(chat.getByText("docs/implementation_status.md")).toHaveCount(0);
    await chat.locator("button").filter({ hasText: "正在编辑" }).first().click();
    await expect(chat.getByText("docs/implementation_status.md")).toBeVisible();
    await expect(chat.getByText("active edit sentinel")).toBeHidden();
  });

  test("shows a desktop scroll-to-latest button when reading older messages", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "滚动到底部按钮只需要在 desktop project 验证",
    );

    await page.setViewportSize({ width: 1440, height: 560 });
    await installMessageBlockMocks(page);
    await page.goto(`/thread/${threadId}`, { waitUntil: "domcontentloaded" });

    const chat = page.getByLabel("会话", { exact: true });
    await expect
      .poll(() =>
        chat.evaluate((element) => element.scrollHeight - element.clientHeight),
      )
      .toBeGreaterThan(180);
    await page.waitForTimeout(150);

    await expect(page.getByRole("button", { name: "滚动到底部" })).toHaveCount(0);
    await chat.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });

    const scrollButton = page.getByRole("button", { name: "滚动到底部" });
    await expect(scrollButton).toBeVisible();
    await scrollButton.click();
    await expect
      .poll(() =>
        chat.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(8);
  });

  test("keeps complex domain message blocks usable on mobile", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "复杂消息块移动端回归只在 mobile project 验证",
    );

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await installMessageBlockMocks(page);
    await page.goto(`/thread/${threadId}`, { waitUntil: "domcontentloaded" });

    const chat = page.getByLabel("会话", { exact: true });
    await expect(
      chat.getByRole("heading", { name: "Complex domain message blocks" }),
    ).toBeVisible();
    const firstUserMessage = chat.getByTestId("user-message").first();
    await expect(firstUserMessage.getByTestId("user-message-text")).toContainText(
      "**must stay plain**",
    );
    await expect(firstUserMessage.locator("strong")).toHaveCount(0);
    await expect(chat.getByText("已思考").first()).toHaveCount(0);
    await expect(chat.getByText("正在执行").first()).toHaveCount(0);
    await expect(chat.getByText("已运行").first()).toBeVisible();
    await expect(chat.getByText("bold sentinel")).toBeVisible();
    await expect(chat.getByText("markdownCodeSentinel")).toBeVisible();
    await expect(
      chat.getByRole("button", { name: "复制 Markdown 代码" }),
    ).toBeVisible();
    await expect(chat.getByText("Renderer verification plan")).toHaveCount(0);
    await expect(chat.getByText("Review command approval")).toBeVisible();
    await expect(
      chat.getByRole("img", { name: "Local path screenshot preview" }),
    ).toBeVisible();
    await expect(chat.getByText("上下文已自动压缩")).toBeVisible();
    await expect(chat.getByText("steered")).toHaveCount(0);
    await expect(chat.getByText("steeringUserMessage")).toHaveCount(0);
    await expect(chat.getByText("raw steering user message sentinel")).toBeVisible();
    await expect(
      chat.getByRole("img", { name: "Steering user attached image" }),
    ).toBeVisible();
    await expect(chat.getByText("未知内容", { exact: true })).toBeVisible();
    await expect(chat.getByText("stabilized unknown item")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "mobile complex message blocks");

    await chat.getByRole("button", { name: "展开内容" }).first().click();
    await expect(
      chat.getByText(
        "pnpm exec playwright test tests/e2e/message-blocks.spec.ts",
      ),
    ).toBeVisible();
    await expectNoHorizontalOverflow(
      page,
      "mobile expanded complex message blocks",
    );
    expect(pageErrors).toEqual([]);
  });
});
