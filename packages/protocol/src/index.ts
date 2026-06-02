import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";

export const WINDOWS_CODEX_IPC_PIPE = "\\\\.\\pipe\\codex-ipc";
export const OFFICIAL_THREAD_STREAM_CHANGED_METHOD =
  "official/thread-stream-state-changed";
export const OFFICIAL_THREAD_ARCHIVED_METHOD = "official/thread-archived";
export const OFFICIAL_THREAD_UNARCHIVED_METHOD = "official/thread-unarchived";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const RECONNECT_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 20_000;
const INITIALIZE_REQUEST_TIMEOUT_MS = 60_000;

export const IPC_METHOD_VERSIONS: Record<string, number> = {
  "thread-stream-state-changed": 6,
  "thread-read-state-changed": 1,
  "thread-archived": 2,
  "thread-unarchived": 1,
  "thread-follower-start-turn": 1,
  "thread-follower-compact-thread": 1,
  "thread-follower-steer-turn": 1,
  "thread-follower-interrupt-turn": 1,
  "thread-follower-set-model-and-reasoning": 1,
  "thread-follower-set-collaboration-mode": 1,
  "thread-follower-edit-last-user-turn": 1,
  "thread-follower-command-approval-decision": 1,
  "thread-follower-file-approval-decision": 1,
  "thread-follower-permissions-request-approval-response": 1,
  "thread-follower-submit-user-input": 1,
  "thread-follower-submit-mcp-server-elicitation-response": 1,
  "thread-follower-set-queued-follow-ups-state": 1,
  "thread-queued-followups-changed": 1,
  initialize: 0,
};

export const REQUIRED_REALTIME_FOLLOWER_METHODS = [
  "thread-follower-start-turn",
  "thread-follower-steer-turn",
  "thread-follower-interrupt-turn",
] as const;

export const OFFICIAL_FOLLOWER_METHODS = Object.freeze(
  Object.keys(IPC_METHOD_VERSIONS)
    .filter((method) => method.startsWith("thread-follower-"))
    .sort(),
);

export type AppServerNotificationImportance =
  | "important"
  | "ignored"
  | "passthrough"
  | "unknown";

export type AppServerNotificationClassification = {
  method: string;
  importance: AppServerNotificationImportance;
  shouldDriveRealtime: boolean;
};

export const IMPORTANT_APP_SERVER_NOTIFICATION_METHODS = Object.freeze([
  "error",
  "thread/started",
  "thread/name/updated",
  "thread/tokenUsage/updated",
  "turn/started",
  "hook/started",
  "turn/completed",
  "hook/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "serverRequest/resolved",
  "item/mcpToolCall/progress",
  "mcpServer/oauthLogin/completed",
  "account/updated",
  "account/rateLimits/updated",
  "app/list/updated",
  "externalAgentConfig/import/completed",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "deprecationNotice",
  "configWarning",
  "windowsSandbox/setupCompleted",
  "account/login/completed",
  "model/rerouted",
  "model/verification",
  "sessionConfigured",
  "codex/event/session_configured",
  "fuzzyFileSearch/sessionUpdated",
  "fuzzyFileSearch/sessionCompleted",
  "thread/archived",
  "thread/goal/cleared",
  "thread/goal/updated",
  "thread/unarchived",
  "skills/changed",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
  "thread/status/changed",
  "remoteControl/status/changed",
  "guardianWarning",
]);

export const PASSTHROUGH_APP_SERVER_NOTIFICATION_METHODS = Object.freeze([
  "process/outputDelta",
  "process/exited",
  "fs/changed",
]);

export const IGNORED_APP_SERVER_NOTIFICATION_METHODS = Object.freeze([
  "rawResponseItem/completed",
  "command/exec/outputDelta",
  "mcpServer/startupStatus/updated",
  "thread/compacted",
  "windows/worldWritableWarning",
  "authStatusChange",
  "loginChatGptComplete",
  "codex/event/task_started",
  "codex/event/agent_reasoning",
  "codex/event/agent_message",
  "codex/event/task_complete",
  "codex/event/mcp_tool_call_begin",
  "codex/event/mcp_tool_call_end",
  "codex/event/exec_command_begin",
  "codex/event/exec_command_end",
  "codex/event/exec_command_output_delta",
  "codex/event/exec_approval_request",
  "codex/event/apply_patch_approval_request",
  "codex/event/background_event",
  "codex/event/turn_diff",
  "codex/event/get_history_entry_response",
  "codex/event/agent_reasoning_delta",
  "codex/event/agent_reasoning_section_break",
  "codex/event/agent_message_delta",
  "codex/event/stream_error",
  "codex/event/error",
  "codex/event/turn_aborted",
  "codex/event/plan_delta",
  "codex/event/plan_update",
  "codex/event/patch_apply_begin",
  "codex/event/patch_apply_end",
  "codex/event/patch_apply_failed",
  "codex/event/exec_command_output",
  "codex/event/exec_command_exited",
  "codex/event/elicitation_request",
  "codex/event/dynamic_tool_call_request",
  "codex/event/request_user_input",
  "codex/event/terminal_interaction",
  "codex/event/token_count",
  "codex/event/deprecation_notice",
  "thread/closed",
  "thread/settings/updated",
  "warning",
]);

const IMPORTANT_APP_SERVER_NOTIFICATION_METHOD_SET = new Set(
  IMPORTANT_APP_SERVER_NOTIFICATION_METHODS,
);
const PASSTHROUGH_APP_SERVER_NOTIFICATION_METHOD_SET = new Set(
  PASSTHROUGH_APP_SERVER_NOTIFICATION_METHODS,
);
const IGNORED_APP_SERVER_NOTIFICATION_METHOD_SET = new Set(
  IGNORED_APP_SERVER_NOTIFICATION_METHODS,
);

export function classifyAppServerNotification(
  method: string,
): AppServerNotificationClassification {
  if (IMPORTANT_APP_SERVER_NOTIFICATION_METHOD_SET.has(method)) {
    return { method, importance: "important", shouldDriveRealtime: true };
  }
  if (PASSTHROUGH_APP_SERVER_NOTIFICATION_METHOD_SET.has(method)) {
    return { method, importance: "passthrough", shouldDriveRealtime: false };
  }
  if (IGNORED_APP_SERVER_NOTIFICATION_METHOD_SET.has(method)) {
    return { method, importance: "ignored", shouldDriveRealtime: false };
  }
  return { method, importance: "unknown", shouldDriveRealtime: true };
}

export type OfficialIpcFrame = Record<string, unknown>;

