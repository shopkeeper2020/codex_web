import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  IPC_METHOD_VERSIONS,
  OFFICIAL_THREAD_ARCHIVED_METHOD,
  OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
  OFFICIAL_THREAD_UNARCHIVED_METHOD,
  OfficialIpcBridge,
  applyOfficialIpcPatches,
  classifyAppServerNotification,
  readOfficialConversationId,
  type OfficialIpcFrame,
  type OfficialIpcNotification,
  type OfficialThreadStreamState,
} from "./index";

function encodeFrame(frame: OfficialIpcFrame): Buffer {
  const payload = Buffer.from(JSON.stringify(frame), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function testPipePath(): string {
  const id = `codex-web-ipc-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${id}`
    : join(tmpdir(), `${id}.sock`);
}

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("timed out waiting for condition"));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

class FakeOfficialIpcPeer {
  private server: Server | null = null;
  private socket: Socket | null = null;
  private incoming = Buffer.alloc(0);
  private readonly frames: OfficialIpcFrame[] = [];
  private readonly methodErrors = new Map<string, string>();
  private readonly nextTargetedMethodErrors = new Map<string, string | null>();
  private readonly waiters: Array<{
    predicate: (frame: OfficialIpcFrame) => boolean;
    resolve: (frame: OfficialIpcFrame) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    readonly pipePath = testPipePath(),
    private readonly clientId = "web-client",
  ) {}

  start(): Promise<void> {
    this.server = createServer((socket) => {
      this.socket = socket;
      socket.on("data", (chunk) => this.handleData(chunk));
    });
    return new Promise((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.pipePath, () => resolve());
    });
  }

  async stop(): Promise<void> {
    for (const waiter of this.waiters.splice(0)) clearTimeout(waiter.timeout);
    this.socket?.destroy();
    this.socket = null;
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  send(frame: OfficialIpcFrame): void {
    if (!this.socket) throw new Error("fake-ipc-peer-not-connected");
    this.socket.write(encodeFrame(frame));
  }

  failMethod(method: string, message: string): void {
    this.methodErrors.set(method, message);
  }

  failNextTargetedMethod(method: string, message: string | null): void {
    this.nextTargetedMethodErrors.set(method, message);
  }

  countFrames(predicate: (frame: OfficialIpcFrame) => boolean): number {
    return this.frames.filter(predicate).length;
  }

  waitForFrame(
    predicate: (frame: OfficialIpcFrame) => boolean,
    timeoutMs = 2000,
  ): Promise<OfficialIpcFrame> {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex(
          (waiter) => waiter.resolve === resolve,
        );
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("timed out waiting for frame"));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, timeout });
    });
  }

  private handleData(chunk: Buffer): void {
    this.incoming = Buffer.concat([this.incoming, chunk]);
    while (this.incoming.length >= 4) {
      const frameLength = this.incoming.readUInt32LE(0);
      if (this.incoming.length < frameLength + 4) return;
      const raw = this.incoming.subarray(4, frameLength + 4).toString("utf8");
      this.incoming = this.incoming.subarray(frameLength + 4);
      const frame = JSON.parse(raw) as OfficialIpcFrame;
      this.recordFrame(frame);
      this.respondIfNeeded(frame);
    }
  }

  private recordFrame(frame: OfficialIpcFrame): void {
    this.frames.push(frame);
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(frame)) continue;
      clearTimeout(waiter.timeout);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  }

  private respondIfNeeded(frame: OfficialIpcFrame): void {
    if (frame.type !== "request") return;
    const requestId =
      typeof frame.requestId === "string" ? frame.requestId : "";
    const method = typeof frame.method === "string" ? frame.method : "";
    if (!requestId) return;
    if (method === "initialize") {
      this.send({
        type: "response",
        requestId,
        method,
        resultType: "success",
        handledByClientId: "official-router",
        result: { clientId: this.clientId },
      });
      return;
    }
    if (
      typeof frame.targetClientId === "string" &&
      this.nextTargetedMethodErrors.has(method)
    ) {
      const message = this.nextTargetedMethodErrors.get(method);
      this.nextTargetedMethodErrors.delete(method);
      this.send({
        type: "response",
        requestId,
        method,
        resultType: "error",
        handledByClientId: frame.targetClientId,
        error: message ? { message } : {},
      });
      return;
    }
    const errorMessage = this.methodErrors.get(method);
    if (errorMessage) {
      this.send({
        type: "response",
        requestId,
        method,
        resultType: "error",
        handledByClientId:
          typeof frame.targetClientId === "string"
            ? frame.targetClientId
            : "official-router",
        error: { message: errorMessage },
      });
      return;
    }
    this.send({
      type: "response",
      requestId,
      method,
      resultType: "success",
      handledByClientId:
        typeof frame.targetClientId === "string"
          ? frame.targetClientId
          : "official-router",
      result: { ok: true },
    });
  }
}

function sendExternalOwnerSnapshot(
  peer: FakeOfficialIpcPeer,
  threadId: string,
  sourceClientId = "desktop-client",
): void {
  peer.send({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId,
    params: {
      hostId: "local",
      conversationId: threadId,
      change: {
        type: "snapshot",
        conversationState: { turns: [] },
      },
    },
  });
}

