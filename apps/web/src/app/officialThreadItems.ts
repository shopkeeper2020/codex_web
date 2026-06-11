import type {
  FileChangeContent,
  MessageImageContent,
  MessageItem,
} from "@codex-web/domain";

export function asThreadItemRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readThreadItemString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readThreadItemText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const record = asThreadItemRecord(entry);
        return (
          readThreadItemString(record?.text) ||
          readThreadItemString(record?.content) ||
          readThreadItemString(record?.value) ||
          readThreadItemText(record?.content)
        );
      })
      .filter(Boolean)
      .join("\n");
  }
  const record = asThreadItemRecord(value);
  if (!record) return "";
  return (
    readThreadItemString(record.text) ||
    readThreadItemText(record.content) ||
    readThreadItemText(record.input) ||
    readThreadItemString(record.message) ||
    readThreadItemString(record.value)
  );
}

export function readMessageItemStatus(item: MessageItem): string | null {
  const record = asThreadItemRecord(item);
  const status =
    readThreadItemString(record?.status) ||
    readThreadItemString(asThreadItemRecord(record?.status)?.type) ||
    readThreadItemString(record?.state) ||
    readThreadItemString(record?.kind);
  return status || null;
}

export function readMessageItemText(item: MessageItem): string {
  const record = asThreadItemRecord(item);
  if (item.type === "agentMessage") return readThreadItemText(record?.text);
  if (item.type === "userMessage") return readThreadItemText(record?.content);
  if (item.type === "reasoning") {
    const summary = Array.isArray(record?.summary) ? record.summary : [];
    const content = Array.isArray(record?.content) ? record.content : [];
    return [
      ...summary.map(readThreadItemText),
      ...content.map(readThreadItemText),
      readThreadItemText(record?.text),
    ].filter(Boolean).join("\n");
  }
  if (item.type === "plan") {
    const steps = Array.isArray(record?.steps) ? record.steps : [];
    return [
      readThreadItemText(record?.text),
      ...steps.map((step) => readThreadItemText(asThreadItemRecord(step)?.text)),
    ].filter(Boolean).join("\n");
  }
  if (item.type === "commandExecution") {
    return [record?.command, record?.aggregatedOutput, record?.stdout, record?.stderr]
      .map((value) => value ?? "")
      .map(readThreadItemText)
      .filter(Boolean)
      .join("\n");
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(record?.changes) ? record.changes : [];
    return changes.map((change) => readThreadItemText(asThreadItemRecord(change)?.diff)).filter(Boolean).join("\n\n");
  }
  if (item.type === "webSearch") return readThreadItemText(record?.query);
  if (item.type === "mcpToolCall") {
    return readThreadItemText(record?.result ?? record?.error ?? record?.arguments);
  }
  if (item.type === "dynamicToolCall") {
    return readThreadItemText(record?.contentItems ?? record?.arguments);
  }
  if (item.type === "collabAgentToolCall") return readThreadItemText(record?.prompt);
  return (
    readThreadItemText(record?.text) ||
    readThreadItemText(record?.output) ||
    readThreadItemText(record?.content) ||
    readThreadItemText(record?.raw)
  );
}

function legacyContentFromText(text: string): Array<Record<string, string>> {
  return text ? [{ type: "text", text }] : [];
}

function readMessagePhase(value: unknown): "commentary" | "final_answer" | null {
  return value === "commentary" || value === "final_answer" ? value : null;
}

export function migrateLegacyMessageItemForRender(item: MessageItem): MessageItem {
  const record = asThreadItemRecord(item);
  if (!record) return item;
  const id = readThreadItemString(record.id) || item.id;
  if (item.type === "user") {
    const text = readThreadItemString(record.text) || readThreadItemText(record.content);
    return {
      ...record,
      type: "userMessage",
      id,
      clientId: readThreadItemString(record.clientId) || null,
      content: Array.isArray(record.content) ? record.content : legacyContentFromText(text),
    } as MessageItem;
  }
  if (item.type === "assistant") {
    const text = readThreadItemString(record.text) || readThreadItemText(record.content);
    return {
      ...record,
      type: "agentMessage",
      id,
      text,
      phase: readMessagePhase(record.phase),
      memoryCitation: record.memoryCitation ?? null,
    } as MessageItem;
  }
  return item;
}

export function migrateLegacyMessageItemsForRender(items: MessageItem[]): MessageItem[] {
  return items.map(migrateLegacyMessageItemForRender);
}

function readFileChangeKind(value: unknown): FileChangeContent["kind"] {
  const record = asThreadItemRecord(value);
  if (record) {
    const type = readThreadItemString(record.type);
    return type ? { ...record, type } : null;
  }
  const type = readThreadItemString(value);
  if (!type) return null;
  if (type === "create") return { type: "add" };
  if (type === "update") return { type: "update", move_path: null };
  return { type };
}

export function isUserMessageItem(item: MessageItem): boolean {
  return item.type === "userMessage";
}