type PendingRequest = {
  method: string;
  resolve: (value: OfficialIpcFrame) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type OfficialIpcNotification = {
  method: string;
  params: unknown;
  atIso: string;
};

export type OfficialThreadStreamState = {
  threadId: string;
  conversationId: string;
  hostId: string;
  ownerClientId: string | null;
  sourceClientId: string | null;
  conversationState: unknown;
  changeType: "snapshot" | "patches";
  cacheVersion: number;
  updatedAtIso: string;
  isInProgress: boolean;
  activeTurnId: string;
};

type OfficialRequestHandler = {
  version: number;
  canHandle?: (params: unknown) => boolean | Promise<boolean>;
  handle: (params: unknown) => unknown | Promise<unknown>;
};

export type FollowerRequestRecord = {
  atIso: string;
  method: string;
  threadId: string;
  targetClientId: string | null;
  usedDiscovery: boolean;
  result: "pending" | "success" | "error";
  handledByClientId?: string | null;
  error?: string;
};

export type RegisteredRequestHandlerRecord = {
  method: string;
  version: number;
};

export type RawFrameRecord = {
  atIso: string;
  direction: "incoming" | "outgoing";
  byteLength: number;
  type: string;
  method: string | null;
  requestId: string | null;
  sourceClientId: string | null;
  targetClientId: string | null;
  preview: unknown;
};

export type OwnershipHandoffRecord = {
  atIso: string;
  conversationId: string;
  previousOwnerClientId: string | null;
  nextOwnerClientId: string | null;
  sourceClientId: string | null;
  reason?: string;
};

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

function readStatusString(value: unknown): string {
  const direct = readString(value);
  if (direct) return direct;
  const record = asRecord(value);
  return (
    readString(record?.type) ||
    readString(record?.status) ||
    readString(record?.state) ||
    readString(record?.kind)
  );
}

function compactStatus(value: unknown): string {
  return readStatusString(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isActiveStatus(value: unknown): boolean {
  return [
    "active",
    "inprogress",
    "running",
    "streaming",
    "thinking",
    "editing",
    "writing",
  ].includes(compactStatus(value));
}

function isTerminalStatus(value: unknown): boolean {
  return [
    "completed",
    "complete",
    "done",
    "success",
    "succeeded",
    "failed",
    "failure",
    "error",
    "interrupted",
    "interrupt",
    "canceled",
    "cancelled",
  ].includes(compactStatus(value));
}

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function compactProtocolType(value: unknown): string {
  return readString(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isContextCompactionItem(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const rawRecord = asRecord(record.raw);
  return [
    record.type,
    record.rawType,
    record.raw_type,
    rawRecord?.type,
    rawRecord?.rawType,
    rawRecord?.raw_type,
  ].some((entry) => compactProtocolType(entry) === "contextcompaction");
}

const OMIT_BROADCAST_VALUE = Symbol("omit-broadcast-value");

function sanitizeOfficialBroadcastValue(
  value: unknown,
): unknown | typeof OMIT_BROADCAST_VALUE {
  if (isContextCompactionItem(value)) return OMIT_BROADCAST_VALUE;

  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const entry of value) {
      const sanitized = sanitizeOfficialBroadcastValue(entry);
      if (sanitized === OMIT_BROADCAST_VALUE) {
        changed = true;
        continue;
      }
      if (sanitized !== entry) changed = true;
      next.push(sanitized);
    }
    return changed ? next : value;
  }

  const record = asRecord(value);
  if (!record) return value;

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    const sanitized = sanitizeOfficialBroadcastValue(entry);
    if (sanitized === OMIT_BROADCAST_VALUE) {
      changed = true;
      continue;
    }
    if (sanitized !== entry) changed = true;
    next[key] = sanitized;
  }
  return changed ? next : value;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampSeconds(value: unknown): number | null {
  const ms = timestampMs(value);
  return ms === null ? null : ms / 1000;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeDesktopArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeDesktopObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function normalizeTurnItemsView(value: unknown): "notLoaded" | "summary" | "full" {
  return value === "notLoaded" || value === "summary" || value === "full"
    ? value
    : "full";
}

function normalizeOfficialBroadcastUserInput(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const type = readString(record.type);
  if (type === "text") {
    const text = typeof record.text === "string" ? record.text : "";
    const textElements = Array.isArray(record.text_elements)
      ? record.text_elements
      : [];
    return record.text === text && record.text_elements === textElements
      ? value
      : { ...record, text, text_elements: textElements };
  }
  if (type === "image") {
    const url = typeof record.url === "string" ? record.url : "";
    return record.url === url ? value : { ...record, url };
  }
  if (type === "localImage") {
    const path = typeof record.path === "string" ? record.path : "";
    return record.path === path ? value : { ...record, path };
  }
  if (type === "skill" || type === "mention") {
    const name = typeof record.name === "string" ? record.name : "";
    const path = typeof record.path === "string" ? record.path : "";
    return record.name === name && record.path === path
      ? value
      : { ...record, name, path };
  }
  return value;
}

function normalizeOfficialBroadcastWebSearchAction(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const type = readString(record.type);
  if (!type) return value;
  let changed = false;
  const next: Record<string, unknown> = { ...record };
  if (type === "search") {
    if (typeof next.query !== "string" && next.query !== null) {
      next.query = null;
      changed = true;
    }
    if (!Array.isArray(next.queries) && next.queries !== null) {
      next.queries = null;
      changed = true;
    }
  } else if (type === "openPage") {
    if (typeof next.url !== "string" && next.url !== null) {
      next.url = null;
      changed = true;
    }
  } else if (type === "findInPage") {
    if (typeof next.url !== "string" && next.url !== null) {
      next.url = null;
      changed = true;
    }
    if (typeof next.pattern !== "string" && next.pattern !== null) {
      next.pattern = null;
      changed = true;
    }
  }
  return changed ? next : value;
}

function normalizeOfficialBroadcastThreadItem(
  value: unknown,
  context: { cwd?: unknown; turnId?: string; index?: number } = {},
): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const type = readString(record.type);
  if (!type) return value;
  let changed = false;
  const next: Record<string, unknown> = { ...record };
  if (!readString(next.id)) {
    const suffix =
      context.index === undefined ? "" : `-${String(context.index)}`;
    next.id = context.turnId ? `${context.turnId}-${type}${suffix}` : `${type}${suffix}`;
    changed = true;
  }

  if (type === "userMessage") {
    if (next.clientId === undefined) {
      next.clientId = null;
      changed = true;
    }
    const rawContent = record.content;
    if (Array.isArray(rawContent)) {
      const content = rawContent.map(normalizeOfficialBroadcastUserInput);
      if (content.some((entry, index) => entry !== rawContent[index])) {
        next.content = content;
        changed = true;
      }
    } else {
      const text = typeof record.text === "string" ? record.text : "";
      next.content = text
        ? [{ type: "text", text, text_elements: [] }]
        : [];
      changed = true;
    }
  } else if (type === "agentMessage") {
    if (typeof next.text !== "string") {
      next.text = "";
      changed = true;
    }
    if (next.phase === undefined) {
      next.phase = null;
      changed = true;
    }
    if (next.memoryCitation === undefined) {
      next.memoryCitation = null;
      changed = true;
    }
  } else if (type === "webSearch") {
    if (typeof next.query !== "string") {
      next.query = "";
      changed = true;
    }
    if (next.action === undefined) {
      next.action = null;
      changed = true;
    } else {
      const action = normalizeOfficialBroadcastWebSearchAction(next.action);
      if (action !== next.action) {
        next.action = action;
        changed = true;
      }
    }
  } else if (type === "commandExecution") {
    if (typeof next.command !== "string") {
      next.command = "";
      changed = true;
    }
    if (!readString(next.cwd)) {
      next.cwd = readString(context.cwd);
      changed = true;
    }
    if (next.processId === undefined) {
      next.processId = null;
      changed = true;
    }
    if (!readString(next.source)) {
      next.source = "agent";
      changed = true;
    }
    if (!readString(next.status)) {
      next.status = "inProgress";
      changed = true;
    }
    if (!Array.isArray(next.commandActions)) {
      next.commandActions = [];
      changed = true;
    }
    if (next.aggregatedOutput === undefined) {
      next.aggregatedOutput = null;
      changed = true;
    }
    if (next.exitCode === undefined) {
      next.exitCode = null;
      changed = true;
    }
    if (next.durationMs === undefined) {
      next.durationMs = null;
      changed = true;
    }
  } else if (type === "fileChange") {
    if (!Array.isArray(next.changes)) {
      next.changes = [];
      changed = true;
    }
    if (!readString(next.status)) {
      next.status = "inProgress";
      changed = true;
    }
  }
  return changed ? next : value;
}

function normalizeAppServerThreadStatus(value: unknown): unknown {
  const record = asRecord(value);
  if (isActiveStatus(value)) {
    const next: Record<string, unknown> = record ? { ...record } : {};
    next.type = "active";
    if (!Array.isArray(next.activeFlags)) {
      next.activeFlags = [];
    }
    return record &&
      record.type === next.type &&
      Array.isArray(record.activeFlags)
      ? value
      : next;
  }

  const status = readStatusString(value);
  if (!status) return value;
  if (!record) return { type: status };
  if (readString(record.type)) return value;
  return { ...record, type: status };
}

function looksLikeAppServerThread(record: Record<string, unknown>): boolean {
  const id = readString(record.id) || readString(record.sessionId);
  return Boolean(
    id &&
      Array.isArray(record.turns) &&
      record.status !== undefined &&
      (record.sessionId !== undefined ||
        record.createdAt !== undefined ||
        record.updatedAt !== undefined ||
        record.cwd !== undefined),
  );
}

function looksLikeAppServerTurn(record: Record<string, unknown>): boolean {
  return Boolean(
    (readString(record.id) || readString(record.turnId)) &&
      (record.startedAt !== undefined ||
        record.completedAt !== undefined ||
        record.itemsView !== undefined),
  );
}

function normalizeOfficialBroadcastTurn(
  value: unknown,
  context: { appServerThread?: boolean; cwd?: unknown } = {},
): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const isAppServerTurn =
    context.appServerThread || looksLikeAppServerTurn(record);
  let changed = false;
  const next: Record<string, unknown> = { ...record };
  const turnId = readString(record.turnId) || readString(record.turn_id);
  const id = readString(record.id);
  if (!turnId && id) {
    next.turnId = id;
    changed = true;
  }
  if (!id && turnId) {
    next.id = turnId;
    changed = true;
  }
  if (next.turnStartedAtMs === undefined) {
    const startedAtMs = timestampMs(record.startedAt ?? record.started_at);
    if (startedAtMs !== null) {
      next.turnStartedAtMs = startedAtMs;
      changed = true;
    }
  }
  if (next.turnCompletedAtMs === undefined) {
    const completedAtMs = timestampMs(record.completedAt ?? record.completed_at);
    if (completedAtMs !== null) {
      next.turnCompletedAtMs = completedAtMs;
      changed = true;
    }
  }
  if (isAppServerTurn && !isPlainObject(next.params)) {
    const params: Record<string, unknown> = {};
    if (context.cwd !== undefined) params.cwd = context.cwd;
    next.params = params;
    changed = true;
  }
  if (isAppServerTurn && !Array.isArray(next.diff)) {
    next.diff = [];
    changed = true;
  }
  if (
    isAppServerTurn &&
    !isPlainObject(next.commandExecutionStartedAtMsById)
  ) {
    next.commandExecutionStartedAtMsById = {};
    changed = true;
  }
  if (isAppServerTurn && !Array.isArray(next.hookRuns)) {
    next.hookRuns = [];
    changed = true;
  }
  if (isAppServerTurn && !Array.isArray(next.items)) {
    next.items = [];
    changed = true;
  }
  if (isAppServerTurn && next.itemsView !== normalizeTurnItemsView(next.itemsView)) {
    next.itemsView = normalizeTurnItemsView(next.itemsView);
    changed = true;
  }
  if (isAppServerTurn && next.error === undefined) {
    next.error = null;
    changed = true;
  }
  if (isAppServerTurn && next.startedAt === undefined) {
    next.startedAt = null;
    changed = true;
  }
  if (isAppServerTurn && next.completedAt === undefined) {
    next.completedAt = null;
    changed = true;
  }
  if (isAppServerTurn && next.durationMs === undefined) {
    next.durationMs = null;
    changed = true;
  }
  const rawItems = record.items;
  if (Array.isArray(rawItems)) {
    const items = rawItems
      .map((item, index) => {
        const sanitized = sanitizeOfficialBroadcastValue(item);
        if (sanitized === OMIT_BROADCAST_VALUE) return sanitized;
        return isAppServerTurn
          ? normalizeOfficialBroadcastThreadItem(sanitized, {
              cwd: context.cwd,
              turnId: readString(next.id),
              index,
            })
          : sanitized;
      })
      .filter((entry) => entry !== OMIT_BROADCAST_VALUE);
    if (items.length !== rawItems.length) changed = true;
    if (items.some((entry, index) => entry !== rawItems[index])) changed = true;
    next.items = items;
  }
  return changed ? next : value;
}

function readFirstUserText(turns: unknown): string {
  if (!Array.isArray(turns)) return "";
  for (const turnValue of turns) {
    const turn = asRecord(turnValue);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const itemValue of items) {
      const item = asRecord(itemValue);
      if (!item) continue;
      if (readString(item.type) !== "userMessage") continue;
      const content = Array.isArray(item.content) ? item.content : [];
      for (const contentValue of content) {
        const contentRecord = asRecord(contentValue);
        const text = readString(contentRecord?.text);
        if (text) return text;
      }
    }
  }
  return "";
}

function normalizeOfficialBroadcastConversationState(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const isAppServerThread = looksLikeAppServerThread(record);
  let changed = false;
  const next: Record<string, unknown> = { ...record };
  if (isAppServerThread) {
    const id = readString(record.id) || readString(record.sessionId);
    if (!readString(next.id) && id) {
      next.id = id;
      changed = true;
    }
    if (!readString(next.sessionId) && id) {
      next.sessionId = id;
      changed = true;
    }
    if (next.forkedFromId === undefined) {
      next.forkedFromId = null;
      changed = true;
    }
    if (next.parentThreadId === undefined) {
      next.parentThreadId = null;
      changed = true;
    }
    if (typeof next.preview !== "string") {
      next.preview =
        readString(record.preview) ||
        readString(record.name) ||
        readString(record.title) ||
        readFirstUserText(record.turns);
      changed = true;
    }
    if (typeof next.ephemeral !== "boolean") {
      next.ephemeral = record.ephemeral === true;
      changed = true;
    }
    if (!readString(next.modelProvider)) {
      next.modelProvider = "openai";
      changed = true;
    }
    const createdAtSeconds = timestampSeconds(record.createdAt ?? record.created_at);
    if (typeof next.createdAt !== "number" || !Number.isFinite(next.createdAt)) {
      next.createdAt = createdAtSeconds ?? Math.floor(Date.now() / 1000);
      changed = true;
    }
    const updatedAtSeconds = timestampSeconds(record.updatedAt ?? record.updated_at);
    if (typeof next.updatedAt !== "number" || !Number.isFinite(next.updatedAt)) {
      next.updatedAt = updatedAtSeconds ?? next.createdAt;
      changed = true;
    }
    if (next.path === undefined) {
      next.path = null;
      changed = true;
    }
    if (!readString(next.cwd) && readString(record.path)) {
      next.cwd = record.path;
      changed = true;
    }
    if (!readString(next.cliVersion)) {
      next.cliVersion = "";
      changed = true;
    }
    if (!readString(next.source)) {
      next.source = "appServer";
      changed = true;
    }
    if (next.agentNickname === undefined) {
      next.agentNickname = null;
      changed = true;
    }
    if (next.agentRole === undefined) {
      next.agentRole = null;
      changed = true;
    }
    if (next.gitInfo === undefined) {
      next.gitInfo = null;
      changed = true;
    }
    if (next.name === undefined) {
      next.name = readString(record.name) || readString(record.title) || null;
      changed = true;
    }
  }
  if (!readString(record.hostId) && !readString(record.host_id)) {
    next.hostId = "local";
    changed = true;
  }
  if (isAppServerThread && !readString(record.threadSource)) {
    next.threadSource = "user";
    changed = true;
  }
  if (record.status !== undefined) {
    const normalizedStatus = normalizeAppServerThreadStatus(record.status);
    if (normalizedStatus !== record.status) {
      next.status = normalizedStatus;
      changed = true;
    }
    if (record.threadRuntimeStatus === undefined) {
      next.threadRuntimeStatus = normalizedStatus;
      changed = true;
    }
  }
  if (record.threadRuntimeStatus !== undefined) {
    const normalizedRuntimeStatus = normalizeAppServerThreadStatus(
      record.threadRuntimeStatus,
    );
    if (normalizedRuntimeStatus !== record.threadRuntimeStatus) {
      next.threadRuntimeStatus = normalizedRuntimeStatus;
      changed = true;
    }
  }
  if (
    isAppServerThread &&
    next.threadRuntimeStatus === undefined &&
    record.status !== undefined
  ) {
    next.threadRuntimeStatus = normalizeAppServerThreadStatus(record.status);
    changed = true;
  }
  const rawTurns = record.turns;
  if (Array.isArray(rawTurns)) {
    const turns = rawTurns.map((turn) =>
      normalizeOfficialBroadcastTurn(turn, {
        appServerThread: isAppServerThread,
        cwd: record.cwd,
      }),
    );
    if (turns.some((turn, index) => turn !== rawTurns[index])) {
      changed = true;
    }
    next.turns = turns;
  } else if (isAppServerThread) {
    next.turns = [];
    changed = true;
  }
  if (isAppServerThread) {
    if (!Array.isArray(next.diff)) {
      next.diff = normalizeDesktopArray(next.diff);
      changed = true;
    }
    if (!Array.isArray(next.hookRuns)) {
      next.hookRuns = normalizeDesktopArray(next.hookRuns);
      changed = true;
    }
    if (!isPlainObject(next.commandExecutionStartedAtMsById)) {
      next.commandExecutionStartedAtMsById = normalizeDesktopObject(
        next.commandExecutionStartedAtMsById,
      );
      changed = true;
    }
  }
  return changed ? next : value;
}

function sanitizeConversationStateForOfficialBroadcast(
  conversationState: unknown,
): unknown {
  const sanitized = sanitizeOfficialBroadcastValue(conversationState);
  return sanitized === OMIT_BROADCAST_VALUE
    ? null
    : normalizeOfficialBroadcastConversationState(sanitized);
}

function patchPath(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (part): part is string | number =>
      typeof part === "string" || typeof part === "number",
  );
}

