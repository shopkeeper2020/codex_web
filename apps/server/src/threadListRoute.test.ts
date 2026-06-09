import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type {
  CodexAppServerProcess,
  ThreadListParams,
  ThreadSearchParams,
} from "./appServerProcess.js";

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

  async threadList(params: ThreadListParams = {}): Promise<unknown> {
    this.calls.push({ method: "thread/list", params });
    return {
      data: [
        {
          id: params.cursor ? "thread-page-2" : "thread-page-1",
          name: params.cursor ? "Page 2" : "Page 1",
          cwd: "C:\\workspace\\codex_web",
          updatedAt: "2026-05-29T00:00:00.000Z",
        },
      ],
      nextCursor: params.cursor ? null : "cursor-1",
      backwardsCursor: null,
    };
  }

  async threadSearch(params: ThreadSearchParams): Promise<unknown> {
    this.calls.push({ method: "thread/search", params });
    return {
      data: [
        {
          thread: {
            id: "thread-search-1",
            name: "Search Hit",
            cwd: "C:\\workspace\\codex_web",
            updatedAt: "2026-05-29T00:00:00.000Z",
          },
          snippet: "matched snippet",
        },
      ],
      nextCursor: null,
      backwardsCursor: null,
    };
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

function applyExternalActiveSnapshot(
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
          name: "Page 1",
          threadRuntimeStatus: { type: "active" },
          turns: [
            {
              turnId: "turn-active",
              status: "inProgress",
              items: [],
            },
          ],
        },
      },
    },
  });
}

async function createHarness(officialIpc = createBridge()): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-thread-list-"));
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

describe("thread list route", () => {
  it("passes cursor pagination through to the official app-server", async () => {
    const { context, appServer } = await createHarness();

    const firstResponse = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread/list?limit=1&archived=false",
    });
    const secondResponse = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread/list?limit=1&archived=false&cursor=cursor-1",
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toMatchObject({
      data: {
        threads: [{ id: "thread-page-1", title: "Page 1" }],
        nextCursor: "cursor-1",
      },
    });
    expect(secondResponse.json()).toMatchObject({
      data: {
        threads: [{ id: "thread-page-2", title: "Page 2" }],
        nextCursor: null,
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/list",
        params: {
          archived: false,
          limit: 1,
          cursor: null,
          sortKey: "updated_at",
          modelProviders: [],
        },
      },
      {
        method: "thread/list",
        params: {
          archived: false,
          limit: 1,
          cursor: "cursor-1",
          sortKey: "updated_at",
          modelProviders: [],
        },
      },
    ]);
  });

  it("overlays official live stream progress onto app-server thread list rows", async () => {
    const officialIpc = createBridge();
    applyExternalActiveSnapshot(officialIpc, "thread-page-1");
    const { context } = await createHarness(officialIpc);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread/list?limit=1&archived=false",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        threads: [
          {
            id: "thread-page-1",
            title: "Page 1",
            inProgress: true,
            owner: {
              clientId: "desktop-client",
              source: "official-ipc",
            },
          },
        ],
      },
    });
  });

  it("overlays locally pinned state onto official thread list rows", async () => {
    const { context } = await createHarness();
    context.database.setThreadPinned("thread-page-1", true);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread/list?limit=1&archived=false",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        threads: [{ id: "thread-page-1", pinned: true }],
      },
    });
  });

  it("searches threads through the official app-server", async () => {
    const { context, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "GET",
      url: "/api/domain/thread/search?searchTerm=weather&archived=false&limit=9",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        results: [
          {
            thread: { id: "thread-search-1", title: "Search Hit" },
            snippet: "matched snippet",
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/search",
        params: {
          searchTerm: "weather",
          archived: false,
          limit: 9,
          cursor: null,
          sortKey: "updated_at",
          sortDirection: "desc",
        },
      },
    ]);
  });
});
