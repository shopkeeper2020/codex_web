import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realtimeEventSchema, type RealtimeEvent } from "@codex-web/api";
import {
  OFFICIAL_THREAD_ARCHIVED_METHOD,
  OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
  OFFICIAL_THREAD_UNARCHIVED_METHOD,
  type OfficialIpcBridge,
  type OfficialIpcNotification,
} from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";
import type { PublishedServerEvent } from "./events.js";

class FakeOfficialIpc {
  private listener: ((notification: OfficialIpcNotification) => void) | null =
    null;
  readonly hydratedThreadStreamStates: Array<{
    threadId: string;
    conversationState: unknown;
    hostId?: string | null;
    ownerClientId?: string | null;
    sourceClientId?: string | null;
  }> = [];

  setRawFrameLogging(): void {}

  onNotification(listener: (notification: OfficialIpcNotification) => void) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  start(): void {}

  dispose(): void {}

  restoreThreadStreamState(): boolean {
    return true;
  }

  registerRequestHandler(): void {}

  isOwnedConversation(): boolean {
    return false;
  }

  isExternallyOwnedConversation(): boolean {
    return false;
  }

  getThreadStreamState(): null {
    return null;
  }

  hydrateThreadStreamState(input: {
    threadId: string;
    conversationState: unknown;
    hostId?: string | null;
    ownerClientId?: string | null;
    sourceClientId?: string | null;
  }): boolean {
    this.hydratedThreadStreamStates.push(input);
    return true;
  }

  getStatus(): Record<string, unknown> {
    return {
      supported: true,
      connected: true,
      clientId: "web-test",
      registeredRequestHandlers: [],
      cachedConversationCount: 0,
      ownedConversationCount: 0,
      recentFollowerRequests: [],
      recentOwnershipHandoffs: [],
      rawFrameLogging: false,
      recentRawFrames: [],
      lastError: null,
    };
  }

  emit(method: string, params: unknown): void {
    this.listener?.({
      method,
      params,
      atIso: "2026-05-29T00:00:00.000Z",
    });
  }
}

class FakeAppServer {
  readonly threadReadCalls: Array<{ threadId: string; includeTurns?: boolean }> =
    [];
  threadReadResult: unknown = {
    id: "thread-hydrated",
    turns: [{ id: "turn-1", status: "active" }],
  };

  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  async threadRead(params: {
    threadId: string;
    includeTurns?: boolean;
  }): Promise<unknown> {
    this.threadReadCalls.push(params);
    return this.threadReadResult;
  }

  dispose(): void {}
}

type Harness = {
  context: ServerContext;
  officialIpc: FakeOfficialIpc;
  appServer: FakeAppServer;
  root: string;
};

type InjectedWebSocket = {
  on(event: "message", listener: (data: { toString(): string }) => void): void;
  terminate(): void;
};

type WebSocketInjectingApp = ServerContext["app"] & {
  injectWS(
    path: string,
    upgradeContext?: Record<string, unknown>,
    options?: { onInit?: (ws: InjectedWebSocket) => void },
  ): Promise<InjectedWebSocket>;
};

const harnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-official-events-"));
  const officialIpc = new FakeOfficialIpc();
  const appServer = new FakeAppServer();
  const context = await createServer(root, {
    officialIpc: officialIpc as unknown as OfficialIpcBridge,
    appServer: appServer as unknown as CodexAppServerProcess,
  });
  const harness = { context, officialIpc, appServer, root };
  harnesses.push(harness);
  return harness;
}

async function injectWebSocket(
  context: ServerContext,
  onInit: (ws: InjectedWebSocket) => void,
): Promise<InjectedWebSocket> {
  await context.app.ready();
  return (context.app as WebSocketInjectingApp).injectWS(
    "/api/realtime",
    {
      socket: { remoteAddress: "127.0.0.1" },
    },
    { onInit },
  );
}

function createJsonMessageQueue(): {
  attach: (ws: InjectedWebSocket) => void;
  next: () => Promise<unknown>;
} {
  const messages: unknown[] = [];
  const waiters: Array<{
    resolve: (message: unknown) => void;
    reject: (error: Error) => void;
  }> = [];

  function push(message: unknown): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(message);
      return;
    }
    messages.push(message);
  }

  return {
    attach: (ws) => {
      ws.on("message", (data) => {
        push(JSON.parse(data.toString()));
      });
    },
    next: () => {
      const message = messages.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for websocket message"));
        }, 1000);
        timeout.unref?.();
        waiters.push({
          resolve: (nextMessage) => {
            clearTimeout(timeout);
            resolve(nextMessage);
          },
          reject,
        });
      });
    },
  };
}

