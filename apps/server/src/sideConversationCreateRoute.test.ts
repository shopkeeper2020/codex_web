import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

class FakeAppServer {
  readonly calls: Array<{ method: string; params?: unknown }> = [];
  turnStarted = false;

  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}

  async threadFork(params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: "thread/fork", params });
    return {
      thread: {
        id: "side-web-created",
        cwd: params.cwd,
        createdAt: 1_779_996_000,
        updatedAt: 1_779_996_000,
        turns: [],
      },
    };
  }

  async threadInjectItems(params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: "thread/inject_items", params });
    return { ok: true };
  }

  async threadRead(params?: Record<string, unknown>): Promise<unknown> {
    const threadId =
      typeof params?.threadId === "string" ? params.threadId : "side-web-created";
    return {
      thread: {
        id: threadId,
        name: threadId,
        turns: this.turnStarted
          ? [
              {
                turnId: "turn-after-start",
                status: "completed",
                items: [
                  {
                    type: "userMessage",
                    id: "user-after-start",
                    content: [{ type: "text", text: "继续问" }],
                  },
                ],
              },
            ]
          : [],
      },
    };
  }

  async threadStart(): Promise<unknown> {
    return { ok: true };
  }

  async threadResume(params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: "thread/resume", params });
    return { ok: true };
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return { ok: true };
  }

  async turnStart(): Promise<unknown> {
    this.turnStarted = true;
    return { ok: true };
  }

  async turnSteer(): Promise<unknown> {
    return { ok: true };
  }

  async turnInterrupt(params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: "turn/interrupt", params });
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

async function createHarness(
  input: { clientId?: string | null } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-side-create-"));
  const officialIpc = new OfficialIpcBridge("");
  if (input.clientId !== null) {
    (officialIpc as unknown as { clientId: string }).clientId =
      input.clientId ?? "web-test";
  }
  officialIpc.hydrateThreadStreamState({
    threadId: "parent-thread",
    hostId: "local",
    ownerClientId: "desktop-test",
    sourceClientId: "desktop-test",
    conversationState: {
      id: "parent-thread",
      cwd: "C:\\workspace\\codex_web",
      turns: [],
    },
  });
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
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await closeHarness(harness);
  }
});

describe("side conversation create route", () => {
  it("forks the current thread through the official side conversation path", async () => {
    const { context, officialIpc, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/side-conversation-create",
      payload: { threadId: "parent-thread" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        sideConversation: {
          id: "side-web-created",
          title: "侧边聊天",
          turnCount: 0,
          turns: [],
        },
      },
    });
    expect(appServer.calls[0]).toMatchObject({
      method: "thread/fork",
      params: {
        threadId: "parent-thread",
        path: null,
        cwd: "C:\\workspace\\codex_web",
        threadSource: "user",
        excludeTurns: true,
        ephemeral: true,
        persistExtendedHistory: false,
      },
    });
    expect(
      String(
        (appServer.calls[0]?.params as Record<string, unknown>)
          .developerInstructions,
      ),
    ).toContain("Side conversation boundary.");
    expect(appServer.calls[1]).toMatchObject({
      method: "thread/inject_items",
      params: {
        threadId: "side-web-created",
        items: [
          {
            type: "message",
            role: "user",
          },
        ],
      },
    });
    expect(
      JSON.stringify((appServer.calls[1]?.params as Record<string, unknown>).items),
    ).toContain("Side conversation boundary.");
    expect(officialIpc.isOwnedConversation("side-web-created")).toBe(true);
    expect(
      officialIpc.getThreadStreamState("side-web-created")?.conversationState,
    ).toMatchObject({
      id: "side-web-created",
      sideConversation: true,
      ephemeral: true,
      parentThreadId: "parent-thread",
      parentConversationId: "parent-thread",
      sourceThreadId: "parent-thread",
      turns: [],
    });
  });

  it("rejects side conversation creation before Web has an official IPC client id", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      clientId: null,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/side-conversation-create",
      payload: { threadId: "parent-thread" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "official-ipc-owner-not-ready",
    });
    expect(appServer.calls).toEqual([]);
    expect(officialIpc.isOwnedConversation("side-web-created")).toBe(false);
  });

  it("refreshes a Web-owned side conversation snapshot after local turn start", async () => {
    const { context, officialIpc } = await createHarness();

    const createResponse = await context.app.inject({
      method: "POST",
      url: "/api/domain/side-conversation-create",
      payload: { threadId: "parent-thread" },
    });
    expect(createResponse.statusCode).toBe(200);

    const turnResponse = await context.app.inject({
      method: "POST",
      url: "/api/domain/turn-start",
      payload: {
        threadId: "side-web-created",
        text: "继续问",
        attachmentIds: [],
      },
    });
    expect(turnResponse.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 850));

    expect(
      officialIpc.getThreadStreamState("side-web-created")?.conversationState,
    ).toMatchObject({
      id: "side-web-created",
      sideConversation: true,
      parentThreadId: "parent-thread",
      turns: [
        {
          turnId: "turn-after-start",
        },
      ],
    });
  }, 10_000);

  it("discards externally owned side conversation cache on close", async () => {
    const { context, officialIpc, appServer } = await createHarness();
    officialIpc.hydrateThreadStreamState({
      threadId: "side-external",
      hostId: "local",
      ownerClientId: "desktop-test",
      sourceClientId: "desktop-test",
      conversationState: {
        id: "side-external",
        sideConversation: true,
        parentThreadId: "parent-thread",
        turns: [],
      },
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/side-conversation-close",
      payload: {
        threadId: "parent-thread",
        sideConversationId: "side-external",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        ok: true,
        sideConversationId: "side-external",
        discarded: true,
        interrupted: false,
      },
    });
    expect(appServer.calls).toEqual([]);
    expect(officialIpc.getThreadStreamState("side-external")).toBeNull();
  });

  it("interrupts Web-owned active side conversations before close", async () => {
    const { context, officialIpc, appServer } = await createHarness();
    officialIpc.broadcastConversationSnapshot("side-owned-active", {
      id: "side-owned-active",
      sideConversation: true,
      parentThreadId: "parent-thread",
      status: "active",
      turns: [{ id: "turn-active", status: "active", items: [] }],
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/side-conversation-close",
      payload: {
        threadId: "parent-thread",
        sideConversationId: "side-owned-active",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        ok: true,
        sideConversationId: "side-owned-active",
        discarded: true,
        interrupted: true,
      },
    });
    expect(appServer.calls).toContainEqual({
      method: "turn/interrupt",
      params: {
        threadId: "side-owned-active",
        turnId: "turn-active",
      },
    });
    expect(officialIpc.getThreadStreamState("side-owned-active")).toBeNull();
  });
});
