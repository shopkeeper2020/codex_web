import type {
  ThreadCompactStartParams,
  ThreadReadParams,
  ThreadResumeParams,
  ThreadRollbackParams,
  TurnInterruptParams,
  TurnStartParams,
  TurnSteerParams,
  ThreadSettingsUpdateParams,
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
  readonly localOnlyThreads = new Set<string>();
  readonly streamStates = new Map<string, { conversationState: unknown }>();
  readonly snapshots: Array<{ threadId: string; state: unknown }> = [];

  registerRequestHandler(method: string, handler: RegisteredHandler): void {
    this.handlers.set(method, handler);
  }

  isOwnedConversation(conversationId: string): boolean {
    return this.ownedThreads.has(conversationId);
  }

  canBroadcastOwnedConversation(conversationId: string): boolean {
    return !this.localOnlyThreads.has(conversationId);
  }

  getThreadStreamState(threadId: string): { conversationState: unknown } | null {
    return this.streamStates.get(threadId) ?? null;
  }

  broadcastConversationSnapshot(
    threadId: string,
    conversationState: unknown,
  ): void {
    this.streamStates.set(threadId, { conversationState });
    this.snapshots.push({ threadId, state: conversationState });
  }
}

class FakeAppServer implements LocalOwnerAppServer {
  notifications = new Set<
    Parameters<LocalOwnerAppServer["onNotification"]>[0]
  >();
  calls: Array<{ method: string; params: unknown }> = [];
  threadReadResult: unknown = { thread: { id: "thread-1", title: "Thread" } };
  threadTurnsListResult: unknown = { turns: [] };

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

