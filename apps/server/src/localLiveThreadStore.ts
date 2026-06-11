import type {
  MessageItem,
  Owner,
  ThreadDetail,
  Turn,
} from "@codex-web/domain";
import { normalizeMessageItem } from "@codex-web/domain";

type AppServerNotificationLike = {
  method: string;
  params: unknown;
  atIso?: string;
};

export type LocalLiveThreadUpdate = {
  threadId: string;
  detail: ThreadDetail;
  source: "app-server-live";
  cacheVersion?: number;
  isInProgress: boolean;
  activeTurnId: string;
};

export type LocalLiveThreadStoreOptions = {
  isLocalOwner: (threadId: string) => boolean;
  readInitialDetail: (threadId: string) => ThreadDetail | null;
  readOwner: (threadId: string) => Owner | null;
};

type LiveThreadState = {
  detail: ThreadDetail;
  activeTurnId: string;
  cacheVersion: number;
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

function readItemType(value: unknown): string {
  return readString(asRecord(value)?.type);
}

function readDeltaString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cloneDetail(detail: ThreadDetail): ThreadDetail {
  return JSON.parse(JSON.stringify(detail)) as ThreadDetail;
}

function readTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const record = asRecord(entry);
        return (
          readString(record?.text) ||
          readString(record?.content) ||
          readString(record?.value) ||
          readTextContent(record?.content)
        );
      })
      .filter(Boolean)
      .join("\n");
  }
  const record = asRecord(value);
  if (!record) return "";
  return (
    readString(record.text) ||
    readTextContent(record.content) ||
    readTextContent(record.input)
  );
}

function compactStatus(value: unknown): string {
  const direct = readString(value);
  if (direct) return direct.toLowerCase().replace(/[\s_-]+/g, "");
  const record = asRecord(value);
  return (
    readString(record?.type) ||
    readString(record?.status) ||
    readString(record?.state) ||
    readString(record?.kind)
  )
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function readTurnStatus(value: unknown): Turn["status"] {
  const status = compactStatus(value);
  if (["active", "inprogress", "running", "streaming"].includes(status))
    return "active";
  if (["completed", "complete", "done", "success", "succeeded"].includes(status))
    return "completed";
  if (["failed", "failure", "error"].includes(status)) return "failed";
  if (["interrupted", "interrupt", "canceled", "cancelled"].includes(status))
    return "interrupted";
  if (["idle", "notloaded"].includes(status)) return "idle";
  return "unknown";
}

function isActiveStatus(value: unknown): boolean {
  return ["active", "inprogress", "running", "streaming"].includes(
    compactStatus(value),
  );
}

function readThreadIdFromParams(value: unknown): string {
  const record = asRecord(value);
  if (!record) return "";
  const thread = asRecord(record.thread);
  return (
    readString(record.threadId) ||
    readString(record.thread_id) ||
    readString(record.conversationId) ||
    readString(thread?.id) ||
    readString(thread?.threadId)
  );
}

function readTurnIdFromParams(value: unknown): string {
  const record = asRecord(value);
  const turn = asRecord(record?.turn);
  return (
    readString(record?.turnId) ||
    readString(record?.turn_id) ||
    readString(turn?.id) ||
    readString(turn?.turnId)
  );
}

function readItemIdFromParams(value: unknown): string {
  const record = asRecord(value);
  const item = asRecord(record?.item);
  return readString(record?.itemId) || readString(record?.item_id) || readString(item?.id);
}

function itemIndex(turn: Turn, itemId: string): number {
  return turn.items.findIndex((item) => item.id === itemId);
}

function normalizedUserText(item: MessageItem): string {
  const record = asRecord(item);
  const type = readString(record?.type);
  if (type === "userMessage") return readTextContent(record?.content).replace(/\s+/g, " ").trim();
  if (type === "user") return readTextContent(record?.text).replace(/\s+/g, " ").trim();
  return "";
}

function duplicateUserItemIndex(items: MessageItem[], item: MessageItem): number {
  const itemType = readItemType(item);
  if (itemType !== "userMessage" && itemType !== "user") return -1;
  const text = normalizedUserText(item);
  return items.findIndex((entry) => {
    const entryType = readItemType(entry);
    if (entryType !== "userMessage" && entryType !== "user") return false;
    if (entry.id === item.id) return true;
    return text.length > 0 && normalizedUserText(entry) === text;
  });
}

const OFFICIAL_ITEM_TYPES_WITH_STATUS = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "imageGeneration",
]);