function getPatchParent(
  root: unknown,
  path: Array<string | number>,
): { parent: unknown; key: string | number } | null {
  if (path.length === 0) return null;
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    if (parent === null || typeof parent !== "object") return null;
    parent = (parent as Record<string, unknown>)[String(segment)];
  }
  const key = path.at(-1);
  return key === undefined ? null : { parent, key };
}

function applySingleOfficialPatch(root: unknown, patch: unknown): unknown {
  const record = asRecord(patch);
  if (!record) return root;

  const op = readString(record.op);
  const path = patchPath(record.path);

  if (path.length === 0) {
    if (op === "add" || op === "replace") return cloneJson(record.value);
    if (op === "remove") return null;
    return root;
  }

  const parentRef = getPatchParent(root, path);
  if (
    !parentRef ||
    parentRef.parent === null ||
    typeof parentRef.parent !== "object"
  )
    return root;

  const { parent, key } = parentRef;
  if (Array.isArray(parent)) {
    const index =
      typeof key === "number" ? key : Number.parseInt(String(key), 10);
    if (op === "remove") {
      if (Number.isInteger(index) && index >= 0 && index < parent.length)
        parent.splice(index, 1);
      return root;
    }
    if (op === "add") {
      if (key === "-") {
        parent.push(cloneJson(record.value));
      } else if (Number.isInteger(index)) {
        parent.splice(
          Math.max(0, Math.min(index, parent.length)),
          0,
          cloneJson(record.value),
        );
      }
      return root;
    }
    if (op === "replace" && Number.isInteger(index) && index >= 0) {
      parent[index] = cloneJson(record.value);
    }
    return root;
  }

  const objectParent = parent as Record<string, unknown>;
  const objectKey = String(key);
  if (op === "remove") {
    delete objectParent[objectKey];
  } else if (op === "add" || op === "replace") {
    objectParent[objectKey] = cloneJson(record.value);
  }
  return root;
}

