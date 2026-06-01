import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type {
  CodexAppServerProcess,
  TurnInterruptParams,
  ThreadCompactStartParams,
  TurnStartParams,
  TurnSteerParams,
} from "./appServerProcess.js";

type FakeOfficialIpcOptions = {
  errorMessage: string;
  hasOfficialState?: boolean;
  officialState?: "active" | "idle" | "stale-active";
  webOwned?: boolean;
};

class FakeOfficialIpc {
  readonly registeredRequestHandlers: string[] = [];
  readonly followerStartCalls: Array<{ threadId: string; params: unknown }> =
    [];
  readonly followerSteerCalls: Array<{ threadId: string; params: unknown }> =
    [];
  readonly followerCompactCalls: Array<{ threadId: string }> = [];
  readonly localOnlyThreads = new Set<string>();
  readonly discardedThreads = new Set<string>();

  constructor(private readonly options: FakeOfficialIpcOptions) {}

  setRawFrameLogging(): void {}

  onNotification(): () => void {
    return () => undefined;
  }

  start(): void {}

  dispose(): void {}

  restoreThreadStreamState(): boolean {
    return true;
  }

  registerRequestHandler(method: string): void {
    this.registeredRequestHandlers.push(method);
  }

  isOwnedConversation(threadId = "thread-a"): boolean {
    return Boolean(this.options.webOwned || this.localOnlyThreads.has(threadId));
  }

  isExternallyOwnedConversation(threadId = "thread-a"): boolean {
    return Boolean(
      this.options.hasOfficialState &&
        !this.options.webOwned &&
        !this.discardedThreads.has(threadId),
    );
  }

  canOwnConversations(): boolean {
    return !this.options.errorMessage.includes("not-connected");
  }

  claimLocalOnlyConversation(threadId: string): boolean {
    if (!this.canOwnConversations() || this.isExternallyOwnedConversation())
      return false;
    this.localOnlyThreads.add(threadId);
    return true;
  }

  discardConversationFromCache(threadId: string): boolean {
    if (!this.options.hasOfficialState) return false;
    this.discardedThreads.add(threadId);
    return true;
  }

  canBroadcastOwnedConversation(threadId: string): boolean {
    return !this.localOnlyThreads.has(threadId);
  }

  getThreadStreamState(threadId: string): Record<string, unknown> | null {
    if (!this.options.hasOfficialState || this.discardedThreads.has(threadId))
      return null;
    const officialState = this.options.officialState ?? "active";
    if (officialState === "idle") {
      return {
        conversationId: threadId,
        ownerClientId: this.options.webOwned ? "web-test" : "official-test",
        sourceClientId: this.options.webOwned ? "web-test" : "official-test",
        cacheVersion: 1,
        updatedAtIso: "2026-05-29T00:00:00.000Z",
        isInProgress: false,
        activeTurnId: "",
        conversationState: {
          id: threadId,
          threadRuntimeStatus: { type: "completed" },
          turns: [{ id: "turn-completed", status: "completed", items: [] }],
        },
      };
    }
    if (officialState === "stale-active") {
      return {
        conversationId: threadId,
        ownerClientId: this.options.webOwned ? "web-test" : "official-test",
        sourceClientId: this.options.webOwned ? "web-test" : "official-test",
        cacheVersion: 1,
        updatedAtIso: "2026-05-29T00:00:00.000Z",
        isInProgress: true,
        activeTurnId: "",
        conversationState: {
          id: threadId,
          threadRuntimeStatus: { type: "active" },
          turns: [],
        },
      };
    }
    return {
      conversationId: threadId,
      ownerClientId: this.options.webOwned ? "web-test" : "official-test",
      sourceClientId: this.options.webOwned ? "web-test" : "official-test",
      cacheVersion: 1,
      updatedAtIso: "2026-05-29T00:00:00.000Z",
      isInProgress: true,
      activeTurnId: "turn-active",
      conversationState: {
        id: threadId,
        threadRuntimeStatus: { type: "active" },
        turns: [{ turnId: "turn-active", status: "inProgress", items: [] }],
      },
    };
  }

