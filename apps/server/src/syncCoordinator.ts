import { readOfficialConversationId } from "@codex-web/protocol";
import type {
  ThreadCompactStartParams,
  ThreadReadParams,
  TurnInterruptParams,
  TurnStartParams,
  TurnSteerParams,
} from "./appServerProcess.js";
import { startLocalTurn } from "./threadActions.js";

type RequestHandler = {
  canHandle?: (params: unknown) => boolean | Promise<boolean>;
  handle: (params: unknown) => unknown | Promise<unknown>;
};

export type LocalOwnerOfficialIpc = {
  registerRequestHandler(method: string, handler: RequestHandler): void;
  isOwnedConversation(conversationId: string): boolean;
  broadcastConversationSnapshot(
    threadId: string,
    conversationState: unknown,
  ): void;
};

export type LocalOwnerAppServer = {
  onNotification(
    listener: (notification: {
      method: string;
      params: unknown;
      atIso?: string;
    }) => void,
  ): () => void;
  rpc(method: string, params?: unknown): Promise<unknown>;
  threadRead(params: ThreadReadParams): Promise<unknown>;
  threadCompactStart(params: ThreadCompactStartParams): Promise<unknown>;
  turnStart(params: TurnStartParams): Promise<unknown>;
  turnSteer(params: TurnSteerParams): Promise<unknown>;
  turnInterrupt(params: TurnInterruptParams): Promise<unknown>;
};