function markItemStarted(item: MessageItem): MessageItem {
  const record = asRecord(item);
  const type = readString(record?.type);
  if (!OFFICIAL_ITEM_TYPES_WITH_STATUS.has(type)) return item;
  const status = readString(record?.status);
  if (!status || status === "unknown") {
    return { ...item, status: "inProgress" } as MessageItem;
  }
  return item;
}

function jsonValueScore(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 1;
  }
}

function richerValue(incomingValue: unknown, currentValue: unknown): unknown {
  if (incomingValue === null || incomingValue === undefined) return currentValue;
  if (currentValue === null || currentValue === undefined) return incomingValue;
  return jsonValueScore(currentValue) > jsonValueScore(incomingValue)
    ? currentValue
    : incomingValue;
}

function mergeMessagePhase(incomingValue: unknown, currentValue: unknown): unknown {
  if (incomingValue === "final_answer" || currentValue !== "final_answer") {
    return incomingValue ?? currentValue;
  }
  return currentValue;
}

function mergeOfficialItemFields(
  merged: Record<string, unknown>,
  currentRecord: Record<string, unknown> | null,
  incomingRecord: Record<string, unknown> | null,
): void {
  const currentType = readString(currentRecord?.type);
  const incomingType = readString(incomingRecord?.type);
  if (currentType === "agentMessage" && incomingType === "agentMessage") {
    if ("phase" in (currentRecord ?? {}) || "phase" in (incomingRecord ?? {})) {
      merged.phase = mergeMessagePhase(incomingRecord?.phase, currentRecord?.phase);
    }
    if ("memoryCitation" in (currentRecord ?? {}) || "memoryCitation" in (incomingRecord ?? {})) {
      merged.memoryCitation = richerValue(
        incomingRecord?.memoryCitation,
        currentRecord?.memoryCitation,
      );
    }
  }
  if (currentType === "webSearch" && incomingType === "webSearch") {
    if ("action" in (currentRecord ?? {}) || "action" in (incomingRecord ?? {})) {
      merged.action = richerValue(incomingRecord?.action, currentRecord?.action);
    }
  }
}

function mergeItem(current: MessageItem, incoming: MessageItem): MessageItem {
  const currentRecord = asRecord(current);
  const incomingRecord = asRecord(incoming);
  const merged = { ...currentRecord, ...incomingRecord } as Record<string, unknown>;
  const currentType = readString(currentRecord?.type);
  const incomingType = readString(incomingRecord?.type);
  if (
    currentType === "agentMessage" &&
    incomingType === "agentMessage" &&
    !readTextContent(incomingRecord?.text) &&
    readTextContent(currentRecord?.text)
  ) {
    merged.text = readTextContent(currentRecord?.text);
  }
  if (
    currentType === "commandExecution" &&
    incomingType === "commandExecution" &&
    !readTextContent(incomingRecord?.aggregatedOutput) &&
    readTextContent(currentRecord?.aggregatedOutput)
  ) {
    merged.aggregatedOutput = currentRecord?.aggregatedOutput;
  }
  mergeOfficialItemFields(merged, currentRecord, incomingRecord);
  return merged as MessageItem;
}

export class LocalLiveThreadStore {
  private readonly states = new Map<string, LiveThreadState>();

  constructor(private readonly options: LocalLiveThreadStoreOptions) {}

  clear(threadId: string): void {
    this.states.delete(threadId);
  }

