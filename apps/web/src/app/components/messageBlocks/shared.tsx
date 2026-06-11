import {
  Check,
  Clipboard,
  Download,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import type {
  ComponentPropsWithoutRef,
  ReactElement,
  ReactNode,
} from "react";
import { isValidElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageImageContent } from "@codex-web/domain";
import { fileContentUrl } from "../../../api";
import { useI18n } from "../../../i18n/useI18n";
import styles from "../../App.module.css";
import { StatusBadge } from "../StatusBadge";

export type MessageImage = MessageImageContent;

export type FileReferenceOptions = {
  projectRoot?: string | null;
  onOpenFileReference?: (path: string) => void;
};

const FILE_REFERENCE_EXTENSIONS =
  "tsx?|jsx?|mjs|cjs|css|scss|sass|less|mdx?|jsonc?|ya?ml|toml|lock|html?|xml|svg|png|jpe?g|gif|webp|bmp|ico|mp4|m4v|mov|webm|ogv|pdf|docx?|xlsx?|xlsm|pptx?|txt|csv|tsv|log|py|ps1|sh|bat|cmd|rs|go|java|cs|cpp|c|h|hpp|sql|env|ini";
const FILE_REFERENCE_LOCATION_SUFFIX = "(?::\\d+(?::\\d+)?)?";
const INLINE_FILE_REFERENCE_PATTERN = new RegExp(
  [
    `[a-z]:[\\\\/][^\\r\\n"'<>|]+?\\.(?:${FILE_REFERENCE_EXTENSIONS})\\b${FILE_REFERENCE_LOCATION_SUFFIX}`,
    `(?:\\.{1,2}[\\\\/])?(?:[\\w .-]+[\\\\/])+[\\w .-]+\\.(?:${FILE_REFERENCE_EXTENSIONS})\\b${FILE_REFERENCE_LOCATION_SUFFIX}`,
    `\\b[\\w.-]+\\.(?:${FILE_REFERENCE_EXTENSIONS})\\b${FILE_REFERENCE_LOCATION_SUFFIX}`,
  ].join("|"),
  "gi",
);

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function firstChild(node: ReactNode): ReactNode {
  return Array.isArray(node) ? node[0] : node;
}

function codeLanguage(children: ReactNode): string {
  const child = firstChild(children);
  if (!isValidElement<{ className?: string }>(child)) return "Code";
  const className = child.props.className ?? "";
  const match = /language-([a-z0-9_-]+)/i.exec(className);
  return match?.[1] ? match[1] : "Code";
}

export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function CopyButton({
  text,
  label = "复制内容",
}: {
  text: string;
  label?: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label}
      className={styles.blockActionButton}
      disabled={!text}
      onClick={() => {
        void writeClipboard(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      type="button"
    >
      {copied ? <Check size={13} /> : <Clipboard size={13} />}
    </button>
  );
}

function MarkdownPre({ children }: ComponentPropsWithoutRef<"pre">): ReactElement {
  const text = nodeText(children).replace(/\n$/, "");
  return (
    <div className={styles.markdownCodeBlock}>
      <div className={styles.markdownCodeHeader}>
        <span>{codeLanguage(children)}</span>
        <CopyButton text={text} label="复制 Markdown 代码" />
      </div>
      <pre className={styles.markdownCodePre}>{children}</pre>
    </div>
  );
}

function isExternalLink(href?: string | null): boolean {
  return /^(https?:|mailto:|tel:|#|data:|blob:)/i.test(href ?? "");
}

function markdownUrlTransform(url: string, key: string): string {
  if ((key === "href" || key === "src") && isLocalFileReference(url)) return url;
  return defaultUrlTransform(url);
}

export function decodeFileUrl(value: string): string {
  const trimmed = value.trim();
  if (isExternalLink(trimmed)) return trimmed;
  if (!trimmed.toLowerCase().startsWith("file:")) {
    if (!/%[0-9a-f]{2}/i.test(trimmed)) return trimmed;
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }
  try {
    const url = new URL(trimmed);
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return `\\\\${url.hostname}${pathname.replaceAll("/", "\\")}`;
    if (/^\/[a-z]:\//i.test(pathname)) return pathname.slice(1).replaceAll("/", "\\");
    return pathname.replaceAll("/", "\\");
  } catch {
    return trimmed.replace(/^file:\/\/\/?/i, "").replaceAll("/", "\\");
  }
}

export function isLocalFileReference(value?: string | null): boolean {
  if (!value) return false;
  const decoded = decodeFileUrl(value);
  return /^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith("\\\\");
}

export function normalizedFileReference(value: string): string {
  const decoded = decodeFileUrl(value);
  if (isLocalFileReference(decoded)) return decoded.replaceAll("/", "\\");
  return decoded;
}

function isAbsoluteWindowsPath(value: string): boolean {
  const decoded = decodeFileUrl(value);
  return /^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith("\\\\");
}

function looksLikeFileReference(value: string): boolean {
  const cleaned = decodeFileUrl(value).replace(/[?#].*$/, "").trim();
  if (!cleaned) return false;
  if (isAbsoluteWindowsPath(cleaned)) return true;
  if (/^[a-z]+:/i.test(cleaned)) return false;
  if (cleaned.includes("\\") || cleaned.includes("/")) return true;
  return /\.[a-z0-9][a-z0-9_-]{0,12}$/i.test(cleaned);
}

function joinProjectPath(root: string, relativePath: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRelative = relativePath.replace(/^[.\\/]+/, "").replace(/[\\/]/g, separator);
  return `${cleanRoot}${separator}${cleanRelative}`;
}

function stripFileReferenceLocation(value: string): { path: string; line: number | null } {
  const cleaned = value.trim().replace(/\s+\((?:line|行)\s+\d+\)$/i, "");
  const match = /^(.*\.[a-z0-9]{1,12})(?::(\d+)(?::\d+)?)$/i.exec(cleaned);
  if (!match) return { path: cleaned, line: null };
  return { path: match[1] ?? cleaned, line: Number(match[2] ?? 0) };
}

function normalizeAbsoluteWindowsCandidate(value: string): string {
  return /^\/[a-z]:[\\/]/i.test(value) ? value.slice(1) : value;
}

function relativePathInsideProject(path: string, projectRoot?: string | null): string | null {
  if (!projectRoot) return null;
  const normalized = path.replaceAll("\\", "/");
  const root = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalized.toLowerCase() === root.toLowerCase()) return "";
  if (!normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
  return normalized.slice(root.length + 1);
}

function withFileReferenceLine(path: string, line: number | null): string {
  return line ? `${path}:${line}` : path;
}

function fileReferenceTarget({
  href,
  label,
  projectRoot,
}: {
  href?: string | null;
  label: string;
  projectRoot?: string | null;
}): { display: string; openPath: string; absolutePath: string; relativePath: string | null; line: number | null } | null {
  const rawTarget = normalizeAbsoluteWindowsCandidate(decodeFileUrl(href || label).trim());
  if (!rawTarget || isExternalLink(rawTarget)) return null;
  const withoutHash = rawTarget.replace(/[?#].*$/, "");
  const location = stripFileReferenceLocation(withoutHash);
  const target = normalizeAbsoluteWindowsCandidate(location.path);
  const display = label.trim() || target.split(/[\\/]/).filter(Boolean).at(-1) || target;
  if (!looksLikeFileReference(target) && !looksLikeFileReference(display)) return null;

  if (isAbsoluteWindowsPath(target)) {
    const normalized = normalizedFileReference(target);
    const relative = relativePathInsideProject(normalized, projectRoot);
    return {
      display,
      openPath: withFileReferenceLine(normalized, location.line),
      absolutePath: normalized,
      relativePath: relative ? withFileReferenceLine(relative, location.line) : null,
      line: location.line,
    };
  }

  const relativePath = target.replace(/^[.\\/]+/, "");
  const absolutePath = projectRoot ? joinProjectPath(projectRoot, relativePath) : relativePath;
  const openPath = projectRoot ? absolutePath : relativePath;
  return {
    display,
    openPath: withFileReferenceLine(openPath, location.line),
    absolutePath,
    relativePath: withFileReferenceLine(relativePath, location.line),
    line: location.line,
  };
}

function FileReference({
  onOpenFileReference,
  target,
}: {
  target: NonNullable<ReturnType<typeof fileReferenceTarget>>;
  onOpenFileReference?: (path: string) => void;
}): ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  const runAndClose = (action: () => void): void => {
    action();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span className={styles.fileReferenceWrap} ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={styles.fileReferenceButton}
        onClick={() => setOpen((value) => !value)}
        title={target.relativePath ?? withFileReferenceLine(target.absolutePath, target.line)}
        type="button"
      >
        {target.display}
      </button>
      {open ? (
        <span className={styles.fileReferenceMenu} role="menu">
          {target.relativePath ? (
            <button
              onClick={() => runAndClose(() => void writeClipboard(target.relativePath ?? ""))}
              role="menuitem"
              type="button"
            >
              {t("message.fileReference.copyRelativePath")}
            </button>
          ) : null}
          <button
            onClick={() => runAndClose(() => onOpenFileReference?.(target.openPath))}
            role="menuitem"
            type="button"
          >
            {t("message.fileReference.openInFiles")}
          </button>
        </span>
      ) : null}
    </span>
  );
}

export function renderFileReferencesInText(text: string, options: FileReferenceOptions): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_FILE_REFERENCE_PATTERN)) {
    const rawValue = match[0];
    const index = match.index ?? 0;
    if (index > 0 && /(?:https?|file):\/\/[^\s]*$/i.test(text.slice(Math.max(0, index - 24), index))) continue;
    const target = fileReferenceTarget({
      label: rawValue,
      projectRoot: options.projectRoot,
    });
    if (!target) continue;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    nodes.push(
      <FileReference
        key={`${rawValue}-${index}`}
        onOpenFileReference={options.onOpenFileReference}
        target={target}
      />,
    );
    lastIndex = index + rawValue.length;
  }
  if (lastIndex === 0) return text;
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderMarkdownInlineChildren(children: ReactNode, options: FileReferenceOptions): ReactNode {
  if (typeof children === "string") return renderFileReferencesInText(children, options);
  if (typeof children === "number") return children;
  if (Array.isArray(children)) {
    return children.map((child, index) => {
      if (typeof child !== "string") return child;
      return <span key={`inline-${index}`}>{renderFileReferencesInText(child, options)}</span>;
    });
  }
  return children;
}

function MarkdownLink({
  children,
  href,
  onOpenFileReference,
  projectRoot,
  ...props
}: ComponentPropsWithoutRef<"a"> & FileReferenceOptions): ReactElement {
  const label = nodeText(children);
  const target = fileReferenceTarget({ href, label, projectRoot });
  if (target) {
    return (
      <FileReference
        onOpenFileReference={onOpenFileReference}
        target={target}
      />
    );
  }

  const external = isExternalLink(href);
  return (
    <a href={href} rel={external ? "noreferrer" : undefined} target={external ? "_blank" : undefined} {...props}>
      {children}
    </a>
  );
}

export function isVideoMedia(image: MessageImage): boolean {
  const mimeType = image.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("video/")) return true;
  const source = image.url ?? image.path ?? "";
  if (/^data:video\//i.test(source)) return true;
  const normalized = normalizedFileReference(source).replace(/[?#].*$/, "").toLowerCase();
  return /\.(?:mp4|m4v|mov|webm|ogv)$/.test(normalized);
}

export function imageSource(image: MessageImage, projectRoot?: string | null): string | null {
  const source = image.url ?? image.path;
  if (!source) return null;
  const normalized = normalizedFileReference(source);
  if (isLocalFileReference(normalized)) return fileContentUrl({ path: normalized });
  if (/^(https?:|data:|blob:|\/)/i.test(normalized)) return normalized;
  return fileContentUrl({ path: normalized, root: projectRoot });
}

export function mediaLabel(image: MessageImage): string {
  return image.alt ?? image.path?.split(/[\\/]/).filter(Boolean).at(-1) ?? image.url ?? image.mimeType ?? "media";
}

function MarkdownMedia({
  alt,
  projectRoot,
  src,
  title,
}: ComponentPropsWithoutRef<"img"> & FileReferenceOptions): ReactElement {
  const media: MessageImage = {
    url: typeof src === "string" ? src : null,
    path: null,
    mimeType: null,
    alt: typeof alt === "string" && alt.trim() ? alt : null,
  };
  const resolvedSrc = imageSource(media, projectRoot);
  const label = mediaLabel(media);
  if (!resolvedSrc) {
    return <span className={styles.markdownMediaUnavailable}>{label}</span>;
  }

  if (isVideoMedia(media)) {
    return (
      <span className={styles.markdownMediaBlock} data-media-kind="video">
        <video
          aria-label={label}
          controls
          data-testid="message-video"
          preload="metadata"
          title={title}
        >
          <source src={resolvedSrc} />
        </video>
      </span>
    );
  }

  return (
    <img
      alt={label}
      className={styles.markdownImage}
      loading="lazy"
      src={resolvedSrc}
      title={title}
    />
  );
}

export function MessageAuthor({
  icon,
  label,
  meta,
}: {
  icon: ReactElement;
  label: string;
  meta: string;
}): ReactElement {
  return (
    <div className={styles.messageAuthor}>
      <span className={styles.avatar}>{icon}</span>
      <span>
        <span className={styles.authorName}>{label}</span>
        <span className={styles.authorMeta}>{meta}</span>
      </span>
    </div>
  );
}

export function MarkdownText({
  className,
  onOpenFileReference,
  projectRoot,
  text,
}: {
  text: string;
  className?: string;
  projectRoot?: string | null;
  onOpenFileReference?: (path: string) => void;
}): ReactElement {
  return (
    <div className={className ?? styles.markdownBody}>
      <ReactMarkdown
        components={{
          a: (props) => (
            <MarkdownLink
              {...props}
              onOpenFileReference={onOpenFileReference}
              projectRoot={projectRoot}
            />
          ),
          img: (props) => (
            <MarkdownMedia
              {...props}
              projectRoot={projectRoot}
            />
          ),
          li: ({ children }) => (
            <li>{renderMarkdownInlineChildren(children, { onOpenFileReference, projectRoot })}</li>
          ),
          p: ({ children }) => (
            <p>{renderMarkdownInlineChildren(children, { onOpenFileReference, projectRoot })}</p>
          ),
          pre: MarkdownPre,
        }}
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function MessageImages({
  images,
  projectRoot,
}: {
  images?: MessageImage[];
  projectRoot?: string | null;
}): ReactElement | null {
  const [activeImage, setActiveImage] = useState<{ src: string; label: string } | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!activeImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveImage(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeImage]);

  if (!images?.length) return null;
  const lightbox = activeImage ? (
    <div
      aria-label={activeImage.label}
      aria-modal="true"
      className={styles.imageLightbox}
      onClick={() => setActiveImage(null)}
      role="dialog"
    >
      <div className={styles.imageLightboxToolbar}>
        <a aria-label="下载图片" download href={activeImage.src} onClick={(event) => event.stopPropagation()}>
          <Download size={18} />
        </a>
        <button aria-label="关闭图片预览" onClick={() => setActiveImage(null)} type="button">
          <X size={22} />
        </button>
      </div>
      <img
        alt={activeImage.label}
        onClick={(event) => event.stopPropagation()}
        src={activeImage.src}
      />
    </div>
  ) : null;
  return (
    <>
      <div className={styles.imageGrid}>
        {images.map((image, index) => {
          const src = imageSource(image, projectRoot);
          const video = isVideoMedia(image);
          const label = mediaLabel(image);
          const failedKey = `${src ?? image.url ?? image.path ?? "image"}-${index}`;
          const failed = Boolean(failedImages[failedKey]);
          if (video) {
            return (
              <figure
                className={styles.imageBlock}
                data-media-kind="video"
                key={`${image.url ?? image.path ?? "video"}-${index}`}
              >
                {src ? (
                  <video
                    aria-label={label}
                    controls
                    data-testid="message-video"
                    preload="metadata"
                  >
                    <source src={src} type={image.mimeType ?? undefined} />
                  </video>
                ) : (
                  <span className={styles.imageUnavailable}>视频文件不可用</span>
                )}
                <figcaption>{label}</figcaption>
              </figure>
            );
          }
          return (
            <button
              className={styles.imageBlock}
              disabled={!src || failed}
              key={`${image.url ?? image.path ?? "image"}-${index}`}
              onClick={() => (src ? setActiveImage({ src, label }) : undefined)}
              type="button"
            >
              {src && !failed ? (
                <img
                  alt={image.alt ?? image.path ?? "attachment"}
                  loading="lazy"
                  onError={() =>
                    setFailedImages((current) => ({
                      ...current,
                      [failedKey]: true,
                    }))
                  }
                  src={src}
                />
              ) : (
                <span className={styles.imageUnavailable}>图片文件不可用</span>
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {lightbox ? createPortal(lightbox, document.body) : null}
    </>
  );
}

export function ExpandButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      aria-label={expanded ? "折叠内容" : "展开内容"}
      className={styles.blockActionButton}
      onClick={onToggle}
      type="button"
    >
      {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
    </button>
  );
}

export function compactStatus(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[-_\s]/g, "");
}

export function isActiveMessageStatus(value?: string | null): boolean {
  const normalized = compactStatus(value);
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

export function isTerminalOperationStatus(value?: string | null): boolean {
  const normalized = compactStatus(value);
  return Boolean(
    normalized &&
      [
        "applied",
        "aborted",
        "cancelled",
        "canceled",
        "complete",
        "completed",
        "declined",
        "done",
        "error",
        "failed",
        "interrupted",
        "modified",
        "stopped",
        "success",
        "succeeded",
      ].includes(normalized),
  );
}

export function CollapsedMessageToggle({
  active,
  expanded,
  icon,
  label,
  meta,
  onToggle,
}: {
  icon: ReactElement;
  label: string;
  meta?: string;
  expanded: boolean;
  active?: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      aria-expanded={expanded}
      aria-label={expanded ? "折叠内容" : "展开内容"}
      className={[styles.collapsedMessageToggle, active ? styles.collapsedMessageToggleActive : ""].filter(Boolean).join(" ")}
      onClick={onToggle}
      type="button"
    >
      <span className={styles.avatar}>{icon}</span>
      <span className={styles.collapsedMessageText}>
        <span className={styles.authorName}>{label}</span>
        {meta ? <span className={styles.authorMeta}>{meta}</span> : null}
      </span>
      <span className={styles.collapsedMessageAction}>
        {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </span>
    </button>
  );
}

export function BlockHeader({
  copyText,
  expanded,
  icon,
  onToggleExpanded,
  status,
  statusTone = "idle",
  title,
}: {
  icon: ReactElement;
  title: string;
  status?: string | null;
  statusTone?: "ready" | "warn" | "idle";
  copyText?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}): ReactElement {
  return (
    <div className={styles.blockHeader}>
      {icon}
      <span className={styles.blockTitle}>{title}</span>
      {status ? <StatusBadge label={status} tone={statusTone} /> : null}
      <span className={styles.blockActions}>
        {copyText !== undefined ? <CopyButton text={copyText} /> : null}
        {onToggleExpanded ? <ExpandButton expanded={Boolean(expanded)} onToggle={onToggleExpanded} /> : null}
      </span>
    </div>
  );
}

export function blockPreClass(expanded: boolean, extraClass = ""): string {
  return [expanded ? styles.blockPreExpanded : "", extraClass].filter(Boolean).join(" ");
}

export function formatDurationMs(value: number | null): string {
  if (value === null) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

export function filePreviewRequest(path: string, projectRoot?: string | null): { path: string; root?: string | null } {
  const normalized = normalizedFileReference(path);
  return {
    path: normalized,
    root: isLocalFileReference(normalized) ? null : projectRoot,
  };
}

export function displayPath(path: string, projectRoot?: string | null): string {
  const normalized = path.replaceAll("\\", "/");
  const root = projectRoot?.replaceAll("\\", "/").replace(/\/+$/, "");
  if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized;
}
