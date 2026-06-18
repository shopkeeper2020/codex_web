import {
  normalizeMessageItem,
  normalizeThreadSubAgents,
  normalizeThreadTokenUsage,
  type MessageItem,
  type ThreadDetail,
  type Turn,
} from "@codex-web/domain";

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

function readItemType(value: unknown): string {
  return readString(asRecord(value)?.type);
}

function isContextCompactionItem(item: MessageItem): boolean {
  return (
    readItemType(item)
      .toLowerCase()
      .replace(/[\s_-]+/g, "") === "contextcompaction"
  );
}

function ensureContextCompactionItem(turn: Turn): Turn {
  if (turn.items.some((item) => isContextCompactionItem(item))) return turn;
  return upsertItem(
    turn,
    normalizeMessageItem(
      {
        type: "contextCompaction",
        id: `context-compaction-${turn.id}`,
      },
      turn.items.length,
    ),
  );
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
    "editing",
    "inprogress",
    "pending",
    "running",
    "started",
    "streaming",
    "thinking",
    "writing",
  ].includes(compactStatus(value));
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

function readTurnStatus(value: unknown): Turn["status"] {
  const status = compactStatus(value);
  if (isActiveStatus(value)) return "active";
  if (
    ["completed", "complete", "done", "success", "succeeded"].includes(status)
  )
    return "completed";
  if (["failed", "failure", "error"].includes(status)) return "failed";
  if (["interrupted", "interrupt", "canceled", "cancelled"].includes(status))
    return "interrupted";
  if (["idle", "notloaded"].includes(status)) return "idle";
  return "unknown";
}

export function readAppServerNotificationThreadId(params: unknown): string {
  const record = asRecord(params);
  const thread = asRecord(record?.thread);
  if (!record) return "";
  return (
    readString(record.threadId) ||
    readString(record.thread_id) ||
    readString(record.conversationId) ||
    readString(thread?.id) ||
    readString(thread?.threadId)
  );
}

function readTurnId(params: unknown): string {
  const record = asRecord(params);
  const turn = asRecord(record?.turn);
  return (
    readString(record?.turnId) ||
    readString(record?.turn_id) ||
    readString(turn?.id) ||
    readString(turn?.turnId)
  );
}

function readItemId(params: unknown): string {
  const record = asRecord(params);
  const item = asRecord(record?.item);
  return (
    readString(record?.itemId) ||
    readString(record?.item_id) ||
    readString(item?.id)
  );
}

function isPendingTurnId(turnId: string): boolean {
  return turnId.startsWith("pending-");
}

function normalizedUserText(item: MessageItem): string {
  const record = asRecord(item);
  const type = readString(record?.type);
  if (type === "userMessage")
    return readTextContent(record?.content).replace(/\s+/g, " ").trim();
  if (type === "user")
    return readTextContent(record?.text).replace(/\s+/g, " ").trim();
  return "";
}

