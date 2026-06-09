import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

class FakeAppServer {
  readonly calls: Array<{ method: string; params?: unknown }> = [];

  constructor(
    private readonly threadId: string,
    private readonly renamedTitle: string,
    private readonly onThreadRead?: () => void,
  ) {}

  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}

  async threadRename(params: {
    threadId: string;
    name: string;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/name/set", params });
    return { ok: true };
  }

  async threadRead(params: {
    threadId: string;
    includeTurns: boolean;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/read", params });
    this.onThreadRead?.();
    return {
      thread: {
        id: this.threadId,
        name: this.renamedTitle,
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-29T00:00:00.000Z",
        turns: [],
      },
    };
  }

  async rpc(): Promise<unknown> {
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
        revision: 1,
        conversationState: {
          id: threadId,
          name: "Desktop owned thread",
          turns: [],
        },
      },
    },
  });
}

async function createHarness(input: {
  officialIpc: OfficialIpcBridge;
  threadId: string;
  renamedTitle: string;
  onThreadRead?: () => void;
}): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-thread-rename-"));
  const appServer = new FakeAppServer(
    input.threadId,
    input.renamedTitle,
    input.onThreadRead,
  );
  const context = await createServer(root, {
    officialIpc: input.officialIpc,
    appServer: appServer as unknown as CodexAppServerProcess,
  });
  const harness = {
    context,
    officialIpc: input.officialIpc,
    appServer,
    root,
  };
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

describe("thread rename route", () => {
  it("renames externally owned threads through app-server and hydrates readonly official cache", async () => {
    const officialIpc = createBridge();
    applyExternalSnapshot(officialIpc, "thread-official");
    const { context, appServer } = await createHarness({
      officialIpc,
      threadId: "thread-official",
      renamedTitle: "Renamed official thread",
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread/rename",
      payload: {
        threadId: "thread-official",
        title: "Renamed official thread",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        ok: true,
        thread: {
          id: "thread-official",
          title: "Renamed official thread",
        },
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/name/set",
        params: { threadId: "thread-official", name: "Renamed official thread" },
      },
      {
        method: "thread/read",
        params: { threadId: "thread-official", includeTurns: true },
      },
    ]);
    expect(officialIpc.isOwnedConversation("thread-official")).toBe(false);
    expect(officialIpc.getThreadStreamState("thread-official")).toMatchObject({
      ownerClientId: "desktop-client",
      sourceClientId: "desktop-client",
      conversationState: {
        name: "Renamed official thread",
      },
    });
    expect(context.database.readThreadDetail("thread-official")).toBeNull();
  });

  it("does not write detail cache when external ownership disappears during rename refresh", async () => {
    const officialIpc = createBridge();
    applyExternalSnapshot(officialIpc, "thread-official");
    const { context } = await createHarness({
      officialIpc,
      threadId: "thread-official",
      renamedTitle: "Renamed official thread",
      onThreadRead: () =>
        officialIpc.discardConversationFromCache(
          "thread-official",
          "test-lost-external-state",
        ),
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread/rename",
      payload: {
        threadId: "thread-official",
        title: "Renamed official thread",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(officialIpc.getThreadStreamState("thread-official")).toBeNull();
    expect(context.database.readThreadDetail("thread-official")).toBeNull();
  });

  it("rebroadcasts rename snapshots only for already Web-owned threads", async () => {
    const officialIpc = createBridge();
    officialIpc.broadcastConversationSnapshot("thread-web", {
      id: "thread-web",
      name: "Old Web thread",
      turns: [],
    });
    const { context } = await createHarness({
      officialIpc,
      threadId: "thread-web",
      renamedTitle: "Renamed Web thread",
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread/rename",
      payload: { threadId: "thread-web", title: "Renamed Web thread" },
    });

    expect(response.statusCode).toBe(200);
    expect(officialIpc.isOwnedConversation("thread-web")).toBe(true);
    expect(officialIpc.getThreadStreamState("thread-web")).toMatchObject({
      ownerClientId: "web-test",
      sourceClientId: "web-test",
      conversationState: {
        name: "Renamed Web thread",
      },
    });
  });

  it("does not rebroadcast a rename snapshot if ownership is lost during detail refresh", async () => {
    const officialIpc = createBridge();
    officialIpc.broadcastConversationSnapshot("thread-web", {
      id: "thread-web",
      name: "Old Web thread",
      turns: [],
    });
    let broadcastCount = 0;
    const originalBroadcast =
      officialIpc.broadcastConversationSnapshot.bind(officialIpc);
    (
      officialIpc as unknown as {
        broadcastConversationSnapshot: (
          threadId: string,
          conversationState: unknown,
        ) => boolean;
      }
    ).broadcastConversationSnapshot = (...args) => {
      broadcastCount += 1;
      return originalBroadcast(...args);
    };
    const { context, appServer } = await createHarness({
      officialIpc,
      threadId: "thread-web",
      renamedTitle: "Renamed Web thread",
      onThreadRead: () => applyExternalSnapshot(officialIpc, "thread-web"),
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread/rename",
      payload: { threadId: "thread-web", title: "Renamed Web thread" },
    });

    expect(response.statusCode).toBe(200);
    expect(appServer.calls).toEqual([
      {
        method: "thread/name/set",
        params: { threadId: "thread-web", name: "Renamed Web thread" },
      },
      {
        method: "thread/read",
        params: { threadId: "thread-web", includeTurns: true },
      },
    ]);
    expect(broadcastCount).toBe(0);
    expect(officialIpc.isOwnedConversation("thread-web")).toBe(false);
    expect(officialIpc.getThreadStreamState("thread-web")).toMatchObject({
      ownerClientId: "desktop-client",
      sourceClientId: "desktop-client",
      conversationState: {
        name: "Desktop owned thread",
      },
    });
  });
});