export function applyOfficialIpcPatches(
  base: unknown,
  patches: unknown,
): unknown {
  if (!Array.isArray(patches)) return base;
  let next = base;
  for (const patch of patches) {
    next = applySingleOfficialPatch(next, patch);
  }
  return next;
}

export function readOfficialConversationId(params: unknown): string {
  const record = asRecord(params);
  if (!record) return "";
  const conversation = asRecord(record.conversation);
  const thread = asRecord(record.thread);
  const state = asRecord(record.conversationState) ?? asRecord(record.state);
  return (
    readString(record.conversationId) ||
    readString(record.conversation_id) ||
    readString(record.threadId) ||
    readString(record.thread_id) ||
    readString(conversation?.id) ||
    readString(conversation?.conversationId) ||
    readString(thread?.id) ||
    readString(thread?.threadId) ||
    readString(state?.conversationId) ||
    readString(state?.threadId)
  );
}

function readTurnRecordId(turn: Record<string, unknown>): string {
  return (
    readString(turn.turnId) || readString(turn.turn_id) || readString(turn.id)
  );
}

function readActiveTurnId(conversationState: unknown): string {
  const state = asRecord(conversationState);
  const turns = Array.isArray(state?.turns) ? state.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index]);
    if (!turn) continue;
    if (isActiveStatus(turn.status) || isActiveStatus(turn.state))
      return readTurnRecordId(turn);
  }
  return "";
}

function snapshotSettlesActiveTurn(
  existing: OfficialThreadStreamState,
  conversationState: unknown,
): boolean {
  const activeTurnId =
    existing.activeTurnId || readActiveTurnId(existing.conversationState);
  if (!activeTurnId) return false;
  const state = asRecord(conversationState);
  const turns = Array.isArray(state?.turns) ? state.turns : [];
  const turn = turns
    .map((value) => asRecord(value))
    .find((value) => value && readTurnRecordId(value) === activeTurnId);
  if (!turn) return false;
  return (
    isTerminalStatus(turn.status) ||
    isTerminalStatus(turn.state) ||
    isTerminalStatus(turn.threadRuntimeStatus)
  );
}

function readIsInProgress(conversationState: unknown): boolean {
  const state = asRecord(conversationState);
  if (!state) return false;
  if (state.inProgress === true) return true;
  if (isActiveStatus(state.status) || isActiveStatus(state.state)) return true;
  if (isActiveStatus(state.threadRuntimeStatus)) return true;

  const runtimeStatus = asRecord(state.threadRuntimeStatus);
  return (
    isActiveStatus(runtimeStatus) ||
    readActiveTurnId(conversationState).length > 0
  );
}

function isSuccessResponse(frame: OfficialIpcFrame): boolean {
  return (
    frame.resultType === "success" ||
    (!("resultType" in frame) && "result" in frame)
  );
}

function responseErrorMessage(
  frame: OfficialIpcFrame,
  fallback: string,
): string {
  const error = asRecord(frame.error);
  return readString(error?.message) || readString(frame.message) || fallback;
}

export class OfficialIpcBridge {
  private socket: Socket | null = null;
  private incoming = Buffer.alloc(0);
  private clientId: string | null = null;
  private connected = false;
  private connecting = false;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private listeners = new Set<(value: OfficialIpcNotification) => void>();
  private requestHandlers = new Map<string, OfficialRequestHandler>();
  private streamStates = new Map<string, OfficialThreadStreamState>();
  private ownedConversationIds = new Set<string>();
  private localOnlyOwnedConversationIds = new Set<string>();
  private followerRequestHistory: FollowerRequestRecord[] = [];
  private ownershipHandoffHistory: OwnershipHandoffRecord[] = [];
  private rawFrameLogging = false;
  private rawFrameHistory: RawFrameRecord[] = [];
  private cacheVersion = 0;
  private lastError: string | null = null;

