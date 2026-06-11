import {
  ChevronDown,
  ChevronRight,
  Code2,
  Globe2,
} from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import type { MessageItem } from "../../../api";
import styles from "../../App.module.css";
import {
  BlockHeader,
  CollapsedMessageToggle,
  blockPreClass,
  isActiveMessageStatus,
  type MessageImage,
} from "./shared";
import { UserMessageBlock } from "./UserMessageBlock";

export type ToolOutputBlockItem = Extract<MessageItem, { type: "toolOutput" }>;
export type UnknownOfficialBlockItem = Extract<MessageItem, { type: "unknown" }>;
export type OfficialWebSearchBlockItem = Extract<MessageItem, { type: "webSearch" }>;
export type OfficialToolCallBlockItem = Extract<MessageItem, { type: "mcpToolCall" | "dynamicToolCall" }>;
export type WebSearchRenderItem = ToolOutputBlockItem | UnknownOfficialBlockItem | OfficialWebSearchBlockItem;
export type ToolOrOfficialUnknownBlockItem = MessageItem;

function sourceKeyLooksLikeWebSearch(value?: string | null): boolean {
  const normalized = (value ?? "").toLowerCase();
  const compact = normalized.replace(/[-_\s]/g, "");
  return compact.includes("websearch") || normalized.includes("网页搜索");
}

function unknownPayload(item: MessageItem): unknown {
  const record = asUnknownRecord(item);
  return readUnknownString(record?.type) === "unknown" && "raw" in (record ?? {})
    ? record?.raw
    : item;
}

function unknownRawType(item: MessageItem): string {
  const record = asUnknownRecord(item);
  const rawRecord = asUnknownRecord(record?.raw);
  const declaredType = readUnknownString(record?.type);
  if (declaredType === "unknown") {
    return (
      readUnknownString(record?.rawType) ||
      readUnknownString(rawRecord?.type) ||
      "unknown"
    );
  }
  return declaredType || readUnknownString(rawRecord?.type) || "unknown";
}

function compactProtocolType(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[-_]/g, "");
}

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readUnknownString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readUnknownTextContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const record = asUnknownRecord(entry);
        return (
          readUnknownString(record?.text) ||
          readUnknownString(record?.content) ||
          readUnknownString(record?.value) ||
          readUnknownTextContent(record?.content)
        );
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  const record = asUnknownRecord(value);
  if (!record) return "";
  return (
    readUnknownString(record.text) ||
    readUnknownString(record.content) ||
    readUnknownString(record.message) ||
    readUnknownString(record.value) ||
    readUnknownTextContent(record.content ?? record.message ?? record.input)
  );
}

function readUnknownImage(value: unknown): MessageImage | null {
  const record = asUnknownRecord(value);
  if (!record) return null;
  const imageUrl = asUnknownRecord(record.image_url);
  const source = asUnknownRecord(record.source);
  const type = readUnknownString(record.type).toLowerCase();
  const url =
    readUnknownString(record.url) ||
    readUnknownString(record.src) ||
    readUnknownString(record.imageUrl) ||
    readUnknownString(record.image_url) ||
    readUnknownString(imageUrl?.url) ||
    readUnknownString(source?.url) ||
    readUnknownString(source?.src) ||
    null;
  const path =
    readUnknownString(record.path) ||
    readUnknownString(record.filePath) ||
    readUnknownString(record.file_path) ||
    readUnknownString(source?.path) ||
    null;
  const mimeType =
    readUnknownString(record.mimeType) ||
    readUnknownString(record.mime_type) ||
    readUnknownString(record.mediaType) ||
    readUnknownString(record.media_type) ||
    null;
  const alt = readUnknownString(record.alt) || readUnknownString(record.filename) || null;
  if (!url && !path && !type.includes("image")) return null;
  return { url, path, mimeType, alt };
}

function readUnknownImages(value: unknown): MessageImage[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(readUnknownImage).filter((entry): entry is MessageImage => Boolean(entry));
}