function duplicateUserItemIndex(
  items: MessageItem[],
  item: MessageItem,
): number {
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

function adoptPendingTurn(
  turns: Turn[],
  targetTurnId: string,
  status: Turn["status"],
): Turn[] {
  if (!targetTurnId || isPendingTurnId(targetTurnId)) return turns;
  return turns
    .filter((turn) => !isPendingTurnId(turn.id))
    .map((turn) =>
      turn.id === targetTurnId && status !== "unknown"
        ? { ...turn, status }
        : turn,
    );
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
  const status = readStatusString(record?.status);
  if (!status || status === "unknown") {
    return { ...item, status: "inProgress" } as MessageItem;
  }
  return item;
}

function activeTurnId(detail: ThreadDetail): string {
  return (
    [...detail.turns].reverse().find((turn) => turn.status === "active")?.id ||
    detail.turns.at(-1)?.id ||
    ""
  );
}

function updateTurn(
  detail: ThreadDetail,
  requestedTurnId: string,
  status: Turn["status"],
  updater: (turn: Turn) => Turn,
): ThreadDetail {
  const turnId = requestedTurnId || activeTurnId(detail) || "turn-live";
  const sourceTurns = adoptPendingTurn(detail.turns, turnId, status);
  let found = false;
  const turns = sourceTurns.map((turn) => {
    if (turn.id !== turnId) return turn;
    found = true;
    return updater({
      ...turn,
      status: status === "unknown" ? turn.status : status,
      items: turn.items,
    });
  });
  if (!found) {
    turns.push(updater({ id: turnId, status, items: [] }));
  }
  return { ...detail, turns };
}

function refreshSubAgents(detail: ThreadDetail): ThreadDetail {
  const subAgents = normalizeThreadSubAgents(
    {
      ...detail.thread,
      turns: detail.turns,
    },
    "app-server",
  );
  if (subAgents.length === 0) return detail;
  return { ...detail, subAgents };
}

function upsertItem(turn: Turn, item: MessageItem): Turn {
  const existingIndex = turn.items.findIndex((entry) => entry.id === item.id);
  const items = [...turn.items];
  if (existingIndex < 0) {
    const duplicateUserIndex = duplicateUserItemIndex(items, item);
    if (duplicateUserIndex >= 0) {
      items[duplicateUserIndex] = item;
      return { ...turn, items };
    }
    return { ...turn, items: [...items, item] };
  }
  items[existingIndex] = mergeItem(items[existingIndex]!, item);
  return { ...turn, items };
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
  if (incomingValue === null || incomingValue === undefined)
    return currentValue;
  if (currentValue === null || currentValue === undefined) return incomingValue;
  return jsonValueScore(currentValue) > jsonValueScore(incomingValue)
    ? currentValue
    : incomingValue;
}

function mergeMessagePhase(
  incomingValue: unknown,
  currentValue: unknown,
): unknown {
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
      merged.phase = mergeMessagePhase(
        incomingRecord?.phase,
        currentRecord?.phase,
      );
    }
    if (
      "memoryCitation" in (currentRecord ?? {}) ||
      "memoryCitation" in (incomingRecord ?? {})
    ) {
      merged.memoryCitation = richerValue(
        incomingRecord?.memoryCitation,
        currentRecord?.memoryCitation,
      );
    }
  }
  if (currentType === "webSearch" && incomingType === "webSearch") {
    if (
      "action" in (currentRecord ?? {}) ||
      "action" in (incomingRecord ?? {})
    ) {
      merged.action = richerValue(
        incomingRecord?.action,
        currentRecord?.action,
      );
    }
  }
}

