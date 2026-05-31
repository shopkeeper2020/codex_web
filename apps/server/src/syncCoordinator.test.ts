import type {
  ThreadCompactStartParams,
  ThreadReadParams,
  TurnInterruptParams,
  TurnStartParams,
  TurnSteerParams,
} from "./appServerProcess.js";
import {
  installLocalOwnerSnapshotSync,
  type LocalOwnerAppServer,
  type LocalOwnerOfficialIpc,
} from "./syncCoordinator.js";
import { EventBus } from "./events.js";
import { afterEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = Parameters<
  LocalOwnerOfficialIpc["registerRequestHandler"]
>[1];

class FakeOfficialIpc implements LocalOwnerOfficialIpc {
  readonly handlers = new Map<string, RegisteredHandler>();
  readonly ownedThreads = new Set<string>();
  readonly snapshots: Array<{ threadId: string; state: unknown }> = [];

  registerRequestHandler(method: string, handler: RegisteredHandler): void {
    this.handlers.set(method, handler);
  }

  isOwnedConversation(conversationId: string): boolean {
    return this.ownedThreads.has(conversationId);
  }

  broadcastConversationSnapshot(
    threadId: string,
    conversationState: unknown,
  ): void {
    this.snapshots.push({ threadId, state: conversationState });
  }
}

class FakeAppServer implements LocalOwnerAppServer {
  notifications = new Set<
    Parameters<LocalOwnerAppServer["onNotification"]>[0]
  >();
  calls: Array<{ method: string; params: unknown }> = [];
  threadReadResult: unknown = { thread: { id: "thread-1", title: "Thread" } };

  onNotification(
    listener: Parameters<LocalOwnerAppServer["onNotification"]>[0],
  ): () => void {
    this.notifications.add(listener);
    return () => {
      this.notifications.delete(listener);
    };
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.notifications) {
      listener({ method, params, atIso: new Date().toISOString() });
    }
  }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return { ok: true };
  }

  async threadRead(params: ThreadReadParams): Promise<unknown> {
    this.calls.push({ method: "thread/read", params });
    return this.threadReadResult;
  }

  async threadCompactStart(params: ThreadCompactStartParams): Promise<unknown> {
    this.calls.push({ method: "thread/compact/start", params });
    return { compacted: true };
  }

  async turnStart(params: TurnStartParams): Promise<unknown> {
    this.calls.push({ method: "turn/start", params });
    return { started: true };
  }

  async turnSteer(params: TurnSteerParams): Promise<unknown> {
    this.calls.push({ method: "turn/steer", params });
    return { steered: true };
  }

  async turnInterrupt(params: TurnInterruptParams): Promise<unknown> {
    this.calls.push({ method: "turn/interrupt", params });
    return { interrupted: true };
  }
}

function installFakes(options: { debounceMs?: number } = {}): {
  officialIpc: FakeOfficialIpc;
  appServer: FakeAppServer;
  diagnostics: { events: unknown[] };
  dispose: () => void;
} {
  const officialIpc = new FakeOfficialIpc();
  const appServer = new FakeAppServer();
  const diagnostics = {
    events: [] as unknown[],
    record: vi.fn((...args: unknown[]) => diagnostics.events.push(args)),
  };
  const dispose = installLocalOwnerSnapshotSync({
    officialIpc,
    appServer,
    diagnostics,
    debounceMs: options.debounceMs,
  });
  return { officialIpc, appServer, diagnostics, dispose };
}

