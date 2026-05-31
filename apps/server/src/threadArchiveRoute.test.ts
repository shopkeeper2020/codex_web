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

  async threadArchive(params: { threadId: string }): Promise<unknown> {
    this.calls.push({ method: "thread/archive", params });
    return { ok: true };
  }

  async threadRead(params: {
    threadId: string;
    includeTurns: boolean;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/read", params });
    return { thread: { id: params.threadId, turns: [] } };
  }

  async threadRename(params: {
    threadId: string;
    name: string;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/name/set", params });
    return { ok: true };
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

function applyExternalSnapshot(
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
          name: "Desktop owned thread",
          turns: [],
        },
      },
    },
  });
}

async function createHarness(officialIpc = createBridge()): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-thread-archive-"));
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

describe("thread archive route", () => {
  it("releases Web ownership and cached stream state after archiving a Web-owned thread", async () => {
    const officialIpc = createBridge();
    officialIpc.broadcastConversationSnapshot("thread-web", {
      id: "thread-web",
      turns: [],
    });
    const { context, appServer } = await createHarness(officialIpc);

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-archive",
      payload: { threadId: "thread-web" },
    });

    const status = officialIpc.getStatus() as {
      ownedConversationCount?: number;
      recentOwnershipHandoffs?: Array<Record<string, unknown>>;
    };
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { ok: true } });
    expect(appServer.calls).toEqual([
      { method: "thread/archive", params: { threadId: "thread-web" } },
    ]);
    expect(officialIpc.isOwnedConversation("thread-web")).toBe(false);
    expect(officialIpc.getThreadStreamState("thread-web")).toBeNull();
    expect(status.ownedConversationCount).toBe(0);
    expect(status.recentOwnershipHandoffs?.at(-1)).toMatchObject({
      conversationId: "thread-web",
      previousOwnerClientId: "web-test",
      nextOwnerClientId: null,
      sourceClientId: "web-test",
      reason: "thread-archived",
    });
  });

  it("rejects local archive mutations for externally owned threads", async () => {
    const officialIpc = createBridge();
    applyExternalSnapshot(officialIpc, "thread-official");
    const { context, appServer } = await createHarness(officialIpc);

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-archive",
      payload: { threadId: "thread-official" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "official-owner-action-required:thread-archive",
    });
    expect(appServer.calls).toEqual([]);
    expect(officialIpc.isOwnedConversation("thread-official")).toBe(false);
    expect(officialIpc.getThreadStreamState("thread-official")).toMatchObject({
      ownerClientId: "desktop-client",
      sourceClientId: "desktop-client",
      conversationState: {
        name: "Desktop owned thread",
      },
    });
  });
});
