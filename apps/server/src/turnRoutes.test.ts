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
  ThreadResumeParams,
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
  readonly snapshots: Array<{ threadId: string; state: unknown }> = [];
  readonly streamStates = new Map<string, Record<string, unknown>>();
  readonly ownedThreads = new Set<string>();
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
    return Boolean(
      this.options.webOwned ||
        this.ownedThreads.has(threadId) ||
        this.localOnlyThreads.has(threadId),
    );
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
    this.ownedThreads.add(threadId);
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

  promoteLocalOnlyConversation(threadId: string): boolean {
    if (!this.localOnlyThreads.has(threadId)) return false;
    this.localOnlyThreads.delete(threadId);
    this.ownedThreads.add(threadId);
    return true;
  }

  getThreadStreamState(threadId: string): Record<string, unknown> | null {
    const streamState = this.streamStates.get(threadId);
    if (streamState) return streamState;
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

  broadcastConversationSnapshot(threadId: string, state: unknown): boolean {
    if (!this.canBroadcastOwnedConversation(threadId)) return false;
    this.snapshots.push({ threadId, state });
    this.streamStates.set(threadId, {
      threadId,
      conversationId: threadId,
      hostId: "local",
      ownerClientId: "web-test",
      sourceClientId: "web-test",
      changeType: "snapshot",
      cacheVersion: this.snapshots.length,
      updatedAtIso: "2026-05-29T00:00:00.000Z",
      isInProgress: true,
      activeTurnId: "pending-turn",
      conversationState: state,
    });
    return true;
  }
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

  async threadResume(params: ThreadResumeParams): Promise<unknown> {
    this.calls.push({ method: "thread/resume", params });
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

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
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

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
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
        cwd: context.config.projectRoot,
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
              type: "localImage",
              path: attachmentPath,
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
            cwd: context.config.projectRoot,
            context: expect.objectContaining({
              workspaceRoots: [context.config.projectRoot],
              imageAttachments: [
                expect.objectContaining({
                  id: "att-image",
                  filename: "image.png",
                  localPath: attachmentPath,
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
        cwd: context.config.projectRoot,
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
              type: "localImage",
              path: attachmentPath,
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
            cwd: context.config.projectRoot,
            context: expect.objectContaining({
              workspaceRoots: [context.config.projectRoot],
              imageAttachments: [
                expect.objectContaining({
                  id: "att-steer-image",
                  filename: "steer-image.png",
                  localPath: attachmentPath,
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
          clientUserMessageId: expect.any(String),
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

  it("passes skill-only start and steer requests without synthetic text input", async () => {
    const { context, officialIpc } = await createHarness({
      errorMessage: "",
      hasOfficialState: true,
    });

    const startResponse = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "thread-a",
        text: "   ",
        skills: [{ name: "docs", path: "C:\\skill\\SKILL.md" }],
      },
    });

    expect(startResponse.statusCode).toBe(200);
    expect(officialIpc.followerStartCalls.at(-1)).toMatchObject({
      threadId: "thread-a",
      params: {
        threadId: "thread-a",
        input: [{ type: "skill", name: "docs", path: "C:\\skill\\SKILL.md" }],
      },
    });

    const steerResponse = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-steer",
      payload: {
        threadId: "thread-a",
        expectedTurnId: "turn-active",
        text: "",
        skills: [{ name: "docs", path: "C:\\skill\\SKILL.md" }],
      },
    });

    expect(steerResponse.statusCode).toBe(200);
    expect(officialIpc.followerSteerCalls.at(-1)).toMatchObject({
      threadId: "thread-a",
      params: {
        threadId: "thread-a",
        expectedTurnId: "turn-active",
        input: [{ type: "skill", name: "docs", path: "C:\\skill\\SKILL.md" }],
      },
    });
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
          clientUserMessageId: expect.any(String),
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

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "app-server", result: { turn: { id: "turn-local" } } },
    });
    expect(officialIpc.discardedThreads.has("thread-a")).toBe(true);
    expect(officialIpc.isOwnedConversation("thread-a")).toBe(true);
    expect(officialIpc.canBroadcastOwnedConversation("thread-a")).toBe(true);
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
    expect(officialIpc.canBroadcastOwnedConversation("thread-a")).toBe(true);
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
  });

  it("does not convert stale active steer into a new local turn", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "official-ipc-request-failed:thread-follower-steer-turn",
      hasOfficialState: true,
      officialState: "stale-active",
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-steer",
      payload: {
        threadId: "thread-a",
        expectedTurnId: "turn-stale",
        text: "continue as a new turn",
        permissionMode: "full-access",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining("official-owner-unavailable"),
    });
    expect(officialIpc.discardedThreads.has("thread-a")).toBe(false);
    expect(officialIpc.isOwnedConversation("thread-a")).toBe(false);
    expect(appServer.calls).toEqual([]);
    expect(context.diagnostics.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "turn-steer",
          message: "official-follower-fallback-denied",
          data: expect.objectContaining({
            threadId: "thread-a",
            expectedTurnId: "turn-stale",
            reason: "official-owner-unavailable",
          }),
        }),
      ]),
    );
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
    expect(officialIpc.canBroadcastOwnedConversation("thread-a")).toBe(true);
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
  });

  it("falls back to local app-server only for Web-owned conversations", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      errorMessage: "no-official-owner",
      hasOfficialState: true,
      webOwned: true,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: { threadId: "thread-a", text: "hello" },
    });

    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json()).toMatchObject({
      data: { mode: "app-server", result: { turn: { id: "turn-local" } } },
    });
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "turn/start",
    ]);
    expect(officialIpc.snapshots[0]).toMatchObject({
      threadId: "thread-a",
      state: {
        id: "thread-a",
        status: { type: "active", activeFlags: [] },
        threadRuntimeStatus: { type: "active", activeFlags: [] },
        title: "Thread A",
        name: "Thread A",
        turns: expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringMatching(/^pending-/),
            turnId: expect.stringMatching(/^pending-/),
            status: "inProgress",
            itemsView: "full",
            items: [
              {
                type: "userMessage",
                id: expect.any(String),
                clientId: expect.any(String),
                content: [
                  { type: "text", text: "hello", text_elements: [] },
                ],
              },
            ],
          }),
        ]),
      },
    });
    const snapshotState = officialIpc.snapshots[0]?.state as {
      turns?: Array<{ items?: Array<{ id?: unknown; clientId?: unknown }> }>;
    };
    const pendingUserMessage = snapshotState.turns?.at(-1)?.items?.[0];
    expect(pendingUserMessage?.clientId).toBe(pendingUserMessage?.id);
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