  constructor(
    private readonly pipePath = process.platform === "win32"
      ? WINDOWS_CODEX_IPC_PIPE
      : "",
  ) {}

  start(): void {
    if (this.disposed || this.connected || this.connecting) return;
    if (!this.pipePath) {
      this.lastError = "official-ipc-not-supported";
      return;
    }

    this.connecting = true;
    const socket = connect(this.pipePath);
    this.socket = socket;

    socket.on("connect", () => {
      this.connected = true;
      this.connecting = false;
      this.lastError = null;
      this.incoming = Buffer.alloc(0);
      void this.initialize();
    });

    socket.on("data", (chunk) => {
      this.handleData(chunk);
    });

    socket.on("error", (error) => {
      this.lastError = error.message;
    });

    socket.on("close", () => {
      this.connected = false;
      this.connecting = false;
      this.socket = null;
      this.clientId = null;
      this.incoming = Buffer.alloc(0);
      for (const [requestId, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(
          new Error(`official-ipc-disconnected:${pending.method}`),
        );
        this.pendingRequests.delete(requestId);
      }
      this.scheduleReconnect();
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`official-ipc-disposed:${pending.method}`));
      this.pendingRequests.delete(requestId);
    }
    this.socket?.destroy();
    this.socket = null;
    this.listeners.clear();
    this.requestHandlers.clear();
    this.streamStates.clear();
    this.ownedConversationIds.clear();
    this.localOnlyOwnedConversationIds.clear();
  }

  onNotification(
    listener: (value: OfficialIpcNotification) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): Record<string, unknown> {
    return {
      supported: Boolean(this.pipePath),
      connected: this.connected,
      clientId: this.clientId,
      pipePath: this.pipePath || null,
      cachedConversationCount: this.streamStates.size,
      ownedConversationCount: this.ownedConversationIds.size,
      localOnlyOwnedConversationCount: this.localOnlyOwnedConversationIds.size,
      registeredRequestHandlers: this.getRegisteredRequestHandlers(),
      recentFollowerRequests: this.followerRequestHistory.slice(-20),
      recentOwnershipHandoffs: this.ownershipHandoffHistory.slice(-20),
      rawFrameLogging: this.rawFrameLogging,
      recentRawFrames: this.rawFrameHistory.slice(-40),
      lastError: this.lastError,
    };
  }

  setRawFrameLogging(enabled: boolean): void {
    this.rawFrameLogging = enabled;
    if (!enabled) this.rawFrameHistory = [];
  }

  getThreadStreamState(threadId: string): OfficialThreadStreamState | null {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return null;
    const state = this.streamStates.get(normalizedThreadId);
    return state ? cloneJson(state) : null;
  }

  getThreadStreamStateView(threadId: string): OfficialThreadStreamState | null {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return null;
    return this.streamStates.get(normalizedThreadId) ?? null;
  }

  listThreadStreamStates(): OfficialThreadStreamState[] {
    return Array.from(this.streamStates.values()).map((state) =>
      cloneJson(state),
    );
  }

  listThreadStreamStateViews(): readonly OfficialThreadStreamState[] {
    return Array.from(this.streamStates.values());
  }

  restoreThreadStreamState(state: OfficialThreadStreamState): boolean {
    const normalizedThreadId = state.threadId.trim();
    const normalizedConversationId = state.conversationId.trim();
    if (
      !normalizedThreadId ||
      !normalizedConversationId ||
      !state.conversationState
    )
      return false;
    const existing = this.streamStates.get(normalizedConversationId);
    this.cacheVersion = Math.max(this.cacheVersion, state.cacheVersion);
    this.releaseOwnedConversationIfExternal({
      conversationId: normalizedConversationId,
      previousOwnerClientId: existing?.ownerClientId ?? null,
      nextOwnerClientId: state.ownerClientId,
      sourceClientId: state.sourceClientId,
    });
    this.streamStates.set(normalizedConversationId, cloneJson(state));
    return true;
  }

  isOwnedConversation(conversationId: string): boolean {
    const normalizedConversationId = conversationId.trim();
    const state = this.streamStates.get(normalizedConversationId);
    if (
      state?.ownerClientId &&
      this.clientId &&
      state.ownerClientId !== this.clientId
    )
      return false;
    return this.ownedConversationIds.has(normalizedConversationId);
  }

  isExternallyOwnedConversation(conversationId: string): boolean {
    const normalizedConversationId = conversationId.trim();
    const state = this.streamStates.get(normalizedConversationId);
    if (!state?.ownerClientId || !this.clientId) return false;
    return (
      state.ownerClientId !== this.clientId &&
      !this.ownedConversationIds.has(normalizedConversationId)
    );
  }

  canOwnConversations(): boolean {
    return Boolean(this.clientId);
  }