  getStatus(): Record<string, unknown> {
    return {
      supported: true,
      connected: true,
      clientId: "web-test",
      registeredRequestHandlers: this.registeredRequestHandlers,
      cachedConversationCount: this.options.hasOfficialState ? 1 : 0,
      ownedConversationCount:
        (this.options.webOwned ? 1 : 0) + this.localOnlyThreads.size,
      recentFollowerRequests: [],
      recentOwnershipHandoffs: [],
      rawFrameLogging: false,
      recentRawFrames: [],
      lastError: null,
    };
  }

  async sendThreadFollowerStartTurn(
    threadId: string,
    params: unknown,
  ): Promise<unknown> {
    this.followerStartCalls.push({ threadId, params });
    if (!this.options.errorMessage) return { ok: true };
    throw new Error(this.options.errorMessage);
  }

  async sendThreadFollowerSteerTurn(
    threadId: string,
    params: unknown,
  ): Promise<unknown> {
    this.followerSteerCalls.push({ threadId, params });
    if (!this.options.errorMessage) return { ok: true };
    throw new Error(this.options.errorMessage);
  }

  async sendThreadFollowerInterruptTurn(): Promise<unknown> {
    throw new Error(this.options.errorMessage);
  }

  async sendThreadFollowerCompactThread(threadId: string): Promise<unknown> {
    this.followerCompactCalls.push({ threadId });
    if (this.options.webOwned) throw new Error("no-official-owner");
    if (!this.options.errorMessage) return { ok: true };
    throw new Error(this.options.errorMessage);
  }

  broadcastConversationSnapshot(): void {}
}

class FakeAppServer {
  readonly calls: Array<{ method: string; params?: unknown }> = [];

  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return { ok: true };
  }

  async turnStart(params: TurnStartParams): Promise<unknown> {
    this.calls.push({ method: "turn/start", params });
    return { turn: { id: "turn-local" } };
  }

  async turnSteer(params: TurnSteerParams): Promise<unknown> {
    this.calls.push({ method: "turn/steer", params });
    return { ok: true };
  }

  async turnInterrupt(params: TurnInterruptParams): Promise<unknown> {
    this.calls.push({ method: "turn/interrupt", params });
    return { ok: true };
  }

  async threadRead(): Promise<unknown> {
    return {
      thread: {
        id: "thread-a",
        title: "Thread A",
        updatedAt: "2026-05-31T20:37:59.000Z",
        threadRuntimeStatus: { type: "completed" },
        turns: [{ id: "turn-completed", status: "completed", items: [] }],
      },
    };
  }

  async threadCompactStart(
    params?: ThreadCompactStartParams,
  ): Promise<unknown> {
    this.calls.push({ method: "thread/compact/start", params });
    return { ok: true };
  }
}

type Harness = {
  context: ServerContext;
  officialIpc: FakeOfficialIpc;
  appServer: FakeAppServer;
  root: string;
};

const harnesses: Harness[] = [];

async function createHarness(
  options: FakeOfficialIpcOptions,
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-turn-routes-"));
  const officialIpc = new FakeOfficialIpc(options);
  const appServer = new FakeAppServer();
  const context = await createServer(root, {
    officialIpc: officialIpc as unknown as OfficialIpcBridge,
    appServer: appServer as unknown as CodexAppServerProcess,
  });
  const harness = { context, officialIpc, appServer, root };
  harnesses.push(harness);
  return harness;
}

async function closeHarness(harness: Harness): Promise<void> {
  await harness.context.app.close();
  rmSync(harness.root, { recursive: true, force: true });
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await closeHarness(harness);
  }
});