function compactMessageImages(images: MessageImage[]): MessageImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${image.url ?? ""}|${image.path ?? ""}`;
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isWebSearchToolOutput(item: ToolOutputBlockItem): boolean {
  return sourceKeyLooksLikeWebSearch(item.rawType) || sourceKeyLooksLikeWebSearch(item.title);
}

function isUnknownWebSearchItem(item: MessageItem): boolean {
  const record = asUnknownRecord(item);
  const raw = asUnknownRecord(unknownPayload(item));
  return (
    sourceKeyLooksLikeWebSearch(readUnknownString(record?.rawType)) ||
    sourceKeyLooksLikeWebSearch(unknownRawType(item)) ||
    sourceKeyLooksLikeWebSearch(readUnknownString(raw?.type))
  );
}

export function isWebSearchRenderItem(item: MessageItem): item is WebSearchRenderItem {
  const type = readUnknownString(asUnknownRecord(item)?.type);
  return (
    type === "webSearch" ||
    (type === "toolOutput" && isWebSearchToolOutput(item as ToolOutputBlockItem)) ||
    (type === "unknown" && isUnknownWebSearchItem(item as UnknownOfficialBlockItem))
  );
}

function officialWebSearchRawQuery(item: OfficialWebSearchBlockItem): string {
  const record = asUnknownRecord(item);
  const action = asUnknownRecord(record?.action);
  return (
    readUnknownString(record?.query) ||
    readUnknownString(action?.query) ||
    readUnknownString(action?.url)
  );
}

function webSearchRawQuery(item: MessageItem): string {
  const raw = asUnknownRecord(unknownPayload(item));
  const action = asUnknownRecord(raw?.action);
  return (
    readUnknownString(raw?.query) ||
    readUnknownString(raw?.searchQuery) ||
    readUnknownString(raw?.search_query) ||
    readUnknownString(action?.query) ||
    readUnknownString(action?.url)
  );
}

function webSearchQuery(item: WebSearchRenderItem): string {
  const title =
    item.type === "toolOutput"
      ? item.title || item.rawType || "网页搜索"
      : item.type === "webSearch"
        ? officialWebSearchRawQuery(item) || "网页搜索"
        : webSearchRawQuery(item) || item.rawType || unknownRawType(item) || "网页搜索";
  return (
    title
      .replace(/^\s*web\s*search\s*:\s*/i, "")
      .replace(/^\s*网页搜索\s*[:：]\s*/u, "")
      .trim() || title
  );
}

function webSearchSummary(
  items: WebSearchRenderItem[],
  isItemActive?: (item: WebSearchRenderItem) => boolean,
): { label: string; meta: string; active: boolean } {
  const active = items.some((item) => {
    const record = asUnknownRecord(item);
    return isItemActive?.(item) ?? isActiveMessageStatus(readUnknownString(record?.status));
  });
  return {
    label: active ? "正在搜索网页" : "已搜索网页",
    meta: `${items.length} 次`,
    active,
  };
}

function isWebSearchActiveForTurn(
  item: WebSearchRenderItem,
  turnStatus: string,
): boolean {
  if (!isActiveMessageStatus(turnStatus)) return false;
  const status = readUnknownString(asUnknownRecord(item)?.status);
  return isActiveMessageStatus(status);
}

export function WebSearchSummaryMessage({
  forceComplete,
  isItemActive,
  items,
  turnStatus,
}: {
  items: WebSearchRenderItem[];
  turnStatus: string;
  forceComplete: boolean;
  isItemActive?: (item: WebSearchRenderItem) => boolean;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const summary = webSearchSummary(
    items,
    forceComplete ? () => false : isItemActive,
  );
  return (
    <article className={styles.assistantMessage} key={`web-search-group-${items.map((item) => item.id).join("-")}`}>
      <CollapsedMessageToggle
        active={summary.active}
        expanded={expanded}
        icon={<Globe2 size={16} />}
        label={summary.label}
        meta={summary.meta}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.webSearchList}>
          {items.map((item) => (
            <span className={styles.webSearchQuery} key={item.id}>
              {webSearchQuery(item)}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function ToolOutputBlockDetails({
  expanded,
  item,
  onToggleExpanded,
}: {
  item: ToolOutputBlockItem;
  expanded: boolean;
  onToggleExpanded: () => void;
}): ReactElement {
  const text = item.text || "暂无工具输出";
  return (
    <div className={styles.commandBlock}>
      <BlockHeader
        copyText={text}
        expanded={expanded}
        icon={<Code2 size={15} />}
        onToggleExpanded={onToggleExpanded}
        status={item.status}
        title={item.rawType}
      />
      <pre className={blockPreClass(expanded)}>{text}</pre>
    </div>
  );
}

function ToolOutputMessage({ item }: { item: ToolOutputBlockItem }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  if (isWebSearchToolOutput(item)) {
    return (
      <WebSearchSummaryMessage
        forceComplete={false}
        isItemActive={(candidate) => isWebSearchActiveForTurn(candidate, item.status ?? "completed")}
        items={[item]}
        key={item.id}
        turnStatus={item.status ?? "completed"}
      />
    );
  }
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        active={isActiveMessageStatus(item.status)}
        expanded={expanded}
        icon={<Code2 size={16} />}
        label={item.title || "工具输出"}
        meta={item.status ?? item.rawType}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <ToolOutputBlockDetails
          expanded={expanded}
          item={item}
          onToggleExpanded={() => setExpanded((value) => !value)}
        />
      ) : null}
    </article>
  );
}

function stringifyToolPayload(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function officialToolTitle(item: OfficialToolCallBlockItem): string {
  const record = asUnknownRecord(item);
  const tool = readUnknownString(record?.tool) || "tool";
  if (item.type === "mcpToolCall") {
    const server = readUnknownString(record?.server);
    return server ? `${server} / ${tool}` : tool;
  }
  const namespace = readUnknownString(record?.namespace);
  return namespace ? `${namespace} / ${tool}` : tool;
}

function officialToolPayload(item: OfficialToolCallBlockItem): string {
  const record = asUnknownRecord(item);
  const values =
    item.type === "mcpToolCall"
      ? [
          ["arguments", record?.arguments],
          ["result", record?.result],
          ["error", record?.error],
        ]
      : [
          ["arguments", record?.arguments],
          ["contentItems", record?.contentItems],
        ];
  const lines = values
    .map(([label, value]) => {
      const text = stringifyToolPayload(value);
      return text ? `${label}:\n${text}` : "";
    })
    .filter(Boolean);
  return lines.join("\n\n") || "暂无工具输出";
}

function OfficialToolCallMessage({ item }: { item: OfficialToolCallBlockItem }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const status = readUnknownString(asUnknownRecord(item)?.status) || null;
  const title = officialToolTitle(item);
  const text = officialToolPayload(item);
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        active={isActiveMessageStatus(status)}
        expanded={expanded}
        icon={<Code2 size={16} />}
        label={title}
        meta={status ?? item.type}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.commandBlock}>
          <BlockHeader
            copyText={text}
            expanded={expanded}
            icon={<Code2 size={15} />}
            onToggleExpanded={() => setExpanded((value) => !value)}
            status={status}
            title={title}
          />
          <pre className={blockPreClass(expanded)}>{text}</pre>
        </div>
      ) : null}
    </article>
  );
}

function UnknownMessage({
  item,
  turnStatus,
}: {
  item: MessageItem;
  turnStatus: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const rawType = unknownRawType(item);
  const rawText = stringifyToolPayload(unknownPayload(item)) || stringifyToolPayload(item);
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        expanded={expanded}
        icon={<Code2 size={16} />}
        label="未知官方内容"
        meta={rawType || turnStatus}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.commandBlock}>
          <BlockHeader
            copyText={rawText}
            expanded={expanded}
            icon={<Code2 size={15} />}
            onToggleExpanded={() => setExpanded((value) => !value)}
            title={rawType || "未知官方内容"}
          />
          <pre className={styles.blockPreExpanded}>{rawText}</pre>
        </div>
      ) : null}
    </article>
  );
}

function ContextCompactionMessage(): ReactElement {
  return (
    <article className={styles.contextCompactionMessage}>
      <span />
      <strong>上下文已自动压缩</strong>
      <span />
    </article>
  );
}

function isContextCompactionItem(item: MessageItem): boolean {
  const rawType = unknownRawType(item).toLowerCase();
  return rawType.includes("contextcompaction") || rawType.includes("context_compaction") || rawType.includes("compact");
}

export function isSilentUnknownItem(item: MessageItem): boolean {
  const rawType = compactProtocolType(unknownRawType(item));
  const declaredType = compactProtocolType(readUnknownString(asUnknownRecord(unknownPayload(item))?.type));
  return (
    rawType === "steered" ||
    declaredType === "steered" ||
    rawType === "todolist" ||
    declaredType === "todolist"
  );
}

function isUnknownSteeringUserMessage(item: MessageItem): boolean {
  return (
    compactProtocolType(unknownRawType(item)) === "steeringusermessage" ||
    compactProtocolType(readUnknownString(asUnknownRecord(unknownPayload(item))?.type)) === "steeringusermessage"
  );
}

function readSteeringUserMessage(item: MessageItem): { text: string; images: MessageImage[] } | null {
  if (!isUnknownSteeringUserMessage(item)) return null;
  const raw = asUnknownRecord(unknownPayload(item));
  const restoreMessage = asUnknownRecord(raw?.restoreMessage);
  const restoreContext = asUnknownRecord(restoreMessage?.context);
  const text =
    readUnknownString(restoreMessage?.text) ||
    readUnknownTextContent(raw?.input) ||
    readUnknownTextContent(raw?.content) ||
    readUnknownString(raw?.text);
  const images = compactMessageImages([
    ...readUnknownImages(raw?.input),
    ...readUnknownImages(raw?.content),
    ...readUnknownImages(raw?.attachments),
    ...readUnknownImages(raw?.imageAttachments),
    ...readUnknownImages(restoreMessage?.imageAttachments),
    ...readUnknownImages(restoreContext?.imageAttachments),
  ]);
  if (!text && images.length === 0) return null;
  return { text, images };
}

export function ToolOrOfficialUnknownBlock({
  item,
  projectRoot,
  turnStatus,
}: {
  item: ToolOrOfficialUnknownBlockItem;
  projectRoot?: string | null;
  turnStatus: string;
}): ReactElement | null {
  const type = readUnknownString(asUnknownRecord(item)?.type);
  if (type === "toolOutput") return <ToolOutputMessage item={item as ToolOutputBlockItem} key={item.id} />;
  if (type === "webSearch") {
    return (
      <WebSearchSummaryMessage
        forceComplete={false}
        isItemActive={(candidate) => isWebSearchActiveForTurn(candidate, turnStatus)}
        items={[item as OfficialWebSearchBlockItem]}
        key={item.id}
        turnStatus={turnStatus}
      />
    );
  }
  if (type === "mcpToolCall" || type === "dynamicToolCall") {
    return <OfficialToolCallMessage item={item as OfficialToolCallBlockItem} key={item.id} />;
  }

  if (type === "unknown" && isUnknownWebSearchItem(item)) {
    return (
      <WebSearchSummaryMessage
        forceComplete={false}
        isItemActive={(candidate) => isWebSearchActiveForTurn(candidate, turnStatus)}
        items={[item as UnknownOfficialBlockItem]}
        key={item.id}
        turnStatus={turnStatus}
      />
    );
  }
  const steeringUserMessage = readSteeringUserMessage(item);
  if (steeringUserMessage) {
    return (
      <UserMessageBlock
        actions={null}
        item={{
          type: "userMessage",
          id: item.id,
          clientId: null,
          content: [{ type: "text", text: steeringUserMessage.text }],
          images: steeringUserMessage.images,
        }}
        key={item.id}
        projectRoot={projectRoot}
      />
    );
  }
  if (isSilentUnknownItem(item)) return null;
  if (isContextCompactionItem(item)) return <ContextCompactionMessage key={item.id} />;
  return <UnknownMessage item={item} key={item.id} turnStatus={turnStatus} />;
}