export function isAgentMessageItem(item: MessageItem): boolean {
  return item.type === "agentMessage";
}

export function isUserMessageLikeItem(item: MessageItem): boolean {
  return item.type === "userMessage" || item.type === "user";
}

export function isAgentMessageLikeItem(item: MessageItem): boolean {
  return item.type === "agentMessage" || item.type === "assistant";
}

export function isCommandExecutionItem(item: MessageItem): boolean {
  return item.type === "commandExecution" || item.type === "command";
}

export function isToolLikeItem(item: MessageItem): boolean {
  return (
    item.type === "mcpToolCall" ||
    item.type === "dynamicToolCall" ||
    item.type === "webSearch" ||
    item.type === "toolOutput"
  );
}

export function isLiveOperationItem(item: MessageItem): boolean {
  return (
    isCommandExecutionItem(item) ||
    item.type === "fileChange" ||
    isToolLikeItem(item)
  );
}

export function readCommandOutput(item: MessageItem): {
  command: string;
  output: string;
  stdout: string;
  stderr: string;
  cwd: string | null;
  status: string | null;
  durationMs: number | null;
  exitCode: number | null;
} | null {
  if (item.type === "commandExecution") {
    const record = asThreadItemRecord(item);
    return {
      command: readThreadItemText(record?.command),
      output: readThreadItemText(record?.aggregatedOutput),
      stdout: readThreadItemText(record?.stdout ?? record?.aggregatedOutput),
      stderr: readThreadItemText(record?.stderr),
      cwd: readThreadItemString(record?.cwd) || null,
      status: readThreadItemString(record?.status) || null,
      durationMs: typeof record?.durationMs === "number" ? record.durationMs : null,
      exitCode: typeof record?.exitCode === "number" ? record.exitCode : null,
    };
  }
  if (item.type !== "command") return null;
  const record = asThreadItemRecord(item);
  return {
    command: readThreadItemText(record?.command),
    output: readThreadItemText(record?.output),
    stdout: readThreadItemText(record?.stdout),
    stderr: readThreadItemText(record?.stderr),
    cwd: readThreadItemString(record?.cwd) || null,
    status: readThreadItemString(record?.status) || null,
    durationMs: typeof record?.durationMs === "number" ? record.durationMs : null,
    exitCode: typeof record?.exitCode === "number" ? record.exitCode : null,
  };
}

export type FileChangeEntry = FileChangeContent & { status: string | null };

export function readFileChangeEntries(item: MessageItem): FileChangeEntry[] {
  if (item.type !== "fileChange") return [];
  const record = asThreadItemRecord(item);
  if (Array.isArray(record?.changes) && record.changes.length) {
    return record.changes.map((change) => {
      const changeRecord = asThreadItemRecord(change);
      return {
        ...(changeRecord ?? {}),
        path: readThreadItemString(changeRecord?.path),
        diff: readThreadItemText(changeRecord?.diff),
        kind: readFileChangeKind(changeRecord?.kind),
        status: readMessageItemStatus(item),
      };
    });
  }
  const path = readThreadItemString(record?.path);
  const diff = readThreadItemText(record?.diff);
  if (!path && !diff) return [];
  return [
    {
      path,
      diff,
      status: readMessageItemStatus(item),
      kind: null,
    },
  ];
}

function readImage(value: unknown): MessageImageContent | null {
  const record = asThreadItemRecord(value);
  if (!record) return null;
  const source = asThreadItemRecord(record.source);
  const imageUrl = asThreadItemRecord(record.image_url);
  const type = readThreadItemString(record.type).toLowerCase();
  const url =
    readThreadItemString(record.url) ||
    readThreadItemString(record.src) ||
    readThreadItemString(record.imageUrl) ||
    readThreadItemString(record.image_url) ||
    readThreadItemString(imageUrl?.url) ||
    readThreadItemString(source?.url) ||
    readThreadItemString(source?.src) ||
    null;
  const path =
    readThreadItemString(record.path) ||
    readThreadItemString(record.filePath) ||
    readThreadItemString(record.file_path) ||
    readThreadItemString(source?.path) ||
    null;
  const mimeType =
    readThreadItemString(record.mimeType) ||
    readThreadItemString(record.mime_type) ||
    readThreadItemString(record.mediaType) ||
    readThreadItemString(record.media_type) ||
    null;
  const alt = readThreadItemString(record.alt) || readThreadItemString(record.filename) || null;
  if (!url && !path && !type.includes("image")) return null;
  return { url, path, mimeType, alt };
}

export function readMessageImages(item: MessageItem): MessageImageContent[] {
  const record = asThreadItemRecord(item);
  const values = [
    ...(Array.isArray(record?.images) ? record.images : []),
    ...(Array.isArray(record?.content) ? record.content : []),
    record?.image,
  ];
  const seen = new Set<string>();
  return values
    .map(readImage)
    .filter((image): image is MessageImageContent => Boolean(image))
    .filter((image) => {
      const key = `${image.url ?? ""}|${image.path ?? ""}`;
      if (!key.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
