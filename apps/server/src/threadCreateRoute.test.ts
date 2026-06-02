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

  async threadStart(params: {
    cwd: string | null;
    runtimeWorkspaceRoots?: string[];
    threadSource?: string;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/start", params });
    return {
      thread: {
        id: "thread-web-created",
        name: "Web created thread",
        cwd: params.cwd,
        updatedAt: "2026-05-29T00:00:00.000Z",
        turns: [],
      },
    };
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return { ok: true };
  }

  async threadRead(): Promise<unknown> {
    return {
      thread: {
        id: "thread-web-created",
        name: "Web created thread",
        turns: [],
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
}

type Harness = {
  context: ServerContext;
  officialIpc: OfficialIpcBridge;
  appServer: FakeAppServer;
  root: string;
};

const harnesses: Harness[] = [];

async function createHarness(
  input: { clientId?: string | null; broadcastResult?: boolean } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-thread-create-"));
  const officialIpc = new OfficialIpcBridge("");
  if (input.clientId !== null) {
    (officialIpc as unknown as { clientId: string }).clientId =
      input.clientId ?? "web-test";
  }
  if (input.broadcastResult === false) {
    (
      officialIpc as unknown as {
        broadcastConversationSnapshot: (
          threadId: string,
          conversationState: unknown,
        ) => boolean;
      }
    ).broadcastConversationSnapshot = () => false;
  }
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

describe("thread create route", () => {
  it("rejects thread creation before Web has an official IPC client id", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      clientId: null,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-create",
      payload: { cwd: "C:\\workspace\\codex_web" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "official-ipc-owner-not-ready",
    });
    expect(appServer.calls).toEqual([]);
    expect(officialIpc.isOwnedConversation("thread-web-created")).toBe(false);
  });

  it("broadcasts an idle Web-owned stream snapshot for newly created threads", async () => {
    const { context, officialIpc, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-create",
      payload: { cwd: "C:\\workspace\\codex_web" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        thread: {
          id: "thread-web-created",
          title: "Web created thread",
          projectId: "C:\\workspace\\codex_web",
        },
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "C:\\workspace\\codex_web",
          threadSource: "user",
        },
      },
    ]);
    expect(officialIpc.isOwnedConversation("thread-web-created")).toBe(true);
    expect(
      officialIpc.getThreadStreamState("thread-web-created"),
    ).toMatchObject({
      ownerClientId: "web-test",
      isInProgress: false,
      activeTurnId: "",
      conversationState: {
        id: "thread-web-created",
        status: { type: "idle" },
        threadRuntimeStatus: { type: "idle" },
        turns: [],
      },
    });
    expect(
      officialIpc.getStatus(),
    ).toMatchObject({
      ownedConversationCount: 1,
      localOnlyOwnedConversationCount: 0,
    });
  });

  it("rejects thread creation if the idle stream snapshot cannot be broadcast", async () => {
    const { context, officialIpc, appServer } = await createHarness({
      broadcastResult: false,
    });

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-create",
      payload: { cwd: "C:\\workspace\\codex_web" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "official-ipc-owner-not-established",
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "C:\\workspace\\codex_web",
          threadSource: "user",
        },
      },
    ]);
    expect(officialIpc.isOwnedConversation("thread-web-created")).toBe(false);
    expect(context.database.status()).toMatchObject({
      threadCount: 0,
      threadDetailCount: 0,
    });
    expect(context.diagnostics.list().at(-1)).toMatchObject({
      level: "warn",
      source: "thread-create",
      message: "official-ipc-owner-not-established",
      data: { threadId: "thread-web-created" },
    });
  });
});