function parseNextRealtimeEvent(queue: {
  next: () => Promise<unknown>;
}): Promise<RealtimeEvent> {
  return queue.next().then((message) => realtimeEventSchema.parse(message));
}

async function waitFor(
  predicate: () => boolean,
  message = "timed out waiting for condition",
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (!harness) continue;
    await harness.context.app.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

describe("official IPC realtime events", () => {
  it("publishes passive archive and unarchive notifications to the server event bus", async () => {
    const { context, officialIpc } = await createHarness();
    const events: PublishedServerEvent[] = [];
    const unsubscribe = context.bus.subscribe((event) => events.push(event));

    officialIpc.emit(OFFICIAL_THREAD_ARCHIVED_METHOD, {
      threadId: "thread-archived",
      sourceClientId: "desktop-client",
    });
    officialIpc.emit(OFFICIAL_THREAD_UNARCHIVED_METHOD, {
      conversationId: "thread-archived",
      sourceClientId: "desktop-client",
    });
    unsubscribe();

    expect(events).toEqual([
      expect.objectContaining({
        type: "official.threadArchived",
        payload: {
          threadId: "thread-archived",
          sourceClientId: "desktop-client",
        },
      }),
      expect.objectContaining({
        type: "official.threadUnarchived",
        payload: {
          conversationId: "thread-archived",
          sourceClientId: "desktop-client",
        },
      }),
    ]);
    expect(Number(events[1]?.sequence)).toBeGreaterThan(
      Number(events[0]?.sequence),
    );
  });

  it("streams schema-valid realtime events over the websocket route", async () => {
    const { context, officialIpc } = await createHarness();
    const messages = createJsonMessageQueue();
    const ws = await injectWebSocket(context, messages.attach);
    try {
      const connected = await parseNextRealtimeEvent(messages);
      expect(connected).toMatchObject({ type: "connected" });

      const archiveMessage = parseNextRealtimeEvent(messages);
      officialIpc.emit(OFFICIAL_THREAD_ARCHIVED_METHOD, {
        conversationId: "thread-ws",
        sourceClientId: "desktop-client",
      });

      const archived = await archiveMessage;
      expect(archived).toMatchObject({
        type: "official.threadArchived",
        payload: {
          conversationId: "thread-ws",
          sourceClientId: "desktop-client",
        },
        sequence: expect.any(Number),
      });
    } finally {
      ws.terminate();
    }
  });

  it("hydrates the official stream cache when patches arrive without a snapshot", async () => {
    const { appServer, context, officialIpc } = await createHarness();
    const events: PublishedServerEvent[] = [];
    const unsubscribe = context.bus.subscribe((event) => events.push(event));
    const hydratedThread = {
      id: "thread-needs-snapshot",
      turns: [{ id: "turn-live", status: "active" }],
    };
    appServer.threadReadResult = { thread: hydratedThread };

    officialIpc.emit(OFFICIAL_THREAD_STREAM_CHANGED_METHOD, {
      threadId: "thread-needs-snapshot",
      hostId: "desktop-host",
      ownerClientId: "desktop-owner",
      sourceClientId: "desktop-source",
      changeType: "patches-without-snapshot",
      cacheVersion: 3,
    });

    await waitFor(
      () => officialIpc.hydratedThreadStreamStates.length === 1,
      "timed out waiting for official stream hydration",
    );
    unsubscribe();

    expect(appServer.threadReadCalls).toEqual([
      { threadId: "thread-needs-snapshot", includeTurns: true },
    ]);
    expect(officialIpc.hydratedThreadStreamStates).toEqual([
      {
        threadId: "thread-needs-snapshot",
        conversationState: hydratedThread,
        hostId: "desktop-host",
        ownerClientId: "desktop-owner",
        sourceClientId: "desktop-source",
      },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "official.threadStreamStateChanged",
        payload: expect.objectContaining({
          threadId: "thread-needs-snapshot",
          changeType: "patches-without-snapshot",
        }),
      }),
    );
  });
});