describe("turn HTTP routes", () => {
  it.each([
    {
      route: "/api/domain/turn-start",
      body: { threadId: "thread-a", text: "hello" },
      source: "turn-start",
    },
    {
      route: "/api/domain/turn-steer",
      body: { threadId: "thread-a", expectedTurnId: "turn-a", text: "guide" },
      source: "turn-steer",
    },
    {
      route: "/api/domain/turn-interrupt",
      body: { threadId: "thread-a", turnId: "turn-a" },
      source: "turn-interrupt",
    },
    {
      route: "/api/domain/thread-compact",
      body: { threadId: "thread-a" },
      source: "thread-compact",
    },
  ])(
    "denies local fallback for official-known owner failures on $route",
    async ({ route, body, source }) => {
      const { context, appServer } = await createHarness({
        errorMessage: "no-client-found",
        hasOfficialState: true,
      });

      const response = await context.app.inject({
        method: "POST",
        url: route,
        payload: body,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: expect.stringContaining("official-owner-unavailable"),
      });
      expect(appServer.calls).toEqual([]);
      expect(context.diagnostics.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source,
            message: "official-follower-fallback-denied",
            data: expect.objectContaining({
              threadId: "thread-a",
              reason: "official-owner-unavailable",
            }),
          }),
        ]),
      );
    },
  );

  it("routes thread compact through the official owner when available", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-compact",
      payload: { threadId: "thread-a" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "official-follower", result: { ok: true } },
    });
    expect(officialIpc.followerCompactCalls).toEqual([
      { threadId: "thread-a" },
    ]);
    expect(appServer.calls).toEqual([]);
  });

  it("compacts a Web-owned thread locally and refreshes its snapshot", async () => {
    const { context, appServer } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
      webOwned: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-compact",
      payload: { threadId: "thread-a" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        mode: "app-server",
        result: { ok: true },
        thread: { id: "thread-a" },
      },
    });
    expect(appServer.calls).toEqual([
      { method: "thread/compact/start", params: { threadId: "thread-a" } },
    ]);
  });

  it("does not associate attachments when start fallback is denied", async () => {
    const { context, appServer } = await createHarness({
      errorMessage: "no-client-found",
      hasOfficialState: true,
    });
    context.database.insertAttachment({
      id: "att-a",
      filename: "note.txt",
      mimeType: "text/plain",
      size: 4,
      path: join(context.config.dataDir, "attachments", "note.txt"),
      sha256: "sha256",
      createdAtIso: "2026-05-29T00:00:00.000Z",
      threadId: null,
      turnId: null,
      officialReferenceId: null,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "thread-a",
        text: "hello",
        attachmentIds: ["att-a"],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(appServer.calls).toEqual([]);
    expect(context.database.readAttachmentsByIds(["att-a"])).toEqual([
      expect.objectContaining({ id: "att-a", threadId: null }),
    ]);
  });

  it("inlines image attachments into follower start input", async () => {
    const { context, officialIpc } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
    });
    const attachmentDirectory = join(context.config.dataDir, "attachments");
    mkdirSync(attachmentDirectory, { recursive: true });
    const attachmentPath = join(attachmentDirectory, "image.png");
    writeFileSync(attachmentPath, Buffer.from("image-body", "utf8"));
    context.database.insertAttachment({
      id: "att-image",
      filename: "image.png",
      mimeType: "image/png",
      size: 10,
      path: attachmentPath,
      sha256: "image-sha",
      createdAtIso: "2026-05-29T00:00:00.000Z",
      threadId: null,
      turnId: null,
      officialReferenceId: null,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "thread-a",
        text: "",
        attachmentIds: ["att-image"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(officialIpc.followerStartCalls).toEqual([
      {
        threadId: "thread-a",
        params: expect.objectContaining({
          input: [
            expect.objectContaining({
              type: "text",
              text: "<image>",
            }),
            expect.objectContaining({
              type: "image",
              url: "data:image/png;base64,aW1hZ2UtYm9keQ==",
            }),
          ],
          attachments: [
            expect.objectContaining({
              id: "att-image",
              type: "local_image",
              path: attachmentPath,
            }),
          ],
          restoreMessage: expect.objectContaining({
            context: expect.objectContaining({
              imageAttachments: [
                expect.objectContaining({
                  filename: "image.png",
                  src: "data:image/png;base64,aW1hZ2UtYm9keQ==",
                }),
              ],
            }),
          }),
        }),
      },
    ]);
    expect(context.database.readAttachmentsByIds(["att-image"])).toEqual([
      expect.objectContaining({ id: "att-image", threadId: "thread-a" }),
    ]);
  });

  it("passes attachments through follower steer requests", async () => {
    const { context, officialIpc } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
    });
    const attachmentDirectory = join(context.config.dataDir, "attachments");
    mkdirSync(attachmentDirectory, { recursive: true });
    const attachmentPath = join(attachmentDirectory, "steer-image.png");
    writeFileSync(attachmentPath, Buffer.from("steer-image", "utf8"));
    context.database.insertAttachment({
      id: "att-steer-image",
      filename: "steer-image.png",
      mimeType: "image/png",
      size: 11,
      path: attachmentPath,
      sha256: "steer-image-sha",
      createdAtIso: "2026-05-29T00:00:00.000Z",
      threadId: null,
      turnId: null,
      officialReferenceId: null,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-steer",
      payload: {
        threadId: "thread-a",
        expectedTurnId: "turn-active",
        text: "guide",
        attachmentIds: ["att-steer-image"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(officialIpc.followerSteerCalls).toEqual([
      {
        threadId: "thread-a",
        params: expect.objectContaining({
          expectedTurnId: "turn-active",
          input: [
            expect.objectContaining({ type: "text", text: "guide" }),
            expect.objectContaining({
              type: "text",
              text: "<image>",
            }),
            expect.objectContaining({
              type: "image",
              url: "data:image/png;base64,c3RlZXItaW1hZ2U=",
            }),
          ],
          attachments: [
            expect.objectContaining({
              id: "att-steer-image",
              type: "local_image",
              path: attachmentPath,
            }),
          ],
          restoreMessage: expect.objectContaining({
            context: expect.objectContaining({
              imageAttachments: [
                expect.objectContaining({
                  filename: "steer-image.png",
                  src: "data:image/png;base64,c3RlZXItaW1hZ2U=",
                }),
              ],
            }),
          }),
        }),
      },
    ]);
    expect(context.database.readAttachmentsByIds(["att-steer-image"])).toEqual([
      expect.objectContaining({ id: "att-steer-image", threadId: "thread-a" }),
    ]);
  });

  it("passes runtime options and skills through to the official follower", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
    });

    const collaborationMode = {
      mode: "plan",
      settings: {
        model: "gpt-plan",
        reasoning_effort: "medium",
        developer_instructions: "do not record this",
      },
    };

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "thread-a",
        text: "hello",
        model: "gpt-runtime",
        effort: "high",
        permissionMode: "auto-review",
        skills: [{ name: "docs", path: "C:\\skill\\SKILL.md" }],
        collaborationMode,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "official-follower", result: { ok: true } },
    });
    expect(appServer.calls).toEqual([]);
    expect(officialIpc.followerStartCalls).toEqual([
      {
        threadId: "thread-a",
        params: {
          threadId: "thread-a",
          input: [
            { type: "text", text: "hello", text_elements: [] },
            { type: "skill", name: "docs", path: "C:\\skill\\SKILL.md" },
          ],
          model: "gpt-runtime",
          effort: "high",
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: [],
            excludeSlashTmp: false,
            excludeTmpdirEnvVar: false,
            networkAccess: false,
          },
          collaborationMode,
        },
      },
    ]);
  });

  it("passes full access as the official tagged sandbox policy", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "thread-a",
        text: "hello",
        permissionMode: "full-access",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(appServer.calls).toEqual([]);
    expect(officialIpc.followerStartCalls).toEqual([
      {
        threadId: "thread-a",
        params: {
          threadId: "thread-a",
          input: [{ type: "text", text: "hello", text_elements: [] }],
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandboxPolicy: { type: "dangerFullAccess" },
        },
      },
    ]);
  });

  it("rejects raw turn-start attachments instead of forwarding unmanaged protocol payloads", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "thread-a",
        text: "hello",
        attachments: [{ path: "C:\\raw\\secret.txt" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining("attachments"),
    });
    expect(officialIpc.followerStartCalls).toEqual([]);
    expect(appServer.calls).toEqual([]);
  });

  it("returns unavailable instead of falling back when owner state is unknown and IPC is disconnected", async () => {
    const { context, appServer } = await createHarness({
      errorMessage: "official-ipc-not-connected",
      hasOfficialState: false,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: { threadId: "thread-a", text: "hello" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining("official-owner-required"),
    });
    expect(appServer.calls).toEqual([]);
  });

  it("claims idle official-known conversations locally when the official owner is unreachable", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "official-ipc-request-failed:thread-follower-start-turn",
      hasOfficialState: true,
      officialState: "idle",
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: { threadId: "thread-a", text: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "app-server", result: { turn: { id: "turn-local" } } },
    });
    expect(officialIpc.discardedThreads.has("thread-a")).toBe(true);
    expect(officialIpc.isOwnedConversation("thread-a")).toBe(true);
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
    expect(context.diagnostics.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "official-ipc",
          message: "idle-external-owner-retired",
          data: expect.objectContaining({
            threadId: "thread-a",
            previousOwnerClientId: "official-test",
          }),
        }),
      ]),
    );
  });

  it("retires stale active owner cache before claiming an app-server-idle conversation", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "official-ipc-request-failed:thread-follower-start-turn",
      hasOfficialState: true,
      officialState: "stale-active",
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: { threadId: "thread-a", text: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "app-server", result: { turn: { id: "turn-local" } } },
    });
    expect(officialIpc.discardedThreads.has("thread-a")).toBe(true);
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
  });

  it("claims idle app-server conversations locally when no official owner is cached", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "no-official-owner",
      hasOfficialState: false,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: { threadId: "thread-a", text: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "app-server", result: { turn: { id: "turn-local" } } },
    });
    expect(officialIpc.isOwnedConversation("thread-a")).toBe(true);
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
  });

  it("falls back to local app-server only for Web-owned conversations", async () => {
    const { context, appServer } = await createHarness({
      errorMessage: "no-official-owner",
      hasOfficialState: true,
      webOwned: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: { threadId: "thread-a", text: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "app-server", result: { turn: { id: "turn-local" } } },
    });
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
  });

  it("records sanitized runtime selections for start requests", async () => {
    const { context } = await createHarness({
      errorMessage: "no-official-owner",
      hasOfficialState: true,
      webOwned: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "thread-a",
        text: "hello",
        model: "gpt-runtime",
        effort: "high",
        skills: [
          {
            name: "private-skill",
            path: "C:\\Users\\example\\.codex\\skills\\private\\SKILL.md",
          },
        ],
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-plan",
            reasoning_effort: "medium",
            developer_instructions: "do not record this",
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const event = context.diagnostics
      .list()
      .find(
        (entry) =>
          entry.source === "turn-start" &&
          entry.message === "runtime-options-selected",
      );
    expect(event).toMatchObject({
      data: {
        threadId: "thread-a",
        model: "gpt-runtime",
        effort: "high",
        skillCount: 1,
        attachmentCount: 0,
        collaborationMode: "plan",
        collaborationModel: "gpt-plan",
        collaborationReasoningEffort: "medium",
      },
    });
    expect(JSON.stringify(event?.data)).not.toContain("private\\SKILL.md");
    expect(JSON.stringify(event?.data)).not.toContain("do not record this");
  });

  it("records sanitized skill counts for steer requests", async () => {
    const { context } = await createHarness({
      errorMessage: "no-official-owner",
      hasOfficialState: true,
      webOwned: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-steer",
      payload: {
        threadId: "thread-a",
        expectedTurnId: "turn-a",
        text: "guide",
        skills: [
          {
            name: "private-skill",
            path: "C:\\Users\\example\\.codex\\skills\\private\\SKILL.md",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(context.diagnostics.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "turn-steer",
          message: "runtime-options-selected",
          data: expect.objectContaining({
            threadId: "thread-a",
            expectedTurnId: "turn-a",
            skillCount: 1,
            attachmentCount: 0,
          }),
        }),
      ]),
    );
    const event = context.diagnostics
      .list()
      .find(
        (entry) =>
          entry.source === "turn-steer" &&
          entry.message === "runtime-options-selected",
      );
    expect(JSON.stringify(event?.data)).not.toContain("private\\SKILL.md");
  });
});