  handle(notification: AppServerNotificationLike): LocalLiveThreadUpdate | null {
    const threadId = readThreadIdFromParams(notification.params);
    if (!threadId) return null;
    const shouldTrack =
      this.options.isLocalOwner(threadId) || this.states.has(threadId);
    if (!shouldTrack) return null;

    const record = asRecord(notification.params);
    let state = this.states.get(threadId);
    let changed = false;

    if (notification.method === "turn/started") {
      state = this.ensureState(threadId, notification.atIso);
      const turn = asRecord(record?.turn);
      const turnId = readTurnIdFromParams(notification.params);
      if (turnId) {
        state.activeTurnId = turnId;
        const activeTurn = this.ensureTurn(
          state,
          turnId,
          readTurnStatus(turn?.status) || "active",
        );
        activeTurn.items = activeTurn.items.filter(
          (item) =>
            (item.type !== "user" && item.type !== "userMessage") ||
            !item.id.startsWith("pending-"),
        );
      }
      state.detail.thread.inProgress = true;
      changed = true;
    } else if (notification.method === "thread/status/changed") {
      state = this.ensureState(threadId, notification.atIso);
      const active = isActiveStatus(record?.status);
      state.detail.thread.inProgress = active;
      if (state.activeTurnId) {
        const turn = this.ensureTurn(state, state.activeTurnId, active ? "active" : "unknown");
        if (active) turn.status = "active";
      }
      changed = true;
    } else if (notification.method === "thread/name/updated") {
      state = this.ensureState(threadId, notification.atIso);
      const title =
        readString(record?.name) ||
        readString(record?.title) ||
        readString(record?.preview);
      if (title) state.detail.thread.title = title;
      changed = Boolean(title);
    } else if (notification.method === "item/started") {
      state = this.ensureState(threadId, notification.atIso);
      const turn = this.ensureTurn(
        state,
        readTurnIdFromParams(notification.params) || state.activeTurnId,
        "active",
      );
      const item = markItemStarted(normalizeMessageItem(record?.item, turn.items.length));
      this.upsertItem(turn, item);
      state.detail.thread.inProgress = true;
      changed = true;
    } else if (notification.method === "item/completed") {
      state = this.ensureState(threadId, notification.atIso);
      const turn = this.ensureTurn(
        state,
        readTurnIdFromParams(notification.params) || state.activeTurnId,
        state.detail.thread.inProgress ? "active" : "unknown",
      );
      const item = normalizeMessageItem(record?.item, turn.items.length);
      this.upsertItem(turn, item);
      changed = true;
    } else if (notification.method === "item/agentMessage/delta") {
      state = this.ensureState(threadId, notification.atIso);
      this.appendTextDelta(state, "agentMessage", notification.params);
      changed = true;
    } else if (
      notification.method === "item/reasoning/textDelta" ||
      notification.method === "item/reasoning/summaryTextDelta"
    ) {
      state = this.ensureState(threadId, notification.atIso);
      this.appendTextDelta(state, "reasoning", notification.params);
      changed = true;
    } else if (notification.method === "item/commandExecution/outputDelta") {
      state = this.ensureState(threadId, notification.atIso);
      this.appendTextDelta(state, "commandExecution", notification.params);
      changed = true;
    } else if (notification.method === "item/fileChange/outputDelta") {
      state = this.ensureState(threadId, notification.atIso);
      this.appendTextDelta(state, "fileChange", notification.params);
      changed = true;
    } else if (notification.method === "turn/completed") {
      state = this.ensureState(threadId, notification.atIso);
      const turnId = readTurnIdFromParams(notification.params) || state.activeTurnId;
      if (turnId) this.ensureTurn(state, turnId, "completed").status = "completed";
      state.activeTurnId = "";
      state.detail.thread.inProgress = false;
      changed = true;
    }

    if (!state || !changed) return null;
    state.detail.thread.owner = this.options.readOwner(threadId);
    state.detail.thread.updatedAtIso = notification.atIso ?? new Date().toISOString();
    state.cacheVersion += 1;
    return {
      threadId,
      detail: cloneDetail(state.detail),
      source: "app-server-live",
      isInProgress: state.detail.thread.inProgress,
      activeTurnId: state.activeTurnId,
    };
  }

  private ensureState(threadId: string, atIso?: string): LiveThreadState {
    const existing = this.states.get(threadId);
    if (existing) return existing;
    const detail =
      this.options.readInitialDetail(threadId) ??
      this.createEmptyDetail(threadId, atIso);
    detail.turns = detail.turns.filter((turn) => !turn.id.startsWith("pending-"));
    detail.thread.inProgress = true;
    detail.thread.owner = this.options.readOwner(threadId);
    const state: LiveThreadState = {
      detail: cloneDetail(detail),
      activeTurnId: "",
      cacheVersion: 0,
    };
    this.states.set(threadId, state);
    return state;
  }