function pendingApproval(threadId: string) {
  return {
    id: `approval-${threadId}`,
    kind: "command" as const,
    method: "item/commandExecution/requestApproval",
    threadId,
    turnId: "turn-1",
    itemId: "item-1",
    title: "批准命令执行",
    body: "pnpm test",
    command: "pnpm test",
    cwd: "C:\\workspace\\codex_web",
    reason: null,
    grantRoot: null,
    filePath: null,
    diff: null,
    changedFiles: null,
    proposedExecpolicyAmendment: null,
    createdAtIso: "2026-05-29T00:00:00.000Z",
    status: "pending" as const,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("local owner sync coordinator", () => {
  it("registers follower handlers and relays start, steer, interrupt and compact to the local app-server", async () => {
    const { officialIpc, appServer, dispose } = installFakes();
    officialIpc.ownedThreads.add("thread-1");
    try {
      const startHandler = officialIpc.handlers.get(
        "thread-follower-start-turn",
      );
      const steerHandler = officialIpc.handlers.get(
        "thread-follower-steer-turn",
      );
      const interruptHandler = officialIpc.handlers.get(
        "thread-follower-interrupt-turn",
      );
      const compactHandler = officialIpc.handlers.get(
        "thread-follower-compact-thread",
      );

      expect(startHandler).toBeTruthy();
      expect(steerHandler).toBeTruthy();
      expect(interruptHandler).toBeTruthy();
      expect(compactHandler).toBeTruthy();
      expect(
        await startHandler?.canHandle?.({ conversationId: "thread-1" }),
      ).toBe(true);
      expect(
        await compactHandler?.canHandle?.({ conversationId: "thread-1" }),
      ).toBe(true);

      await expect(
        startHandler?.handle({
          conversationId: "thread-1",
          turnStartParams: {
            input: [{ type: "text", text: "hello" }],
            model: "gpt-test",
          },
        }),
      ).resolves.toEqual({ started: true });
      await expect(
        steerHandler?.handle({
          conversationId: "thread-1",
          expectedTurnId: "turn-1",
          input: [{ type: "text", text: "guide" }],
          restoreMessage: { text: "guide" },
        }),
      ).resolves.toEqual({ steered: true });
      await expect(
        interruptHandler?.handle({
          conversationId: "thread-1",
          turnId: "turn-1",
        }),
      ).resolves.toEqual({ interrupted: true });
      await expect(
        compactHandler?.handle({
          conversationId: "thread-1",
        }),
      ).resolves.toEqual({ compacted: true });

      expect(appServer.calls).toEqual([
        {
          method: "thread/resume",
          params: { threadId: "thread-1" },
        },
        {
          method: "turn/start",
          params: {
            threadId: "thread-1",
            input: [{ type: "text", text: "hello" }],
            model: "gpt-test",
          },
        },
        {
          method: "turn/steer",
          params: {
            threadId: "thread-1",
            expectedTurnId: "turn-1",
            input: [{ type: "text", text: "guide" }],
          },
        },
        {
          method: "turn/interrupt",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
          },
        },
        {
          method: "thread/compact/start",
          params: {
            threadId: "thread-1",
          },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("stores Web-owned runtime settings from follower owner-state handlers", async () => {
    const { officialIpc, appServer, dispose } = installFakes();
    officialIpc.ownedThreads.add("thread-1");
    try {
      const modelHandler = officialIpc.handlers.get(
        "thread-follower-set-model-and-reasoning",
      );
      const collaborationHandler = officialIpc.handlers.get(
        "thread-follower-set-collaboration-mode",
      );
      const startHandler = officialIpc.handlers.get(
        "thread-follower-start-turn",
      );

      expect(modelHandler).toBeTruthy();
      expect(collaborationHandler).toBeTruthy();
      expect(
        await modelHandler?.canHandle?.({ conversationId: "thread-1" }),
      ).toBe(true);

      await expect(
        modelHandler?.handle({
          conversationId: "thread-1",
          model: "gpt-runtime",
          reasoningEffort: "high",
        }),
      ).resolves.toEqual({ ok: true });
      await expect(
        collaborationHandler?.handle({
          conversationId: "thread-1",
          collaborationMode: {
            mode: "plan",
            settings: { developer_instructions: null },
          },
        }),
      ).resolves.toEqual({ ok: true });
      await expect(
        startHandler?.handle({
          conversationId: "thread-1",
          turnStartParams: {
            input: [{ type: "text", text: "use runtime settings" }],
          },
        }),
      ).resolves.toEqual({ started: true });

      expect(appServer.calls).toEqual([
        {
          method: "thread/resume",
          params: { threadId: "thread-1" },
        },
        {
          method: "turn/start",
          params: {
            threadId: "thread-1",
            input: [{ type: "text", text: "use runtime settings" }],
            model: "gpt-runtime",
            effort: "high",
            collaborationMode: {
              mode: "plan",
              settings: { developer_instructions: null },
            },
          },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("clears cached runtime settings after local ownership is lost", async () => {
    const { officialIpc, appServer, dispose } = installFakes();
    officialIpc.ownedThreads.add("thread-1");
    try {
      const modelHandler = officialIpc.handlers.get(
        "thread-follower-set-model-and-reasoning",
      );
      const collaborationHandler = officialIpc.handlers.get(
        "thread-follower-set-collaboration-mode",
      );
      const startHandler = officialIpc.handlers.get(
        "thread-follower-start-turn",
      );

      await modelHandler?.handle({
        conversationId: "thread-1",
        model: "gpt-stale",
        reasoningEffort: "high",
      });
      await collaborationHandler?.handle({
        conversationId: "thread-1",
        collaborationMode: { mode: "plan" },
      });

      officialIpc.ownedThreads.delete("thread-1");
      expect(
        await startHandler?.canHandle?.({ conversationId: "thread-1" }),
      ).toBe(false);
      await expect(
        startHandler?.handle({
          conversationId: "thread-1",
          turnStartParams: { input: [] },
        }),
      ).rejects.toThrow("no-local-owner");

      officialIpc.ownedThreads.add("thread-1");
      appServer.calls = [];
      await expect(
        startHandler?.handle({
          conversationId: "thread-1",
          turnStartParams: {
            input: [{ type: "text", text: "fresh owner" }],
          },
        }),
      ).resolves.toEqual({ started: true });

      expect(appServer.calls).toEqual([
        {
          method: "thread/resume",
          params: { threadId: "thread-1" },
        },
        {
          method: "turn/start",
          params: {
            threadId: "thread-1",
            input: [{ type: "text", text: "fresh owner" }],
          },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("keeps explicit turn-start runtime options ahead of cached owner settings", async () => {
    const { officialIpc, appServer, dispose } = installFakes();
    officialIpc.ownedThreads.add("thread-1");
    try {
      const modelHandler = officialIpc.handlers.get(
        "thread-follower-set-model-and-reasoning",
      );
      const collaborationHandler = officialIpc.handlers.get(
        "thread-follower-set-collaboration-mode",
      );
      const startHandler = officialIpc.handlers.get(
        "thread-follower-start-turn",
      );

      await modelHandler?.handle({
        conversationId: "thread-1",
        model: "gpt-cached",
        reasoningEffort: "high",
      });
      await collaborationHandler?.handle({
        conversationId: "thread-1",
        collaborationMode: { mode: "plan" },
      });
      await expect(
        startHandler?.handle({
          conversationId: "thread-1",
          turnStartParams: {
            input: [{ type: "text", text: "explicit wins" }],
            model: "gpt-explicit",
            effort: "low",
            collaborationMode: { mode: "default" },
          },
        }),
      ).resolves.toEqual({ started: true });

      expect(appServer.calls.at(-1)).toEqual({
        method: "turn/start",
        params: {
          threadId: "thread-1",
          input: [{ type: "text", text: "explicit wins" }],
          model: "gpt-explicit",
          effort: "low",
          collaborationMode: { mode: "default" },
        },
      });
    } finally {
      dispose();
    }
  });

  it("broadcasts debounced snapshots for local owner app-server stream events", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    try {
      appServer.emit("item/agentMessage/delta", {
        threadId: "thread-1",
      });
      appServer.emit("item/agentMessage/delta", {
        threadId: "thread-1",
      });

      expect(officialIpc.snapshots).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([
        {
          method: "thread/read",
          params: { threadId: "thread-1", includeTurns: true },
        },
      ]);
      expect(officialIpc.snapshots).toEqual([
        {
          threadId: "thread-1",
          state: { id: "thread-1", title: "Thread" },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("does not broadcast local snapshots without confirmed Web ownership", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    try {
      appServer.emit("item/agentMessage/delta", {
        conversationId: "thread-1",
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([]);
      expect(officialIpc.snapshots).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("does not broadcast a queued snapshot after Web ownership is lost during debounce", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    try {
      appServer.emit("item/agentMessage/delta", {
        conversationId: "thread-1",
      });
      officialIpc.ownedThreads.delete("thread-1");
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([]);
      expect(officialIpc.snapshots).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("does not broadcast a snapshot if Web ownership is lost while reading the thread", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    appServer.threadRead = vi.fn(async (params: ThreadReadParams) => {
      appServer.calls.push({ method: "thread/read", params });
      officialIpc.ownedThreads.delete("thread-1");
      return { thread: { id: "thread-1", title: "Thread" } };
    });
    try {
      appServer.emit("item/agentMessage/delta", {
        conversationId: "thread-1",
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([
        {
          method: "thread/read",
          params: { threadId: "thread-1", includeTurns: true },
        },
      ]);
      expect(officialIpc.snapshots).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("broadcasts snapshots when local approvals are requested and resolved", async () => {
    vi.useFakeTimers();
    const officialIpc = new FakeOfficialIpc();
    const appServer = new FakeAppServer();
    const diagnostics = {
      events: [] as unknown[],
      record: vi.fn((...args: unknown[]) => diagnostics.events.push(args)),
    };
    const bus = new EventBus();
    const dispose = installLocalOwnerSnapshotSync({
      officialIpc,
      appServer,
      diagnostics,
      events: bus,
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    try {
      bus.publish({
        type: "approval.requested",
        approval: pendingApproval("thread-1"),
      });
      await vi.advanceTimersByTimeAsync(10);
      bus.publish({
        type: "approval.resolved",
        approval: pendingApproval("thread-1"),
        decision: "accept",
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([
        {
          method: "thread/read",
          params: { threadId: "thread-1", includeTurns: true },
        },
        {
          method: "thread/read",
          params: { threadId: "thread-1", includeTurns: true },
        },
      ]);
      expect(officialIpc.snapshots).toEqual([
        {
          threadId: "thread-1",
          state: { id: "thread-1", title: "Thread" },
        },
        {
          threadId: "thread-1",
          state: { id: "thread-1", title: "Thread" },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("does not broadcast approval snapshots without confirmed Web ownership", async () => {
    vi.useFakeTimers();
    const officialIpc = new FakeOfficialIpc();
    const appServer = new FakeAppServer();
    const diagnostics = {
      events: [] as unknown[],
      record: vi.fn((...args: unknown[]) => diagnostics.events.push(args)),
    };
    const bus = new EventBus();
    const dispose = installLocalOwnerSnapshotSync({
      officialIpc,
      appServer,
      diagnostics,
      events: bus,
      debounceMs: 10,
    });
    try {
      bus.publish({
        type: "approval.requested",
        approval: pendingApproval("thread-1"),
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([]);
      expect(officialIpc.snapshots).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("records diagnostics when a local snapshot read fails", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, diagnostics, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    appServer.threadRead = vi.fn(async () => {
      throw new Error("read failed");
    });
    try {
      appServer.emit("turn/completed", { thread_id: "thread-1" });
      await vi.advanceTimersByTimeAsync(10);

      expect(diagnostics.events).toEqual([
        [
          "warn",
          "official-ipc",
          "local-owner-snapshot-failed",
          { threadId: "thread-1", error: "read failed" },
        ],
      ]);
    } finally {
      dispose();
    }
  });
});