  claimLocalOnlyConversation(threadId: string): boolean {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId || !this.clientId) return false;
    if (this.isExternallyOwnedConversation(normalizedThreadId)) return false;
    this.ownedConversationIds.add(normalizedThreadId);
    this.localOnlyOwnedConversationIds.add(normalizedThreadId);
    return true;
  }

  isLocalOnlyOwnedConversation(threadId: string): boolean {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return false;
    return this.localOnlyOwnedConversationIds.has(normalizedThreadId);
  }

  promoteLocalOnlyConversation(threadId: string, reason?: string): boolean {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId || !this.clientId) return false;
    if (!this.ownedConversationIds.has(normalizedThreadId)) return false;
    if (!this.localOnlyOwnedConversationIds.delete(normalizedThreadId)) {
      return false;
    }
    this.recordOwnershipHandoff({
      conversationId: normalizedThreadId,
      previousOwnerClientId: null,
      nextOwnerClientId: this.clientId,
      sourceClientId: this.clientId,
      reason,
    });
    return true;
  }

  canBroadcastOwnedConversation(threadId: string): boolean {
    const normalizedThreadId = threadId.trim();
    return (
      this.isOwnedConversation(normalizedThreadId) &&
      !this.localOnlyOwnedConversationIds.has(normalizedThreadId)
    );
  }

  registerRequestHandler(
    method: string,
    handler: Omit<OfficialRequestHandler, "version"> & { version?: number },
  ): void {
    this.requestHandlers.set(method, {
      version: handler.version ?? IPC_METHOD_VERSIONS[method] ?? 0,
      canHandle: handler.canHandle,
      handle: handler.handle,
    });
  }

  async sendThreadFollowerStartTurn(
    threadId: string,
    turnStartParams: unknown,
  ): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-start-turn",
      threadId,
      { conversationId: threadId, turnStartParams },
      ownerClientId,
    );
  }

  async sendThreadFollowerInterruptTurn(
    threadId: string,
    turnId: string,
  ): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-interrupt-turn",
      threadId,
      { conversationId: threadId, turnId },
      ownerClientId,
    );
  }

  async sendThreadFollowerSteerTurn(
    threadId: string,
    turnSteerParams: unknown,
  ): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-steer-turn",
      threadId,
      this.buildThreadFollowerSteerParams(threadId, turnSteerParams),
      ownerClientId,
    );
  }

  async sendThreadFollowerCompactThread(threadId: string): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-compact-thread",
      threadId,
      { conversationId: threadId },
      ownerClientId,
    );
  }

  private buildThreadFollowerSteerParams(
    threadId: string,
    turnSteerParams: unknown,
  ): Record<string, unknown> {
    const record = asRecord(turnSteerParams) ?? {};
    const params: Record<string, unknown> = {
      conversationId: threadId,
      input: Array.isArray(record.input) ? record.input : [],
    };
    if ("restoreMessage" in record)
      params.restoreMessage = record.restoreMessage;
    if ("attachments" in record) params.attachments = record.attachments;
    return params;
  }

  private async sendFollowerRequestWithDiscoveryRetry(
    method: string,
    threadId: string,
    params: unknown,
    ownerClientId?: string,
  ): Promise<unknown> {
    const requestRecord = this.startFollowerRequestRecord(
      method,
      threadId,
      ownerClientId,
    );
    try {
      const response = await this.sendRequest(method, params, ownerClientId);
      this.finishFollowerRequestRecord(requestRecord, "success", response);
      return response.result ?? null;
    } catch (error) {
      this.finishFollowerRequestRecord(requestRecord, "error", null, error);
      if (!this.shouldRetryFollowerViaDiscovery(method, ownerClientId, error)) {
        throw error;
      }
      const discoveryRecord = this.startFollowerRequestRecord(method, threadId);
      try {
        const response = await this.sendRequest(method, params);
        this.finishFollowerRequestRecord(discoveryRecord, "success", response);
        return response.result ?? null;
      } catch (discoveryError) {
        this.finishFollowerRequestRecord(
          discoveryRecord,
          "error",
          null,
          discoveryError,
        );
        throw discoveryError;
      }
    }
  }

  private shouldRetryFollowerViaDiscovery(
    method: string,
    ownerClientId: string | undefined,
    error: unknown,
  ): boolean {
    if (!ownerClientId) return false;
    const message = error instanceof Error ? error.message : String(error);
    return (
      message === `official-ipc-request-failed:${method}` ||
      message.includes("no-client") ||
      message.includes("client-not-found") ||
      message.includes("target-client") ||
      message.includes(`official-ipc-timeout:${method}`) ||
      message.includes(`official-ipc-disconnected:${method}`)
    );
  }

  broadcastConversationSnapshot(
    threadId: string,
    conversationState: unknown,
  ): boolean {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId || !this.clientId) return false;
    if (this.localOnlyOwnedConversationIds.has(normalizedThreadId))
      return false;
    const officialConversationState =
      sanitizeConversationStateForOfficialBroadcast(conversationState);
    this.ownedConversationIds.add(normalizedThreadId);
    this.storeThreadStreamState({
      threadId: normalizedThreadId,
      conversationId: normalizedThreadId,
      hostId: "local",
      ownerClientId: this.clientId,
      sourceClientId: this.clientId,
      conversationState: officialConversationState,
      changeType: "snapshot",
    });
    this.sendBroadcast("thread-stream-state-changed", {
      hostId: "local",
      conversationId: normalizedThreadId,
      change: {
        type: "snapshot",
        conversationState: officialConversationState,
      },
    });
    return true;
  }

  hydrateThreadStreamState(input: {
    threadId: string;
    conversationState: unknown;
    hostId?: string | null;
    ownerClientId?: string | null;
    sourceClientId?: string | null;
  }): boolean {
    const normalizedThreadId = input.threadId.trim();
    if (!normalizedThreadId || !input.conversationState) return false;
    const existing = this.streamStates.get(normalizedThreadId);
    const ownerClientId =
      input.ownerClientId ?? existing?.ownerClientId ?? null;
    const sourceClientId =
      input.sourceClientId ?? existing?.sourceClientId ?? null;
    this.releaseOwnedConversationIfExternal({
      conversationId: normalizedThreadId,
      previousOwnerClientId: existing?.ownerClientId ?? null,
      nextOwnerClientId: ownerClientId,
      sourceClientId,
    });
    this.storeThreadStreamState({
      threadId: normalizedThreadId,
      conversationId: normalizedThreadId,
      hostId: input.hostId || existing?.hostId || "local",
      ownerClientId,
      sourceClientId,
      conversationState: input.conversationState,
      changeType: "snapshot",
    });
    if (
      this.lastError ===
      `official-ipc-patches-without-snapshot:${normalizedThreadId}`
    ) {
      this.lastError = null;
    }
    return true;
  }

  releaseOwnedConversation(threadId: string, reason?: string): void {
    const normalizedThreadId = threadId.trim();
    const wasOwned = this.ownedConversationIds.delete(normalizedThreadId);
    const wasLocalOnly =
      this.localOnlyOwnedConversationIds.delete(normalizedThreadId);
    if (!wasOwned && !wasLocalOnly) return;
    const existing = this.streamStates.get(normalizedThreadId);
    this.streamStates.delete(normalizedThreadId);
    this.recordOwnershipHandoff({
      conversationId: normalizedThreadId,
      previousOwnerClientId: existing?.ownerClientId ?? this.clientId,
      nextOwnerClientId: null,
      sourceClientId: this.clientId,
      reason,
    });
  }

  discardConversationFromCache(threadId: string, reason?: string): boolean {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return false;
    const existing = this.streamStates.get(normalizedThreadId);
    const wasOwned = this.ownedConversationIds.delete(normalizedThreadId);
    const wasLocalOnly =
      this.localOnlyOwnedConversationIds.delete(normalizedThreadId);
    const deleted = this.streamStates.delete(normalizedThreadId);
    if (!existing && !wasOwned && !wasLocalOnly && !deleted) return false;
    this.recordOwnershipHandoff({
      conversationId: normalizedThreadId,
      previousOwnerClientId: existing?.ownerClientId ?? this.clientId,
      nextOwnerClientId: null,
      sourceClientId: this.clientId,
      reason,
    });
    return true;
  }

  private getRegisteredRequestHandlers(): RegisteredRequestHandlerRecord[] {
    return Array.from(this.requestHandlers.entries())
      .map(([method, handler]) => ({ method, version: handler.version }))
      .sort((left, right) => left.method.localeCompare(right.method));
  }

  private startFollowerRequestRecord(
    method: string,
    threadId: string,
    targetClientId?: string,
  ): FollowerRequestRecord {
    const record: FollowerRequestRecord = {
      atIso: new Date().toISOString(),
      method,
      threadId,
      targetClientId: targetClientId ?? null,
      usedDiscovery: !targetClientId,
      result: "pending",
    };
    this.followerRequestHistory.push(record);
    if (this.followerRequestHistory.length > 20) {
      this.followerRequestHistory.splice(
        0,
        this.followerRequestHistory.length - 20,
      );
    }
    return record;
  }

  private finishFollowerRequestRecord(
    record: FollowerRequestRecord,
    result: "success" | "error",
    response: OfficialIpcFrame | null,
    error?: unknown,
  ): void {
    record.result = result;
    record.handledByClientId = readString(response?.handledByClientId) || null;
    if (error)
      record.error = error instanceof Error ? error.message : String(error);
  }

  private getExternalOwnerClientId(threadId: string): string {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return "";
    const state = this.streamStates.get(normalizedThreadId);
    const ownerClientId = state?.ownerClientId ?? "";
    if (!ownerClientId || ownerClientId === this.clientId) return "";
    return ownerClientId;
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || !this.pipePath) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, RECONNECT_DELAY_MS);
  }

  private async initialize(): Promise<void> {
    try {
      const response = await this.sendRequest(
        "initialize",
        { clientType: "codex-web-local" },
        undefined,
        0,
        INITIALIZE_REQUEST_TIMEOUT_MS,
      );
      const result = asRecord(response.result);
      const clientId =
        readString(result?.clientId) || readString(response.handledByClientId);
      if (clientId) this.clientId = clientId;
    } catch (error) {
      this.lastError =
        error instanceof Error
          ? error.message
          : "official-ipc-initialize-failed";
    }
  }

  private handleData(chunk: Buffer): void {
    this.incoming = Buffer.concat([this.incoming, chunk]);
    while (this.incoming.length >= 4) {
      const frameLength = this.incoming.readUInt32LE(0);
      if (frameLength <= 0 || frameLength > MAX_FRAME_BYTES) {
        this.lastError = `official-ipc-invalid-frame:${frameLength}`;
        this.socket?.destroy();
        return;
      }
      if (this.incoming.length < frameLength + 4) return;
      const raw = this.incoming.subarray(4, frameLength + 4).toString("utf8");
      this.incoming = this.incoming.subarray(frameLength + 4);
      try {
        const frame = JSON.parse(raw) as OfficialIpcFrame;
        this.recordRawFrame("incoming", frame, frameLength);
        this.handleFrame(frame);
      } catch (error) {
        this.lastError =
          error instanceof Error
            ? error.message
            : "official-ipc-frame-parse-failed";
      }
    }
  }

  private handleFrame(frame: OfficialIpcFrame): void {
    const type = readString(frame.type);
    if (type === "response") {
      this.handleResponse(frame);
      return;
    }
    if (type === "broadcast") {
      this.handleBroadcast(frame);
      return;
    }
    if (type === "client-discovery-request") {
      void this.handleClientDiscoveryRequest(frame);
      return;
    }
    if (type === "request") {
      void this.handleRequest(frame);
    }
  }

  private handleResponse(frame: OfficialIpcFrame): void {
    const requestId = readString(frame.requestId);
    const pending = requestId ? this.pendingRequests.get(requestId) : null;
    if (!pending) return;
    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    if (isSuccessResponse(frame)) pending.resolve(frame);
    else
      pending.reject(
        new Error(
          responseErrorMessage(
            frame,
            `official-ipc-request-failed:${pending.method}`,
          ),
        ),
      );
  }

  private handleBroadcast(frame: OfficialIpcFrame): void {
    const method = readString(frame.method);
    if (method === "thread-stream-state-changed") {
      this.handleThreadStreamStateChanged(frame);
      return;
    }
    if (method === "thread-archived") {
      this.handleThreadArchived(frame);
      return;
    }
    if (method === "thread-unarchived") {
      this.handleThreadUnarchived(frame);
    }
  }

  private readThreadLifecycleBroadcast(frame: OfficialIpcFrame): {
    threadId: string;
    sourceClientId: string | null;
  } | null {
    const params = asRecord(frame.params);
    const threadId = readOfficialConversationId(params);
    if (!threadId) return null;
    return {
      threadId,
      sourceClientId:
        readString(frame.sourceClientId) ||
        readString(params?.sourceClientId) ||
        null,
    };
  }

  private handleThreadArchived(frame: OfficialIpcFrame): void {
    const lifecycle = this.readThreadLifecycleBroadcast(frame);
    if (!lifecycle) return;
    const existing = this.streamStates.get(lifecycle.threadId);
    const wasOwned = this.ownedConversationIds.delete(lifecycle.threadId);
    this.streamStates.delete(lifecycle.threadId);
    if (wasOwned || existing) {
      this.recordOwnershipHandoff({
        conversationId: lifecycle.threadId,
        previousOwnerClientId: existing?.ownerClientId ?? this.clientId,
        nextOwnerClientId: null,
        sourceClientId: lifecycle.sourceClientId,
        reason: "thread-archived",
      });
    }
    this.emitNotification({
      method: OFFICIAL_THREAD_ARCHIVED_METHOD,
      params: {
        threadId: lifecycle.threadId,
        conversationId: lifecycle.threadId,
        sourceClientId: lifecycle.sourceClientId,
      },
      atIso: new Date().toISOString(),
    });
  }

  private handleThreadUnarchived(frame: OfficialIpcFrame): void {
    const lifecycle = this.readThreadLifecycleBroadcast(frame);
    if (!lifecycle) return;
    this.emitNotification({
      method: OFFICIAL_THREAD_UNARCHIVED_METHOD,
      params: {
        threadId: lifecycle.threadId,
        conversationId: lifecycle.threadId,
        sourceClientId: lifecycle.sourceClientId,
      },
      atIso: new Date().toISOString(),
    });
  }

  private handleThreadStreamStateChanged(frame: OfficialIpcFrame): void {
    const params = asRecord(frame.params);
    if (!params) return;
    const hostId =
      readString(params.hostId) || readString(params.host_id) || "local";

    const conversationId = readOfficialConversationId(params);
    if (!conversationId) return;

    const change = asRecord(params.change);
    const changeType = readString(change?.type);
    const existing = this.streamStates.get(conversationId);
    const sourceClientId =
      readString(frame.sourceClientId) ||
      readString(params.sourceClientId) ||
      null;
    const ownerClientId = sourceClientId || existing?.ownerClientId || null;
    if (
      this.shouldIgnoreLocalOnlyExternalChange({
        conversationId,
        nextOwnerClientId: ownerClientId,
        sourceClientId,
      })
    ) {
      return;
    }

    let conversationState: unknown = null;
    if (changeType === "snapshot") {
      conversationState = change?.conversationState ?? null;
    } else if (changeType === "patches") {
      if (!existing) {
        this.lastError = `official-ipc-patches-without-snapshot:${conversationId}`;
        this.emitNotification({
          method: OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
          params: {
            threadId: conversationId,
            conversationId,
            hostId,
            ownerClientId,
            sourceClientId,
            changeType: "patches-without-snapshot",
            cacheVersion: this.cacheVersion,
            isInProgress: false,
            activeTurnId: "",
          },
          atIso: new Date().toISOString(),
        });
        return;
      }
      conversationState = applyOfficialIpcPatches(
        existing.conversationState,
        change?.patches,
      );
    } else {
      return;
    }
    if (!conversationState) return;
    if (
      changeType === "snapshot" &&
      this.shouldIgnoreInactiveSnapshot({
        existing,
        conversationState,
        sourceClientId,
      })
    ) {
      return;
    }
    if (
      this.shouldIgnoreOwnedActiveExternalChange({
        conversationId,
        existing,
        conversationState,
        nextOwnerClientId: ownerClientId,
        sourceClientId,
      })
    ) {
      return;
    }
    this.releaseOwnedConversationIfExternal({
      conversationId,
      previousOwnerClientId: existing?.ownerClientId ?? null,
      nextOwnerClientId: ownerClientId,
      sourceClientId,
    });

    this.storeThreadStreamState({
      threadId: conversationId,
      conversationId,
      hostId,
      ownerClientId,
      sourceClientId,
      conversationState,
      changeType: changeType === "patches" ? "patches" : "snapshot",
    });
    if (
      this.lastError ===
      `official-ipc-patches-without-snapshot:${conversationId}`
    ) {
      this.lastError = null;
    }
  }

  private shouldIgnoreInactiveSnapshot(input: {
    existing: OfficialThreadStreamState | undefined;
    conversationState: unknown;
    sourceClientId: string | null;
  }): boolean {
    if (!input.existing?.isInProgress) return false;
    if (readIsInProgress(input.conversationState)) return false;
    const conversation = asRecord(input.conversationState);
    const status = compactStatus(conversation?.status ?? conversation?.state);
    if (status === "notloaded") return true;
    if (
      input.sourceClientId &&
      input.existing.ownerClientId &&
      input.sourceClientId !== input.existing.ownerClientId
    ) {
      return !snapshotSettlesActiveTurn(
        input.existing,
        input.conversationState,
      );
    }
    return false;
  }

  private shouldIgnoreOwnedActiveExternalChange(input: {
    conversationId: string;
    existing: OfficialThreadStreamState | undefined;
    conversationState: unknown;
    nextOwnerClientId: string | null;
    sourceClientId: string | null;
  }): boolean {
    if (!this.ownedConversationIds.has(input.conversationId)) return false;
    if (!input.existing?.isInProgress) return false;
    const externalSource = Boolean(
      input.sourceClientId && input.sourceClientId !== this.clientId,
    );
    const externalOwner = Boolean(
      input.nextOwnerClientId && input.nextOwnerClientId !== this.clientId,
    );
    if (!externalSource && !externalOwner) return false;
    return !snapshotSettlesActiveTurn(input.existing, input.conversationState);
  }

  private shouldIgnoreLocalOnlyExternalChange(input: {
    conversationId: string;
    nextOwnerClientId: string | null;
    sourceClientId: string | null;
  }): boolean {
    if (!this.localOnlyOwnedConversationIds.has(input.conversationId))
      return false;
    const externalSource = Boolean(
      input.sourceClientId && input.sourceClientId !== this.clientId,
    );
    const externalOwner = Boolean(
      input.nextOwnerClientId && input.nextOwnerClientId !== this.clientId,
    );
    return externalSource || externalOwner;
  }

  private storeThreadStreamState(input: {
    threadId: string;
    conversationId: string;
    hostId: string;
    ownerClientId: string | null;
    sourceClientId: string | null;
    conversationState: unknown;
    changeType: "snapshot" | "patches";
  }): void {
    const cacheVersion = ++this.cacheVersion;
    const state: OfficialThreadStreamState = {
      ...input,
      cacheVersion,
      updatedAtIso: new Date().toISOString(),
      isInProgress: readIsInProgress(input.conversationState),
      activeTurnId: readActiveTurnId(input.conversationState),
    };
    this.streamStates.set(input.conversationId, state);
    this.emitNotification({
      method: OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
      params: {
        threadId: input.threadId,
        conversationId: input.conversationId,
        hostId: input.hostId,
        ownerClientId: input.ownerClientId,
        sourceClientId: input.sourceClientId,
        changeType: input.changeType,
        cacheVersion,
        isInProgress: state.isInProgress,
        activeTurnId: state.activeTurnId,
      },
      atIso: state.updatedAtIso,
    });
  }

  private releaseOwnedConversationIfExternal(input: {
    conversationId: string;
    previousOwnerClientId: string | null;
    nextOwnerClientId: string | null;
    sourceClientId: string | null;
  }): void {
    if (!this.ownedConversationIds.has(input.conversationId)) return;
    const externalSource = Boolean(
      input.sourceClientId && input.sourceClientId !== this.clientId,
    );
    const externalOwner = Boolean(
      input.nextOwnerClientId && input.nextOwnerClientId !== this.clientId,
    );
    if (!externalSource && !externalOwner) return;
    this.ownedConversationIds.delete(input.conversationId);
    this.localOnlyOwnedConversationIds.delete(input.conversationId);
    this.recordOwnershipHandoff(input);
  }

  private recordOwnershipHandoff(input: {
    conversationId: string;
    previousOwnerClientId: string | null;
    nextOwnerClientId: string | null;
    sourceClientId: string | null;
    reason?: string;
  }): void {
    this.ownershipHandoffHistory.push({
      atIso: new Date().toISOString(),
      conversationId: input.conversationId,
      previousOwnerClientId: input.previousOwnerClientId,
      nextOwnerClientId: input.nextOwnerClientId,
      sourceClientId: input.sourceClientId,
      reason: input.reason,
    });
    if (this.ownershipHandoffHistory.length > 20) {
      this.ownershipHandoffHistory.splice(
        0,
        this.ownershipHandoffHistory.length - 20,
      );
    }
  }

  private async handleClientDiscoveryRequest(
    frame: OfficialIpcFrame,
  ): Promise<void> {
    const requestId = readString(frame.requestId);
    if (!requestId) return;
    const method = readString(frame.method);
    const params = frame.params ?? null;
    const canHandle = await this.canHandleRequest(
      method,
      params,
      typeof frame.version === "number" ? frame.version : undefined,
    );
    this.sendFrame({
      type: "client-discovery-response",
      requestId,
      clientId: this.clientId,
      canHandle,
    });
  }

  private async handleRequest(frame: OfficialIpcFrame): Promise<void> {
    const requestId = readString(frame.requestId);
    const method = readString(frame.method);
    if (!requestId || !method) return;
    const handler = this.requestHandlers.get(method);
    const canHandle = handler
      ? await this.canHandleRequest(
          method,
          frame.params ?? null,
          typeof frame.version === "number" ? frame.version : undefined,
        )
      : false;
    if (!handler || !canHandle) {
      this.sendFrame({
        type: "response",
        requestId,
        method,
        resultType: "error",
        error: { message: `no-handler:${method}` },
      });
      return;
    }

    try {
      const result = await handler.handle(frame.params ?? null);
      this.sendFrame({
        type: "response",
        requestId,
        method,
        resultType: "success",
        result,
      });
    } catch (error) {
      this.sendFrame({
        type: "response",
        requestId,
        method,
        resultType: "error",
        error: {
          message:
            error instanceof Error ? error.message : `request-failed:${method}`,
        },
      });
    }
  }

  private async canHandleRequest(
    method: string,
    params: unknown,
    version: number | undefined,
  ): Promise<boolean> {
    const handler = this.requestHandlers.get(method);
    if (!handler) return false;
    if (typeof version === "number" && version > handler.version) return false;
    if (!handler.canHandle) return true;
    try {
      return await handler.canHandle(params);
    } catch {
      return false;
    }
  }

  private sendRequest(
    method: string,
    params: unknown,
    targetClientId?: string,
    version = IPC_METHOD_VERSIONS[method] ?? 0,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<OfficialIpcFrame> {
    if (!this.connected || !this.socket) {
      this.start();
      return Promise.reject(new Error("official-ipc-not-connected"));
    }

    const requestId = randomUUID();
    const frame: OfficialIpcFrame = {
      type: "request",
      requestId,
      method,
      version,
      params,
    };
    if (this.clientId) frame.sourceClientId = this.clientId;
    if (targetClientId) frame.targetClientId = targetClientId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`official-ipc-timeout:${method}`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { method, resolve, reject, timeout });
      try {
        this.sendFrame(frame);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(
          error instanceof Error
            ? error
            : new Error(`official-ipc-send-failed:${method}`),
        );
      }
    });
  }

  private sendBroadcast(method: string, params: unknown): void {
    if (!this.connected || !this.socket) {
      this.start();
      return;
    }
    const frame: OfficialIpcFrame = {
      type: "broadcast",
      method,
      version: IPC_METHOD_VERSIONS[method] ?? 0,
      params,
    };
    if (this.clientId) frame.sourceClientId = this.clientId;
    this.sendFrame(frame);
  }

  private sendFrame(frame: OfficialIpcFrame): void {
    if (!this.socket || !this.connected)
      throw new Error("official-ipc-not-connected");
    const payload = Buffer.from(JSON.stringify(frame), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(payload.length, 0);
    this.recordRawFrame("outgoing", frame, payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }

  private emitNotification(notification: OfficialIpcNotification): void {
    for (const listener of this.listeners) listener(notification);
  }

  private recordRawFrame(
    direction: RawFrameRecord["direction"],
    frame: OfficialIpcFrame,
    byteLength: number,
  ): void {
    if (!this.rawFrameLogging) return;
    const record: RawFrameRecord = {
      atIso: new Date().toISOString(),
      direction,
      byteLength,
      type: readString(frame.type) || "unknown",
      method: readString(frame.method) || null,
      requestId: readString(frame.requestId) || null,
      sourceClientId: readString(frame.sourceClientId) || null,
      targetClientId: readString(frame.targetClientId) || null,
      preview: this.buildRawFramePreview(frame),
    };
    this.rawFrameHistory.push(record);
    if (this.rawFrameHistory.length > 40) {
      this.rawFrameHistory.splice(0, this.rawFrameHistory.length - 40);
    }
  }

  private buildRawFramePreview(frame: OfficialIpcFrame): unknown {
    const preview = { ...frame };
    if ("params" in preview) preview.params = "[redacted]";
    if ("result" in preview) preview.result = "[redacted]";
    return preview;
  }
}
