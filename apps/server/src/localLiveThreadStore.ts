import type {
  MessageItem,
  Owner,
  ThreadDetail,
  Turn,
} from "@codex-web/domain";

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
        const record = asRecord(entry);
        return readString(record?.text);
      })
      .filter(Boolean)
      .join("");
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

function readWebSearchQuery(record: Record<string, unknown> | null): string {
  const action = asRecord(record?.action);
  return (
    readString(record?.query) ||
    readString(record?.searchQuery) ||
    readString(record?.search_query) ||
    readString(action?.query) ||
    readString(action?.url)
  );
}

function normalizeLiveItem(value: unknown, fallbackId: string): MessageItem {
  const record = asRecord(value);
  const rawType = readString(record?.type);
  const type = rawType.toLowerCase().replace(/[-_]/g, "");
  const id = readString(record?.id) || fallbackId;

  if (type === "usermessage" || type === "user") {
    return { type: "user", id, text: readTextContent(record?.content) };
  }
  if (type === "agentmessage" || type === "assistantmessage" || type === "assistant") {
    return {
      type: "assistant",
      id,
      text: readString(record?.text) || readTextContent(record?.content),
    };
  }
  if (type === "reasoning" || type.includes("thinking")) {
    return {
      type: "reasoning",
      id,
      text: readString(record?.text) || readTextContent(record?.content),
      collapsed: true,
      status: readString(record?.status) || readString(record?.state) || null,
    };
  }
  if (type === "commandexecution" || type === "command") {
    const output = readTextContent(record?.output);
    return {
      type: "command",
      id,
      command:
        readString(record?.command) ||
        readString(record?.cmd) ||
        readString(record?.commandLine),
      status: readString(record?.status) || "unknown",
      output,
      stdout: output,
      stderr: "",
      cwd: readString(record?.cwd) || null,
      durationMs: null,
      exitCode: null,
    };
  }
  if (type === "filechange" || type.includes("patch")) {
    return {
      type: "fileChange",
      id,
      path: readString(record?.path),
      diff: readTextContent(record?.diff ?? record?.output),
      status: readString(record?.status) || null,
    };
  }
  if (type === "websearch" || type.includes("websearch")) {
    const query = readWebSearchQuery(record);
    return {
      type: "toolOutput",
      id,
      title: query ? `Web search: ${query}` : "Web search",
      text: readTextContent(
        record?.output ??
          record?.results ??
          record?.content ??
          record?.text ??
          record?.result,
      ),
      status: readString(record?.status) || null,
      rawType: rawType || "webSearch",
    };
  }
  return { type: "unknown", id, rawType: rawType || "unknown", raw: value };
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
  return item.type === "user" ? item.text.replace(/\s+/g, " ").trim() : "";
}

function duplicateUserItemIndex(items: MessageItem[], item: MessageItem): number {
  if (item.type !== "user") return -1;
  const text = normalizedUserText(item);
  return items.findIndex((entry) => {
    if (entry.type !== "user") return false;
    if (entry.id === item.id) return true;
    return text.length > 0 && normalizedUserText(entry) === text;
  });
}

export class LocalLiveThreadStore {
  private readonly states = new Map<string, LiveThreadState>();

  constructor(private readonly options: LocalLiveThreadStoreOptions) {}

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
          (item) => item.type !== "user" || !item.id.startsWith("pending-"),
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
      const item = normalizeLiveItem(record?.item, `item-${turn.items.length + 1}`);
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
      const item = normalizeLiveItem(record?.item, `item-${turn.items.length + 1}`);
      this.upsertItem(turn, item);
      changed = true;
    } else if (notification.method === "item/agentMessage/delta") {
      state = this.ensureState(threadId, notification.atIso);
      this.appendTextDelta(state, "assistant", notification.params);
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
      this.appendTextDelta(state, "command", notification.params);
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
      turn.items[existingIndex] = item;
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
    kind: "assistant" | "reasoning" | "command" | "fileChange",
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
      if (kind === "assistant") {
        turn.items.push({ type: "assistant", id: itemId, text: delta });
      } else if (kind === "reasoning") {
        turn.items.push({
          type: "reasoning",
          id: itemId,
          text: delta,
          collapsed: true,
          status: "active",
        });
      } else if (kind === "command") {
        turn.items.push({
          type: "command",
          id: itemId,
          command: "",
          status: "active",
          output: delta,
          stdout: delta,
          stderr: "",
          cwd: null,
          durationMs: null,
          exitCode: null,
        });
      } else {
        turn.items.push({
          type: "fileChange",
          id: itemId,
          path: "",
          diff: delta,
          status: "active",
        });
      }
      return;
    }
    const item = turn.items[existingIndex];
    if (!item) return;
    if (item.type === "assistant" || item.type === "reasoning") {
      turn.items[existingIndex] = { ...item, text: item.text + delta };
    } else if (item.type === "command") {
      turn.items[existingIndex] = {
        ...item,
        output: item.output + delta,
        stdout: item.stdout + delta,
      };
    } else if (item.type === "fileChange") {
      turn.items[existingIndex] = { ...item, diff: item.diff + delta };
    }
    state.detail.thread.inProgress = true;
  }
}