type SyncDiagnostics = {
  record(
    level: "info" | "warn" | "error",
    source: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
};

type LocalOwnerEventBus = {
  subscribe(
    listener: (event: {
      type: string;
      approval?: { threadId?: string | null };
    }) => void,
  ): () => void;
};

type LocalOwnerRuntimeSettings = {
  model?: string;
  effort?: string;
  collaborationMode?: Record<string, unknown>;
};

export const LOCAL_OWNER_SNAPSHOT_DEBOUNCE_MS = 650;
export const LOCAL_OWNER_SNAPSHOT_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "thread/name/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

function readThreadIdFromParams(value: unknown): string {
  const record = asRecord(value);
  if (!record) return "";
  return (
    readString(record.threadId) ||
    readString(record.thread_id) ||
    readString(record.conversationId)
  );
}

function readReasoningEffort(record: Record<string, unknown> | null): string {
  return (
    readString(record?.reasoningEffort) ||
    readString(record?.reasoning_effort) ||
    readString(record?.effort)
  );
}

function applyRuntimeSettings(
  turnStartParams: Record<string, unknown>,
  runtimeSettings: LocalOwnerRuntimeSettings | undefined,
): Record<string, unknown> {
  if (!runtimeSettings) return turnStartParams;
  const next = { ...turnStartParams };
  if (runtimeSettings.model && !readString(next.model)) {
    next.model = runtimeSettings.model;
  }
  if (runtimeSettings.effort && !readString(next.effort)) {
    next.effort = runtimeSettings.effort;
  }
  if (runtimeSettings.collaborationMode && !asRecord(next.collaborationMode)) {
    next.collaborationMode = runtimeSettings.collaborationMode;
  }
  return next;
}

export function installLocalOwnerSnapshotSync(input: {
  appServer: LocalOwnerAppServer;
  officialIpc: LocalOwnerOfficialIpc;
  diagnostics: SyncDiagnostics;
  events?: LocalOwnerEventBus;
  debounceMs?: number;
}): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<string>();
  const runtimeSettingsByThread = new Map<string, LocalOwnerRuntimeSettings>();
  const debounceMs = input.debounceMs ?? LOCAL_OWNER_SNAPSHOT_DEBOUNCE_MS;

  input.officialIpc.registerRequestHandler("thread-follower-start-turn", {
    canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
    handle: async (params) => {
      const record = asRecord(params);
      const threadId = readOfficialConversationId(record);
      if (!threadId) throw new Error("Missing conversationId");
      if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
      const turnStartParams = applyRuntimeSettings(
        asRecord(record?.turnStartParams) ?? {},
        runtimeSettingsByThread.get(threadId),
      );
      return await startLocalTurn(input.appServer, {
        ...turnStartParams,
        threadId,
        input: Array.isArray(turnStartParams.input)
          ? turnStartParams.input
          : [],
      });
    },
  });

  input.officialIpc.registerRequestHandler(
    "thread-follower-set-model-and-reasoning",
    {
      canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
      handle: async (params) => {
        const record = asRecord(params);
        const threadId = readOfficialConversationId(record);
        if (!threadId) throw new Error("Missing conversationId");
        if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
        const model = readString(record?.model);
        const effort = readReasoningEffort(record);
        if (!model && !effort) {
          throw new Error("Missing model or reasoningEffort");
        }
        const previous = runtimeSettingsByThread.get(threadId) ?? {};
        runtimeSettingsByThread.set(threadId, {
          ...previous,
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
        });
        return { ok: true };
      },
    },
  );

  input.officialIpc.registerRequestHandler(
    "thread-follower-set-collaboration-mode",
    {
      canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
      handle: async (params) => {
        const record = asRecord(params);
        const threadId = readOfficialConversationId(record);
        if (!threadId) throw new Error("Missing conversationId");
        if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
        const collaborationMode = asRecord(record?.collaborationMode);
        if (!collaborationMode) throw new Error("Missing collaborationMode");
        const previous = runtimeSettingsByThread.get(threadId) ?? {};
        runtimeSettingsByThread.set(threadId, {
          ...previous,
          collaborationMode,
        });
        return { ok: true };
      },
    },
  );

  input.officialIpc.registerRequestHandler("thread-follower-interrupt-turn", {
    canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
    handle: async (params) => {
      const record = asRecord(params);
      const threadId = readOfficialConversationId(record);
      const turnId = readString(record?.turnId) || readString(record?.turn_id);
      if (!threadId) throw new Error("Missing conversationId");
      if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
      if (!turnId) throw new Error("Missing turnId");
      return await input.appServer.turnInterrupt({ threadId, turnId });
    },
  });

  input.officialIpc.registerRequestHandler("thread-follower-steer-turn", {
    canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
    handle: async (params) => {
      const record = asRecord(params);
      const threadId = readOfficialConversationId(record);
      if (!threadId) throw new Error("Missing conversationId");
      if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
      const turnSteerParams = asRecord(record?.turnSteerParams) ?? record ?? {};
      return await input.appServer.turnSteer({
        threadId,
        expectedTurnId: readString(turnSteerParams.expectedTurnId),
        input: Array.isArray(turnSteerParams.input)
          ? turnSteerParams.input
          : [],
      });
    },
  });

  input.officialIpc.registerRequestHandler("thread-follower-compact-thread", {
    canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
    handle: async (params) => {
      const threadId = readOfficialConversationId(params);
      if (!threadId) throw new Error("Missing conversationId");
      if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
      const result = await input.appServer.threadCompactStart({ threadId });
      schedule(threadId);
      return result;
    },
  });

  function clearLocalOwnerState(threadId: string): void {
    runtimeSettingsByThread.delete(threadId);
  }

  function isLocalOwner(threadId: string): boolean {
    const owned = input.officialIpc.isOwnedConversation(threadId);
    if (!owned) clearLocalOwnerState(threadId);
    return owned;
  }

  async function broadcastSnapshot(threadId: string): Promise<void> {
    if (!isLocalOwner(threadId)) return;
    if (inFlight.has(threadId)) {
      schedule(threadId);
      return;
    }
    inFlight.add(threadId);
    try {
      const result = await input.appServer.threadRead({
        threadId,
        includeTurns: true,
      });
      const record = asRecord(result);
      const thread = asRecord(record?.thread);
      if (!thread) return;
      if (!isLocalOwner(threadId)) return;
      input.officialIpc.broadcastConversationSnapshot(threadId, thread);
    } catch (error) {
      input.diagnostics.record(
        "warn",
        "official-ipc",
        "local-owner-snapshot-failed",
        {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    } finally {
      inFlight.delete(threadId);
    }
  }

  function schedule(threadId: string): void {
    if (!isLocalOwner(threadId)) return;
    if (timers.has(threadId)) return;
    const timer = setTimeout(() => {
      timers.delete(threadId);
      void broadcastSnapshot(threadId);
    }, debounceMs);
    timer.unref?.();
    timers.set(threadId, timer);
  }

  const unsubscribe = input.appServer.onNotification((notification) => {
    if (!LOCAL_OWNER_SNAPSHOT_METHODS.has(notification.method)) return;
    const threadId = readThreadIdFromParams(notification.params);
    if (!threadId) return;
    if (!input.officialIpc.isOwnedConversation(threadId)) return;
    schedule(threadId);
  });
  const unsubscribeEvents = input.events?.subscribe((event) => {
    if (
      event.type !== "approval.requested" &&
      event.type !== "approval.resolved"
    )
      return;
    const threadId = readString(event.approval?.threadId);
    if (!threadId) return;
    if (!input.officialIpc.isOwnedConversation(threadId)) return;
    schedule(threadId);
  });

  return () => {
    unsubscribe();
    unsubscribeEvents?.();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    inFlight.clear();
    runtimeSettingsByThread.clear();
  };
}
