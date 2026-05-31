import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Code2,
  Command,
  FileDiff,
  FileText,
  Folder,
  FolderOpen,
  Github,
  GitBranch,
  GitCommitHorizontal,
  Globe2,
  HardDrive,
  Laptop,
  MessageSquare,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { I18nKey } from "@codex-web/i18n";
import type { RealtimeEvent } from "@codex-web/api";
import {
  fileContentUrl,
  getFilePreview,
  getWorkspaceStatus,
  listProjectFiles,
  type AppConfig,
  type AppServerStatus,
  type ApprovalDecision,
  type FileBrowserListing,
  type FilePreview,
  type OfficialIpcStatus,
  type PendingApproval,
  type Thread,
  type ThreadDetail,
  type ThreadGoal,
  type ThreadList,
  type WorkspaceStatus,
} from "../../api";
import { useI18n } from "../../i18n/useI18n";
import styles from "../App.module.css";
import { ApprovalCard, MessageAuthor, renderTurnItems } from "./MessageBlocks";

const MESSAGE_VIRTUALIZATION_THRESHOLD = 120;
export type RightSidebarTab =
  | "chat"
  | "files"
  | "browser"
  | "review"
  | "terminal";

type RightSidebarTabInstance = {
  id: string;
  type: RightSidebarTab;
  title: string;
  filePath?: string | null;
  sideConversationId?: string | null;
};

type DraftThreadView = {
  cwd: string | null;
  projectName: string | null;
};

type ThreadTurn = ThreadDetail["turns"][number];
type SideConversation = ThreadDetail["sideConversations"][number];
type TurnItem = ThreadTurn["items"][number];
type CommandMessageItem = Extract<TurnItem, { type: "command" }>;
type FileChangeMessageItem = Extract<TurnItem, { type: "fileChange" }>;
type PlanMessageItem = Extract<TurnItem, { type: "plan" }>;
type FileChangeEntry = NonNullable<FileChangeMessageItem["changes"]>[number];
type AgentTone = "blue" | "orange" | "green" | "red" | "violet" | "neutral";
type AgentRow = {
  name: string;
  role: string;
  tone: AgentTone;
  status: string | null;
};
type ComposerActivityRow = {
  key: string;
  icon: ReactElement;
  label: string;
  meta: ReactNode;
  action?: string;
};
type ProgressItem = {
  label: string;
  done?: boolean;
  active?: boolean;
};

function hasTextSelectionInside(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const container = selection.getRangeAt(index).commonAncestorContainer;
    const node =
      container.nodeType === Node.ELEMENT_NODE
        ? container
        : container.parentNode;
    if (node && element.contains(node)) return true;
  }
  return false;
}

function itemScrollSignature(item: TurnItem): string {
  if (item.type === "user" || item.type === "assistant") {
    return `${item.type}:${item.id}:${item.text.length}:${item.text.slice(-32)}:${
      item.images?.length ?? 0
    }`;
  }
  if (item.type === "reasoning") {
    return `${item.type}:${item.id}:${item.status ?? ""}:${item.text.length}:${item.text.slice(
      -24,
    )}`;
  }
  if (item.type === "command") {
    return `${item.type}:${item.id}:${item.status}:${item.exitCode ?? ""}:${
      item.output.length
    }:${item.stdout.length}:${item.stderr.length}`;
  }
  if (item.type === "fileChange") {
    return `${item.type}:${item.id}:${item.status ?? ""}:${item.diff.length}:${
      item.changes?.length ?? 0
    }`;
  }
  if (item.type === "plan") {
    return `${item.type}:${item.id}:${item.status ?? ""}:${item.steps
      .map((step) => `${step.status ?? ""}:${step.text.length}`)
      .join("|")}`;
  }
  if (item.type === "approval") {
    return `${item.type}:${item.id}:${item.status ?? ""}:${item.title.length}`;
  }
  if (item.type === "image") {
    return `${item.type}:${item.id}:${item.image.url ?? ""}:${item.image.path ?? ""}`;
  }
  if (item.type === "error") {
    return `${item.type}:${item.id}:${item.code ?? ""}:${item.message.length}`;
  }
  if (item.type === "toolOutput") {
    return `${item.type}:${item.id}:${item.status ?? ""}:${item.text.length}`;
  }
  return `${item.type}:${item.id}:${item.rawType}`;
}

