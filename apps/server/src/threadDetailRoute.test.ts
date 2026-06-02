import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

class FakeAppServer {
  readonly calls: Array<{ method: string; params?: unknown }> = [];
  threadReadResult: unknown | null = null;
  threadReadError: Error | null = null;

  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}

  async threadRead(params: {
    threadId: string;
    includeTurns: boolean;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/read", params });
    if (this.threadReadError) throw this.threadReadError;
    return (
      this.threadReadResult ?? {
        thread: {
          id: params.threadId,
          name: "App-server hydrated thread",
          cwd: "C:\\workspace\\codex_web",
          updatedAt: "2026-05-29T00:00:00.000Z",
          turns: [
            {
              id: "turn-app-server",
              status: "completed",
              items: [{ type: "agent_message", text: "hydrated" }],
            },
          ],
        },
      }
    );
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return { ok: true };
  }

  async turnStart(): Promise<unknown> {
    return { ok: true };
  }

  async turnSteer(): Promise<unknown> {
    return { ok: true };
  }

  async turnInterrupt(): Promise<unknown> {
    return { ok: true };
  }

  async threadCompactStart(): Promise<unknown> {
    return { ok: true };
  }
}

type Harness = {
  context: ServerContext;
  officialIpc: OfficialIpcBridge;
  appServer: FakeAppServer;
  root: string;
};

const harnesses: Harness[] = [];

function createBridge(): OfficialIpcBridge {
  const officialIpc = new OfficialIpcBridge("");
  (officialIpc as unknown as { clientId: string }).clientId = "web-test";
  return officialIpc;
}

function applyExternalEmptySnapshot(
  officialIpc: OfficialIpcBridge,
  threadId: string,
): void {
  (
    officialIpc as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    }
  ).handleFrame({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "desktop-client",
    params: {
      hostId: "local",
      conversationId: threadId,
      change: {
        type: "snapshot",
        conversationState: {
          id: threadId,
          name: "Desktop empty snapshot",
          turns: [],
        },
      },
    },
  });
}

function applyExternalPartialActiveSnapshot(
  officialIpc: OfficialIpcBridge,
  threadId: string,
): void {
  (
    officialIpc as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    }
  ).handleFrame({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "desktop-client",
    params: {
      hostId: "local",
      conversationId: threadId,
      change: {
        type: "snapshot",
        conversationState: {
          id: threadId,
          name: "Desktop partial active snapshot",
          threadRuntimeStatus: { type: "active" },
          turns: [
            {
              id: "turn-completed",
              status: "completed",
              items: [{ type: "agent_message", text: "historical" }],
            },
            {
              turnId: "turn-active-empty",
              status: "inProgress",
              items: [],
            },
          ],
        },
      },
    },
  });
}

function applyExternalUsableActiveSnapshot(
  officialIpc: OfficialIpcBridge,
  input: {
    cacheVersion?: number;
    threadId: string;
    text?: string;
  },
): void {
  (
    officialIpc as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    }
  ).handleFrame({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "desktop-client",
    params: {
      hostId: "local",
      conversationId: input.threadId,
      change: {
        type: "snapshot",
        conversationState: {
          id: input.threadId,
          name: "Desktop usable active snapshot",
          threadRuntimeStatus: { type: "active" },
          updatedAt: "2026-05-29T00:00:00.000Z",
          turns: [
            {
              id: "turn-live",
              status: "active",
              items: [
                {
                  id: `item-live-${input.cacheVersion ?? 1}`,
                  type: "agentMessage",
                  text: input.text ?? "live stream",
                },
              ],
            },
          ],
        },
      },
    },
  });
}

function applyExternalSparseItemSnapshot(
  officialIpc: OfficialIpcBridge,
  threadId: string,
): void {
  const items: unknown[] = [
    { type: "userMessage", id: "item-user", content: "hello" },
  ];
  items.length = 4;
  items.push(null, undefined, {
    type: "agentMessage",
    id: "item-agent",
    text: "world",
  });
  (
    officialIpc as unknown as {
      handleFrame: (frame: Record<string, unknown>) => void;
    }
  ).handleFrame({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "desktop-client",
    params: {
      hostId: "local",
      conversationId: threadId,
      change: {
        type: "snapshot",
        conversationState: {
          id: threadId,
          name: "Desktop sparse item snapshot",
          turns: [
            {
              id: "turn-sparse",
              status: "completed",
              items,
            },
          ],
        },
      },
    },
  });
}

