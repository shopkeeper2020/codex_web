import { readOfficialConversationId } from "@codex-web/protocol";
import type {
  ThreadCompactStartParams,
  ThreadReadParams,
  ThreadResumeParams,
  ThreadRollbackParams,
  ThreadTurnsListParams,
  ThreadSettingsUpdateParams,
  TurnInterruptParams,
  TurnStartParams,
  TurnSteerParams,
} from "./appServerProcess.js";
import { IMPORTANT_APP_SERVER_NOTIFICATION_METHODS } from "@codex-web/protocol";
import { toOfficialTurnSteerParams } from "./appServerParams.js";
import { editLocalLastUserTurn, startLocalTurn } from "./threadActions.js";

type RequestHandler = {
  canHandle?: (params: unknown) => boolean | Promise<boolean>;
  handle: (params: unknown) => unknown | Promise<unknown>;
};

export type LocalOwnerOfficialIpc = {
  registerRequestHandler(method: string, handler: RequestHandler): void;
  isOwnedConversation(conversationId: string): boolean;
  getThreadStreamState?(threadId: string): { conversationState: unknown } | null;
  canBroadcastOwnedConversation?(conversationId: string): boolean;
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
  threadTurnsList?: (params: ThreadTurnsListParams) => Promise<unknown>;
  threadCompactStart(params: ThreadCompactStartParams): Promise<unknown>;
  threadSettingsUpdate(params: ThreadSettingsUpdateParams): Promise<unknown>;
  threadResume(params: ThreadResumeParams): Promise<unknown>;
  threadRollback(params: ThreadRollbackParams): Promise<unknown>;
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

export const LOCAL_OWNER_SNAPSHOT_DEBOUNCE_MS = 120;
const LOCAL_OWNER_LIVE_DELTA_METHODS = new Set([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
]);
export const LOCAL_OWNER_SNAPSHOT_METHODS = new Set(
  IMPORTANT_APP_SERVER_NOTIFICATION_METHODS.filter(
    (method) => !LOCAL_OWNER_LIVE_DELTA_METHODS.has(method),
  ),
);
export const LOCAL_OWNER_IMMEDIATE_SNAPSHOT_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "hook/started",
  "hook/completed",
  "thread/status/changed",
  "thread/name/updated",
  "item/started",
  "item/completed",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "serverRequest/resolved",
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

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isEphemeralIncludeTurnsError(error: unknown): boolean {
  return errorMessage(error).includes(
    "ephemeral threads do not support includeTurns",
  );
}

function readTurnsFromListResult(value: unknown): unknown[] {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  const thread = asRecord(record?.thread);
  if (Array.isArray(record?.turns)) return record.turns;
  if (Array.isArray(data?.turns)) return data.turns;
  if (Array.isArray(thread?.turns)) return thread.turns;
  if (Array.isArray(value)) return value;
  return [];
}

async function listThreadTurns(
  appServer: Pick<LocalOwnerAppServer, "rpc" | "threadTurnsList">,
  threadId: string,
): Promise<unknown[]> {
  const result = appServer.threadTurnsList
    ? await appServer.threadTurnsList({ threadId, cursor: null, limit: null })
    : await appServer.rpc("thread/turns/list", {
        threadId,
        cursor: null,
        limit: null,
      });
  return readTurnsFromListResult(result);
}

export async function readAppServerThreadSnapshot(
  appServer: Pick<LocalOwnerAppServer, "rpc" | "threadRead" | "threadTurnsList">,
  threadId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await appServer.threadRead({
      threadId,
      includeTurns: true,
    });
    return asRecord(asRecord(result)?.thread) ?? asRecord(result);
  } catch (error) {
    if (!isEphemeralIncludeTurnsError(error)) throw error;
  }

  const metadataResult = await appServer.threadRead({
    threadId,
    includeTurns: false,
  });
  const metadataThread =
    asRecord(asRecord(metadataResult)?.thread) ?? asRecord(metadataResult);
  if (!metadataThread) return null;
  const turns = await listThreadTurns(appServer, threadId);
  return { ...metadataThread, turns };
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

const SIDE_CONVERSATION_PRESERVED_FIELDS = [
  "sideConversation",
  "ephemeral",
  "parentConversationId",
  "parentThreadId",
  "sourceConversationId",
  "sourceThreadId",
  "mainConversationId",
  "mainThreadId",
  "rootConversationId",
  "rootThreadId",
  "originConversationId",
  "originThreadId",
  "forkedFromId",
  "forkedFromConversationId",
  "forkedFromThreadId",
];

export function preserveSideConversationMetadata(input: {
  threadId: string;
  conversationState: unknown;
  existingState: { conversationState: unknown } | null;
}): unknown {
  const record = asRecord(input.conversationState);
  const previous = asRecord(input.existingState?.conversationState);
  if (!record || previous?.sideConversation !== true) {
    return input.conversationState;
  }

  const next: Record<string, unknown> = {
    ...record,
    sideConversation: true,
  };
  for (const field of SIDE_CONVERSATION_PRESERVED_FIELDS) {
    if (next[field] !== undefined && next[field] !== null) continue;
    if (previous[field] !== undefined && previous[field] !== null) {
      next[field] = previous[field];
    }
  }
  if (!readString(next.parentThreadId)) {
    next.parentThreadId =
      readString(previous.parentThreadId) ||
      readString(previous.forkedFromId) ||
      null;
  }
  if (!readString(next.parentConversationId)) {
    next.parentConversationId = next.parentThreadId ?? null;
  }
  return next;
}

function readReasoningEffort(record: Record<string, unknown> | null): string {
  return (
    readString(record?.reasoningEffort) ||
    readString(record?.reasoning_effort) ||
    readString(record?.effort)
  );
}

async function updateThreadSettings(input: {
  appServer: LocalOwnerAppServer;
  threadId: string;
  settings: Omit<ThreadSettingsUpdateParams, "threadId">;
}): Promise<void> {
  await input.appServer.threadSettingsUpdate({
    threadId: input.threadId,
    ...input.settings,
  });
}

export function installLocalOwnerSnapshotSync(input: {
  appServer: LocalOwnerAppServer;
  officialIpc: LocalOwnerOfficialIpc;
  diagnostics: SyncDiagnostics;
  events?: LocalOwnerEventBus;
  debounceMs?: number;
}): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const timerDueAt = new Map<string, number>();
  const inFlight = new Set<string>();
  const debounceMs = input.debounceMs ?? LOCAL_OWNER_SNAPSHOT_DEBOUNCE_MS;

  input.officialIpc.registerRequestHandler("thread-follower-start-turn", {
    canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
    handle: async (params) => {
      const record = asRecord(params);
      const threadId = readOfficialConversationId(record);
      if (!threadId) throw new Error("Missing conversationId");
      if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
      const turnStartParams = asRecord(record?.turnStartParams) ?? {};
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
        await updateThreadSettings({
          appServer: input.appServer,
          threadId,
          settings: {
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
          },
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
        await updateThreadSettings({
          appServer: input.appServer,
          threadId,
          settings: { collaborationMode },
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
      return await input.appServer.turnSteer(
        toOfficialTurnSteerParams({
          ...turnSteerParams,
          threadId,
          expectedTurnId: readString(turnSteerParams.expectedTurnId),
          input: Array.isArray(turnSteerParams.input)
            ? turnSteerParams.input
            : [],
        } as TurnSteerParams),
      );
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

  input.officialIpc.registerRequestHandler(
    "thread-follower-edit-last-user-turn",
    {
      canHandle: (params) => isLocalOwner(readOfficialConversationId(params)),
      handle: async (params) => {
        const record = asRecord(params);
        const threadId = readOfficialConversationId(record);
        if (!threadId) throw new Error("Missing conversationId");
        if (!isLocalOwner(threadId)) throw new Error("no-local-owner");
        const turnId = readString(record?.turnId) || readString(record?.turn_id);
        const message = readString(record?.message);
        if (!turnId) throw new Error("Missing turnId");
        if (!message) throw new Error("Missing message");
        const streamState = input.officialIpc.getThreadStreamState?.(threadId);
        const conversationState =
          streamState?.conversationState ??
          asRecord(await input.appServer.threadRead({ threadId, includeTurns: true }))
            ?.thread;
        const result = await editLocalLastUserTurn(input.appServer, {
          threadId,
          turnId,
          message,
          conversationState,
        });
        schedule(threadId);
        return result;
      },
    },
  );

  function isLocalOwner(threadId: string): boolean {
    return input.officialIpc.isOwnedConversation(threadId);
  }

  function canBroadcastLocalOwner(threadId: string): boolean {
    if (!isLocalOwner(threadId)) return false;
    return input.officialIpc.canBroadcastOwnedConversation?.(threadId) ?? true;
  }

  async function broadcastSnapshot(threadId: string): Promise<void> {
    if (!canBroadcastLocalOwner(threadId)) return;
    if (inFlight.has(threadId)) {
      schedule(threadId);
      return;
    }
    inFlight.add(threadId);
    try {
      const thread = await readAppServerThreadSnapshot(
        input.appServer,
        threadId,
      );
      if (!thread) return;
      if (!canBroadcastLocalOwner(threadId)) return;
      input.officialIpc.broadcastConversationSnapshot(
        threadId,
        preserveSideConversationMetadata({
          threadId,
          conversationState: thread,
          existingState:
            input.officialIpc.getThreadStreamState?.(threadId) ?? null,
        }),
      );
    } catch (error) {
      input.diagnostics.record(
        "warn",
        "official-ipc",
        "local-owner-snapshot-failed",
        {
          threadId,
          error: errorMessage(error),
        },
      );
    } finally {
      inFlight.delete(threadId);
    }
  }

  function schedule(threadId: string, delayMs = debounceMs): void {
    if (!canBroadcastLocalOwner(threadId)) return;
    const delay = Math.max(0, delayMs);
    const dueAt = Date.now() + delay;
    const existingTimer = timers.get(threadId);
    if (existingTimer) {
      const existingDueAt = timerDueAt.get(threadId) ?? Number.POSITIVE_INFINITY;
      if (existingDueAt <= dueAt) return;
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      timers.delete(threadId);
      timerDueAt.delete(threadId);
      void broadcastSnapshot(threadId);
    }, delay);
    timer.unref?.();
    timers.set(threadId, timer);
    timerDueAt.set(threadId, dueAt);
  }

  const unsubscribe = input.appServer.onNotification((notification) => {
    if (!LOCAL_OWNER_SNAPSHOT_METHODS.has(notification.method)) return;
    const threadId = readThreadIdFromParams(notification.params);
    if (!threadId) return;
    if (!canBroadcastLocalOwner(threadId)) return;
    schedule(
      threadId,
      LOCAL_OWNER_IMMEDIATE_SNAPSHOT_METHODS.has(notification.method)
        ? 0
        : debounceMs,
    );
  });
  const unsubscribeEvents = input.events?.subscribe((event) => {
    if (
      event.type !== "approval.requested" &&
      event.type !== "approval.resolved"
    )
      return;
    const threadId = readString(event.approval?.threadId);
    if (!threadId) return;
    if (!canBroadcastLocalOwner(threadId)) return;
    schedule(threadId, 0);
  });

  return () => {
    unsubscribe();
    unsubscribeEvents?.();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    timerDueAt.clear();
    inFlight.clear();
  };
}