function turnsScrollSignature(turns: ThreadTurn[]): string {
  const latestTurn = turns.at(-1);
  if (!latestTurn) return "empty";
  return [
    latestTurn.id,
    latestTurn.status,
    latestTurn.items.length,
    ...latestTurn.items.slice(-3).map(itemScrollSignature),
  ].join("::");
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function projectDisplayName(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

function rightSidebarTabCopyKey(
  type: RightSidebarTab,
  field: "label" | "description",
): I18nKey {
  return `rightSidebar.tabs.${type}.${field}` as I18nKey;
}

function rightSidebarTabShortcut(type: RightSidebarTab): string | null {
  void type;
  return null;
}

function rightSidebarTabIcon(type: RightSidebarTab, size = 16): ReactElement {
  switch (type) {
    case "chat":
      return <MessageSquare size={size} />;
    case "files":
      return <FileText size={size} />;
    case "browser":
      return <Globe2 size={size} />;
    case "review":
      return <FileDiff size={size} />;
    case "terminal":
      return <TerminalSquare size={size} />;
  }
}

function normalizePathForCompare(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function isAbsoluteFsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
}

function relativePathFromTarget(
  root: string | null,
  targetPath?: string | null,
): string | null {
  if (!targetPath) return null;
  const normalizedTarget = targetPath.replaceAll("\\", "/");
  if (!isAbsoluteFsPath(targetPath))
    return normalizedTarget.replace(/^\.?\//, "");
  if (!root) return null;
  const normalizedRoot = normalizePathForCompare(root);
  const normalizedAbsoluteTarget = normalizePathForCompare(targetPath);
  if (normalizedAbsoluteTarget === normalizedRoot) return "";
  if (!normalizedAbsoluteTarget.startsWith(`${normalizedRoot}/`)) return null;
  return targetPath
    .replaceAll("\\", "/")
    .slice(root.replaceAll("\\", "/").length + 1);
}

function parentPath(relativePath: string): string {
  const parts = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function filePreviewRequestForPath(
  path: string,
  root: string | null,
): { path: string; root?: string | null } {
  return isAbsoluteFsPath(path) ? { path } : { path, root };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "codex_web.rightSidebarWidth";
const FILE_TREE_WIDTH_STORAGE_KEY = "codex_web.fileTreeWidth";

function readStoredWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredWidth(key: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // localStorage can be unavailable in hardened browser contexts.
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDurationMs(value: number | null): string {
  if (value === null) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function formatFileTime(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function ownerRuntimeLabel(
  thread: Thread | null,
  ipc: OfficialIpcStatus | null,
): string {
  const owner = thread?.owner;
  if (!owner?.clientId) return "unknown";
  if (ipc?.clientId && owner.clientId === ipc.clientId) return "web";
  if (owner.kind && owner.kind !== "unknown") return owner.kind;
  return owner.source === "official-ipc" ? "official" : owner.source;
}

function ownerRuntimeDisplay(
  thread: Thread | null,
  ipc: OfficialIpcStatus | null,
): string {
  const label = ownerRuntimeLabel(thread, ipc);
  if (label === "official") return "Desktop / VS Code";
  if (label === "web") return "Web";
  if (label === "unknown") return "自动";
  return label;
}

function MobileFoldout({
  icon,
  label,
  meta,
  children,
}: {
  icon: ReactElement;
  label: string;
  meta: string;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : !window.matchMedia("(max-width: 680px)").matches,
  );
  const bodyClassName = open
    ? `${styles.foldoutBody} ${styles.foldoutBodyOpen}`
    : styles.foldoutBody;

  return (
    <article className={`${styles.assistantMessage} ${styles.mobileFoldout}`}>
      <button
        className={styles.foldoutSummary}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.messageAuthor}>
          <span className={styles.avatar}>{icon}</span>
          <span>
            <span className={styles.authorName}>{label}</span>
            <span className={styles.authorMeta}>{meta}</span>
          </span>
        </span>
        <ChevronDown
          className={open ? styles.foldoutChevronOpen : styles.foldoutChevron}
          size={16}
        />
      </button>
      <div className={bodyClassName}>{children}</div>
    </article>
  );
}

function ProjectFilesBrowser({
  root,
  compact = false,
  targetPath,
  onSelectFile,
}: {
  root: string | null;
  compact?: boolean;
  targetPath?: string | null;
  onSelectFile?: (path: string) => void;
}): ReactElement {
  const [relativePath, setRelativePath] = useState("");
  const [listing, setListing] = useState<FileBrowserListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const targetRelativePath = relativePathFromTarget(root, targetPath);
  const browserTestId = compact ? "right-file-browser" : "file-browser";
  const fileListTestId = compact ? "right-file-list" : "file-list";

  useEffect(() => {
    setRelativePath("");
    setListing(null);
    setError("");
  }, [root]);

  useEffect(() => {
    if (!targetRelativePath) return;
    setRelativePath(parentPath(targetRelativePath));
  }, [targetRelativePath]);

  const refresh = useCallback(async () => {
    if (!root) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const nextListing = await listProjectFiles({
        root,
        path: relativePath,
        limit: 160,
      });
      if (requestId === requestIdRef.current) {
        setListing(nextListing);
        setError("");
      }
    } catch (unknownError) {
      if (requestId === requestIdRef.current) {
        setError(
          unknownError instanceof Error
            ? unknownError.message
            : "file list failed",
        );
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [relativePath, root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!root) {
    return (
      <div
        data-testid={browserTestId}
        className={[
          styles.fileBrowser,
          compact ? styles.fileBrowserCompact : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={styles.fileNotice}>当前会话没有项目目录。</div>
      </div>
    );
  }

  return (
    <div
      data-testid={browserTestId}
      className={[styles.fileBrowser, compact ? styles.fileBrowserCompact : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.fileToolbar}>
        <button
          className={styles.blockActionButton}
          type="button"
          aria-label="返回上级目录"
          disabled={!listing?.parentRelativePath && !listing?.relativePath}
          onClick={() => setRelativePath(listing?.parentRelativePath ?? "")}
        >
          <ChevronDown size={14} className={styles.rotateLeft} />
        </button>
        <span className={styles.filePathLabel} title={listing?.path ?? root}>
          {listing?.relativePath || projectDisplayName(root)}
        </span>
        <button
          className={styles.blockActionButton}
          type="button"
          aria-label="刷新文件列表"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {error ? <div className={styles.fileNotice}>{error}</div> : null}
      {loading && !listing ? (
        <div className={styles.fileNotice}>正在读取文件...</div>
      ) : null}
      {listing ? (
        <div
          className={styles.fileList}
          data-testid={fileListTestId}
          role="list"
          aria-label="项目文件"
        >
          {listing.entries.map((entry) => {
            const isDirectory = entry.kind === "directory";
            const selected =
              !isDirectory &&
              targetRelativePath !== null &&
              normalizePathForCompare(entry.relativePath) ===
                normalizePathForCompare(targetRelativePath);
            const rowClassName = [
              styles.fileRow,
              selected ? styles.fileRowActive : "",
            ]
              .filter(Boolean)
              .join(" ");
            const rowContent = (
              <>
                {isDirectory ? <Folder size={15} /> : <FileText size={15} />}
                <span className={styles.fileName}>
                  <strong>{entry.name}</strong>
                  <small>{entry.relativePath || entry.name}</small>
                </span>
                <span>
                  {isDirectory ? "folder" : entry.extension || "file"}
                </span>
                <span>
                  {entry.size === null
                    ? formatFileTime(entry.mtimeIso)
                    : formatBytes(entry.size)}
                </span>
              </>
            );
            if (isDirectory) {
              return (
                <button
                  className={rowClassName}
                  key={entry.relativePath || entry.name}
                  type="button"
                  onClick={() => setRelativePath(entry.relativePath)}
                >
                  {rowContent}
                </button>
              );
            }
            return (
              <button
                className={rowClassName}
                key={entry.relativePath || entry.name}
                type="button"
                onClick={() => onSelectFile?.(entry.path || entry.relativePath)}
              >
                {rowContent}
              </button>
            );
          })}
          {listing.entries.length === 0 ? (
            <div className={styles.fileNotice}>当前目录为空</div>
          ) : null}
          {listing.limited ? (
            <div className={styles.fileNotice}>仅显示前 160 项</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectFilesPanel({
  root,
}: {
  root: string | null;
}): ReactElement | null {
  if (!root) return null;
  return (
    <MobileFoldout
      icon={<FolderOpen size={16} />}
      label="文件"
      meta="只读项目视图"
    >
      <ProjectFilesBrowser root={root} />
    </MobileFoldout>
  );
}

function FilePreviewPane({
  root,
  path,
}: {
  root: string | null;
  path: string | null;
}): ReactElement {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError("");
    if (!path)
      return () => {
        disposed = true;
      };

    setLoading(true);
    getFilePreview({
      ...filePreviewRequestForPath(path, root),
      maxBytes: 180_000,
    })
      .then((nextPreview) => {
        if (disposed) return;
        setPreview(nextPreview);
      })
      .catch((unknownError: unknown) => {
        if (disposed) return;
        setError(
          unknownError instanceof Error
            ? unknownError.message
            : "无法读取文件内容",
        );
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [path, root]);

  if (!path) {
    return (
      <div className={styles.filePreviewPane}>
        <div className={styles.filePreviewEmptyState}>
          <FolderOpen size={34} />
          <strong>打开文件</strong>
          <span>从工作区目录树中选择文件</span>
        </div>
      </div>
    );
  }

  const previewRequest = filePreviewRequestForPath(path, root);
  return (
    <div className={styles.filePreviewPane}>
      <div className={styles.filePreviewHeader}>
        <span title={path}>{relativePathFromTarget(root, path) ?? path}</span>
      </div>
      {loading ? (
        <div className={styles.filePreviewNotice}>正在读取文件...</div>
      ) : null}
      {error ? (
        <div className={styles.filePreviewNotice}>无法预览：{error}</div>
      ) : null}
      {!loading && !error && preview?.kind === "image" ? (
        <div className={styles.filePreviewImagePane}>
          <img
            src={fileContentUrl(previewRequest)}
            alt={preview.filename}
            loading="lazy"
          />
        </div>
      ) : null}
      {!loading && !error && preview?.kind === "text" ? (
        preview.filename.toLowerCase().endsWith(".md") ? (
          <div className={styles.filePreviewMarkdownPane}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {preview.content ?? ""}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className={styles.filePreviewPre}>{preview.content ?? ""}</pre>
        )
      ) : null}
      {!loading && !error && preview?.kind === "binary" ? (
        <div className={styles.filePreviewNotice}>
          {preview.filename} 是二进制文件，大小 {formatBytes(preview.size)}。
        </div>
      ) : null}
      {preview?.truncated ? (
        <div className={styles.filePreviewNotice}>文件较大，已截断预览。</div>
      ) : null}
    </div>
  );
}

function BottomTerminalDock({
  projectRoot,
}: {
  projectRoot: string | null;
}): ReactElement {
  return (
    <section className={styles.bottomTerminalDock} aria-label="命令行">
      <div className={styles.bottomTerminalTab}>
        <TerminalSquare size={14} />
        <span>PowerShell</span>
      </div>
      <pre>{`PowerShell 7.5.5\n(base) PS ${projectRoot ?? "~"}>`}</pre>
    </section>
  );
}

function RightSidebarLauncher({
  onCreateTab,
}: {
  onCreateTab: (type: RightSidebarTab) => void;
}): ReactElement {
  const { t } = useI18n();
  const entries: RightSidebarTab[] = ["files", "chat", "browser", "review"];

  return (
    <div
      className={styles.sidePanelLauncher}
      aria-label={t("rightSidebar.aria.newTab")}
    >
      {entries.map((type) => {
        const shortcut = rightSidebarTabShortcut(type);
        return (
          <button
            className={styles.sidePanelLauncherCard}
            key={type}
            type="button"
            onClick={() => onCreateTab(type)}
          >
            <span className={styles.sidePanelLauncherIcon}>
              {rightSidebarTabIcon(type, 22)}
            </span>
            <strong>{t(rightSidebarTabCopyKey(type, "label"))}</strong>
            <span>{t(rightSidebarTabCopyKey(type, "description"))}</span>
            {shortcut ? (
              <kbd className={styles.sidePanelLauncherShortcut}>{shortcut}</kbd>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SideChatPane({
  selectedThread,
  sideConversation,
  projectRoot,
  onOpenFileReference,
  onSendSideChat,
}: {
  selectedThread: Thread | null;
  sideConversation: SideConversation | null;
  projectRoot: string | null;
  onOpenFileReference: (path: string) => void;
  onSendSideChat: (sideConversationId: string, text: string) => Promise<void>;
}): ReactElement {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const sideConversationId = sideConversation?.id ?? "";
  const contextCount =
    sideConversation?.turns.reduce(
      (count, turn) => count + turn.items.length,
      0,
    ) ?? 0;
  const statusLabel = sideConversation?.inProgress
    ? t("rightSidebar.chat.active")
    : t("rightSidebar.chat.idle");
  const threadTitle =
    sideConversation?.title ??
    selectedThread?.title ??
    t("rightSidebar.chat.noThread");
  const renderedRows = useMemo(
    () =>
      sideConversation
        ? sideConversation.turns.flatMap((turn) =>
            renderTurnItems(turn.items, turn.status, {
              projectRoot,
              onOpenFileReference,
            }),
          )
        : [],
    [onOpenFileReference, projectRoot, sideConversation],
  );
  const inputDisabled =
    !sideConversation || sideConversation.inProgress || sending;
  const canSend = !inputDisabled && text.trim().length > 0;
  const placeholder = sideConversation
    ? sideConversation.inProgress
      ? t("rightSidebar.chat.generatingPlaceholder")
      : t("rightSidebar.chat.placeholder")
    : t("rightSidebar.chat.waitingPlaceholder");

  useEffect(() => {
    setText("");
    setSendError("");
    setSending(false);
  }, [sideConversationId]);

  const submitSideChatMessage = useCallback(async () => {
    const trimmedText = text.trim();
    if (!sideConversationId || !trimmedText || inputDisabled) return;
    setSending(true);
    setSendError("");
    try {
      await onSendSideChat(sideConversationId, trimmedText);
      setText("");
    } catch (unknownError) {
      setSendError(
        unknownError instanceof Error
          ? unknownError.message
          : t("rightSidebar.chat.sendFailed"),
      );
    } finally {
      setSending(false);
    }
  }, [inputDisabled, onSendSideChat, sideConversationId, t, text]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submitSideChatMessage();
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void submitSideChatMessage();
  };

  return (
    <section
      className={styles.sideChatShell}
      aria-label={t("rightSidebar.tabs.chat.label")}
    >
      <div className={styles.sideChatThreadBar}>
        <span className={styles.sideChatThreadIcon}>
          <MessageSquare size={16} />
        </span>
        <div className={styles.sideChatThreadCopy}>
          <strong>{threadTitle}</strong>
          <span>
            {sideConversation
              ? t("rightSidebar.chat.contextCount", { count: contextCount })
              : selectedThread
                ? selectedThread.title
                : t("rightSidebar.chat.emptyContext")}
          </span>
        </div>
        <span className={styles.sideChatContextPill}>{statusLabel}</span>
      </div>
      <div className={styles.sideChatTranscript}>
        {sideConversation ? (
          renderedRows.length > 0 ? (
            renderedRows
          ) : (
            <div className={styles.sideChatEmpty}>当前侧边聊天暂无消息。</div>
          )
        ) : (
          <div className={styles.sideChatSyncNotice}>
            <strong>{t("rightSidebar.chat.desktopSyncPending")}</strong>
            <span>{t("rightSidebar.chat.desktopSyncDescription")}</span>
          </div>
        )}
      </div>
      <form className={styles.sideChatComposerShell} onSubmit={handleSubmit}>
        {sendError ? (
          <div className={styles.sideChatError} role="alert">
            {sendError}
          </div>
        ) : null}
        {sending ? (
          <div className={styles.sideChatSendingLine}>
            {t("rightSidebar.chat.sending")}
          </div>
        ) : null}
        <textarea
          aria-label={t("rightSidebar.chat.input")}
          className={styles.sideChatComposerInput}
          disabled={inputDisabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          value={text}
        />
        <div className={styles.sideChatComposerBar}>
          <button
            className={styles.sideChatComposerIcon}
            type="button"
            aria-label={t("rightSidebar.chat.add")}
            disabled
          >
            <Plus size={17} />
          </button>
          <button
            className={styles.sideChatSendButton}
            type="submit"
            aria-label={t("rightSidebar.chat.send")}
            disabled={!canSend}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </form>
    </section>
  );
}

function DesktopRightSidebar({
  tabs,
  activeTabId,
  launcherOpen,
  onSelectTab,
  onCloseTab,
  onCreateTab,
  onShowLauncher,
  projectRoot,
  selectedThread,
  threadDetail,
  selectedFilePath,
  onOpenFileReference,
  onSendSideChat,
  onSelectFile,
  fileTreeWidth,
  onFileTreeResizeStart,
}: {
  tabs: RightSidebarTabInstance[];
  activeTabId: string | null;
  launcherOpen: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCreateTab: (type: RightSidebarTab) => void;
  onShowLauncher: () => void;
  projectRoot: string | null;
  selectedThread: Thread | null;
  threadDetail: ThreadDetail | null;
  selectedFilePath: string | null;
  onOpenFileReference: (path: string) => void;
  onSendSideChat: (sideConversationId: string, text: string) => Promise<void>;
  onSelectFile: (path: string) => void;
  fileTreeWidth: number;
  onFileTreeResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): ReactElement {
  const { t } = useI18n();
  const fileLayoutStyle = {
    "--file-tree-width": `${fileTreeWidth}px`,
  } as CSSProperties;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const showLauncher = launcherOpen || !activeTab;
  const activeFilePath =
    activeTab?.type === "files"
      ? (activeTab.filePath ?? selectedFilePath)
      : selectedFilePath;
  const activeSideConversation =
    activeTab?.type === "chat" && activeTab.sideConversationId
      ? (threadDetail?.sideConversations.find(
          (conversation) => conversation.id === activeTab.sideConversationId,
        ) ?? null)
      : null;

  return (
    <aside
      className={styles.rightSidePanel}
      aria-label={t("rightSidebar.aria.panel")}
    >
      <div
        className={styles.sidePanelTabBar}
        role="tablist"
        aria-label={t("rightSidebar.aria.tabList")}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId && !showLauncher;
          const label = tab.title;
          return (
            <span
              className={
                active ? styles.sidePanelTabItemActive : styles.sidePanelTabItem
              }
              key={tab.id}
            >
              <button
                className={
                  active ? styles.sidePanelTabActive : styles.sidePanelTab
                }
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectTab(tab.id)}
              >
                {rightSidebarTabIcon(tab.type, 14)}
                <span>{label}</span>
              </button>
              <button
                className={styles.sidePanelTabClose}
                type="button"
                aria-label={t("rightSidebar.aria.closeTab", { label })}
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={13} />
              </button>
            </span>
          );
        })}
        <button
          className={styles.sidePanelIconButton}
          type="button"
          aria-label={t("rightSidebar.aria.newTab")}
          aria-expanded={showLauncher}
          onClick={onShowLauncher}
        >
          <Plus size={15} />
        </button>
      </div>
      {showLauncher ? <RightSidebarLauncher onCreateTab={onCreateTab} /> : null}
      {!showLauncher && activeTab?.type === "chat" ? (
        <SideChatPane
          selectedThread={selectedThread}
          sideConversation={activeSideConversation}
          projectRoot={projectRoot}
          onOpenFileReference={onOpenFileReference}
          onSendSideChat={onSendSideChat}
        />
      ) : null}
      {!showLauncher && activeTab?.type === "files" ? (
        <div className={styles.fileSideLayout} style={fileLayoutStyle}>
          <FilePreviewPane root={projectRoot} path={activeFilePath} />
          <div
            className={styles.fileTreeResizer}
            role="separator"
            aria-label="调整文件树宽度"
            aria-orientation="vertical"
            onPointerDown={onFileTreeResizeStart}
          />
          <ProjectFilesBrowser
            compact
            root={projectRoot}
            targetPath={activeFilePath}
            onSelectFile={onSelectFile}
          />
        </div>
      ) : null}
      {!showLauncher &&
      activeTab &&
      activeTab.type !== "chat" &&
      activeTab.type !== "files" ? (
        <div className={styles.sidePanelPendingPane}>
          <div className={styles.sidePanelPendingCard}>
            {rightSidebarTabIcon(activeTab.type, 24)}
            <strong>
              {t(rightSidebarTabCopyKey(activeTab.type, "label"))}
            </strong>
            <span>
              {t(rightSidebarTabCopyKey(activeTab.type, "description"))}
            </span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function RuntimeStatusContent({
  ipc,
  appServer,
  selectedThread,
  realtimeEvents,
}: {
  ipc: OfficialIpcStatus | null;
  appServer: AppServerStatus | null;
  selectedThread: Thread | null;
  realtimeEvents: RealtimeEvent[];
}): ReactElement {
  const eventPreview = realtimeEvents.map((event) => event.type).slice(0, 4);

  return (
    <>
      <div className={styles.statusGrid}>
        <div className={styles.statusTile}>
          <CheckCircle2 size={16} />
          <span>Desktop</span>
          <strong>{ipc?.connected ? "已连接" : "离线"}</strong>
        </div>
        <div className={styles.statusTile}>
          <Zap size={16} />
          <span>实时事件</span>
          <strong>
            {eventPreview.length ? `${eventPreview.length} 条` : "等待中"}
          </strong>
        </div>
        <div className={styles.statusTile}>
          <Laptop size={16} />
          <span>执行端</span>
          <strong>{ownerRuntimeDisplay(selectedThread, ipc)}</strong>
        </div>
        <div className={styles.statusTile}>
          <Command size={16} />
          <span>app-server</span>
          <strong>{appServer?.initialized ? "ready" : "等待"}</strong>
        </div>
      </div>
      <div className={styles.eventList}>
        {(eventPreview.length ? eventPreview : ["暂无实时事件"]).map(
          (eventLabel) => (
            <span key={eventLabel}>
              <Clock3 size={13} />
              {eventLabel}
            </span>
          ),
        )}
      </div>
    </>
  );
}

function RuntimeDetailsContent({
  config,
  appServer,
}: {
  config: AppConfig | null;
  appServer: AppServerStatus | null;
}): ReactElement {
  return (
    <>
      <div className={styles.detailRows}>
        <div>
          <span>地址</span>
          <strong>
            {config ? `${config.server.host}:${config.server.port}` : "loading"}
          </strong>
        </div>
        <div>
          <span>前端</span>
          <strong>{config ? config.dev.frontendPort : "loading"}</strong>
        </div>
        <div>
          <span>数据</span>
          <strong>{config?.dataDir ?? "loading"}</strong>
        </div>
        <div>
          <span>等待调用</span>
          <strong>{appServer?.pendingCallCount ?? 0}</strong>
        </div>
      </div>
    </>
  );
}

function workspaceChangeLabel(
  status: WorkspaceStatus | null,
  loading: boolean,
  error: string,
): string {
  if (error) return "状态未知";
  if (!status) return loading ? "读取中" : "等待项目";
  if (!status.isGitRepository) return "非 Git";
  return status.changedFiles > 0 ? `${status.changedFiles} 个文件` : "干净";
}

function workspaceBranchLabel(
  status: WorkspaceStatus | null,
  loading: boolean,
  error: string,
): string {
  if (error) return "状态未知";
  if (!status) return loading ? "读取中" : "等待项目";
  if (!status.isGitRepository) return "非 Git";
  return status.branch ?? "detached";
}

function workspaceCommitLabel(
  status: WorkspaceStatus | null,
  loading: boolean,
  error: string,
): string {
  if (error) return "状态未知";
  if (!status) return loading ? "读取中" : "等待项目";
  if (!status.isGitRepository) return "非 Git";
  return status.commit ?? "无提交";
}

function githubCliLabel(
  status: WorkspaceStatus | null,
  loading: boolean,
  error: string,
): string {
  if (error) return "状态未知";
  if (!status) return loading ? "读取中" : "等待项目";
  if (status.githubCli.status === "available") return "已登录";
  if (status.githubCli.status === "not-authenticated") return "未登录";
  if (status.githubCli.status === "error") return "状态未知";
  return "CLI 不可用";
}

function localPortLabel(config: AppConfig | null): string {
  if (config) return `${config.server.port}`;
  if (typeof window === "undefined") return "loading";
  if (window.location.port) return window.location.port;
  return window.location.protocol === "https:" ? "443" : "80";
}

function isActiveStatus(status: string | null | undefined): boolean {
  const normalized = compactStatus(status);
  return Boolean(
    normalized &&
    [
      "active",
      "editing",
      "inprogress",
      "pending",
      "running",
      "started",
      "streaming",
      "thinking",
      "writing",
    ].includes(normalized),
  );
}

function compactStatus(status: string | null | undefined): string {
  return (status ?? "").toLowerCase().replace(/[-_\s]/g, "");
}

function isDoneStatus(status: string | null | undefined): boolean {
  const normalized = compactStatus(status);
  return Boolean(
    normalized &&
      [
        "complete",
        "completed",
        "done",
        "finished",
        "resolved",
        "success",
      ].includes(normalized),
  );
}

function formatGoalDuration(goal: ThreadGoal): string {
  const seconds = goal.timeUsedSeconds;
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function goalStatusLabel(goal: ThreadGoal): string {
  if (goal.status === "paused") return "已暂停的目标";
  if (goal.status === "completed") return "已完成的目标";
  return "进行中的目标";
}

function goalToggleStatus(goal: ThreadGoal): "active" | "paused" {
  return goal.status === "paused" ? "active" : "paused";
}

function goalToggleLabel(goal: ThreadGoal): string {
  return goal.status === "paused" ? "恢复目标" : "暂停目标";
}

const agentTones: AgentTone[] = [
  "blue",
  "orange",
  "green",
  "red",
  "violet",
  "neutral",
];

function subAgentRows(threadDetail: ThreadDetail | null): AgentRow[] {
  return (threadDetail?.subAgents ?? []).map((agent, index) => ({
    name: agent.name,
    role: agent.role ?? agent.status ?? "子智能体",
    status: agent.status,
    tone: agentTones[index % agentTones.length] ?? "neutral",
  }));
}

function latestActivityTurn(
  threadDetail: ThreadDetail | null,
): ThreadTurn | null {
  const turns = threadDetail?.turns ?? [];
  return (
    turns
      .slice()
      .reverse()
      .find((turn) => isActiveStatus(turn.status)) ??
    turns.at(-1) ??
    null
  );
}

function fileChangeEntries(item: FileChangeMessageItem): FileChangeEntry[] {
  const entries = item.changes?.length
    ? item.changes
    : [{ path: item.path, diff: item.diff, status: item.status, kind: null }];
  return entries.filter((entry) => entry.path || entry.diff);
}

function fileChangeStats(diff: string): {
  additions: number;
  deletions: number;
} {
  return diff.split(/\r?\n/).reduce(
    (stats, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) stats.additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) stats.deletions += 1;
      return stats;
    },
    { additions: 0, deletions: 0 },
  );
}

function summarizeFileActivity(turn: ThreadTurn): ComposerActivityRow | null {
  const items = turn.items.filter(
    (item): item is FileChangeMessageItem => item.type === "fileChange",
  );
  if (items.length === 0) return null;
  const entries = items.flatMap(fileChangeEntries);
  const totals = entries.reduce(
    (summary, entry) => {
      const stats = fileChangeStats(entry.diff);
      summary.additions += stats.additions;
      summary.deletions += stats.deletions;
      return summary;
    },
    { additions: 0, deletions: 0 },
  );
  const active =
    isActiveStatus(turn.status) &&
    items.some((item) => isActiveStatus(item.status) || item.status === null);
  return {
    key: "files",
    icon: <FileDiff size={14} />,
    label: `${active ? "正在编辑" : "已编辑"} ${entries.length || items.length} 个文件`,
    meta:
      totals.additions || totals.deletions ? (
        <>
          <b className={styles.composerActivityPositive}>+{totals.additions}</b>
          <b className={styles.composerActivityNegative}>-{totals.deletions}</b>
        </>
      ) : (
        "等待文件内容"
      ),
    action: active ? undefined : "在此审查",
  };
}

function summarizeCommandActivity(
  turn: ThreadTurn,
): ComposerActivityRow | null {
  const items = turn.items.filter(
    (item): item is CommandMessageItem => item.type === "command",
  );
  if (items.length === 0) return null;
  const active =
    isActiveStatus(turn.status) &&
    items.some((item) => isActiveStatus(item.status) || item.exitCode === null);
  const durationMs = items.reduce(
    (total, item) => total + (item.durationMs ?? 0),
    0,
  );
  return {
    key: "commands",
    icon: <Command size={14} />,
    label: `${active ? "正在运行" : "已运行"} ${items.length} 条命令`,
    meta:
      active && durationMs > 0
        ? `已持续 ${formatDurationMs(durationMs)}`
        : durationMs > 0
          ? formatDurationMs(durationMs)
          : "",
  };
}

function latestPlanProgress(threadDetail: ThreadDetail | null): ProgressItem[] {
  const planItem =
    threadDetail?.turns
      .flatMap((turn) => turn.items)
      .slice()
      .reverse()
      .find(
        (item): item is PlanMessageItem =>
          item.type === "plan" && item.steps.length > 0,
      ) ?? null;
  return (
    planItem?.steps.map((step) => ({
      label: step.text,
      done: isDoneStatus(step.status),
      active: isActiveStatus(step.status),
    })) ?? []
  );
}

function GoalActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      className={styles.goalActionButton}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ComposerGoalActivityRow({
  goal,
  expanded,
  busy,
  onEdit,
  onToggleStatus,
  onClear,
  onToggleExpanded,
}: {
  goal: ThreadGoal;
  expanded: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  onClear: () => void;
  onToggleExpanded: () => void;
}): ReactElement {
  const duration = formatGoalDuration(goal);
  return (
    <div className={styles.composerGoalRow}>
      <div className={styles.composerGoalHeader}>
        <span className={styles.composerActivityIcon}>
          <Target size={14} />
        </span>
        <span className={styles.composerActivityMain}>
          {goalStatusLabel(goal)}
        </span>
        <span className={styles.composerActivityMeta}>
          {duration ? (
            <span className={styles.goalDuration}>{duration}</span>
          ) : null}
          <span className={styles.goalObjectiveCompact}>{goal.objective}</span>
        </span>
        <span className={styles.goalActionGroup}>
          <GoalActionButton label="编辑目标" disabled={busy} onClick={onEdit}>
            <Pencil size={14} />
          </GoalActionButton>
          <GoalActionButton
            label={goalToggleLabel(goal)}
            disabled={busy || goal.status === "completed"}
            onClick={onToggleStatus}
          >
            {goal.status === "paused" ? (
              <PlayCircle size={14} />
            ) : (
              <PauseCircle size={14} />
            )}
          </GoalActionButton>
          <GoalActionButton label="清除目标" disabled={busy} onClick={onClear}>
            <Trash2 size={14} />
          </GoalActionButton>
          <GoalActionButton
            label={expanded ? "隐藏完整目标" : "显示完整目标"}
            disabled={false}
            onClick={onToggleExpanded}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </GoalActionButton>
        </span>
      </div>
      {expanded ? (
        <p className={styles.composerGoalFull}>{goal.objective}</p>
      ) : null}
    </div>
  );
}

function ComposerActivityStrip({
  threadDetail,
  goalExpanded,
  goalBusy,
  onEditGoal,
  onToggleGoalStatus,
  onClearGoal,
  onToggleGoalExpanded,
}: {
  threadDetail: ThreadDetail | null;
  goalExpanded: boolean;
  goalBusy: boolean;
  onEditGoal: () => void;
  onToggleGoalStatus: () => void;
  onClearGoal: () => void;
  onToggleGoalExpanded: () => void;
}): ReactElement | null {
  const activeTurn = latestActivityTurn(threadDetail);
  const goal = threadDetail?.goal ?? null;
  const rows = [
    activeTurn ? summarizeFileActivity(activeTurn) : null,
    activeTurn ? summarizeCommandActivity(activeTurn) : null,
  ].filter((row): row is ComposerActivityRow => Boolean(row));

  if (rows.length === 0 && !goal) return null;
  return (
    <div className={styles.composerActivityStrip} aria-label="当前活动摘要">
      {rows.map((row) => (
        <div className={styles.composerActivityRow} key={row.key}>
          <span className={styles.composerActivityIcon}>{row.icon}</span>
          <span className={styles.composerActivityMain}>{row.label}</span>
          <span className={styles.composerActivityMeta}>{row.meta}</span>
          {row.action ? (
            <span className={styles.composerActivityAction}>{row.action}</span>
          ) : null}
        </div>
      ))}
      {goal ? (
        <ComposerGoalActivityRow
          goal={goal}
          expanded={goalExpanded}
          busy={goalBusy}
          onEdit={onEditGoal}
          onToggleStatus={onToggleGoalStatus}
          onClear={onClearGoal}
          onToggleExpanded={onToggleGoalExpanded}
        />
      ) : null}
    </div>
  );
}

function GoalEditorDialog({
  open,
  draft,
  saving,
  onDraftChange,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  draft: string;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): ReactElement | null {
  if (!open) return null;
  const canSave = draft.trim().length > 0 && !saving;
  return (
    <div className={styles.goalDialogLayer} role="presentation">
      <button
        className={styles.goalDialogScrim}
        type="button"
        aria-label="关闭编辑目标"
        onClick={onCancel}
      />
      <form
        className={styles.goalDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-dialog-title"
        onSubmit={onSubmit}
      >
        <div className={styles.goalDialogIcon} aria-hidden="true">
          <Target size={19} />
        </div>
        <button
          className={styles.goalDialogClose}
          type="button"
          aria-label="关闭"
          onClick={onCancel}
        >
          <X size={18} />
        </button>
        <h2 id="goal-dialog-title">编辑目标</h2>
        <textarea
          className={styles.goalDialogTextarea}
          aria-label="目标内容"
          value={draft}
          disabled={saving}
          autoFocus
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <div className={styles.goalDialogActions}>
          <button type="button" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button type="submit" disabled={!canSave}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function DesktopActivityPanel({
  config,
  ipc,
  appServer,
  selectedThread,
  threadDetail,
  projectRoot,
  threadListLoading,
  realtimeEvents,
  onOpenSideChat,
}: {
  config: AppConfig | null;
  ipc: OfficialIpcStatus | null;
  appServer: AppServerStatus | null;
  selectedThread: Thread | null;
  threadDetail: ThreadDetail | null;
  projectRoot: string | null;
  threadListLoading: boolean;
  realtimeEvents: RealtimeEvent[];
  onOpenSideChat: (sideConversation: SideConversation) => void;
}): ReactElement {
  const [workspaceStatus, setWorkspaceStatus] =
    useState<WorkspaceStatus | null>(null);
  const [workspaceStatusLoading, setWorkspaceStatusLoading] = useState(false);
  const [workspaceStatusError, setWorkspaceStatusError] = useState("");
  const fallbackProgressItems: ProgressItem[] = [
    {
      label: threadListLoading
        ? "正在同步会话列表"
        : selectedThread?.inProgress
          ? "正在生成回复"
          : "当前会话已同步",
      done: Boolean(config) && !threadListLoading,
    },
    {
      label: ipc?.connected ? "Desktop 实时连接" : "等待 Desktop IPC",
      done: ipc?.connected === true,
    },
    {
      label: appServer?.initialized ? "app-server ready" : "等待 app-server",
      done: appServer?.initialized === true,
    },
  ];
  const planProgressItems = latestPlanProgress(threadDetail);
  const progressItems =
    planProgressItems.length > 0 ? planProgressItems : fallbackProgressItems;
  const subAgents = subAgentRows(threadDetail);
  const sideConversations = threadDetail?.sideConversations ?? [];
  const eventCount = realtimeEvents.length;
  const workspaceRefreshKey = useMemo(() => {
    const latestFileChange = threadDetail?.turns
      .flatMap((turn) => turn.items)
      .filter(
        (item): item is FileChangeMessageItem => item.type === "fileChange",
      )
      .at(-1);
    if (!latestFileChange) return selectedThread?.id ?? "none";
    return [
      selectedThread?.id ?? "",
      latestFileChange.id,
      latestFileChange.status ?? "",
      latestFileChange.diff.length,
      latestFileChange.changes?.length ?? 0,
    ].join(":");
  }, [selectedThread?.id, threadDetail?.turns]);
  const showWorkspaceDelta =
    workspaceStatus?.isGitRepository === true &&
    (workspaceStatus.changedFiles > 0 ||
      (workspaceStatus.additions ?? 0) > 0 ||
      (workspaceStatus.deletions ?? 0) > 0);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | null = null;
    if (!projectRoot) {
      setWorkspaceStatus(null);
      setWorkspaceStatusError("");
      setWorkspaceStatusLoading(false);
      return () => {
        disposed = true;
      };
    }

    const refreshWorkspaceStatus = (): void => {
      setWorkspaceStatusLoading(true);
      getWorkspaceStatus({ cwd: projectRoot })
        .then((status) => {
          if (disposed) return;
          setWorkspaceStatus(status);
          setWorkspaceStatusError("");
        })
        .catch((error: unknown) => {
          if (disposed) return;
          setWorkspaceStatusError(
            error instanceof Error ? error.message : "workspace status failed",
          );
        })
        .finally(() => {
          if (disposed) return;
          setWorkspaceStatusLoading(false);
          refreshTimer = window.setTimeout(refreshWorkspaceStatus, 30_000);
        });
    };

    refreshWorkspaceStatus();

    return () => {
      disposed = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [projectRoot, workspaceRefreshKey]);

  return (
    <aside className={styles.activityPanel} aria-label="运行状态">
      <section className={styles.activityCard}>
        <h2>进度</h2>
        <ul className={styles.progressList}>
          {progressItems.map((item) => (
            <li
              className={
                item.done
                  ? styles.progressItemDone
                  : item.active
                    ? styles.progressItemActive
                    : styles.progressItem
              }
              key={item.label}
            >
              <span aria-hidden="true" />
              <strong>{item.label}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.activityCard}>
        <h2>环境信息</h2>
        <div className={styles.activityMetricList}>
          <div className={styles.activityMetricRow}>
            <span className={styles.activityMetricIcon}>
              <FileDiff size={15} />
            </span>
            <strong>变更</strong>
            <span className={styles.activityMetricValue}>
              {workspaceChangeLabel(
                workspaceStatus,
                workspaceStatusLoading,
                workspaceStatusError,
              )}
            </span>
            {showWorkspaceDelta ? (
              <span
                className={styles.activityMetricDelta}
                aria-label="工作区变更统计"
              >
                <span className={styles.activityMetricPositive}>
                  +{workspaceStatus.additions ?? 0}
                </span>
                <span className={styles.activityMetricNegative}>
                  -{workspaceStatus.deletions ?? 0}
                </span>
              </span>
            ) : null}
          </div>
          <div className={styles.activityMetricRow}>
            <span className={styles.activityMetricIcon}>
              <HardDrive size={15} />
            </span>
            <strong>本地</strong>
            <span className={styles.activityMetricValue}>
              {localPortLabel(config)}
            </span>
          </div>
          <div className={styles.activityMetricRow}>
            <span className={styles.activityMetricIcon}>
              <Laptop size={15} />
            </span>
            <strong>执行端</strong>
            <span className={styles.activityMetricValue}>
              {ownerRuntimeDisplay(selectedThread, ipc)}
            </span>
          </div>
          <div className={styles.activityMetricRow}>
            <span className={styles.activityMetricIcon}>
              <GitBranch size={15} />
            </span>
            <strong>分支</strong>
            <span className={styles.activityMetricValue}>
              {workspaceBranchLabel(
                workspaceStatus,
                workspaceStatusLoading,
                workspaceStatusError,
              )}
            </span>
          </div>
          <div className={styles.activityMetricRow}>
            <span className={styles.activityMetricIcon}>
              <GitCommitHorizontal size={15} />
            </span>
            <strong>提交</strong>
            <span className={styles.activityMetricValue}>
              {workspaceCommitLabel(
                workspaceStatus,
                workspaceStatusLoading,
                workspaceStatusError,
              )}
            </span>
          </div>
          <div className={styles.activityMetricRow}>
            <span className={styles.activityMetricIcon}>
              <Github size={15} />
            </span>
            <strong>GitHub</strong>
            <span className={styles.activityMetricValue}>
              {githubCliLabel(
                workspaceStatus,
                workspaceStatusLoading,
                workspaceStatusError,
              )}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.activityCard}>
        <h2>子智能体</h2>
        <div className={styles.agentList}>
          {subAgents.length ? (
            subAgents.map((agent) => (
              <div className={styles.agentRow} key={agent.name}>
                <span className={styles.agentAvatar} data-tone={agent.tone}>
                  {agent.name.slice(0, 1)}
                </span>
                <strong>{agent.name}</strong>
                <span>{agent.role}</span>
              </div>
            ))
          ) : (
            <div className={styles.agentRow}>
              <span className={styles.agentAvatar} data-tone="neutral">
                -
              </span>
              <strong>官方暂未提供子智能体列表</strong>
              <span>等待结构化数据</span>
            </div>
          )}
        </div>
      </section>

      <section className={styles.activityCard}>
        <h2>侧边聊天</h2>
        <div className={styles.activitySideChatList}>
          {sideConversations.length > 0 ? (
            sideConversations.map((sideConversation) => (
              <button
                className={styles.activitySideChatButton}
                type="button"
                key={sideConversation.id}
                onClick={() => onOpenSideChat(sideConversation)}
              >
                <span className={styles.activityMetricIcon}>
                  <MessageSquare size={15} />
                </span>
                <strong>{sideConversation.title}</strong>
                <span className={styles.activityMetricValue}>
                  {sideConversation.inProgress
                    ? "正在生成"
                    : sideConversation.turnCount > 0
                      ? `${sideConversation.turnCount} 轮`
                      : "空白"}
                </span>
                <ChevronDown size={14} />
              </button>
            ))
          ) : (
            <div className={styles.activitySideChatEmpty}>
              <span className={styles.activityMetricIcon}>
                <MessageSquare size={15} />
              </span>
              <strong>暂无侧边聊天</strong>
              <span>等待同步</span>
            </div>
          )}
        </div>
      </section>

      <section className={styles.activityCard}>
        <h2>来源</h2>
        <div className={styles.activityMetricList}>
          <div className={styles.activityMetricRow}>
            <span className={styles.activityMetricIcon}>
              <Globe2 size={15} />
            </span>
            <strong>网页搜索</strong>
            <span className={styles.activityMetricValue}>
              {eventCount ? "可用" : "待同步"}
            </span>
          </div>
        </div>
      </section>
    </aside>
  );
}

export function ChatMain({
  config,
  ipc,
  appServer,
  threadList,
  threadListLoading,
  selectedThread,
  draftThread,
  threadDetail,
  approvals,
  detailLoading,
  realtimeEvents,
  error,
  onDecideApproval,
  pinnedSummaryOpen,
  rightSidebarOpen,
  bottomTerminalOpen,
  onOpenRightSidebar,
  onSendSideChat,
  onSetThreadGoal,
  onClearThreadGoal,
  composer,
}: {
  config: AppConfig | null;
  ipc: OfficialIpcStatus | null;
  appServer: AppServerStatus | null;
  threadList: ThreadList;
  threadListLoading: boolean;
  selectedThread: Thread | null;
  draftThread: DraftThreadView | null;
  threadDetail: ThreadDetail | null;
  approvals: PendingApproval[];
  detailLoading: boolean;
  realtimeEvents: RealtimeEvent[];
  error: string;
  onDecideApproval: (id: string, decision: ApprovalDecision) => Promise<void>;
  pinnedSummaryOpen: boolean;
  rightSidebarOpen: boolean;
  bottomTerminalOpen: boolean;
  onOpenRightSidebar: () => void;
  onSendSideChat: (sideConversationId: string, text: string) => Promise<void>;
  onSetThreadGoal: (
    threadId: string,
    input: { objective?: string; status?: "active" | "paused" },
  ) => Promise<void>;
  onClearThreadGoal: (threadId: string) => Promise<void>;
  composer: ReactNode;
}): ReactElement {
  const { t } = useI18n();
  const isDraftThread = Boolean(draftThread);
  const turns = threadDetail?.turns ?? [];
  const selectedThreadId = selectedThread?.id ?? "";
  const selectedThreadTitle = selectedThread?.title ?? "";
  const visibleApprovals = selectedThreadId
    ? approvals.filter(
        (approval) =>
          !approval.threadId || approval.threadId === selectedThreadId,
      )
    : approvals;
  const visibleApprovalsKey = visibleApprovals
    .map((approval) => `${approval.id}:${approval.status ?? ""}`)
    .join("|");
  const selectedProject = selectedThread?.projectId
    ? (threadList.projects.find(
        (project) => project.id === selectedThread.projectId,
      ) ?? null)
    : null;
  const projectRoot =
    draftThread?.cwd ??
    selectedProject?.path ??
    selectedThread?.projectId ??
    selectedThread?.path ??
    null;
  const draftProjectLabel = draftThread?.projectName ?? "当前工作区";
  const chatColumnRef = useRef<HTMLDivElement | null>(null);
  const lastThreadIdRef = useRef<string | null>(null);
  const lastRowCountRef = useRef(0);
  const lastMessageSignatureRef = useRef("none");
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readStoredWidth(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, 560, 380, 780),
  );
  const [fileTreeWidth, setFileTreeWidth] = useState(() =>
    readStoredWidth(FILE_TREE_WIDTH_STORAGE_KEY, 270, 220, 460),
  );
  const [fileSidebarTarget, setFileSidebarTarget] = useState<string | null>(
    null,
  );
  const [rightSidebarTabs, setRightSidebarTabs] = useState<
    RightSidebarTabInstance[]
  >([]);
  const [activeRightSidebarTabId, setActiveRightSidebarTabId] = useState<
    string | null
  >(null);
  const [rightSidebarLauncherOpen, setRightSidebarLauncherOpen] =
    useState(false);
  const rightSidebarTabCounterRef = useRef(0);
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalMutationPending, setGoalMutationPending] = useState(false);
  const [goalExpandedByThread, setGoalExpandedByThread] = useState<
    Record<string, boolean>
  >({});
  const currentGoal = threadDetail?.goal ?? null;
  const goalExpanded = selectedThreadId
    ? (goalExpandedByThread[selectedThreadId] ?? false)
    : false;

  useEffect(() => {
    writeStoredWidth(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, rightSidebarWidth);
  }, [rightSidebarWidth]);

  useEffect(() => {
    writeStoredWidth(FILE_TREE_WIDTH_STORAGE_KEY, fileTreeWidth);
  }, [fileTreeWidth]);

  const createRightSidebarTab = useCallback(
    (
      type: RightSidebarTab,
      options?: {
        filePath?: string | null;
        sideConversationId?: string | null;
        title?: string | null;
      },
    ) => {
      if (type === "terminal") return;
      const id = `${type}-${options?.sideConversationId ?? Date.now()}-${rightSidebarTabCounterRef.current++}`;
      const title =
        options?.title ||
        (type === "files" && options?.filePath
          ? projectDisplayName(options.filePath)
          : t(rightSidebarTabCopyKey(type, "label")));
      const nextTab: RightSidebarTabInstance = {
        id,
        type,
        title,
        filePath: type === "files" ? (options?.filePath ?? null) : null,
        sideConversationId:
          type === "chat" ? (options?.sideConversationId ?? null) : null,
      };
      setRightSidebarTabs((current) => [...current, nextTab]);
      setActiveRightSidebarTabId(id);
      setRightSidebarLauncherOpen(false);
      onOpenRightSidebar();
    },
    [onOpenRightSidebar, t],
  );

  const handleOpenFileReference = useCallback(
    (path: string) => {
      setFileSidebarTarget(path);
      createRightSidebarTab("files", { filePath: path });
    },
    [createRightSidebarTab],
  );

  const handleOpenSideChatFromSummary = useCallback(
    (sideConversation: SideConversation) => {
      const existingChatTab = rightSidebarTabs.find(
        (tab) =>
          tab.type === "chat" && tab.sideConversationId === sideConversation.id,
      );
      if (existingChatTab) {
        setActiveRightSidebarTabId(existingChatTab.id);
        setRightSidebarLauncherOpen(false);
        onOpenRightSidebar();
        return;
      }
      createRightSidebarTab("chat", {
        sideConversationId: sideConversation.id,
        title: sideConversation.title,
      });
    },
    [createRightSidebarTab, onOpenRightSidebar, rightSidebarTabs],
  );

  useEffect(() => {
    const sideConversationById = new Map(
      (threadDetail?.sideConversations ?? []).map((conversation) => [
        conversation.id,
        conversation,
      ]),
    );
    setRightSidebarTabs((current) =>
      current.map((tab) => {
        if (tab.type !== "chat" || !tab.sideConversationId) return tab;
        const sideConversation = sideConversationById.get(
          tab.sideConversationId,
        );
        if (!sideConversation || sideConversation.title === tab.title)
          return tab;
        return { ...tab, title: sideConversation.title };
      }),
    );
  }, [threadDetail?.sideConversations]);

  const handleSelectRightSidebarTab = useCallback((id: string) => {
    setActiveRightSidebarTabId(id);
    setRightSidebarLauncherOpen(false);
  }, []);

  const handleCloseRightSidebarTab = useCallback(
    (id: string) => {
      setRightSidebarTabs((current) => {
        const closingIndex = current.findIndex((tab) => tab.id === id);
        const nextTabs = current.filter((tab) => tab.id !== id);
        if (activeRightSidebarTabId === id) {
          const fallbackTab =
            nextTabs[Math.min(closingIndex, nextTabs.length - 1)] ?? null;
          setActiveRightSidebarTabId(fallbackTab?.id ?? null);
          setRightSidebarLauncherOpen(!fallbackTab);
        }
        return nextTabs;
      });
    },
    [activeRightSidebarTabId],
  );

  const handleShowRightSidebarLauncher = useCallback(() => {
    setRightSidebarLauncherOpen(true);
  }, []);

  const handleSelectRightSidebarFile = useCallback(
    (path: string) => {
      setFileSidebarTarget(path);
      setRightSidebarTabs((current) =>
        current.map((tab) =>
          tab.id === activeRightSidebarTabId && tab.type === "files"
            ? { ...tab, title: projectDisplayName(path), filePath: path }
            : tab,
        ),
      );
    },
    [activeRightSidebarTabId],
  );

  useEffect(() => {
    if (!rightSidebarOpen) return;
    if (rightSidebarTabs.length > 0) return;
    setRightSidebarLauncherOpen(true);
  }, [rightSidebarOpen, rightSidebarTabs.length]);

  useEffect(() => {
    if (!activeRightSidebarTabId) return;
    if (rightSidebarTabs.some((tab) => tab.id === activeRightSidebarTabId)) {
      return;
    }
    const fallbackTab = rightSidebarTabs.at(-1) ?? null;
    setActiveRightSidebarTabId(fallbackTab?.id ?? null);
    setRightSidebarLauncherOpen(!fallbackTab);
  }, [activeRightSidebarTabId, rightSidebarTabs]);

  const handleRightSidebarResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = rightSidebarWidth;
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const nextWidth = clamp(
          startWidth + startX - moveEvent.clientX,
          380,
          780,
        );
        setRightSidebarWidth(nextWidth);
      };
      const stopResize = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
    },
    [rightSidebarWidth],
  );
  const handleFileTreeResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = fileTreeWidth;
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const nextWidth = clamp(
          startWidth + startX - moveEvent.clientX,
          220,
          460,
        );
        setFileTreeWidth(nextWidth);
      };
      const stopResize = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
    },
    [fileTreeWidth],
  );

  useEffect(() => {
    setFileSidebarTarget(null);
  }, [projectRoot]);

  useEffect(() => {
    setGoalEditorOpen(false);
    setGoalDraft("");
    setGoalMutationPending(false);
  }, [selectedThreadId]);

  const handleOpenGoalEditor = useCallback(() => {
    setGoalDraft(currentGoal?.objective ?? "");
    setGoalEditorOpen(true);
  }, [currentGoal?.objective]);

  const handleCloseGoalEditor = useCallback(() => {
    if (goalMutationPending) return;
    setGoalEditorOpen(false);
  }, [goalMutationPending]);

  const handleSaveGoal = useCallback(async () => {
    const objective = goalDraft.trim();
    if (!selectedThreadId || !objective) return;
    setGoalMutationPending(true);
    try {
      await onSetThreadGoal(selectedThreadId, { objective });
      setGoalEditorOpen(false);
    } finally {
      setGoalMutationPending(false);
    }
  }, [goalDraft, onSetThreadGoal, selectedThreadId]);

  const handleSubmitGoalEditor = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleSaveGoal();
    },
    [handleSaveGoal],
  );

  const handleToggleGoalStatus = useCallback(async () => {
    if (!selectedThreadId || !currentGoal) return;
    setGoalMutationPending(true);
    try {
      await onSetThreadGoal(selectedThreadId, {
        status: goalToggleStatus(currentGoal),
      });
    } finally {
      setGoalMutationPending(false);
    }
  }, [currentGoal, onSetThreadGoal, selectedThreadId]);

  const handleClearGoal = useCallback(async () => {
    if (!selectedThreadId) return;
    setGoalMutationPending(true);
    try {
      await onClearThreadGoal(selectedThreadId);
      setGoalEditorOpen(false);
    } finally {
      setGoalMutationPending(false);
    }
  }, [onClearThreadGoal, selectedThreadId]);

  const handleToggleGoalExpanded = useCallback(() => {
    if (!selectedThreadId) return;
    setGoalExpandedByThread((current) => ({
      ...current,
      [selectedThreadId]: !(current[selectedThreadId] ?? false),
    }));
  }, [selectedThreadId]);

  const showInitialDetailLoading = Boolean(
    selectedThreadId &&
    detailLoading &&
    (!threadDetail || threadDetail.thread.id !== selectedThreadId),
  );
  const messageRows = useMemo<ReactElement[]>(() => {
    const rows: ReactElement[] = [];

    if (isDraftThread) {
      rows.push(
        <div className={styles.newThreadDraft} key="new-thread-draft">
          <span className={styles.newThreadDraftIcon}>
            <Sparkles size={19} />
          </span>
          <h2>
            {draftThread?.projectName
              ? `今天想在 ${draftThread.projectName} 里推进什么？`
              : "今天想让 Codex 推进什么？"}
          </h2>
          <div
            className={styles.newThreadDraftContext}
            aria-label="新对话上下文"
          >
            <span>
              <FolderOpen size={15} />
              {draftProjectLabel}
            </span>
            <span>
              <GitBranch size={15} />
              Default
            </span>
          </div>
        </div>,
      );
    } else if (!selectedThreadId) {
      rows.push(
        <div className={styles.threadIntro} key="thread-intro">
          <span className={styles.threadIcon}>
            <Sparkles size={18} />
          </span>
          <div>
            <h2>{threadListLoading ? "正在同步会话" : "选择一个会话"}</h2>
            <p>
              {threadListLoading
                ? "正在从官方 app-server 读取项目和会话列表。"
                : "左侧会话列表来自官方 app-server，打开后会优先读取官方 IPC 的实时缓存。"}
            </p>
          </div>
        </div>,
      );
    } else {
      rows.push(
        <h2 className={styles.chatThreadHeading} key="thread-heading">
          {selectedThreadTitle}
        </h2>,
      );
    }

    if (showInitialDetailLoading && !isDraftThread) {
      rows.push(
        <article className={styles.assistantMessage} key="detail-loading">
          <MessageAuthor
            icon={<Activity size={16} />}
            label="正在读取"
            meta="会话内容"
          />
          <p>正在读取会话内容...</p>
        </article>,
      );
    }

    if (
      !showInitialDetailLoading &&
      !isDraftThread &&
      selectedThreadId &&
      turns.length === 0
    ) {
      rows.push(
        <article className={styles.assistantMessage} key="empty-thread">
          <MessageAuthor icon={<Bot size={16} />} label="Codex" meta="空会话" />
          <p>
            这个会话暂时没有可展示内容，或官方端尚未把完整实时快照广播给 Web。
          </p>
        </article>,
      );
    }

    rows.push(
      ...turns.flatMap((turn) =>
        renderTurnItems(turn.items, turn.status, {
          projectRoot,
          onOpenFileReference: handleOpenFileReference,
        }),
      ),
    );

    if (visibleApprovals.length > 0) {
      rows.push(
        <article className={styles.assistantMessage} key="approvals">
          <MessageAuthor
            icon={<CheckCircle2 size={16} />}
            label="审批"
            meta={`${visibleApprovals.length} 个待处理`}
          />
          <div className={styles.approvalList}>
            {visibleApprovals.map((approval) => (
              <ApprovalCard
                approval={approval}
                key={approval.id}
                onDecide={onDecideApproval}
              />
            ))}
          </div>
        </article>,
      );
    }

    if (error) {
      rows.push(
        <div className={styles.errorBox} key="thread-error">
          {error}
        </div>,
      );
    }

    return rows;
  }, [
    error,
    draftProjectLabel,
    draftThread?.projectName,
    handleOpenFileReference,
    isDraftThread,
    onDecideApproval,
    projectRoot,
    selectedThreadId,
    selectedThreadTitle,
    showInitialDetailLoading,
    threadListLoading,
    turns,
    visibleApprovalsKey,
  ]);
  const messageScrollSignature = useMemo(
    () => turnsScrollSignature(turns),
    [turns],
  );
  const mobileAuxiliaryPanels = isDraftThread ? null : (
    <div className={styles.mobileAuxiliaryPanels}>
      <ProjectFilesPanel root={projectRoot} />
      <MobileFoldout
        icon={<Activity size={16} />}
        label="运行状态"
        meta="实时同步快照"
      >
        <RuntimeStatusContent
          ipc={ipc}
          appServer={appServer}
          selectedThread={selectedThread}
          realtimeEvents={realtimeEvents}
        />
      </MobileFoldout>
      <MobileFoldout
        icon={<Code2 size={16} />}
        label="运行详情"
        meta="本机服务"
      >
        <RuntimeDetailsContent config={config} appServer={appServer} />
      </MobileFoldout>
    </div>
  );
  const shouldVirtualizeMessages =
    messageRows.length > MESSAGE_VIRTUALIZATION_THRESHOLD;
  const messageVirtualizer = useVirtualizer({
    count: messageRows.length,
    enabled: shouldVirtualizeMessages,
    estimateSize: () => 112,
    getScrollElement: () => chatColumnRef.current,
    overscan: 12,
  });
  const messageVirtualizerRef = useRef(messageVirtualizer);
  const [nearBottom, setNearBottom] = useState(true);

  useEffect(() => {
    messageVirtualizerRef.current = messageVirtualizer;
  }, [messageVirtualizer]);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const scroller = chatColumnRef.current;
      if (!scroller || messageRows.length === 0) return;
      if (shouldVirtualizeMessages) {
        messageVirtualizerRef.current.scrollToIndex(messageRows.length - 1, {
          align: "end",
        });
      }
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
      setNearBottom(true);
    },
    [messageRows.length, shouldVirtualizeMessages],
  );

  useEffect(() => {
    const scroller = chatColumnRef.current;
    if (!scroller) return;
    const update = () => {
      setNearBottom(
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
          160,
      );
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [messageRows.length, selectedThread?.id]);

  useEffect(() => {
    const scroller = chatColumnRef.current;
    const threadId = selectedThread?.id ?? null;
    const previousThreadId = lastThreadIdRef.current;
    const previousRowCount = lastRowCountRef.current;
    const previousMessageSignature = lastMessageSignatureRef.current;
    lastThreadIdRef.current = threadId;
    lastRowCountRef.current = messageRows.length;
    lastMessageSignatureRef.current = messageScrollSignature;

    if (!scroller || !threadId || messageRows.length === 0) return;
    if (hasTextSelectionInside(scroller)) return;
    const threadChanged = previousThreadId !== threadId;
    const rowCountIncreased = messageRows.length > previousRowCount;
    const contentChanged = previousMessageSignature !== messageScrollSignature;
    const loadedThreadHistory =
      previousRowCount <= 4 &&
      messageRows.length > MESSAGE_VIRTUALIZATION_THRESHOLD;
    const isNearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 220;
    if (!threadChanged && !loadedThreadHistory && previousRowCount > 0) {
      if (!rowCountIncreased && !contentChanged) return;
      if (!isNearBottom) return;
    }

    const animationFrame = window.requestAnimationFrame(() =>
      scrollToLatest("auto"),
    );
    const timeout = window.setTimeout(() => scrollToLatest("auto"), 80);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [
    messageRows.length,
    messageScrollSignature,
    selectedThread?.id,
    shouldVirtualizeMessages,
    scrollToLatest,
  ]);

  const chatLayoutClassName = [
    styles.chatLayout,
    !pinnedSummaryOpen ? styles.chatLayoutNoSummary : "",
    rightSidebarOpen ? styles.chatLayoutWithSidePanel : "",
    isDraftThread ? styles.chatLayoutDraft : "",
  ]
    .filter(Boolean)
    .join(" ");
  const chatLayoutStyle = rightSidebarOpen
    ? ({
        "--right-sidebar-width": `${rightSidebarWidth}px`,
      } as CSSProperties)
    : undefined;

  return (
    <section className={styles.chatViewport}>
      <div className={styles.chatWorkspace}>
        <div className={chatLayoutClassName} style={chatLayoutStyle}>
          <div
            className={[
              styles.chatStack,
              isDraftThread ? styles.chatStackDraft : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={[
                styles.chatColumn,
                isDraftThread ? styles.chatColumnDraft : "",
              ]
                .filter(Boolean)
                .join(" ")}
              ref={chatColumnRef}
              role="region"
              aria-label="会话"
            >
              {shouldVirtualizeMessages ? (
                <div
                  className={styles.virtualMessageList}
                  style={{ height: messageVirtualizer.getTotalSize() }}
                >
                  {messageVirtualizer.getVirtualItems().map((virtualRow) => (
                    <div
                      className={styles.virtualMessageItem}
                      data-index={virtualRow.index}
                      key={virtualRow.key}
                      ref={messageVirtualizer.measureElement}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {messageRows[virtualRow.index]}
                    </div>
                  ))}
                </div>
              ) : (
                messageRows
              )}
              {mobileAuxiliaryPanels}
            </div>
            {!nearBottom ? (
              <button
                className={styles.scrollToLatestButton}
                type="button"
                aria-label="滚动到底部"
                onClick={() => scrollToLatest("smooth")}
              >
                <ArrowDown size={18} />
              </button>
            ) : null}
            {isDraftThread ? null : (
              <ComposerActivityStrip
                threadDetail={threadDetail}
                goalExpanded={goalExpanded}
                goalBusy={goalMutationPending}
                onEditGoal={handleOpenGoalEditor}
                onToggleGoalStatus={() => void handleToggleGoalStatus()}
                onClearGoal={() => void handleClearGoal()}
                onToggleGoalExpanded={handleToggleGoalExpanded}
              />
            )}
            {composer}
          </div>
          {pinnedSummaryOpen ? (
            <DesktopActivityPanel
              config={config}
              ipc={ipc}
              appServer={appServer}
              selectedThread={selectedThread}
              threadDetail={threadDetail}
              projectRoot={projectRoot}
              threadListLoading={threadListLoading}
              realtimeEvents={realtimeEvents}
              onOpenSideChat={handleOpenSideChatFromSummary}
            />
          ) : null}
          {rightSidebarOpen ? (
            <div
              className={styles.desktopPaneResizer}
              role="separator"
              aria-label="调整右侧栏宽度"
              aria-orientation="vertical"
              onPointerDown={handleRightSidebarResizeStart}
            />
          ) : null}
          {rightSidebarOpen ? (
            <DesktopRightSidebar
              tabs={rightSidebarTabs}
              activeTabId={activeRightSidebarTabId}
              launcherOpen={rightSidebarLauncherOpen}
              onSelectTab={handleSelectRightSidebarTab}
              onCloseTab={handleCloseRightSidebarTab}
              onCreateTab={createRightSidebarTab}
              onShowLauncher={handleShowRightSidebarLauncher}
              projectRoot={projectRoot}
              selectedThread={selectedThread}
              threadDetail={threadDetail}
              selectedFilePath={fileSidebarTarget}
              onOpenFileReference={handleOpenFileReference}
              onSendSideChat={onSendSideChat}
              onSelectFile={handleSelectRightSidebarFile}
              fileTreeWidth={fileTreeWidth}
              onFileTreeResizeStart={handleFileTreeResizeStart}
            />
          ) : null}
        </div>
        {bottomTerminalOpen ? (
          <BottomTerminalDock projectRoot={projectRoot} />
        ) : null}
      </div>
      <GoalEditorDialog
        open={goalEditorOpen}
        draft={goalDraft}
        saving={goalMutationPending}
        onDraftChange={setGoalDraft}
        onCancel={handleCloseGoalEditor}
        onSubmit={handleSubmitGoalEditor}
      />
    </section>
  );
}