  async threadTurnsList(params: {
    threadId: string;
    cursor?: string | null;
    limit?: number | null;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/turns/list", params });
    return this.threadTurnsListResult;
  }

  async threadCompactStart(params: ThreadCompactStartParams): Promise<unknown> {
    this.calls.push({ method: "thread/compact/start", params });
    return { compacted: true };
  }

  async threadSettingsUpdate(
    params: ThreadSettingsUpdateParams,
  ): Promise<unknown> {
    this.calls.push({ method: "thread/settings/update", params });
    return {};
  }

  async threadResume(params: ThreadResumeParams): Promise<unknown> {
    this.calls.push({ method: "thread/resume", params });
    return {};
  }

  async threadRollback(params: ThreadRollbackParams): Promise<unknown> {
    this.calls.push({ method: "thread/rollback", params });
    return {};
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
    permissions: null,
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

  it("relays edit-last-user-turn through rollback and replacement start", async () => {
    const { officialIpc, appServer, dispose } = installFakes();
    officialIpc.ownedThreads.add("thread-1");
    officialIpc.streamStates.set("thread-1", {
      conversationState: {
        id: "thread-1",
        turns: [
          {
            turnId: "turn-last",
            status: "completed",
            params: {
              input: [
                { type: "text", text: "original", text_elements: [] },
                { type: "skill", name: "docs", path: "C:\\skill\\SKILL.md" },
              ],
              model: "gpt-test",
            },
          },
        ],
      },
    });
    try {
      const editHandler = officialIpc.handlers.get(
        "thread-follower-edit-last-user-turn",
      );

      expect(editHandler).toBeTruthy();
      expect(
        await editHandler?.canHandle?.({ conversationId: "thread-1" }),
      ).toBe(true);
      await expect(
        editHandler?.handle({
          conversationId: "thread-1",
          turnId: "turn-last",
          message: "edited",
        }),
      ).resolves.toEqual({ started: true });

      expect(appServer.calls).toEqual([
        {
          method: "thread/resume",
          params: { threadId: "thread-1" },
        },
        {
          method: "thread/rollback",
          params: { threadId: "thread-1", numTurns: 1 },
        },
        {
          method: "turn/start",
          params: {
            clientUserMessageId: expect.any(String),
            threadId: "thread-1",
            input: [
              { type: "text", text: "edited", text_elements: [] },
              { type: "skill", name: "docs", path: "C:\\skill\\SKILL.md" },
            ],
            model: "gpt-test",
          },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("updates Web-owned runtime settings through official app-server", async () => {
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
          method: "thread/settings/update",
          params: {
            threadId: "thread-1",
            model: "gpt-runtime",
            effort: "high",
          },
        },
        {
          method: "thread/settings/update",
          params: {
            threadId: "thread-1",
            collaborationMode: {
              mode: "plan",
              settings: { developer_instructions: null },
            },
          },
        },
        {
          method: "thread/resume",
          params: { threadId: "thread-1" },
        },
        {
          method: "turn/start",
          params: {
            threadId: "thread-1",
            input: [{ type: "text", text: "use runtime settings" }],
          },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("preserves explicit turn-start runtime options", async () => {
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

  it("broadcasts debounced snapshots for local owner lifecycle events", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    try {
      appServer.emit("item/completed", {
        threadId: "thread-1",
      });
      appServer.emit("item/completed", {
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

  it("does not use token deltas to drive official full snapshots", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    try {
      appServer.emit("item/agentMessage/delta", {
        threadId: "thread-1",
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([]);
      expect(officialIpc.snapshots).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("keeps side conversation metadata on later local owner snapshots", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("side-thread-1");
    officialIpc.streamStates.set("side-thread-1", {
      conversationState: {
        id: "side-thread-1",
        sideConversation: true,
        ephemeral: true,
        parentThreadId: "parent-thread",
        parentConversationId: "parent-thread",
        forkedFromId: "parent-thread",
        turns: [],
      },
    });
    appServer.threadReadResult = {
      thread: {
        id: "side-thread-1",
        title: "Side",
        turns: [{ id: "turn-1", items: [] }],
      },
    };
    try {
      appServer.emit("item/completed", {
        threadId: "side-thread-1",
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(officialIpc.snapshots).toEqual([
        {
          threadId: "side-thread-1",
          state: {
            id: "side-thread-1",
            title: "Side",
            sideConversation: true,
            ephemeral: true,
            parentThreadId: "parent-thread",
            parentConversationId: "parent-thread",
            forkedFromId: "parent-thread",
            turns: [{ id: "turn-1", items: [] }],
          },
        },
      ]);
    } finally {
      dispose();
    }
  });

  it("reads ephemeral side conversation turns through the turns-list API", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("side-thread-1");
    officialIpc.streamStates.set("side-thread-1", {
      conversationState: {
        id: "side-thread-1",
        sideConversation: true,
        ephemeral: true,
        parentThreadId: "parent-thread",
        turns: [],
      },
    });
    appServer.threadRead = vi.fn(async (params: ThreadReadParams) => {
      appServer.calls.push({ method: "thread/read", params });
      if (params.includeTurns) {
        throw new Error("ephemeral threads do not support includeTurns");
      }
      return {
        thread: {
          id: "side-thread-1",
          title: "南京呢?",
          cwd: "C:\\workspace\\codex_web",
        },
      };
    });
    appServer.threadTurnsListResult = {
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [{ type: "userMessage", content: [{ text: "南京呢?" }] }],
        },
      ],
    };
    try {
      appServer.emit("turn/completed", {
        threadId: "side-thread-1",
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([
        {
          method: "thread/read",
          params: { threadId: "side-thread-1", includeTurns: true },
        },
        {
          method: "thread/read",
          params: { threadId: "side-thread-1", includeTurns: false },
        },
        {
          method: "thread/turns/list",
          params: { threadId: "side-thread-1", cursor: null, limit: null },
        },
      ]);
      expect(officialIpc.snapshots).toEqual([
        {
          threadId: "side-thread-1",
          state: {
            id: "side-thread-1",
            title: "南京呢?",
            cwd: "C:\\workspace\\codex_web",
            sideConversation: true,
            ephemeral: true,
            parentThreadId: "parent-thread",
            parentConversationId: "parent-thread",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  { type: "userMessage", content: [{ text: "南京呢?" }] },
                ],
              },
            ],
          },
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
      appServer.emit("item/completed", {
        conversationId: "thread-1",
      });
      await vi.advanceTimersByTimeAsync(10);

      expect(appServer.calls).toEqual([]);
      expect(officialIpc.snapshots).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("does not broadcast snapshots for local-only Web-owned threads", async () => {
    vi.useFakeTimers();
    const { officialIpc, appServer, dispose } = installFakes({
      debounceMs: 10,
    });
    officialIpc.ownedThreads.add("thread-1");
    officialIpc.localOnlyThreads.add("thread-1");
    try {
      appServer.emit("item/completed", {
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
      appServer.emit("item/completed", {
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
      appServer.emit("item/completed", {
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
