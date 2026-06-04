import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

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

  async threadFork(params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: "thread/fork", params });
    return {
      thread: {
        id: "thread-forked",
        sessionId: "thread-forked",
        name: "Forked thread",
        cwd: "C:\\workspace\\codex_web",
        forkedFromId: "thread-source",
        createdAt: "2026-06-04T04:00:30.000Z",
        updatedAt: "2026-06-04T04:00:00.000Z",
        turns: this.historyTurns(),
      },
    };
  }

  async threadRollback(params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: "thread/rollback", params });
    const numTurns =
      typeof params.numTurns === "number" ? params.numTurns : 0;
    return {
      thread: {
        id: "thread-forked",
        sessionId: "thread-forked",
        name: "Forked thread",
        cwd: "C:\\workspace\\codex_web",
        forkedFromId: "thread-source",
        createdAt: "2026-06-04T04:00:30.000Z",
        updatedAt: "2026-06-04T04:01:00.000Z",
        turns: this.historyTurns().slice(0, Math.max(0, 3 - numTurns)),
      },
    };
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return { ok: true };
  }

  async threadRead(params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: "thread/read", params });
    return {
      thread: {
        id: "thread-source",
        sessionId: "thread-source",
        name: "Source thread",
        cwd: "C:\\workspace\\codex_web",
        createdAt: "2026-06-04T03:57:00.000Z",
        turns: this.historyTurns(),
      },
    };
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

  private historyTurns(): Array<Record<string, unknown>> {
    return [
      {
        id: "turn-1",
        status: "completed",
        startedAt: "2026-06-04T03:57:30.000Z",
        completedAt: "2026-06-04T03:58:00.000Z",
        items: [{ type: "agent_message", text: "first" }],
      },
      {
        id: "turn-2",
        status: "completed",
        startedAt: "2026-06-04T03:58:30.000Z",
        completedAt: "2026-06-04T03:59:00.000Z",
        items: [{ type: "agent_message", text: "second" }],
      },
      {
        id: "turn-3",
        status: "completed",
        startedAt: "2026-06-04T03:59:30.000Z",
        completedAt: "2026-06-04T04:00:00.000Z",
        items: [{ type: "agent_message", text: "third" }],
      },
    ];
  }
}

type Harness = {
  context: ServerContext;
  officialIpc: OfficialIpcBridge;
  appServer: FakeAppServer;
  root: string;
  recentRefreshBroadcasts: string[];
};

const harnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-thread-fork-"));
  const officialIpc = new OfficialIpcBridge("");
  (officialIpc as unknown as { clientId: string }).clientId = "web-test";
  const recentRefreshBroadcasts: string[] = [];
  (
    officialIpc as unknown as {
      broadcastThreadUnarchived: (threadId: string) => boolean;
    }
  ).broadcastThreadUnarchived = (threadId: string) => {
    recentRefreshBroadcasts.push(threadId);
    return true;
  };
  const appServer = new FakeAppServer();
  const context = await createServer(root, {
    officialIpc,
    appServer: appServer as unknown as CodexAppServerProcess,
  });
  const harness = {
    context,
    officialIpc,
    appServer,
    root,
    recentRefreshBroadcasts,
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (harnesses.length) {
    const harness = harnesses.pop();
    if (!harness) continue;
    await harness.context.app.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

describe("thread fork route", () => {
  it("forks through official thread/fork without side-conversation fields", async () => {
    const { context, appServer, officialIpc, recentRefreshBroadcasts } =
      await createHarness();

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread/fork",
      payload: {
        threadId: "thread-source",
        cwd: "C:\\workspace\\codex_web",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        thread: {
          id: "thread-forked",
          title: "Forked thread",
        },
        derivedFromThreadId: "thread-source",
      },
    });
    expect(appServer.calls[0]).toEqual({
      method: "thread/fork",
      params: {
        threadId: "thread-source",
        cwd: "C:\\workspace\\codex_web",
        threadSource: "user",
      },
    });
    expect(appServer.calls[0]?.params).not.toMatchObject({
      ephemeral: true,
      developerInstructions: expect.any(String),
    });
    expect(officialIpc.isOwnedConversation("thread-forked")).toBe(true);
    expect(recentRefreshBroadcasts).toEqual(["thread-forked"]);
  });

  it("forks context from the selected turn without implying workspace rollback", async () => {
    const { context, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread/fork",
      payload: {
        threadId: "thread-source",
        afterTurnId: "turn-2",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        thread: {
          id: "thread-forked",
          title: "Forked thread",
        },
        derivedFromThreadId: "thread-source",
      },
    });
    expect(appServer.calls.map((call) => call.method)).toEqual([
      "thread/read",
      "thread/fork",
      "thread/rollback",
    ]);
    expect(appServer.calls[2]).toEqual({
      method: "thread/rollback",
      params: {
        threadId: "thread-forked",
        numTurns: 1,
      },
    });
  });
});