function mergeItem(current: MessageItem, incoming: MessageItem): MessageItem {
  const currentRecord = asRecord(current);
  const incomingRecord = asRecord(incoming);
  const merged = { ...currentRecord, ...incomingRecord } as Record<
    string,
    unknown
  >;
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

function appendDeltaToItem(
  item: MessageItem,
  kind:
    | "agentMessage"
    | "reasoning"
    | "plan"
    | "commandExecution"
    | "fileChange",
  delta: string,
): MessageItem {
  const record = asRecord(item);
  const type = readString(record?.type);
  if (kind === "agentMessage" && type === "agentMessage") {
    return {
      ...item,
      text: readTextContent(record?.text) + delta,
    } as MessageItem;
  }
  if (kind === "reasoning" && type === "reasoning") {
    const content = Array.isArray(record?.content) ? record.content : [];
    const text = readTextContent(record?.text);
    return {
      ...item,
      content: [...content, delta],
      ...(text ? { text: text + delta } : {}),
    } as MessageItem;
  }
  if (kind === "plan" && type === "plan") {
    return {
      ...item,
      text: readTextContent(record?.text) + delta,
    } as MessageItem;
  }
  if (kind === "commandExecution" && type === "commandExecution") {
    return {
      ...item,
      aggregatedOutput: `${readTextContent(record?.aggregatedOutput)}${delta}`,
    } as MessageItem;
  }
  if (kind === "fileChange" && type === "fileChange") {
    const existingChanges = Array.isArray(record?.changes)
      ? record.changes
      : [];
    const changes = existingChanges.length
      ? existingChanges.map((change, index) => {
          const changeRecord = asRecord(change) ?? {};
          return index === 0
            ? {
                ...changeRecord,
                diff: readTextContent(changeRecord.diff) + delta,
              }
            : change;
        })
      : [{ path: "", diff: delta, kind: { type: "update", move_path: null } }];
    return { ...item, changes } as MessageItem;
  }
  return item;
}

function createDeltaItem(
  kind:
    | "agentMessage"
    | "reasoning"
    | "plan"
    | "commandExecution"
    | "fileChange",
  itemId: string,
  delta: string,
): MessageItem {
  if (kind === "agentMessage") {
    return {
      type: "agentMessage",
      id: itemId,
      text: delta,
      phase: null,
      memoryCitation: null,
    };
  }
  if (kind === "reasoning") {
    return {
      type: "reasoning",
      id: itemId,
      summary: [],
      content: [delta],
      status: "active",
    };
  }
  if (kind === "plan") {
    return {
      type: "plan",
      id: itemId,
      text: delta,
      steps: [],
      status: "active",
    };
  }
  if (kind === "commandExecution") {
    return {
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
    };
  }
  return {
    type: "fileChange",
    id: itemId,
    path: "",
    diff: delta,
    status: "inProgress",
  };
}

function appendDelta(
  detail: ThreadDetail,
  params: unknown,
  kind:
    | "agentMessage"
    | "reasoning"
    | "plan"
    | "commandExecution"
    | "fileChange",
): ThreadDetail {
  const record = asRecord(params);
  const turnId = readTurnId(params);
  const itemId = readItemId(params) || `${kind}-live`;
  const delta = readDeltaString(record?.delta) || readTextContent(record?.text);
  if (!delta) return detail;
  return updateTurn(detail, turnId, "active", (turn) => {
    const existingIndex = turn.items.findIndex((entry) => entry.id === itemId);
    if (existingIndex < 0) {
      return {
        ...turn,
        items: [...turn.items, createDeltaItem(kind, itemId, delta)],
      };
    }
    const items = [...turn.items];
    const item = items[existingIndex];
    if (!item) return turn;
    items[existingIndex] = appendDeltaToItem(item, kind, delta);
    return { ...turn, items };
  });
}

export function applyAppServerRealtimeNotification(
  detail: ThreadDetail | null,
  method: string,
  params: unknown,
): ThreadDetail | null {
  if (!detail) return null;
  const threadId = readAppServerNotificationThreadId(params);
  if (!threadId || threadId !== detail.thread.id) return null;
  const record = asRecord(params);

  if (method === "turn/started") {
    const turn = asRecord(record?.turn);
    return updateTurn(
      { ...detail, thread: { ...detail.thread, inProgress: true } },
      readTurnId(params),
      readTurnStatus(turn?.status) === "unknown"
        ? "active"
        : readTurnStatus(turn?.status),
      (entry) => entry,
    );
  }

  if (method === "thread/status/changed") {
    const inProgress = isActiveStatus(record?.status);
    return {
      ...detail,
      thread: { ...detail.thread, inProgress },
      turns: detail.turns.map((turn) =>
        turn.status === "active" && !inProgress
          ? { ...turn, status: "unknown" }
          : turn,
      ),
    };
  }

  if (method === "thread/tokenUsage/updated") {
    const tokenUsage = normalizeThreadTokenUsage(record?.tokenUsage);
    if (!tokenUsage) return detail;
    return {
      ...detail,
      tokenUsage,
    };
  }

  if (method === "item/started" || method === "item/completed") {
    const normalizedItem = normalizeMessageItem(record?.item, 0);
    const item =
      method === "item/started"
        ? markItemStarted(normalizedItem)
        : normalizedItem;
    const status = method === "item/started" ? "active" : "unknown";
    const nextDetail = updateTurn(
      {
        ...detail,
        thread: {
          ...detail.thread,
          inProgress:
            method === "item/started" ? true : detail.thread.inProgress,
        },
      },
      readTurnId(params),
      status,
      (turn) => upsertItem(turn, item),
    );
    return item.type === "collabAgentToolCall"
      ? refreshSubAgents(nextDetail)
      : nextDetail;
  }

  if (method === "item/agentMessage/delta") {
    return appendDelta(detail, params, "agentMessage");
  }
  if (method === "item/plan/delta") {
    return appendDelta(detail, params, "plan");
  }
  if (
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/summaryTextDelta"
  ) {
    return appendDelta(detail, params, "reasoning");
  }
  if (method === "item/commandExecution/outputDelta") {
    return appendDelta(detail, params, "commandExecution");
  }
  if (method === "item/fileChange/outputDelta") {
    return appendDelta(detail, params, "fileChange");
  }

  if (method === "turn/completed") {
    const turn = asRecord(record?.turn);
    const status = readTurnStatus(turn?.status);
    return updateTurn(
      { ...detail, thread: { ...detail.thread, inProgress: false } },
      readTurnId(params),
      status === "unknown" ? "completed" : status,
      (entry) => entry,
    );
  }

  if (method === "thread/compacted") {
    return updateTurn(
      { ...detail, thread: { ...detail.thread, inProgress: false } },
      readTurnId(params),
      "completed",
      ensureContextCompactionItem,
    );
  }

  return null;
}
