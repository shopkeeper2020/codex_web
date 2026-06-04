import type { MessageItem, ThreadDetail, Turn } from "../api";

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
  return readStatusString(value).toLowerCase().replace(/[\s_-]+/g, "");
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
  return readString(record?.itemId) || readString(record?.item_id) || readString(item?.id);
}

function isPendingTurnId(turnId: string): boolean {
  return turnId.startsWith("pending-");
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

function normalizeItem(value: unknown, fallbackId: string): MessageItem {
  const record = asRecord(value);
  const rawType = readString(record?.type);
  const type = rawType.toLowerCase().replace(/[-_]/g, "");
  const id = readString(record?.id) || fallbackId;

  if (type === "usermessage" || type === "user") {
    const intent = readString(record?.intent);
    return {
      type: "user",
      id,
      text: readTextContent(record?.content) || readString(record?.text),
      ...(intent === "guidance" ? { intent } : {}),
    };
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
  if (type === "plan") {
    return {
      type: "plan",
      id,
      text: readString(record?.text) || readTextContent(record?.content),
      steps: [],
      status: readString(record?.status) || null,
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
      status: readStatusString(record?.status) || null,
      rawType: rawType || "webSearch",
    };
  }
  if (type.includes("tool") || type.includes("mcp") || type.includes("function")) {
    return {
      type: "toolOutput",
      id,
      title: readString(record?.title) || readString(record?.name) || rawType || "Tool output",
      text: readTextContent(
        record?.output ?? record?.content ?? record?.text ?? record?.result,
      ),
      status: readStatusString(record?.status) || null,
      rawType: rawType || "unknown",
    };
  }
  return { type: "unknown", id, rawType: rawType || "unknown", raw: value };
}

function markItemStarted(item: MessageItem): MessageItem {
  if (
    (item.type === "toolOutput" ||
      item.type === "fileChange" ||
      item.type === "plan" ||
      item.type === "reasoning") &&
    !item.status
  ) {
    return { ...item, status: "active" };
  }
  if (item.type === "command" && item.status === "unknown") {
    return { ...item, status: "active" };
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
  items[existingIndex] = item;
  return { ...turn, items };
}

function appendDeltaToItem(
  item: MessageItem,
  kind: "assistant" | "reasoning" | "plan" | "command" | "fileChange",
  delta: string,
): MessageItem {
  if ((kind === "assistant" && item.type === "assistant") || (kind === "reasoning" && item.type === "reasoning")) {
    return { ...item, text: item.text + delta };
  }
  if (kind === "plan" && item.type === "plan") {
    return { ...item, text: item.text + delta };
  }
  if (kind === "command" && item.type === "command") {
    return {
      ...item,
      output: item.output + delta,
      stdout: item.stdout + delta,
    };
  }
  if (kind === "fileChange" && item.type === "fileChange") {
    return { ...item, diff: item.diff + delta };
  }
  return item;
}

function createDeltaItem(
  kind: "assistant" | "reasoning" | "plan" | "command" | "fileChange",
  itemId: string,
  delta: string,
): MessageItem {
  if (kind === "assistant") return { type: "assistant", id: itemId, text: delta };
  if (kind === "reasoning") {
    return {
      type: "reasoning",
      id: itemId,
      text: delta,
      collapsed: true,
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
  if (kind === "command") {
    return {
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
    };
  }
  return {
    type: "fileChange",
    id: itemId,
    path: "",
    diff: delta,
    status: "active",
  };
}

function appendDelta(
  detail: ThreadDetail,
  params: unknown,
  kind: "assistant" | "reasoning" | "plan" | "command" | "fileChange",
): ThreadDetail {
  const record = asRecord(params);
  const turnId = readTurnId(params);
  const itemId = readItemId(params) || `${kind}-live`;
  const delta = readDeltaString(record?.delta) || readTextContent(record?.text);
  if (!delta) return detail;
  return updateTurn(detail, turnId, "active", (turn) => {
    const existingIndex = turn.items.findIndex((entry) => entry.id === itemId);
    if (existingIndex < 0) {
      return { ...turn, items: [...turn.items, createDeltaItem(kind, itemId, delta)] };
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
      readTurnStatus(turn?.status) === "unknown" ? "active" : readTurnStatus(turn?.status),
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

  if (method === "item/started" || method === "item/completed") {
    const normalizedItem = normalizeItem(record?.item, "item-live");
    const item =
      method === "item/started"
        ? markItemStarted(normalizedItem)
        : normalizedItem;
    const status = method === "item/started" ? "active" : "unknown";
    return updateTurn(
      { ...detail, thread: { ...detail.thread, inProgress: true } },
      readTurnId(params),
      status,
      (turn) => upsertItem(turn, item),
    );
  }

  if (method === "item/agentMessage/delta") {
    return appendDelta(detail, params, "assistant");
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
    return appendDelta(detail, params, "command");
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

  return null;
}