  private createEmptyDetail(threadId: string, atIso?: string): ThreadDetail {
    return {
      thread: {
        id: threadId,
        title: "Untitled",
        projectId: null,
        path: null,
        updatedAtIso: atIso ?? new Date().toISOString(),
        inProgress: true,
        pinned: false,
        gitInfo: null,
        owner: this.options.readOwner(threadId),
      },
      goal: null,
      turns: [],
      subAgents: [],
      sideConversations: [],
    };
  }

  private ensureTurn(
    state: LiveThreadState,
    turnId: string,
    status: Turn["status"],
  ): Turn {
    const id = turnId || state.activeTurnId || `turn-${state.detail.turns.length + 1}`;
    state.activeTurnId ||= id;
    let turn = state.detail.turns.find((entry) => entry.id === id);
    if (!turn) {
      turn = { id, status, items: [] };
      state.detail.turns.push(turn);
    } else if (status !== "unknown") {
      turn.status = status;
    }
    return turn;
  }

  private upsertItem(turn: Turn, item: MessageItem): void {
    const existingIndex = itemIndex(turn, item.id);
    if (existingIndex >= 0) {
      turn.items[existingIndex] = mergeItem(turn.items[existingIndex]!, item);
      return;
    }
    const duplicateUserIndex = duplicateUserItemIndex(turn.items, item);
    if (duplicateUserIndex >= 0) {
      turn.items[duplicateUserIndex] = item;
      return;
    }
    turn.items.push(item);
  }

  private appendTextDelta(
    state: LiveThreadState,
    kind: "agentMessage" | "reasoning" | "commandExecution" | "fileChange",
    params: unknown,
  ): void {
    const turn = this.ensureTurn(
      state,
      readTurnIdFromParams(params) || state.activeTurnId,
      "active",
    );
    const record = asRecord(params);
    const itemId =
      readItemIdFromParams(params) || `${kind}-${turn.items.length + 1}`;
    const delta = readDeltaString(record?.delta) || readTextContent(record?.text);
    const existingIndex = itemIndex(turn, itemId);
    if (existingIndex < 0) {
      if (kind === "agentMessage") {
        turn.items.push({
          type: "agentMessage",
          id: itemId,
          text: delta,
          phase: null,
          memoryCitation: null,
        });
      } else if (kind === "reasoning") {
        turn.items.push({
          type: "reasoning",
          id: itemId,
          summary: [],
          content: [delta],
          status: "active",
        });
      } else if (kind === "commandExecution") {
        turn.items.push({
          type: "commandExecution",
          id: itemId,
          command: "",
          cwd: null,
          processId: null,
          source: null,
          status: "inProgress",
          aggregatedOutput: delta,
          commandActions: [],
          durationMs: null,
          exitCode: null,
        });
      } else {
        turn.items.push({
          type: "fileChange",
          id: itemId,
          path: "",
          diff: delta,
          status: "inProgress",
        });
      }
      return;
    }
    const item = turn.items[existingIndex];
    if (!item) return;
    const itemRecord = asRecord(item);
    const itemType = readString(itemRecord?.type);
    if (itemType === "agentMessage") {
      turn.items[existingIndex] = { ...item, text: readTextContent(itemRecord?.text) + delta } as MessageItem;
    } else if (itemType === "reasoning") {
      const itemRecord = asRecord(item);
      const content = Array.isArray(itemRecord?.content) ? itemRecord.content : [];
      const text = readTextContent(itemRecord?.text);
      turn.items[existingIndex] = {
        ...item,
        content: [...content, delta],
        ...(text ? { text: text + delta } : {}),
      } as MessageItem;
    } else if (itemType === "commandExecution") {
      turn.items[existingIndex] = {
        ...item,
        aggregatedOutput: `${readTextContent(itemRecord?.aggregatedOutput)}${delta}`,
      } as MessageItem;
    } else if (itemType === "fileChange") {
      const existingChanges = Array.isArray(itemRecord?.changes) ? itemRecord.changes : [];
      const changes = existingChanges.length
        ? existingChanges.map((change, index) => {
            const changeRecord = asRecord(change) ?? {};
            return index === 0
              ? { ...changeRecord, diff: readTextContent(changeRecord.diff) + delta }
              : change;
          })
        : [{ path: "", diff: delta, kind: { type: "update", move_path: null } }];
      turn.items[existingIndex] = { ...item, changes } as MessageItem;
    }
    state.detail.thread.inProgress = true;
  }
}