describe("official IPC helpers", () => {
  it("declares the official follower and broadcast method versions used by Desktop and VS Code", () => {
    expect(IPC_METHOD_VERSIONS).toMatchObject({
      "thread-stream-state-changed": 6,
      "thread-read-state-changed": 1,
      "thread-archived": 2,
      "thread-unarchived": 1,
      "thread-follower-start-turn": 1,
      "thread-follower-steer-turn": 1,
      "thread-follower-interrupt-turn": 1,
      "thread-follower-command-approval-decision": 1,
      "thread-follower-file-approval-decision": 1,
      "thread-follower-permissions-request-approval-response": 1,
      "thread-follower-submit-user-input": 1,
      "thread-follower-submit-mcp-server-elicitation-response": 1,
      "thread-follower-set-queued-follow-ups-state": 1,
      "thread-queued-followups-changed": 1,
    });
  });

  it("classifies app-server notifications using the official importance split", () => {
    expect(classifyAppServerNotification("item/agentMessage/delta")).toEqual({
      method: "item/agentMessage/delta",
      importance: "important",
      shouldDriveRealtime: true,
    });
    expect(classifyAppServerNotification("rawResponseItem/completed")).toEqual(
      {
        method: "rawResponseItem/completed",
        importance: "ignored",
        shouldDriveRealtime: false,
      },
    );
    expect(classifyAppServerNotification("process/outputDelta")).toEqual({
      method: "process/outputDelta",
      importance: "passthrough",
      shouldDriveRealtime: false,
    });
    expect(classifyAppServerNotification("future/event")).toEqual({
      method: "future/event",
      importance: "unknown",
      shouldDriveRealtime: true,
    });
  });

  it("reads common conversation id fields", () => {
    expect(readOfficialConversationId({ conversationId: "a" })).toBe("a");
    expect(readOfficialConversationId({ conversation_id: "b" })).toBe("b");
    expect(readOfficialConversationId({ threadId: "c" })).toBe("c");
    expect(readOfficialConversationId({ thread_id: "d" })).toBe("d");
    expect(readOfficialConversationId({ conversation: { id: "e" } })).toBe(
      "e",
    );
  });

  it("applies add, replace, and remove patches", () => {
    const base = { turns: [{ id: "1", text: "old" }] };
    const patched = applyOfficialIpcPatches(base, [
      { op: "replace", path: ["turns", 0, "text"], value: "new" },
      { op: "add", path: ["turns", 1], value: { id: "2" } },
      { op: "remove", path: ["turns", 0, "id"] },
    ]);
    expect(patched).toEqual({ turns: [{ text: "new" }, { id: "2" }] });
  });

  it("releases local ownership when an official client broadcasts the same conversation", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      clientId: string | null;
      handleFrame: (frame: Record<string, unknown>) => void;
    };
    testBridge.clientId = "web-client";

    bridge.broadcastConversationSnapshot("thread-1", { turns: [] });
    expect(bridge.isOwnedConversation("thread-1")).toBe(true);

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-1",
        change: {
          type: "snapshot",
          conversationState: {
            turns: [{ id: "turn-1", status: "completed", items: [] }],
          },
        },
      },
    });

    const status = bridge.getStatus() as {
      ownedConversationCount?: number;
      recentOwnershipHandoffs?: Array<{
        conversationId?: string;
        sourceClientId?: string | null;
      }>;
    };
    expect(bridge.isOwnedConversation("thread-1")).toBe(false);
    expect(status.ownedConversationCount).toBe(0);
    expect(status.recentOwnershipHandoffs?.at(-1)).toMatchObject({
      conversationId: "thread-1",
      sourceClientId: "desktop-client",
    });
  });

  it("sanitizes unsupported markdown fence languages from external stream state", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-external-markdown",
        change: {
          type: "snapshot",
          conversationState: {
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  {
                    type: "agentMessage",
                    id: "assistant-1",
                    text: "```powershell\nGet-ChildItem\n```",
                  },
                ],
              },
            ],
          },
        },
      },
    });

    const state = bridge.getThreadStreamState("thread-external-markdown")
      ?.conversationState as {
      turns?: Array<{ items?: Array<{ text?: string }> }>;
    };
    expect(state?.turns?.[0]?.items?.[0]?.text).toBe(
      "```text\nGet-ChildItem\n```",
    );
  });

  it("explicitly releases Web-owned conversations and clears cached stream state", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";

    bridge.broadcastConversationSnapshot("thread-archived", {
      turns: [],
    });
    expect(bridge.isOwnedConversation("thread-archived")).toBe(true);
    expect(bridge.getThreadStreamState("thread-archived")).toMatchObject({
      ownerClientId: "web-client",
      sourceClientId: "web-client",
    });

    bridge.releaseOwnedConversation("thread-archived", "thread-archived");

    const status = bridge.getStatus() as {
      cachedConversationCount?: number;
      ownedConversationCount?: number;
      recentOwnershipHandoffs?: Array<Record<string, unknown>>;
    };
    expect(bridge.isOwnedConversation("thread-archived")).toBe(false);
    expect(bridge.getThreadStreamState("thread-archived")).toBeNull();
    expect(status.cachedConversationCount).toBe(0);
    expect(status.ownedConversationCount).toBe(0);
    expect(status.recentOwnershipHandoffs?.at(-1)).toMatchObject({
      conversationId: "thread-archived",
      previousOwnerClientId: "web-client",
      nextOwnerClientId: null,
      sourceClientId: "web-client",
      reason: "thread-archived",
    });
  });

  it("passively releases cached state when an official archive broadcast arrives", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      clientId: string | null;
      handleFrame: (frame: Record<string, unknown>) => void;
    };
    const notifications: OfficialIpcNotification[] = [];
    bridge.onNotification((notification) => notifications.push(notification));
    testBridge.clientId = "web-client";

    bridge.broadcastConversationSnapshot("thread-official-archived", {
      turns: [],
    });
    expect(bridge.isOwnedConversation("thread-official-archived")).toBe(true);

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-archived",
      sourceClientId: "desktop-client",
      params: {
        conversationId: "thread-official-archived",
      },
    });

    const status = bridge.getStatus() as {
      cachedConversationCount?: number;
      ownedConversationCount?: number;
      recentOwnershipHandoffs?: Array<Record<string, unknown>>;
    };
    expect(bridge.getThreadStreamState("thread-official-archived")).toBeNull();
    expect(bridge.isOwnedConversation("thread-official-archived")).toBe(false);
    expect(status.cachedConversationCount).toBe(0);
    expect(status.ownedConversationCount).toBe(0);
    expect(status.recentOwnershipHandoffs?.at(-1)).toMatchObject({
      conversationId: "thread-official-archived",
      previousOwnerClientId: "web-client",
      nextOwnerClientId: null,
      sourceClientId: "desktop-client",
      reason: "thread-archived",
    });
    expect(notifications.at(-1)).toMatchObject({
      method: OFFICIAL_THREAD_ARCHIVED_METHOD,
      params: {
        threadId: "thread-official-archived",
        conversationId: "thread-official-archived",
        sourceClientId: "desktop-client",
      },
    });
  });

  it("notifies callers when an official unarchive broadcast arrives", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };
    const notifications: OfficialIpcNotification[] = [];
    bridge.onNotification((notification) => notifications.push(notification));

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-unarchived",
      sourceClientId: "desktop-client",
      params: {
        threadId: "thread-official-unarchived",
      },
    });

    expect(
      bridge.getThreadStreamState("thread-official-unarchived"),
    ).toBeNull();
    expect(notifications.at(-1)).toMatchObject({
      method: OFFICIAL_THREAD_UNARCHIVED_METHOD,
      params: {
        threadId: "thread-official-unarchived",
        conversationId: "thread-official-unarchived",
        sourceClientId: "desktop-client",
      },
    });
  });

  it("does not mark snapshots as Web-owned before a client id is initialized", () => {
    const bridge = new OfficialIpcBridge("");

    expect(bridge.canOwnConversations()).toBe(false);
    expect(
      bridge.broadcastConversationSnapshot("thread-no-client", { turns: [] }),
    ).toBe(false);
    expect(bridge.isOwnedConversation("thread-no-client")).toBe(false);
    expect(bridge.getThreadStreamState("thread-no-client")).toBeNull();
    expect(bridge.claimLocalOnlyConversation("thread-no-client")).toBe(false);
  });

  it("omits context compaction items from Web-owned snapshots sent to official clients", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";
    const snapshot = {
      turns: [
        {
          id: "turn-with-context-compaction",
          status: "completed",
          items: [
            { type: "userMessage", id: "user-1", text: "before" },
            { type: "contextCompaction", id: "compact-direct" },
            {
              type: "unknown",
              id: "compact-unknown",
              rawType: "context_compaction",
              raw: { type: "contextCompaction", id: "raw-compact" },
            },
            { type: "agentMessage", id: "assistant-1", text: "after" },
          ],
        },
      ],
    };
    const originalSnapshot = JSON.stringify(snapshot);

    expect(
      bridge.broadcastConversationSnapshot("thread-context", snapshot),
    ).toBe(true);

    const state = bridge.getThreadStreamState("thread-context")
      ?.conversationState as {
      turns?: Array<{ items?: unknown[] }>;
    };
    expect(state?.turns?.[0]?.items).toHaveLength(2);
    expect(state?.turns?.[0]?.items).toMatchObject([
      {
        type: "userMessage",
        id: "user-1",
        text: "before",
        clientId: null,
        content: [{ type: "text", text: "before", text_elements: [] }],
      },
      {
        type: "agentMessage",
        id: "assistant-1",
        text: "after",
        phase: null,
        memoryCitation: null,
      },
    ]);
    expect(JSON.stringify(snapshot)).toBe(originalSnapshot);
  });

  it("downgrades unsupported markdown fence languages in official broadcasts", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";
    const snapshot = {
      turns: [
        {
          id: "turn-markdown",
          status: "completed",
          items: [
            {
              type: "agentMessage",
              id: "assistant-1",
              text: [
                "keep normal text mentioning powershell",
                "```powershell",
                "pnpm dev",
                "```",
                "```ts",
                "const value = true",
                "```",
              ].join("\n"),
            },
            {
              type: "commandExecution",
              id: "command-1",
              command: "pwsh -NoLogo",
              aggregatedOutput: "```powershell\nGet-ChildItem\n```",
            },
          ],
        },
      ],
    };
    const originalSnapshot = JSON.stringify(snapshot);

    expect(
      bridge.broadcastConversationSnapshot("thread-markdown", snapshot),
    ).toBe(true);

    const state = bridge.getThreadStreamState("thread-markdown")
      ?.conversationState as {
      turns?: Array<{
        items?: Array<{ text?: string; aggregatedOutput?: string }>;
      }>;
    };
    expect(state?.turns?.[0]?.items?.[0]?.text).toContain("```text\npnpm dev");
    expect(state?.turns?.[0]?.items?.[0]?.text).toContain("```ts\nconst value");
    expect(state?.turns?.[0]?.items?.[0]?.text).toContain(
      "mentioning powershell",
    );
    expect(state?.turns?.[0]?.items?.[1]?.aggregatedOutput).toBe(
      "```powershell\nGet-ChildItem\n```",
    );
    expect(JSON.stringify(snapshot)).toBe(originalSnapshot);
  });

  it("normalizes app-server thread snapshots into Desktop stream shape", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";
    const startedAt = "2026-06-02T00:00:00.000Z";
    const snapshot = {
      id: "thread-web-created",
      sessionId: "thread-web-created",
      source: "vscode",
      threadSource: null,
      cwd: "C:\\workspace\\codex_web",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:01.000Z",
      status: { type: "active" },
      turns: [
        {
          id: "turn-active",
          status: "inProgress",
          startedAt,
          params: {
            cwd: "C:\\workspace\\codex_web",
            restoreMessage: {
              context: {
                imageAttachments: [
                  {
                    path: "C:\\workspace\\codex_web\\image.png",
                    src: "data:image/png;base64,aW1hZ2U=",
                  },
                ],
                workspaceRoots: [],
              },
            },
          },
          diff: null,
          hookRuns: null,
          commandExecutionStartedAtMsById: null,
          itemsView: null,
          items: [
            { type: "userMessage", id: "user-1", text: "hello" },
            { type: "agentMessage", id: "assistant-1", text: "hi" },
            {
              type: "webSearch",
              id: "search-1",
              query: "official schema",
              action: { type: "search", query: "official schema" },
            },
          ],
        },
      ],
    };
    const originalSnapshot = JSON.stringify(snapshot);

    expect(
      bridge.broadcastConversationSnapshot("thread-web-created", snapshot),
    ).toBe(true);

    const state = bridge.getThreadStreamState("thread-web-created");

    expect(state).toMatchObject({
      isInProgress: true,
      activeTurnId: "turn-active",
      conversationState: {
        hostId: "local",
        preview: "hello",
        ephemeral: false,
        modelProvider: "openai",
        source: "vscode",
        threadSource: "user",
        forkedFromId: null,
        parentThreadId: null,
        cliVersion: "",
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        title: "hello",
        name: "hello",
        requests: [],
        hasUnreadTurn: false,
        threadGoal: null,
        threadGoalResumeConfirmation: null,
        latestModel: null,
        latestReasoningEffort: null,
        previousTurnModel: null,
        latestTokenUsageInfo: null,
        currentPermissions: null,
        resumeState: "resumed",
        workspaceKind: "project",
        workspaceBrowserRoot: null,
        projectlessOutputDirectory: null,
        turnsPagination: {
          olderCursor: null,
          oldestLoadedTurnId: null,
          isLoadingOlder: false,
          hasLoadedOldest: true,
        },
        status: { type: "active", activeFlags: [] },
        threadRuntimeStatus: { type: "active", activeFlags: [] },
        turns: [
          {
            id: "turn-active",
            turnId: "turn-active",
            status: "inProgress",
            turnStartedAtMs: Date.parse(startedAt),
            params: {
              cwd: "C:\\workspace\\codex_web",
              restoreMessage: {
                cwd: "C:\\workspace\\codex_web",
                context: {
                  imageAttachments: [
                    {
                      id: "image-0",
                      filename: "image.png",
                      localPath: "C:\\workspace\\codex_web\\image.png",
                      path: "C:\\workspace\\codex_web\\image.png",
                      src: "data:image/png;base64,aW1hZ2U=",
                      uploadStatus: "idle",
                    },
                  ],
                  workspaceRoots: ["C:\\workspace\\codex_web"],
                },
              },
            },
            itemsView: "full",
            error: null,
            completedAt: null,
            durationMs: null,
            diff: [],
            commandExecutionStartedAtMsById: {},
            hookRuns: [],
            items: [
              {
                type: "userMessage",
                id: "user-1",
                clientId: null,
                content: [
                  { type: "text", text: "hello", text_elements: [] },
                ],
              },
              {
                type: "agentMessage",
                id: "assistant-1",
                text: "hi",
                phase: null,
                memoryCitation: null,
              },
              {
                type: "webSearch",
                id: "search-1",
                query: "official schema",
                action: {
                  type: "search",
                  query: "official schema",
                  queries: null,
                },
              },
            ],
          },
        ],
      },
    });
    expect(state?.conversationState).not.toHaveProperty(
      "latestCollaborationMode",
    );
    expect(JSON.stringify(snapshot)).toBe(originalSnapshot);
  });

  it("omits null/default collaboration modes from Desktop stream snapshots", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";

    expect(
      bridge.broadcastConversationSnapshot("thread-default-mode", {
        id: "thread-default-mode",
        sessionId: "thread-default-mode",
        cwd: "C:\\workspace\\codex_web",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:01.000Z",
        status: { type: "idle" },
        latestCollaborationMode: null,
        turns: [
          {
            id: "turn-default",
            status: "completed",
            startedAt: "2026-06-03T00:00:00.000Z",
            params: {
              cwd: "C:\\workspace\\codex_web",
              collaborationMode: { mode: "default" },
            },
            items: [
              { type: "userMessage", id: "user-1", text: "hello" },
              {
                type: "webSearch",
                id: "search-1",
                query: "",
                action: { type: "openPage", url: null },
              },
            ],
          },
        ],
      }),
    ).toBe(true);

    const state = bridge.getThreadStreamState("thread-default-mode");
    const conversationState = state?.conversationState as
      | Record<string, unknown>
      | undefined;
    const turns = conversationState?.turns as
      | Array<Record<string, unknown>>
      | undefined;
    const firstTurn = turns?.[0];
    const items = firstTurn?.items as
      | Array<Record<string, unknown>>
      | undefined;
    expect(conversationState).not.toHaveProperty("latestCollaborationMode");
    expect(firstTurn?.params).not.toHaveProperty("collaborationMode");
    expect(items?.[1]).toMatchObject({
      type: "webSearch",
      action: { type: "openPage", url: "" },
    });
  });

  it("preserves non-default collaboration modes with object settings", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";

    expect(
      bridge.broadcastConversationSnapshot("thread-plan-mode", {
        id: "thread-plan-mode",
        sessionId: "thread-plan-mode",
        cwd: "C:\\workspace\\codex_web",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:01.000Z",
        status: { type: "idle" },
        turns: [
          {
            id: "turn-plan",
            status: "completed",
            startedAt: "2026-06-03T00:00:00.000Z",
            params: {
              cwd: "C:\\workspace\\codex_web",
              collaborationMode: { mode: "plan", settings: null },
            },
            items: [{ type: "userMessage", id: "user-1", text: "plan" }],
          },
        ],
      }),
    ).toBe(true);

    const state = bridge.getThreadStreamState("thread-plan-mode");
    const conversationState = state?.conversationState as
      | Record<string, unknown>
      | undefined;
    const turns = conversationState?.turns as
      | Array<Record<string, unknown>>
      | undefined;
    expect(conversationState?.latestCollaborationMode).toEqual({
      mode: "plan",
      settings: {},
    });
    expect(turns?.[0]?.params).toMatchObject({
      collaborationMode: { mode: "plan", settings: {} },
    });
  });

  it("normalizes Desktop stream snapshots that omit top-level status", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-runtime-only",
        change: {
          type: "snapshot",
          conversationState: {
            id: "thread-runtime-only",
            turns: [
              {
                id: "turn-complete",
                turnId: "turn-complete",
                turnStartedAtMs: 1780410203000,
                durationMs: 19720,
                status: "completed",
                error: null,
                diff: null,
                items: [
                  {
                    type: "userMessage",
                    id: "user-1",
                    content: [
                      { type: "text", text: "hello", text_elements: [] },
                    ],
                  },
                  {
                    type: "agentMessage",
                    id: "assistant-1",
                    text: "done",
                  },
                ],
              },
            ],
            createdAt: 1780410202000,
            updatedAt: 1780410223000,
            source: "vscode",
            threadRuntimeStatus: { type: "idle" },
            rolloutPath:
              "\\\\?\\C:\\Users\\lwm\\.codex\\sessions\\thread-runtime-only.jsonl",
            cwd: "E:\\cache\\Desktop\\codex_web",
          },
        },
      },
    });

    expect(
      bridge.getThreadStreamState("thread-runtime-only"),
    ).toMatchObject({
      ownerClientId: "desktop-client",
      conversationState: {
        status: { type: "idle" },
        threadRuntimeStatus: { type: "idle" },
        turns: [
          {
            id: "turn-complete",
            turnId: "turn-complete",
            itemsView: "full",
            diff: [],
            hookRuns: [],
            commandExecutionStartedAtMsById: {},
            completedAt: null,
            items: [
              {
                type: "userMessage",
                clientId: null,
              },
              {
                type: "agentMessage",
                phase: null,
                memoryCitation: null,
              },
            ],
          },
        ],
      },
    });
  });

  it("broadcasts thread-unarchived lifecycle events for official recent-list refresh", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      expect(bridge.broadcastThreadUnarchived(" thread-refresh ")).toBe(true);

      await expect(
        peer.waitForFrame(
          (frame) =>
            frame.type === "broadcast" &&
            frame.method === "thread-unarchived",
        ),
      ).resolves.toMatchObject({
        sourceClientId: "web-client",
        version: 1,
        params: {
          hostId: "local",
          conversationId: "thread-refresh",
        },
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("claims local-only conversations without publishing stream state", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";

    expect(bridge.claimLocalOnlyConversation("thread-local")).toBe(true);

    expect(bridge.isOwnedConversation("thread-local")).toBe(true);
    expect(bridge.isLocalOnlyOwnedConversation("thread-local")).toBe(true);
    expect(bridge.canBroadcastOwnedConversation("thread-local")).toBe(false);
    expect(bridge.getThreadStreamState("thread-local")).toBeNull();
    expect(
      bridge.broadcastConversationSnapshot("thread-local", { turns: [] }),
    ).toBe(false);
    expect(bridge.getThreadStreamState("thread-local")).toBeNull();
    expect(bridge.getStatus()).toMatchObject({
      ownedConversationCount: 1,
      localOnlyOwnedConversationCount: 1,
    });

    bridge.releaseOwnedConversation("thread-local", "done");

    expect(bridge.isOwnedConversation("thread-local")).toBe(false);
    expect(bridge.getStatus()).toMatchObject({
      ownedConversationCount: 0,
      localOnlyOwnedConversationCount: 0,
    });
  });

  it("promotes local-only conversations before publishing live stream state", () => {
    const bridge = new OfficialIpcBridge("");
    (bridge as unknown as { clientId: string | null }).clientId = "web-client";

    expect(bridge.claimLocalOnlyConversation("thread-local")).toBe(true);
    expect(bridge.promoteLocalOnlyConversation("thread-local", "turn-start"))
      .toBe(true);

    expect(bridge.isLocalOnlyOwnedConversation("thread-local")).toBe(false);
    expect(bridge.canBroadcastOwnedConversation("thread-local")).toBe(true);
    expect(
      bridge.broadcastConversationSnapshot("thread-local", {
        threadRuntimeStatus: { type: "active" },
        turns: [{ id: "turn-active", status: "active", items: [] }],
      }),
    ).toBe(true);
    expect(bridge.getThreadStreamState("thread-local")).toMatchObject({
      ownerClientId: "web-client",
      isInProgress: true,
      activeTurnId: "turn-active",
    });
    expect(bridge.getStatus()).toMatchObject({
      ownedConversationCount: 1,
      localOnlyOwnedConversationCount: 0,
      recentOwnershipHandoffs: [
        expect.objectContaining({
          conversationId: "thread-local",
          nextOwnerClientId: "web-client",
          reason: "turn-start",
        }),
      ],
    });
  });

  it("rebroadcasts Web-owned snapshots after IPC initialize refreshes the client id", async () => {
    const peer = new FakeOfficialIpcPeer(testPipePath(), "web-client-b");
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);
    const testBridge = bridge as unknown as {
      clientId: string | null;
      ownedConversationIds: Set<string>;
      streamStates: Map<string, OfficialThreadStreamState>;
    };
    testBridge.clientId = "web-client-a";
    testBridge.ownedConversationIds.add("thread-reconnect-owned");
    testBridge.streamStates.set("thread-reconnect-owned", {
      threadId: "thread-reconnect-owned",
      conversationId: "thread-reconnect-owned",
      hostId: "local",
      ownerClientId: "web-client-a",
      sourceClientId: "web-client-a",
      conversationState: {
        threadRuntimeStatus: { type: "active", activeFlags: [] },
        turns: [{ id: "turn-active", status: "active", items: [] }],
      },
      changeType: "snapshot",
      cacheVersion: 1,
      updatedAtIso: "2026-06-02T00:00:00.000Z",
      isInProgress: true,
      activeTurnId: "turn-active",
    });

    try {
      bridge.start();

      const broadcast = await peer.waitForFrame(
        (frame) =>
          frame.type === "broadcast" &&
          frame.method === "thread-stream-state-changed" &&
          frame.sourceClientId === "web-client-b",
      );

      expect(broadcast).toMatchObject({
        params: {
          hostId: "local",
          conversationId: "thread-reconnect-owned",
          change: {
            type: "snapshot",
            conversationState: {
              turns: [{ id: "turn-active", status: "active", items: [] }],
            },
          },
        },
      });
      expect(
        bridge.getThreadStreamState("thread-reconnect-owned"),
      ).toMatchObject({
        ownerClientId: "web-client-b",
        sourceClientId: "web-client-b",
        activeTurnId: "turn-active",
      });
      expect(bridge.getStatus()).toMatchObject({
        recentOwnerRebroadcasts: [
          expect.objectContaining({
            clientId: "web-client-b",
            conversationIds: ["thread-reconnect-owned"],
            count: 1,
            reason: "ipc-initialized",
          }),
        ],
        recentOwnershipHandoffs: [
          expect.objectContaining({
            conversationId: "thread-reconnect-owned",
            previousOwnerClientId: "web-client-a",
            nextOwnerClientId: "web-client-b",
            sourceClientId: "web-client-b",
            reason: "ipc-initialized",
          }),
        ],
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("keeps active Web ownership when an external client opens the conversation", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      clientId: string | null;
      handleFrame: (frame: Record<string, unknown>) => void;
    };
    testBridge.clientId = "web-client";

    expect(
      bridge.broadcastConversationSnapshot("thread-web-owned", {
        threadRuntimeStatus: { type: "active" },
        turns: [{ id: "turn-active", status: "active", items: [] }],
      }),
    ).toBe(true);

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-web-owned",
        change: {
          type: "snapshot",
          conversationState: {
            threadRuntimeStatus: { type: "active" },
            turns: [{ id: "turn-active", status: "active", items: [] }],
          },
        },
      },
    });

    expect(bridge.isOwnedConversation("thread-web-owned")).toBe(true);
    expect(bridge.getThreadStreamState("thread-web-owned")).toMatchObject({
      ownerClientId: "web-client",
      sourceClientId: "web-client",
      isInProgress: true,
      activeTurnId: "turn-active",
    });
    expect(bridge.getStatus()).toMatchObject({
      ownedConversationCount: 1,
      recentOwnershipHandoffs: [],
    });
  });

  it("keeps local-only ownership when an official client opens the same conversation", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      clientId: string | null;
      handleFrame: (frame: Record<string, unknown>) => void;
    };
    const notifications: OfficialIpcNotification[] = [];
    testBridge.clientId = "web-client";
    bridge.onNotification((notification) => notifications.push(notification));

    expect(bridge.claimLocalOnlyConversation("thread-local")).toBe(true);

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-local",
        change: {
          type: "snapshot",
          conversationState: {
            status: "interrupted",
            turns: [{ id: "turn-opened", status: "interrupted", items: [] }],
          },
        },
      },
    });

    expect(bridge.isOwnedConversation("thread-local")).toBe(true);
    expect(bridge.getThreadStreamState("thread-local")).toBeNull();
    expect(notifications).toEqual([]);
    expect(bridge.getStatus()).toMatchObject({
      ownedConversationCount: 1,
      localOnlyOwnedConversationCount: 1,
    });

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-local",
        change: {
          type: "patches",
          patches: [
            {
              op: "replace",
              path: ["status"],
              value: "interrupted",
            },
          ],
        },
      },
    });

    expect(bridge.isOwnedConversation("thread-local")).toBe(true);
    expect(bridge.getThreadStreamState("thread-local")).toBeNull();
    expect(notifications).toEqual([]);
  });

  it("reads active turn ids from official stream snapshots", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-active",
        change: {
          type: "snapshot",
          conversationState: {
            turns: [{ turnId: "turn-active", status: "active", items: [] }],
          },
        },
      },
    });

    expect(bridge.getThreadStreamState("thread-active")).toMatchObject({
      activeTurnId: "turn-active",
      isInProgress: true,
    });
  });

  it("keeps official stream snapshots with non-local host ids", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "C:\\workspace\\local-agent",
        conversationId: "thread-non-local-host",
        change: {
          type: "snapshot",
          conversationState: {
            status: { type: "running" },
            turns: [
              {
                turnId: "turn-running",
                status: { type: "running" },
                items: [],
              },
            ],
          },
        },
      },
    });

    expect(bridge.getThreadStreamState("thread-non-local-host")).toMatchObject({
      hostId: "C:\\workspace\\local-agent",
      activeTurnId: "turn-running",
      isInProgress: true,
    });
  });

  it("does not let stale inactive snapshots replace an active official stream", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-stale-inactive",
        change: {
          type: "snapshot",
          conversationState: {
            status: { type: "running" },
            turns: [
              {
                id: "turn-running",
                status: { type: "running" },
                items: [{ type: "reasoning", text: "thinking" }],
              },
            ],
          },
        },
      },
    });

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "vscode-client",
      params: {
        hostId: "local",
        conversationId: "thread-stale-inactive",
        change: {
          type: "snapshot",
          conversationState: {
            status: { type: "notLoaded" },
            turns: [],
          },
        },
      },
    });

    expect(bridge.getThreadStreamState("thread-stale-inactive")).toMatchObject({
      ownerClientId: "desktop-client",
      sourceClientId: "desktop-client",
      isInProgress: true,
      activeTurnId: "turn-running",
      cacheVersion: 1,
    });
  });

  it("accepts inactive snapshots that settle the cached active turn", () => {
    const bridge = new OfficialIpcBridge("");
    const testBridge = bridge as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-completed-elsewhere",
        change: {
          type: "snapshot",
          conversationState: {
            status: { type: "running" },
            turns: [
              {
                id: "turn-running",
                status: { type: "running" },
                items: [{ type: "reasoning", text: "thinking" }],
              },
            ],
          },
        },
      },
    });

    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "vscode-client",
      params: {
        hostId: "local",
        conversationId: "thread-completed-elsewhere",
        change: {
          type: "snapshot",
          conversationState: {
            status: { type: "completed" },
            turns: [
              {
                id: "turn-running",
                status: { type: "completed" },
                items: [{ type: "agentMessage", text: "done" }],
              },
            ],
          },
        },
      },
    });

    expect(
      bridge.getThreadStreamState("thread-completed-elsewhere"),
    ).toMatchObject({
      ownerClientId: "vscode-client",
      sourceClientId: "vscode-client",
      isInProgress: false,
      activeTurnId: "",
      cacheVersion: 2,
    });
  });

  it("restores persisted official stream snapshots", () => {
    const source = new OfficialIpcBridge("");
    const testBridge = source as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    };
    testBridge.handleFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "desktop-client",
      params: {
        hostId: "local",
        conversationId: "thread-persisted",
        change: {
          type: "snapshot",
          conversationState: {
            status: { type: "running" },
            turns: [{ id: "turn-persisted", status: "active", items: [] }],
          },
        },
      },
    });

    const persisted = source.listThreadStreamStates()[0];
    expect(persisted).toBeDefined();
    if (!persisted) throw new Error("missing persisted state");
    const restored = new OfficialIpcBridge("");

    expect(restored.restoreThreadStreamState(persisted)).toBe(true);
    expect(restored.getThreadStreamState("thread-persisted")).toMatchObject({
      ownerClientId: "desktop-client",
      isInProgress: true,
      activeTurnId: "turn-persisted",
      cacheVersion: persisted.cacheVersion,
    });
  });

  it("can hydrate external stream cache from a readonly thread snapshot", () => {
    const bridge = new OfficialIpcBridge("");
    const notifications: OfficialIpcNotification[] = [];
    bridge.onNotification((notification) => notifications.push(notification));

    expect(
      bridge.hydrateThreadStreamState({
        threadId: "thread-hydrated",
        hostId: "workspace-host",
        ownerClientId: "desktop-client",
        sourceClientId: "desktop-client",
        conversationState: {
          status: "in_progress",
          turns: [
            {
              id: "turn-hydrated",
              status: { type: "thinking" },
              items: [],
            },
          ],
        },
      }),
    ).toBe(true);

    expect(bridge.isOwnedConversation("thread-hydrated")).toBe(false);
    expect(bridge.getThreadStreamState("thread-hydrated")).toMatchObject({
      hostId: "workspace-host",
      ownerClientId: "desktop-client",
      activeTurnId: "turn-hydrated",
      isInProgress: true,
      changeType: "snapshot",
    });
    expect(notifications.at(-1)).toMatchObject({
      method: OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
      params: {
        threadId: "thread-hydrated",
        conversationId: "thread-hydrated",
        changeType: "snapshot",
        isInProgress: true,
        activeTurnId: "turn-hydrated",
      },
    });
  });

  it("notifies with stable fields when patches arrive before a snapshot so callers can recover", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);
    const notifications: OfficialIpcNotification[] = [];
    bridge.onNotification((notification) => notifications.push(notification));

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      peer.send({
        type: "broadcast",
        method: "thread-stream-state-changed",
        sourceClientId: "desktop-client",
        params: {
          hostId: "local",
          conversationId: "thread-missing-snapshot",
          change: {
            type: "patches",
            patches: [
              { op: "add", path: ["turns", 0], value: { id: "turn-a" } },
            ],
          },
        },
      });
      await waitUntil(() => notifications.length > 0);

      expect(bridge.getThreadStreamState("thread-missing-snapshot")).toBeNull();
      expect(notifications.at(-1)).toMatchObject({
        method: OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
        atIso: expect.any(String),
      });
      expect(notifications.at(-1)?.params).toEqual({
        threadId: "thread-missing-snapshot",
        conversationId: "thread-missing-snapshot",
        hostId: "local",
        ownerClientId: "desktop-client",
        sourceClientId: "desktop-client",
        changeType: "patches-without-snapshot",
        cacheVersion: 0,
        isInProgress: false,
        activeTurnId: "",
      });
      expect(bridge.getStatus()).toMatchObject({
        lastError:
          "official-ipc-patches-without-snapshot:thread-missing-snapshot",
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("uses framed IPC to send follower start-turn to the current official owner", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      peer.send({
        type: "broadcast",
        method: "thread-stream-state-changed",
        sourceClientId: "desktop-client",
        params: {
          hostId: "local",
          conversationId: "thread-follow",
          change: {
            type: "snapshot",
            conversationState: { turns: [] },
          },
        },
      });
      await waitUntil(
        () =>
          bridge.getThreadStreamState("thread-follow")?.ownerClientId ===
          "desktop-client",
      );

      const resultPromise = bridge.sendThreadFollowerStartTurn(
        "thread-follow",
        {
          input: [{ type: "text", text: "hi" }],
        },
      );
      const request = await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-start-turn",
      );
      await expect(resultPromise).resolves.toEqual({ ok: true });

      expect(request).toMatchObject({
        type: "request",
        method: "thread-follower-start-turn",
        targetClientId: "desktop-client",
        sourceClientId: "web-client",
      });
      expect(request.params).toMatchObject({
        conversationId: "thread-follow",
        turnStartParams: {
          input: [{ type: "text", text: "hi" }],
        },
      });
      expect(bridge.getStatus()).toMatchObject({
        recentFollowerRequests: [
          {
            method: "thread-follower-start-turn",
            threadId: "thread-follow",
            targetClientId: "desktop-client",
            usedDiscovery: false,
            result: "success",
            handledByClientId: "desktop-client",
          },
        ],
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("uses framed IPC to send follower edit-last-user-turn to the current official owner", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      sendExternalOwnerSnapshot(peer, "thread-edit");
      await waitUntil(
        () =>
          bridge.getThreadStreamState("thread-edit")?.ownerClientId ===
          "desktop-client",
      );

      const resultPromise = bridge.sendThreadFollowerEditLastUserTurn(
        "thread-edit",
        {
          turnId: "turn-last",
          message: "edited message",
        },
      );
      const request = await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-edit-last-user-turn",
      );
      await expect(resultPromise).resolves.toEqual({ ok: true });

      expect(request).toMatchObject({
        type: "request",
        method: "thread-follower-edit-last-user-turn",
        targetClientId: "desktop-client",
        sourceClientId: "web-client",
      });
      expect(request.params).toMatchObject({
        conversationId: "thread-edit",
        turnId: "turn-last",
        message: "edited message",
      });
      expect(
        (
          bridge.getStatus() as {
            recentFollowerRequests?: Array<Record<string, unknown>>;
          }
        ).recentFollowerRequests?.at(-1),
      ).toMatchObject({
        method: "thread-follower-edit-last-user-turn",
        threadId: "thread-edit",
        targetClientId: "desktop-client",
        usedDiscovery: false,
        result: "success",
        handledByClientId: "desktop-client",
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("uses discovery when follower start-turn has no cached official owner", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      const resultPromise = bridge.sendThreadFollowerStartTurn(
        "thread-discovery",
        {
          input: [{ type: "text", text: "discover owner" }],
        },
      );
      const request = await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-start-turn" &&
          readOfficialConversationId(frame.params) === "thread-discovery",
      );
      await expect(resultPromise).resolves.toEqual({ ok: true });

      expect(request).toMatchObject({
        type: "request",
        method: "thread-follower-start-turn",
        version: 1,
        sourceClientId: "web-client",
      });
      expect("targetClientId" in request).toBe(false);
      expect(request.params).toMatchObject({
        conversationId: "thread-discovery",
        turnStartParams: {
          input: [{ type: "text", text: "discover owner" }],
        },
      });
      expect(
        (
          bridge.getStatus() as {
            recentFollowerRequests?: Array<Record<string, unknown>>;
          }
        ).recentFollowerRequests?.at(-1),
      ).toMatchObject({
        method: "thread-follower-start-turn",
        threadId: "thread-discovery",
        targetClientId: null,
        usedDiscovery: true,
        result: "success",
        handledByClientId: "official-router",
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("uses framed IPC to steer the active turn on the current official owner", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      sendExternalOwnerSnapshot(peer, "thread-steer");
      await waitUntil(
        () =>
          bridge.getThreadStreamState("thread-steer")?.ownerClientId ===
          "desktop-client",
      );

      const steerParams = {
        expectedTurnId: "turn-active",
        input: [{ type: "text", text: "guide current turn" }],
        restoreMessage: { text: "guide current turn" },
      };
      const resultPromise = bridge.sendThreadFollowerSteerTurn(
        "thread-steer",
        steerParams,
      );
      const request = await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-steer-turn",
      );
      await expect(resultPromise).resolves.toEqual({ ok: true });

      expect(request).toMatchObject({
        type: "request",
        method: "thread-follower-steer-turn",
        targetClientId: "desktop-client",
        sourceClientId: "web-client",
      });
      expect(request.params).toMatchObject({
        conversationId: "thread-steer",
        input: steerParams.input,
        restoreMessage: steerParams.restoreMessage,
      });
      expect(
        (request.params as Record<string, unknown>).turnSteerParams,
      ).toBeUndefined();
      expect(
        (
          bridge.getStatus() as {
            recentFollowerRequests?: Array<Record<string, unknown>>;
          }
        ).recentFollowerRequests?.at(-1),
      ).toMatchObject({
        method: "thread-follower-steer-turn",
        threadId: "thread-steer",
        targetClientId: "desktop-client",
        usedDiscovery: false,
        result: "success",
        handledByClientId: "desktop-client",
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("retries follower steer with discovery when the cached owner target is stale", async () => {
    const peer = new FakeOfficialIpcPeer();
    peer.failNextTargetedMethod("thread-follower-steer-turn", null);
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      sendExternalOwnerSnapshot(peer, "thread-stale-owner");
      await waitUntil(
        () =>
          bridge.getThreadStreamState("thread-stale-owner")?.ownerClientId ===
          "desktop-client",
      );

      const steerParams = {
        expectedTurnId: "turn-active",
        input: [{ type: "text", text: "recover stale owner" }],
        restoreMessage: { text: "recover stale owner" },
      };
      const resultPromise = bridge.sendThreadFollowerSteerTurn(
        "thread-stale-owner",
        steerParams,
      );
      const directRequest = await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-steer-turn" &&
          frame.targetClientId === "desktop-client",
      );
      const discoveryRequest = await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-steer-turn" &&
          !("targetClientId" in frame),
      );
      await expect(resultPromise).resolves.toEqual({ ok: true });

      expect(directRequest.params).toMatchObject({
        conversationId: "thread-stale-owner",
        input: steerParams.input,
        restoreMessage: steerParams.restoreMessage,
      });
      expect(discoveryRequest.params).toMatchObject({
        conversationId: "thread-stale-owner",
        input: steerParams.input,
        restoreMessage: steerParams.restoreMessage,
      });
      const recentRequests = (
        bridge.getStatus() as {
          recentFollowerRequests?: Array<Record<string, unknown>>;
        }
      ).recentFollowerRequests;
      expect(recentRequests?.slice(-2)).toMatchObject([
        {
          method: "thread-follower-steer-turn",
          threadId: "thread-stale-owner",
          targetClientId: "desktop-client",
          usedDiscovery: false,
          result: "error",
          error: "official-ipc-request-failed:thread-follower-steer-turn",
        },
        {
          method: "thread-follower-steer-turn",
          threadId: "thread-stale-owner",
          targetClientId: null,
          usedDiscovery: true,
          result: "success",
          handledByClientId: "official-router",
        },
      ]);
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("uses discovery when follower interrupt has no cached official owner", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      const resultPromise = bridge.sendThreadFollowerInterruptTurn(
        "thread-interrupt",
        "turn-active",
      );
      const request = await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-interrupt-turn" &&
          readOfficialConversationId(frame.params) === "thread-interrupt",
      );
      await expect(resultPromise).resolves.toEqual({ ok: true });

      expect(request).toMatchObject({
        type: "request",
        method: "thread-follower-interrupt-turn",
        sourceClientId: "web-client",
      });
      expect("targetClientId" in request).toBe(false);
      expect(request.params).toMatchObject({
        conversationId: "thread-interrupt",
        turnId: "turn-active",
      });
      expect(
        (
          bridge.getStatus() as {
            recentFollowerRequests?: Array<Record<string, unknown>>;
          }
        ).recentFollowerRequests?.at(-1),
      ).toMatchObject({
        method: "thread-follower-interrupt-turn",
        threadId: "thread-interrupt",
        targetClientId: null,
        usedDiscovery: true,
        result: "success",
        handledByClientId: "official-router",
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("records follower request errors from official IPC responses", async () => {
    const peer = new FakeOfficialIpcPeer();
    peer.failMethod("thread-follower-steer-turn", "owner refused steer");
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      sendExternalOwnerSnapshot(peer, "thread-steer-error");
      await waitUntil(
        () =>
          bridge.getThreadStreamState("thread-steer-error")?.ownerClientId ===
          "desktop-client",
      );

      const resultPromise = bridge.sendThreadFollowerSteerTurn(
        "thread-steer-error",
        { expectedTurnId: "turn-active", input: [] },
      );
      await peer.waitForFrame(
        (frame) =>
          frame.type === "request" &&
          frame.method === "thread-follower-steer-turn",
      );
      await expect(resultPromise).rejects.toThrow("owner refused steer");

      expect(
        (
          bridge.getStatus() as {
            recentFollowerRequests?: Array<Record<string, unknown>>;
          }
        ).recentFollowerRequests?.at(-1),
      ).toMatchObject({
        method: "thread-follower-steer-turn",
        threadId: "thread-steer-error",
        targetClientId: "desktop-client",
        usedDiscovery: false,
        result: "error",
        error: "owner refused steer",
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("answers official discovery and request frames through registered handlers", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);
    const handledParams: unknown[] = [];

    bridge.registerRequestHandler("thread-follower-interrupt-turn", {
      canHandle: (params) =>
        typeof params === "object" &&
        params !== null &&
        "conversationId" in params &&
        params.conversationId === "thread-owned",
      handle: (params) => {
        handledParams.push(params);
        return { interrupted: true };
      },
    });
    expect(bridge.getStatus()).toMatchObject({
      registeredRequestHandlers: [
        { method: "thread-follower-interrupt-turn", version: 1 },
      ],
    });

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      peer.send({
        type: "client-discovery-request",
        requestId: "discover-1",
        method: "thread-follower-interrupt-turn",
        version: 1,
        params: { conversationId: "thread-owned" },
      });
      const discoveryResponse = await peer.waitForFrame(
        (frame) =>
          frame.type === "client-discovery-response" &&
          frame.requestId === "discover-1",
      );
      expect(discoveryResponse).toMatchObject({
        clientId: "web-client",
        canHandle: true,
        response: { canHandle: true },
      });

      peer.send({
        type: "request",
        requestId: "request-1",
        method: "thread-follower-interrupt-turn",
        version: 1,
        params: { conversationId: "thread-owned", turnId: "turn-active" },
      });
      const requestResponse = await peer.waitForFrame(
        (frame) => frame.type === "response" && frame.requestId === "request-1",
      );

      expect(requestResponse).toMatchObject({
        method: "thread-follower-interrupt-turn",
        resultType: "success",
        result: { interrupted: true },
      });
      expect(handledParams).toEqual([
        { conversationId: "thread-owned", turnId: "turn-active" },
      ]);
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("answers nested official client discovery requests", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    bridge.registerRequestHandler("thread-follower-start-turn", {
      canHandle: (params) =>
        typeof params === "object" &&
        params !== null &&
        "conversationId" in params &&
        params.conversationId === "thread-nested-discovery",
      handle: () => ({ startedBy: "web" }),
    });

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      peer.send({
        type: "client-discovery-request",
        requestId: "discover-nested",
        request: {
          method: "thread-follower-start-turn",
          version: 1,
          params: { conversationId: "thread-nested-discovery" },
        },
      });

      await expect(
        peer.waitForFrame(
          (frame) =>
            frame.type === "client-discovery-response" &&
            frame.requestId === "discover-nested",
        ),
      ).resolves.toMatchObject({
        clientId: "web-client",
        canHandle: true,
        response: {
          canHandle: true,
          clientId: "web-client",
        },
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("rejects higher-version discovery and request frames without invoking handlers", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);
    const handledParams: unknown[] = [];

    bridge.registerRequestHandler("thread-follower-interrupt-turn", {
      version: 1,
      canHandle: () => true,
      handle: (params) => {
        handledParams.push(params);
        return { interrupted: true };
      },
    });

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      peer.send({
        type: "client-discovery-request",
        requestId: "discover-too-new",
        method: "thread-follower-interrupt-turn",
        version: 2,
        params: { conversationId: "thread-owned" },
      });
      await expect(
        peer.waitForFrame(
          (frame) =>
            frame.type === "client-discovery-response" &&
            frame.requestId === "discover-too-new",
        ),
      ).resolves.toMatchObject({
        clientId: "web-client",
        canHandle: false,
      });

      peer.send({
        type: "request",
        requestId: "request-too-new",
        method: "thread-follower-interrupt-turn",
        version: 2,
        params: { conversationId: "thread-owned", turnId: "turn-active" },
      });
      await expect(
        peer.waitForFrame(
          (frame) =>
            frame.type === "response" && frame.requestId === "request-too-new",
        ),
      ).resolves.toMatchObject({
        method: "thread-follower-interrupt-turn",
        resultType: "error",
        error: { message: "no-handler:thread-follower-interrupt-turn" },
      });
      expect(handledParams).toEqual([]);
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("broadcasts Web-owned snapshots and handles follower requests for that conversation", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    bridge.registerRequestHandler("thread-follower-start-turn", {
      canHandle: (params) =>
        bridge.isOwnedConversation(readOfficialConversationId(params)),
      handle: () => ({ startedBy: "web" }),
    });

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      bridge.broadcastConversationSnapshot("thread-web-owned", { turns: [] });
      const broadcast = await peer.waitForFrame(
        (frame) =>
          frame.type === "broadcast" &&
          frame.method === "thread-stream-state-changed",
      );
      expect(broadcast).toMatchObject({
        sourceClientId: "web-client",
        params: {
          hostId: "local",
          conversationId: "thread-web-owned",
          change: {
            type: "snapshot",
            conversationState: { turns: [] },
          },
        },
      });
      expect(bridge.isOwnedConversation("thread-web-owned")).toBe(true);

      peer.send({
        type: "client-discovery-request",
        requestId: "discover-web-owned",
        method: "thread-follower-start-turn",
        version: 1,
        params: { conversationId: "thread-web-owned" },
      });
      await expect(
        peer.waitForFrame(
          (frame) =>
            frame.type === "client-discovery-response" &&
            frame.requestId === "discover-web-owned",
        ),
      ).resolves.toMatchObject({
        clientId: "web-client",
        canHandle: true,
      });

      peer.send({
        type: "request",
        requestId: "request-web-owned",
        method: "thread-follower-start-turn",
        version: 1,
        params: {
          conversationId: "thread-web-owned",
          turnStartParams: { input: [{ type: "text", text: "from desktop" }] },
        },
      });
      await expect(
        peer.waitForFrame(
          (frame) =>
            frame.type === "response" &&
            frame.requestId === "request-web-owned",
        ),
      ).resolves.toMatchObject({
        resultType: "success",
        result: { startedBy: "web" },
      });

      peer.send({
        type: "broadcast",
        method: "thread-stream-state-changed",
        sourceClientId: "desktop-client",
        params: {
          hostId: "local",
          conversationId: "thread-web-owned",
          change: {
            type: "snapshot",
            conversationState: {
              turns: [{ id: "desktop-turn", status: "completed", items: [] }],
            },
          },
        },
      });
      await waitUntil(
        () =>
          bridge.getThreadStreamState("thread-web-owned")?.ownerClientId ===
          "desktop-client",
      );
      expect(bridge.isOwnedConversation("thread-web-owned")).toBe(false);
      expect(
        (
          bridge.getStatus() as {
            recentOwnershipHandoffs?: Array<Record<string, unknown>>;
          }
        ).recentOwnershipHandoffs?.at(-1),
      ).toMatchObject({
        conversationId: "thread-web-owned",
        previousOwnerClientId: "web-client",
        nextOwnerClientId: "desktop-client",
        sourceClientId: "desktop-client",
      });

      peer.send({
        type: "client-discovery-request",
        requestId: "discover-after-handoff",
        method: "thread-follower-start-turn",
        version: 1,
        params: { conversationId: "thread-web-owned" },
      });
      await expect(
        peer.waitForFrame(
          (frame) =>
            frame.type === "client-discovery-response" &&
            frame.requestId === "discover-after-handoff",
        ),
      ).resolves.toMatchObject({
        clientId: "web-client",
        canHandle: false,
      });
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });

  it("deduplicates unchanged Web-owned snapshot broadcasts", async () => {
    const peer = new FakeOfficialIpcPeer();
    await peer.start();
    const bridge = new OfficialIpcBridge(peer.pipePath);

    try {
      bridge.start();
      await waitUntil(
        () =>
          (bridge.getStatus() as { clientId?: string | null }).clientId ===
          "web-client",
      );

      const isThreadStreamBroadcast = (frame: OfficialIpcFrame) =>
        Boolean(
          frame.type === "broadcast" &&
            frame.method === "thread-stream-state-changed" &&
            frame.params &&
            typeof frame.params === "object" &&
            "conversationId" in frame.params &&
            frame.params.conversationId === "thread-web-owned",
        );

      bridge.broadcastConversationSnapshot("thread-web-owned", { turns: [] });
      await peer.waitForFrame(isThreadStreamBroadcast);
      const firstCacheVersion = bridge.getThreadStreamState(
        "thread-web-owned",
      )?.cacheVersion;
      bridge.broadcastConversationSnapshot("thread-web-owned", { turns: [] });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(peer.countFrames(isThreadStreamBroadcast)).toBe(1);
      expect(
        bridge.getThreadStreamState("thread-web-owned")?.cacheVersion,
      ).toBe(firstCacheVersion);

      bridge.broadcastConversationSnapshot("thread-web-owned", {
        turns: [{ id: "turn-a", items: [] }],
      });
      await peer.waitForFrame((frame) => {
        if (!isThreadStreamBroadcast(frame)) return false;
        const params = frame.params as {
          change?: { conversationState?: { turns?: unknown[] } };
        };
        return params.change?.conversationState?.turns?.length === 1;
      });
      expect(peer.countFrames(isThreadStreamBroadcast)).toBe(2);
      expect(
        bridge.getThreadStreamState("thread-web-owned")?.cacheVersion,
      ).toBeGreaterThan(firstCacheVersion ?? 0);
    } finally {
      bridge.dispose();
      await peer.stop();
    }
  });
});