async function createHarness(officialIpc = createBridge()): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-thread-detail-"));
  const appServer = new FakeAppServer();
  const context = await createServer(root, {
    officialIpc,
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
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await closeHarness(harness);
  }
});

describe("thread detail route", () => {
  it("hydrates external-owned empty snapshots without caching app-server detail", async () => {
    const officialIpc = createBridge();
    applyExternalEmptySnapshot(officialIpc, "thread-official");
    const { context, appServer } = await createHarness(officialIpc);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-official",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server-readonly",
      data: {
        thread: {
          id: "thread-official",
          owner: {
            clientId: "desktop-client",
            source: "official-ipc",
          },
        },
        turns: [{ id: "turn-app-server" }],
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-official", includeTurns: true },
      },
    ]);
    expect(officialIpc.getThreadStreamState("thread-official")).toMatchObject({
      threadId: "thread-official",
      ownerClientId: "desktop-client",
      conversationState: {
        id: "thread-official",
        turns: [{ id: "turn-app-server" }],
      },
    });
    expect(context.database.status().threadDetailCount).toBe(0);
  });

  it("drops sparse official turn item placeholders before response validation", async () => {
    const officialIpc = createBridge();
    applyExternalSparseItemSnapshot(officialIpc, "thread-sparse");
    const { context, appServer } = await createHarness(officialIpc);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-sparse",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "official-ipc",
      data: {
        thread: {
          id: "thread-sparse",
          owner: {
            clientId: "desktop-client",
            source: "official-ipc",
          },
        },
        turns: [
          {
            id: "turn-sparse",
            items: [
              { type: "user", id: "item-user", text: "hello" },
              { type: "assistant", id: "item-agent", text: "world" },
            ],
          },
        ],
      },
    });
    expect(appServer.calls).toEqual([]);
  });

  it("still caches app-server detail when no official stream state exists", async () => {
    const { context, officialIpc, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-app-server",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server",
      data: {
        thread: { id: "thread-app-server" },
        turns: [{ id: "turn-app-server" }],
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-app-server", includeTurns: true },
      },
    ]);
    expect(context.database.status().threadDetailCount).toBe(1);
    expect(officialIpc.isOwnedConversation("thread-app-server")).toBe(true);
    expect(officialIpc.canBroadcastOwnedConversation("thread-app-server")).toBe(
      false,
    );
  });

  it("uses cached created thread detail during transient empty rollout reads", async () => {
    const { context, appServer } = await createHarness();
    context.database.upsertThreadDetail(
      "thread-created",
      {
        thread: {
          id: "thread-created",
          title: "Untitled",
          projectId: "C:\\workspace\\codex_web",
          path: "C:\\workspace\\codex_web",
          updatedAtIso: "2026-06-01T00:00:00.000Z",
          inProgress: false,
          pinned: false,
          owner: null,
        },
        goal: null,
        turns: [],
        subAgents: [],
        sideConversations: [],
      },
      "app-server",
    );
    appServer.threadReadError = new Error(
      "failed to read thread: thread-store internal error: failed to read thread C:\\Users\\lwm\\.codex\\sessions\\2026\\06\\01\\rollout-thread-created.jsonl: rollout at C:\\Users\\lwm\\.codex\\sessions\\2026\\06\\01\\rollout-thread-created.jsonl is empty",
    );

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-created",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server-cache-transient",
      data: {
        thread: { id: "thread-created", title: "Untitled" },
        turns: [],
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-created", includeTurns: true },
      },
    ]);
  });

  it("overlays locally pinned state onto thread detail responses", async () => {
    const { context } = await createHarness();
    context.database.setThreadPinned("thread-app-server", true);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-app-server",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        thread: {
          id: "thread-app-server",
          pinned: true,
        },
      },
    });
  });

  it("hydrates external-owned partial active snapshots when the active turn has no items", async () => {
    const officialIpc = createBridge();
    applyExternalPartialActiveSnapshot(officialIpc, "thread-active");
    const { context, appServer } = await createHarness(officialIpc);
    appServer.threadReadResult = {
      thread: {
        id: "thread-active",
        name: "App-server live thread",
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-29T00:00:00.000Z",
        status: "active",
        turns: [
          {
            id: "turn-completed",
            status: "completed",
            items: [{ type: "agentMessage", text: "historical" }],
          },
          {
            id: "turn-active-filled",
            status: "active",
            items: [{ type: "agentMessage", text: "live tail" }],
          },
        ],
      },
    };

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-active",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server-readonly",
      data: {
        thread: {
          id: "thread-active",
          inProgress: true,
          owner: {
            clientId: "desktop-client",
            source: "official-ipc",
          },
        },
        turns: [
          { id: "turn-completed" },
          {
            id: "turn-active-filled",
            status: "active",
            items: [{ type: "assistant", text: "live tail" }],
          },
        ],
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-active", includeTurns: true },
      },
    ]);
    expect(officialIpc.getThreadStreamState("thread-active")).toMatchObject({
      threadId: "thread-active",
      ownerClientId: "desktop-client",
      conversationState: {
        id: "thread-active",
        turns: [
          { id: "turn-completed" },
          { id: "turn-active-filled", items: [{ text: "live tail" }] },
        ],
      },
    });
    expect(context.database.status().threadDetailCount).toBe(0);
  });

  it("preserves official live state when readonly app-server detail is stale", async () => {
    const officialIpc = createBridge();
    applyExternalPartialActiveSnapshot(officialIpc, "thread-stale-active");
    const { context, appServer } = await createHarness(officialIpc);
    appServer.threadReadResult = {
      thread: {
        id: "thread-stale-active",
        name: "Stale app-server thread",
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-29T00:00:00.000Z",
        status: "completed",
        threadRuntimeStatus: { type: "completed" },
        turns: [
          {
            id: "turn-completed",
            status: "completed",
            items: [{ type: "agentMessage", text: "historical" }],
          },
          {
            id: "turn-active-empty",
            status: "completed",
            items: [],
          },
        ],
      },
    };

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-stale-active",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server-readonly",
      data: {
        thread: {
          id: "thread-stale-active",
          inProgress: true,
          owner: {
            clientId: "desktop-client",
            source: "official-ipc",
          },
        },
        turns: [
          { id: "turn-completed", status: "completed" },
          { id: "turn-active-empty", status: "active" },
        ],
      },
    });
    expect(
      officialIpc.getThreadStreamState("thread-stale-active"),
    ).toMatchObject({
      threadId: "thread-stale-active",
      ownerClientId: "desktop-client",
      isInProgress: true,
      activeTurnId: "turn-active-empty",
      conversationState: {
        id: "thread-stale-active",
        status: "active",
        threadRuntimeStatus: { type: "active" },
        turns: [
          { id: "turn-completed", status: "completed" },
          { id: "turn-active-empty", status: "active" },
        ],
      },
    });
    expect(context.database.status().threadDetailCount).toBe(0);
  });

  it("preserves richer official stream turn items when reopening an active external thread", async () => {
    const officialIpc = createBridge();
    officialIpc.restoreThreadStreamState({
      threadId: "thread-live-items",
      conversationId: "thread-live-items",
      hostId: "local",
      ownerClientId: "desktop-client",
      sourceClientId: "desktop-client",
      conversationState: {
        id: "thread-live-items",
        name: "Live command snapshot",
        threadRuntimeStatus: { type: "active" },
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [
              { type: "agentMessage", text: "live intro" },
              {
                type: "commandExecution",
                id: "call-live-command",
                command: "pnpm --filter @codex-web/web typecheck",
                status: "completed",
                output: "typecheck ok",
              },
            ],
          },
        ],
      },
      changeType: "snapshot",
      cacheVersion: 9,
      updatedAtIso: "2026-05-29T00:00:00.000Z",
      isInProgress: true,
      activeTurnId: "turn-live",
    });
    const { context, appServer } = await createHarness(officialIpc);
    appServer.threadReadResult = {
      thread: {
        id: "thread-live-items",
        name: "App-server lagging thread",
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-29T00:00:01.000Z",
        status: "active",
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [{ type: "agentMessage", text: "app-server intro only" }],
          },
        ],
      },
    };

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-live-items",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server-readonly",
      data: {
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [
              { type: "assistant", text: "live intro" },
              {
                type: "command",
                id: "call-live-command",
                command: "pnpm --filter @codex-web/web typecheck",
              },
            ],
          },
        ],
      },
    });
    expect(officialIpc.getThreadStreamState("thread-live-items")).toMatchObject(
      {
        conversationState: {
          turns: [
            {
              id: "turn-live",
              items: [
                { text: "live intro" },
                {
                  type: "commandExecution",
                  command: "pnpm --filter @codex-web/web typecheck",
                },
              ],
            },
          ],
        },
      },
    );
  });

  it("serves fresh usable external active detail without app-server verification", async () => {
    const officialIpc = createBridge();
    applyExternalUsableActiveSnapshot(officialIpc, {
      threadId: "thread-active-throttle",
      text: "live first",
    });
    const { context, appServer } = await createHarness(officialIpc);
    appServer.threadReadResult = {
      thread: {
        id: "thread-active-throttle",
        name: "App-server active thread",
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-29T00:00:00.000Z",
        status: "active",
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [{ type: "agentMessage", text: "app-server live" }],
          },
        ],
      },
    };

    const first = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-active-throttle",
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      source: "official-ipc-active",
      data: {
        thread: { id: "thread-active-throttle", inProgress: true },
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [{ type: "assistant", text: "live first" }],
          },
        ],
      },
    });
    expect(appServer.calls).toEqual([]);

    applyExternalUsableActiveSnapshot(officialIpc, {
      threadId: "thread-active-throttle",
      text: "live second",
    });

    const second = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-active-throttle",
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      source: "official-ipc-active",
      data: {
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [{ type: "assistant", text: "live second" }],
          },
        ],
      },
    });
    expect(appServer.calls).toEqual([]);
  });

  it("verifies stale usable external active detail through app-server", async () => {
    const officialIpc = createBridge();
    officialIpc.restoreThreadStreamState({
      threadId: "thread-stale-active-verify",
      conversationId: "thread-stale-active-verify",
      hostId: "local",
      ownerClientId: "desktop-client",
      sourceClientId: "desktop-client",
      conversationState: {
        id: "thread-stale-active-verify",
        name: "Stale active snapshot",
        threadRuntimeStatus: { type: "active" },
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [{ type: "agentMessage", text: "stale live" }],
          },
        ],
      },
      changeType: "snapshot",
      cacheVersion: 1,
      updatedAtIso: "2026-05-29T00:00:00.000Z",
      isInProgress: true,
      activeTurnId: "turn-live",
    });
    const { context, appServer } = await createHarness(officialIpc);
    appServer.threadReadResult = {
      thread: {
        id: "thread-stale-active-verify",
        name: "App-server active thread",
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-29T00:00:00.000Z",
        status: "active",
        turns: [
          {
            id: "turn-live",
            status: "active",
            items: [{ type: "agentMessage", text: "app-server live" }],
          },
        ],
      },
    };

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-stale-active-verify",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server-readonly",
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/read",
        params: {
          threadId: "thread-stale-active-verify",
          includeTurns: true,
        },
      },
    ]);
  });

  it("retires a stale external active cache when app-server has a newer completed turn", async () => {
    const officialIpc = createBridge();
    officialIpc.restoreThreadStreamState({
      threadId: "thread-stale-finished",
      conversationId: "thread-stale-finished",
      hostId: "local",
      ownerClientId: "desktop-client",
      sourceClientId: "desktop-client",
      conversationState: {
        id: "thread-stale-finished",
        name: "Stale active snapshot",
        threadRuntimeStatus: { type: "active" },
        turns: [
          {
            id: "turn-stale-active",
            status: "active",
            items: [{ type: "reasoning", text: "thinking" }],
          },
        ],
      },
      changeType: "snapshot",
      cacheVersion: 1,
      updatedAtIso: "2026-05-29T00:00:00.000Z",
      isInProgress: true,
      activeTurnId: "turn-stale-active",
    });
    const { context, appServer } = await createHarness(officialIpc);
    appServer.threadReadResult = {
      thread: {
        id: "thread-stale-finished",
        name: "Finished app-server thread",
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-31T00:00:00.000Z",
        status: "completed",
        threadRuntimeStatus: { type: "completed" },
        turns: [
          {
            id: "turn-stale-active",
            status: "completed",
            items: [{ type: "agentMessage", text: "finished" }],
          },
        ],
      },
    };

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread-detail?threadId=thread-stale-finished",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "app-server-readonly-stale-official-retired",
      data: {
        thread: {
          id: "thread-stale-finished",
          inProgress: false,
        },
        turns: [
          {
            id: "turn-stale-active",
            status: "completed",
            items: [{ type: "assistant", text: "finished" }],
          },
        ],
      },
    });
    expect(
      officialIpc.getThreadStreamState("thread-stale-finished"),
    ).toMatchObject({
      threadId: "thread-stale-finished",
      ownerClientId: "desktop-client",
      isInProgress: false,
      activeTurnId: "",
      conversationState: {
        id: "thread-stale-finished",
        status: "completed",
        turns: [{ id: "turn-stale-active", status: "completed" }],
      },
    });
  });
});
