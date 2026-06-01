import { Buffer } from "node:buffer";
import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/layout";

const projectRoot = "C:\\workspace\\codex_web";
const threadId = "thread-runtime-options-e2e";
const skillPath = "C:\\codex-web-test\\skills\\docs\\SKILL.md";
const secondSkillPath = "C:\\codex-web-test\\skills\\edge-web-ops\\SKILL.md";

type JsonBody = Record<string, unknown>;
type ActiveTurnOption = boolean | (() => boolean);
type ComposerRuntimeMockOptions = {
  activeTurn?: ActiveTurnOption;
  runtimeOptions?: JsonBody;
  threadInProgress?: ActiveTurnOption;
  onThreadStopBackground?: (body: JsonBody) => void;
};

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installComposerRuntimeMocks(
  page: Page,
  onTurnStart: (body: JsonBody) => void,
  options: ComposerRuntimeMockOptions = {},
): Promise<void> {
  const isActiveTurn = (): boolean =>
    typeof options.activeTurn === "function"
      ? options.activeTurn()
      : Boolean(options.activeTurn);
  const isThreadInProgress = (): boolean => {
    const configured =
      typeof options.threadInProgress === "function"
        ? options.threadInProgress()
        : options.threadInProgress;
    return isActiveTurn() || Boolean(configured);
  };
  const activeTurnId = (): string =>
    isActiveTurn() ? "turn-active-runtime-e2e" : "";

  await page.route("**/api/domain/threads**", async (route) => {
    const url = new URL(route.request().url());
    const archived = url.searchParams.get("archived") === "true";
    const currentActiveTurnId = activeTurnId();
    const currentThreadInProgress = isThreadInProgress();
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
                title: "Runtime options request body",
                projectId: projectRoot,
                path: projectRoot,
                updatedAtIso: "2026-05-29T00:00:00.000Z",
                inProgress: currentThreadInProgress,
                pinned: false,
                owner: null,
              },
            ],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread-detail**", async (route) => {
    const currentActiveTurnId = activeTurnId();
    const currentThreadInProgress = isThreadInProgress();
    await fulfillJson(route, {
      data: {
        thread: {
          id: threadId,
          title: "Runtime options request body",
          projectId: projectRoot,
          path: projectRoot,
          updatedAtIso: "2026-05-29T00:00:00.000Z",
          inProgress: currentThreadInProgress,
          pinned: false,
          owner: null,
        },
        turns: currentActiveTurnId
          ? [{ id: currentActiveTurnId, status: "active", items: [] }]
          : [],
      },
      source: "e2e-mock",
    });
  });

  await page.route("**/api/runtime-options", async (route) => {
    await fulfillJson(
      route,
      options.runtimeOptions ?? {
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
            {
              id: "runtime",
              model: "gpt-runtime",
              displayName: "GPT Runtime",
              description: "Selected test model.",
              isDefault: false,
              defaultReasoningEffort: "high",
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
              model: "gpt-plan",
              reasoningEffort: "medium",
              developerInstructions: "plan first",
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
      },
    );
  });

  await page.route("**/api/skills**", async (route) => {
    await fulfillJson(route, {
      data: {
        skills: [
          {
            id: "docs-skill",
            name: "docs",
            displayName: "Docs Skill",
            description: "Write project docs.",
            shortDescription: "Docs",
            path: skillPath,
            cwd: projectRoot,
            scope: "user",
            enabled: true,
            brandColor: "#3366ff",
          },
          {
            id: "edge-web-ops",
            name: "agent-edge-web-ops",
            displayName: "Agent Edge Web Ops",
            description: "Use Edge login state for direct web UI work.",
            shortDescription: "Edge web UI work",
            path: secondSkillPath,
            cwd: projectRoot,
            scope: "repo",
            enabled: true,
            brandColor: "#0f766e",
          },
          ...Array.from({ length: 18 }, (_, index) => {
            const ordinal = index + 1;
            return {
              id: `overflow-skill-${ordinal}`,
              name: `overflow-skill-${ordinal}`,
              displayName: `Overflow Skill ${ordinal}`,
              description: `Overflow skill ${ordinal}.`,
              shortDescription: `Overflow ${ordinal}`,
              path: `C:\\codex-web-test\\skills\\overflow-${ordinal}\\SKILL.md`,
              cwd: projectRoot,
              scope: ordinal % 2 === 0 ? "system" : "user",
              enabled: true,
              brandColor: "#64748b",
            };
          }),
        ],
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

  await page.route("**/api/domain/turn-start", async (route) => {
    onTurnStart(route.request().postDataJSON() as JsonBody);
    await fulfillJson(route, {
      data: {
        mode: "official-follower",
        result: { ok: true },
      },
    });
  });

  await page.route("**/api/domain/thread-stop-background", async (route) => {
    const body = route.request().postDataJSON() as JsonBody;
    options.onThreadStopBackground?.(body);
    await fulfillJson(route, {
      data: {
        ok: true,
        interrupted: 1,
        results: [{ turnId: "turn-from-official-stream", mode: "official-follower" }],
      },
    });
  });
}

test.describe("composer runtime options", () => {
  test("shows stop control for thread-level running state without active turn id", async ({
    page,
  }) => {
    let stopBody: JsonBody | null = null;
    await installComposerRuntimeMocks(page, () => undefined, {
      threadInProgress: true,
      onThreadStopBackground: (body) => {
        stopBody = body;
      },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const composer = page.getByRole("form", { name: "Composer" });
    await expect(
      composer.getByRole("button", { name: "停止当前回复" }),
    ).toBeVisible();
    await composer.getByRole("button", { name: "停止当前回复" }).click();
    await expect.poll(() => stopBody?.threadId).toBe(threadId);
  });

  test("renders Desktop-like native dictation controls while recording", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "听写底栏结构先在桌面尺寸验证",
    );

    await page.addInitScript(() => {
      const track = { stop() {} };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => ({
            getTracks: () => [track],
          }),
        },
      });
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: undefined,
      });

      class FakeMediaRecorder extends EventTarget {
        mimeType = "audio/webm";
        ondataavailable: ((event: BlobEvent) => void) | null = null;
        onerror: (() => void) | null = null;
        onstop: (() => void) | null = null;
        state = "inactive";

        start(): void {
          this.state = "recording";
        }

        stop(): void {
          this.state = "inactive";
          const event = new BlobEvent("dataavailable", {
            data: new Blob(["audio"], { type: this.mimeType }),
          });
          this.ondataavailable?.(event);
          this.dispatchEvent(event);
          this.onstop?.();
          this.dispatchEvent(new Event("stop"));
        }
      }

      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
    });

    await installComposerRuntimeMocks(page, () => undefined);
    await page.route("**/api/native-dictation/transcribe", async (route) => {
      await fulfillJson(route, { data: { text: "喂喂喂,你是谁呀?" } });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByLabel("输入消息").fill("已有文字");
    await page.getByLabel("原生语音输入").click();
    await expect(page.getByLabel("输入消息")).toHaveAttribute(
      "placeholder",
      "正在听写...",
    );
    await expect(page.getByRole("group", { name: "听写控制" })).toBeVisible();
    await expect(page.getByLabel("停止听写")).toBeVisible();
    await expect(page.getByLabel("听写波形")).toBeVisible();
    await expect(
      page.locator('[class*="dictationWaveformBar"]').first(),
    ).toBeVisible();

    await page.waitForTimeout(300);
    await page.getByLabel("停止听写").click();
    await expect(page.getByLabel("输入消息")).toHaveValue(
      "已有文字 喂喂喂,你是谁呀?",
    );
  });

  test("uploads multiple images, sends their ids, and clears the tray after success", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "附件请求体链路只需要在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });
    let uploadCount = 0;
    await page.route("**/api/attachments?**", async (route) => {
      uploadCount += 1;
      await fulfillJson(route, {
        data: {
          id: `attachment-image-${uploadCount}`,
          filename: `web-image-${uploadCount}.png`,
          mimeType: "image/png",
          size: 21 + uploadCount,
          path: `C:\\workspace\\codex_web\\data\\attachments\\attachment-image-${uploadCount}.png`,
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          createdAtIso: "2026-05-29T00:00:00.000Z",
          threadId,
          turnId: null,
          officialReferenceId: null,
        },
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("输入消息")).toBeVisible();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("打开输入选项").click();
    await page.getByRole("menuitem", { name: "添加照片和文件" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([
      {
        name: "web-image-1.png",
        mimeType: "image/png",
        buffer: Buffer.from("image one", "utf8"),
      },
      {
        name: "web-image-2.png",
        mimeType: "image/png",
        buffer: Buffer.from("image two", "utf8"),
      },
    ]);
    await expect(
      page.getByRole("img", { name: "web-image-1.png" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "web-image-2.png" }),
    ).toBeVisible();
    const imageGrid = page.getByTestId("composer-image-attachments");
    await expect(imageGrid).toBeVisible();
    await expect(page.getByTestId("composer-file-attachments")).toHaveCount(0);
    const imageGridBox = await imageGrid.boundingBox();
    const inputBox = await page.getByLabel("输入消息").boundingBox();
    expect(imageGridBox?.y).toBeLessThan(inputBox?.y ?? 0);

    await page.getByLabel("输入消息").fill("send with image attachments");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "send with image attachments",
      attachmentIds: ["attachment-image-1", "attachment-image-2"],
    });
    await expect(
      page.getByRole("img", { name: "web-image-1.png" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: "web-image-2.png" }),
    ).toHaveCount(0);
  });

  test("opens uploaded image attachments in a preview dialog", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "图片预览交互先在桌面尺寸验证",
    );

    await installComposerRuntimeMocks(page, () => undefined);
    await page.route("**/api/attachments?**", async (route) => {
      await fulfillJson(route, {
        data: {
          id: "attachment-preview-image",
          filename: "web-preview.png",
          mimeType: "image/png",
          size: 21,
          path: "C:\\workspace\\codex_web\\data\\attachments\\web-preview.png",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          createdAtIso: "2026-05-29T00:00:00.000Z",
          threadId,
          turnId: null,
          officialReferenceId: null,
        },
      });
    });
    await page.route(
      "**/api/attachments/attachment-preview-image/content",
      async (route) => {
        await route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
            "base64",
          ),
        });
      },
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("打开输入选项").click();
    await page.getByRole("menuitem", { name: "添加照片和文件" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([
      {
        name: "web-preview.png",
        mimeType: "image/png",
        buffer: Buffer.from("image preview", "utf8"),
      },
    ]);

    const previewButton = page.getByRole("button", {
      name: "预览 web-preview.png",
    });
    await expect(previewButton).toBeVisible();
    await previewButton.click();

    const dialog = page.getByRole("dialog", {
      name: "预览 web-preview.png",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("img", { name: "web-preview.png" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", {
        name: "下载 web-preview.png",
      }),
    ).toBeVisible();

    await dialog
      .getByRole("button", { name: "关闭 web-preview.png 预览" })
      .click();
    await expect(dialog).toHaveCount(0);
  });

  test("keeps focus in the composer after pasting an image", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "粘贴上传后的焦点回归只需要在桌面项目验证一次",
    );

    await installComposerRuntimeMocks(page, () => undefined);
    await page.route("**/api/attachments?**", async (route) => {
      await fulfillJson(route, {
        data: {
          id: "attachment-pasted-image",
          filename: "pasted-image.png",
          mimeType: "image/png",
          size: 21,
          path: "C:\\workspace\\codex_web\\data\\attachments\\pasted-image.png",
          sha256:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          createdAtIso: "2026-05-29T00:00:00.000Z",
          threadId,
          turnId: null,
          officialReferenceId: null,
        },
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const composerInput = page.getByLabel("输入消息");
    await expect(composerInput).toBeVisible();
    await composerInput.focus();
    await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="输入消息"]',
      );
      if (!textarea) throw new Error("Composer textarea not found");
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "pasted-image.png", {
          type: "image/png",
        }),
      );
      textarea.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        }),
      );
    });

    await expect(
      page.getByRole("img", { name: "pasted-image.png" }),
    ).toBeVisible();
    await expect(composerInput).toBeFocused();
  });

  test("keeps image thumbnails above file cards and text input", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "混合附件顺序先在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });
    let uploadCount = 0;
    const longFilename =
      "codex-web-reference-with-a-very-long-name-for-file-card-layout.md";
    await page.route("**/api/attachments?**", async (route) => {
      uploadCount += 1;
      const imageUpload = uploadCount === 1;
      await fulfillJson(route, {
        data: {
          id: imageUpload ? "attachment-mixed-image" : "attachment-mixed-file",
          filename: imageUpload ? "mixed-image.png" : longFilename,
          mimeType: imageUpload ? "image/png" : "text/markdown",
          size: imageUpload ? 64 : 4096,
          path: imageUpload
            ? "C:\\workspace\\codex_web\\data\\attachments\\mixed-image.png"
            : "C:\\workspace\\codex_web\\data\\attachments\\mixed-file.md",
          sha256:
            "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          createdAtIso: "2026-05-29T00:00:00.000Z",
          threadId,
          turnId: null,
          officialReferenceId: null,
        },
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("打开输入选项").click();
    await page.getByRole("menuitem", { name: "添加照片和文件" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([
      {
        name: "mixed-image.png",
        mimeType: "image/png",
        buffer: Buffer.from("image", "utf8"),
      },
      {
        name: longFilename,
        mimeType: "text/markdown",
        buffer: Buffer.from("# file", "utf8"),
      },
    ]);

    const imageGrid = page.getByTestId("composer-image-attachments");
    const fileRow = page.getByTestId("composer-file-attachments");
    await expect(
      page.getByRole("img", { name: "mixed-image.png" }),
    ).toBeVisible();
    await expect(fileRow.getByText(longFilename)).toBeVisible();
    const imageGridBox = await imageGrid.boundingBox();
    const fileRowBox = await fileRow.boundingBox();
    const inputBox = await page.getByLabel("输入消息").boundingBox();
    expect(imageGridBox?.y).toBeLessThan(fileRowBox?.y ?? 0);
    expect(fileRowBox?.y).toBeLessThan(inputBox?.y ?? 0);
    await expectNoHorizontalOverflow(
      page,
      "desktop composer mixed attachments",
    );

    await page.getByLabel("输入消息").fill("send mixed attachments");
    await page.getByRole("button", { name: "发送" }).click();
    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      attachmentIds: ["attachment-mixed-image", "attachment-mixed-file"],
    });
  });

  test("keeps attachment picker usable while guiding an active turn", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "运行中附件队列路径只需要在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    let capturedTurnSteer: JsonBody | null = null;
    await installComposerRuntimeMocks(
      page,
      (body) => {
        capturedTurnStart = body;
      },
      { activeTurn: true },
    );
    await page.route("**/api/attachments?**", async (route) => {
      await fulfillJson(route, {
        data: {
          id: "attachment-active-e2e",
          filename: "queued-during-active-turn.png",
          mimeType: "image/png",
          size: 128,
          path: "C:\\workspace\\codex_web\\data\\attachments\\queued-during-active-turn.png",
          sha256:
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          createdAtIso: "2026-05-29T00:00:00.000Z",
          threadId,
          turnId: null,
          officialReferenceId: null,
        },
      });
    });
    await page.route("**/api/domain/turn-steer", async (route) => {
      capturedTurnSteer = route.request().postDataJSON() as JsonBody;
      await fulfillJson(route, {
        data: {
          mode: "official-follower",
          result: { ok: true },
        },
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("输入消息")).toHaveAttribute(
      "placeholder",
      "引导当前回复",
    );
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("打开输入选项").click();
    await page.getByRole("menuitem", { name: "添加照片和文件" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "queued-during-active-turn.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71]),
    });

    await expect(
      page.getByRole("img", { name: "queued-during-active-turn.png" }),
    ).toBeVisible();
    await expect(page.getByLabel("发送目标")).toContainText("当前");
    await expect(page.getByLabel("输入消息")).toHaveAttribute(
      "placeholder",
      "引导当前回复",
    );

    await page.getByLabel("输入消息").fill("guide with attachment");
    await page.getByRole("button", { name: "发送", exact: true }).click();

    await expect.poll(() => capturedTurnSteer).not.toBeNull();
    expect(capturedTurnSteer).toMatchObject({
      threadId,
      expectedTurnId: "turn-active-runtime-e2e",
      text: "guide with attachment",
      attachmentIds: ["attachment-active-e2e"],
    });
    expect(capturedTurnStart).toBeNull();
  });

  test("queues messages during an active turn and flushes after it finishes", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "排队模式的桌面队列条交互先在桌面尺寸验证",
    );

    let activeTurn = true;
    let capturedTurnStart: JsonBody | null = null;
    let capturedTurnSteer: JsonBody | null = null;
    await installComposerRuntimeMocks(
      page,
      (body) => {
        capturedTurnStart = body;
      },
      { activeTurn: () => activeTurn },
    );
    await page.route("**/api/domain/turn-steer", async (route) => {
      capturedTurnSteer = route.request().postDataJSON() as JsonBody;
      await fulfillJson(route, {
        data: {
          mode: "official-follower",
          result: { ok: true },
        },
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("输入消息")).toHaveAttribute(
      "placeholder",
      "引导当前回复",
    );

    await page.getByLabel("发送目标").click();
    await expect(page.getByLabel("发送目标")).toContainText("排队");
    await expect(page.getByLabel("输入消息")).toHaveAttribute(
      "placeholder",
      "排队下一条消息",
    );
    await page.getByLabel("输入消息").fill("先作为队列引导");
    await page.getByRole("button", { name: "发送", exact: true }).click();

    const queueStrip = page.getByLabel("排队消息");
    await expect(queueStrip.getByText("先作为队列引导")).toBeVisible();
    expect(capturedTurnStart).toBeNull();
    expect(capturedTurnSteer).toBeNull();

    await queueStrip.getByRole("button", { name: "引导" }).click();
    await expect.poll(() => capturedTurnSteer).not.toBeNull();
    expect(capturedTurnSteer).toMatchObject({
      threadId,
      expectedTurnId: "turn-active-runtime-e2e",
      text: "先作为队列引导",
    });
    expect(capturedTurnStart).toBeNull();
    await expect(queueStrip.getByText("先作为队列引导")).toHaveCount(0);

    await page.getByLabel("输入消息").fill("这条要删除");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(queueStrip.getByText("这条要删除")).toBeVisible();
    await queueStrip.getByRole("button", { name: "删除排队消息" }).click();
    await expect(queueStrip.getByText("这条要删除")).toHaveCount(0);

    await page.getByLabel("输入消息").fill("当前结束后再发送");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(queueStrip.getByText("当前结束后再发送")).toBeVisible();
    activeTurn = false;

    await expect.poll(() => capturedTurnStart, { timeout: 3500 }).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "当前结束后再发送",
      cwd: projectRoot,
    });
    await expect(queueStrip.getByText("当前结束后再发送")).toHaveCount(0);
  });

  test("opens slash commands only at an empty prompt and sends selected skills/functions", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "斜杠菜单请求体链路先在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const input = page.getByLabel("输入消息");
    await input.fill("已有文本 /");
    await expect(page.getByRole("menu", { name: "斜杠菜单" })).toHaveCount(0);

    await input.fill("/");
    const slashMenu = page.getByRole("menu", { name: "斜杠菜单" });
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu.getByText("功能")).toBeVisible();
    await expect(slashMenu.getByText("技能")).toBeVisible();

    await slashMenu
      .getByRole("menuitemcheckbox", { name: /^目标 设置/ })
      .click();
    await expect(page.getByLabel("协作模式")).toContainText("目标");
    await expect(input).toHaveValue("");

    await slashMenu
      .getByRole("menuitemcheckbox", { name: /Docs Skill/ })
      .click();
    await slashMenu
      .getByRole("menuitemcheckbox", { name: /Agent Edge Web Ops/ })
      .click();
    const inlineSkills = page.getByTestId("composer-inline-skills");
    await expect(inlineSkills.getByText("Docs Skill")).toBeVisible();
    await expect(inlineSkills.getByText("Agent Edge Web Ops")).toBeVisible();
    const chipBox = await inlineSkills.getByText("Docs Skill").boundingBox();
    const inputBox = await input.boundingBox();
    expect(chipBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(chipBox!.y).toBeGreaterThanOrEqual(inputBox!.y - 8);
    expect(chipBox!.y).toBeLessThanOrEqual(inputBox!.y + 8);
    await expect(input).toHaveValue("");

    await input.fill("slash command payload");
    await expect(slashMenu).toHaveCount(0);
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "slash command payload",
      skills: [
        { name: "docs", path: skillPath },
        { name: "agent-edge-web-ops", path: secondSkillPath },
      ],
      collaborationMode: {
        mode: "plan",
      },
    });
  });

  test("sends a selected skill without typed text", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "skill-only 请求体链路先在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const input = page.getByLabel("输入消息");
    await page.getByLabel("打开输入选项").click();
    const inputMenu = page.getByRole("menu", { name: "输入选项" });
    await expect(inputMenu).toBeVisible();
    await inputMenu.getByRole("button", { name: "插件" }).click();
    await inputMenu.getByText("Docs Skill").click();
    await expect(input).toHaveValue("");
    await expect(
      page.getByTestId("composer-inline-skills").getByText("Docs Skill"),
    ).toBeVisible();

    const sendButton = page.getByRole("button", {
      name: "发送",
      exact: true,
    });
    await expect(sendButton).toBeEnabled();
    await page.keyboard.press("Escape");
    await sendButton.click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "",
      skills: [{ name: "docs", path: skillPath }],
    });
    await expect(page.getByTestId("composer-inline-skills")).toHaveCount(0);
  });

  test("keeps the keyboard-selected slash command item visible", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "斜杠菜单滚动键盘路径先在桌面项目验证一次",
    );

    await installComposerRuntimeMocks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const input = page.getByLabel("输入消息");
    await input.focus();
    await input.press("/");
    const slashMenu = page.getByRole("menu", { name: "斜杠菜单" });
    await expect(slashMenu).toBeVisible();

    for (let index = 0; index < 20; index += 1) {
      await input.press("ArrowDown");
    }

    const activeItem = slashMenu.locator('[data-active="true"]');
    await expect(activeItem).toHaveCount(1);
    const menuBox = await slashMenu.boundingBox();
    const activeBox = await activeItem.boundingBox();
    expect(activeBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(activeBox!.y).toBeGreaterThanOrEqual(menuBox!.y - 1);
    expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(
      menuBox!.y + menuBox!.height + 1,
    );
  });

  test("treats slash after instruction text as normal text", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "斜杠触发边界只需要在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByLabel("输入消息").fill("正常文本 / 不是命令");
    await expect(page.getByRole("menu", { name: "斜杠菜单" })).toHaveCount(0);
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "正常文本 / 不是命令",
    });
  });

  test("sends selected model, effort, plan mode, and skills to turn-start", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "请求体链路只需要在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("输入消息")).toBeVisible();
    await expect(page.getByLabel("模型与思考深度")).toContainText("Default");
    await expect(page.getByLabel("模型与思考深度")).toContainText("中");
    await expect(page.getByLabel("协作模式")).toHaveCount(0);
    await expect(page.getByLabel("权限设置")).toContainText("完全访问权限");

    await page.getByLabel("模型与思考深度").click();
    await page.getByRole("menuitemradio", { name: "GPT Runtime" }).click();
    await page.getByLabel("模型与思考深度").click();
    await page.getByRole("menuitemradio", { name: "高" }).click();

    await page.getByLabel("打开输入选项").click();
    await page.getByRole("menuitemradio", { name: "目标" }).click();
    await expect(page.getByLabel("协作模式")).toContainText("目标");

    await page.getByLabel("权限设置").click();
    await page.getByRole("menuitemradio", { name: "自动审查" }).click();
    await expect(page.getByLabel("权限设置")).toContainText("自动审查");

    await page.getByLabel("打开输入选项").click();
    await page
      .getByRole("menu", { name: "输入选项" })
      .getByRole("button", { name: "插件" })
      .click();
    await page.getByText("Docs Skill").click();
    await expect(
      page.getByRole("checkbox", { name: /Docs Skill/ }),
    ).toBeChecked();

    await page.getByLabel("输入消息").fill("runtime request body check");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "runtime request body check",
      model: "gpt-runtime",
      effort: "high",
      attachmentIds: [],
      skills: [{ name: "docs", path: skillPath }],
      permissionMode: "auto-review",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-plan",
          reasoning_effort: "medium",
          developer_instructions: "plan first",
        },
      },
    });
  });

  test("uses server default extra-high reasoning on mobile when model default differs", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "移动端默认模型与思考强度展示只在 mobile project 验证",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(
      page,
      (body) => {
        capturedTurnStart = body;
      },
      {
        runtimeOptions: {
          data: {
            models: [
              {
                id: "gpt-5.5",
                model: "gpt-5.5",
                displayName: "GPT-5.5",
                description: "Official model default is medium.",
                isDefault: true,
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "Low" },
                  { reasoningEffort: "medium", description: "Medium" },
                  { reasoningEffort: "high", description: "High" },
                  { reasoningEffort: "xhigh", description: "Extra high" },
                ],
                inputModalities: ["text", "image"],
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
              model: "gpt-5.5",
              reasoningEffort: "xhigh",
              collaborationModeName: "Default",
            },
            source: {
              models: "app-server",
              collaborationModes: "app-server",
            },
            warnings: [],
          },
        },
      },
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("模型与思考深度")).toContainText("5.5");
    await expect(page.getByLabel("模型与思考深度")).toContainText("超高");

    await page.getByLabel("输入消息").fill("mobile xhigh default check");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "mobile xhigh default check",
      model: "gpt-5.5",
      effort: "xhigh",
    });
  });

  test("submits with Enter and keeps Shift+Enter as a newline", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.includes("mobile"),
      "键盘发送只需要在桌面项目验证一次",
    );

    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const composer = page.getByLabel("输入消息");
    await expect(composer).toBeVisible();
    await composer.fill("line one");
    await composer.press("Shift+Enter");
    await composer.type("line two");
    await expect(composer).toHaveValue("line one\nline two");
    expect(capturedTurnStart).toBeNull();

    await composer.press("Enter");

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "line one\nline two",
    });
    await expect(composer).toHaveValue("");
  });

  test("uploads an attachment and sends selected Skills on mobile", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "移动端附件和 Skills 请求体链路只在 mobile project 验证",
    );

    const filename =
      "codex-web-mobile-attachment-with-a-very-long-name-for-chip-layout.txt";
    let capturedTurnStart: JsonBody | null = null;
    await installComposerRuntimeMocks(page, (body) => {
      capturedTurnStart = body;
    });
    await page.route("**/api/attachments?**", async (route) => {
      await fulfillJson(route, {
        data: {
          id: "attachment-mobile-e2e",
          filename,
          mimeType: "text/plain",
          size: 21,
          path: "C:\\workspace\\codex_web\\data\\attachments\\attachment-mobile-e2e.txt",
          sha256:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          createdAtIso: "2026-05-29T00:00:00.000Z",
          threadId,
          turnId: null,
          officialReferenceId: null,
        },
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("输入消息")).toBeVisible();
    await page.getByLabel("打开输入选项").click();
    const inputMenu = page.getByRole("menu", { name: "输入选项" });
    await expect(inputMenu).toBeVisible();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await inputMenu.getByRole("menuitem", { name: "添加照片和文件" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("mobile attachment body", "utf8"),
    });
    await expect(page.getByText(filename)).toBeVisible();
    await expect(page.getByTestId("composer-file-attachments")).toBeVisible();
    await expect(page.getByTestId("composer-image-attachments")).toHaveCount(0);
    const fileRowBox = await page
      .getByTestId("composer-file-attachments")
      .boundingBox();
    const inputBox = await page.getByLabel("输入消息").boundingBox();
    expect(
      (fileRowBox?.y ?? 0) + (fileRowBox?.height ?? 0),
    ).toBeLessThanOrEqual((inputBox?.y ?? 0) + 1);
    await expectNoHorizontalOverflow(page, "mobile composer attachment chip");

    await page.getByLabel("打开输入选项").click();
    await expect(inputMenu).toBeVisible();
    await inputMenu.getByRole("button", { name: "插件" }).click();
    await inputMenu.getByText("Docs Skill").click();
    await expect(
      page.getByRole("checkbox", { name: /Docs Skill/ }),
    ).toBeChecked();
    await expect(
      page.getByTestId("composer-inline-skills").getByText("Docs Skill"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page, "mobile composer selected skill");

    await page.getByLabel("输入消息").fill("mobile attachment send");
    await page.getByRole("button", { name: "发送" }).click();

    await expect.poll(() => capturedTurnStart).not.toBeNull();
    expect(capturedTurnStart).toMatchObject({
      threadId,
      text: "mobile attachment send",
      attachmentIds: ["attachment-mobile-e2e"],
      skills: [{ name: "docs", path: skillPath }],
    });
    await expect(page.getByText(filename)).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "mobile composer after send");
  });

  test("keeps mobile image attachment previews from covering the input", async ({
    page,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "移动端图片附件布局回归",
    );

    await installComposerRuntimeMocks(page, () => undefined);
    await page.route("**/api/attachments?**", async (route) => {
      await fulfillJson(route, {
        data: {
          id: "attachment-mobile-image-e2e",
          filename: "mobile-preview.png",
          mimeType: "image/png",
          size: 88,
          path: "C:\\workspace\\codex_web\\data\\attachments\\mobile-preview.png",
          sha256:
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          createdAtIso: "2026-05-29T00:00:00.000Z",
          threadId,
          turnId: null,
          officialReferenceId: null,
        },
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("打开输入选项").click();
    await page
      .getByRole("menu", { name: "输入选项" })
      .getByRole("menuitem", { name: "添加照片和文件" })
      .click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "mobile-preview.png",
      mimeType: "image/png",
      buffer: Buffer.from("mobile image", "utf8"),
    });

    await expect(
      page.getByRole("img", { name: "mobile-preview.png" }),
    ).toBeVisible();
    await page.getByLabel("输入消息").fill("mobile image text stays readable");
    const imageGridBox = await page
      .getByTestId("composer-image-attachments")
      .boundingBox();
    const inputBox = await page.getByLabel("输入消息").boundingBox();
    expect(
      (imageGridBox?.y ?? 0) + (imageGridBox?.height ?? 0),
    ).toBeLessThanOrEqual((inputBox?.y ?? 0) + 1);
    await expectNoHorizontalOverflow(page, "mobile composer image attachment");
  });
});
