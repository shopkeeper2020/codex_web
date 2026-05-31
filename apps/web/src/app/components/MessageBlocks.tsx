import {
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Download,
  FileCode2,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  Paperclip,
  TerminalSquare,
  X,
} from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import { isValidElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  fileContentUrl,
  getFilePreview,
  type ApprovalDecision,
  type FilePreview,
  type MessageItem,
  type PendingApproval,
} from '../../api'
import { useI18n } from '../../i18n/useI18n'
import styles from '../App.module.css'
import { StatusBadge } from './StatusBadge'

type MessageImage = NonNullable<Extract<MessageItem, { type: 'user' }>['images']>[number]
type CommandItem = Extract<MessageItem, { type: 'command' }>
type FileChangeItem = Extract<MessageItem, { type: 'fileChange' }>
type FileChangeEntry = NonNullable<FileChangeItem['changes']>[number]
type ReasoningItem = Extract<MessageItem, { type: 'reasoning' }>
type ToolOutputItem = Extract<MessageItem, { type: 'toolOutput' }>
type UnknownItem = Extract<MessageItem, { type: 'unknown' }>
type GroupedOperationItem = CommandItem | FileChangeItem | ToolOutputItem
type RenderOptions = {
  projectRoot?: string | null
  onOpenFileReference?: (path: string) => void
}

const USER_MESSAGE_COLLAPSE_LINE_COUNT = 9
const USER_MESSAGE_COLLAPSE_CHAR_COUNT = 560
const FILE_CHANGE_INITIAL_ROW_COUNT = 3
const FILE_REFERENCE_EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|css|scss|sass|less|mdx?|jsonc?|ya?ml|toml|lock|html?|xml|svg|png|jpe?g|gif|webp|bmp|ico|pdf|txt|csv|tsv|log|py|ps1|sh|bat|cmd|rs|go|java|cs|cpp|c|h|hpp|sql|env|ini'
const INLINE_FILE_REFERENCE_PATTERN = new RegExp(
  [
    `[a-z]:[\\\\/][^\\r\\n"'<>|]+?\\.(?:${FILE_REFERENCE_EXTENSIONS})\\b`,
    `(?:\\.{1,2}[\\\\/])?(?:[\\w .-]+[\\\\/])+[\\w .-]+\\.(?:${FILE_REFERENCE_EXTENSIONS})\\b`,
    `\\b[\\w.-]+\\.(?:${FILE_REFERENCE_EXTENSIONS})\\b`,
  ].join('|'),
  'gi',
)

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

function firstChild(node: ReactNode): ReactNode {
  return Array.isArray(node) ? node[0] : node
}

function codeLanguage(children: ReactNode): string {
  const child = firstChild(children)
  if (!isValidElement<{ className?: string }>(child)) return 'Code'
  const className = child.props.className ?? ''
  const match = /language-([a-z0-9_-]+)/i.exec(className)
  return match?.[1] ? match[1] : 'Code'
}

function MarkdownPre({ children }: ComponentPropsWithoutRef<'pre'>): ReactElement {
  const text = nodeText(children).replace(/\n$/, '')
  return (
    <div className={styles.markdownCodeBlock}>
      <div className={styles.markdownCodeHeader}>
        <span>{codeLanguage(children)}</span>
        <CopyButton text={text} label="复制 Markdown 代码" />
      </div>
      <pre className={styles.markdownCodePre}>{children}</pre>
    </div>
  )
}

function isExternalLink(href?: string | null): boolean {
  return /^(https?:|mailto:|tel:|#|data:|blob:)/i.test(href ?? '')
}

function isAbsoluteWindowsPath(value: string): boolean {
  const decoded = decodeFileUrl(value)
  return /^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith('\\\\')
}

function looksLikeFileReference(value: string): boolean {
  const cleaned = decodeFileUrl(value).replace(/[?#].*$/, '').trim()
  if (!cleaned) return false
  if (isAbsoluteWindowsPath(cleaned)) return true
  if (/^[a-z]+:/i.test(cleaned)) return false
  if (cleaned.includes('\\') || cleaned.includes('/')) return true
  return /\.[a-z0-9][a-z0-9_-]{0,12}$/i.test(cleaned)
}

function joinProjectPath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  const cleanRoot = root.replace(/[\\/]+$/, '')
  const cleanRelative = relativePath.replace(/^[.\\/]+/, '').replace(/[\\/]/g, separator)
  return `${cleanRoot}${separator}${cleanRelative}`
}

function fileReferenceTarget({
  href,
  label,
  projectRoot,
}: {
  href?: string | null
  label: string
  projectRoot?: string | null
}): { display: string; openPath: string; absolutePath: string; relativePath: string | null } | null {
  const rawTarget = decodeFileUrl(href || label).trim()
  if (!rawTarget || isExternalLink(rawTarget)) return null
  const target = rawTarget.replace(/[?#].*$/, '')
  const display = label.trim() || target.split(/[\\/]/).filter(Boolean).at(-1) || target
  if (!looksLikeFileReference(target) && !looksLikeFileReference(display)) return null

  if (isAbsoluteWindowsPath(target)) {
    const normalized = normalizedFileReference(target)
    const relative = projectRoot ? displayPath(normalized, projectRoot) : null
    return {
      display,
      openPath: normalized,
      absolutePath: normalized,
      relativePath: relative && relative !== normalized.replaceAll('\\', '/') ? relative : null,
    }
  }

  const relativePath = target.replace(/^[.\\/]+/, '')
  const absolutePath = projectRoot ? joinProjectPath(projectRoot, relativePath) : relativePath
  return {
    display,
    openPath: relativePath,
    absolutePath,
    relativePath,
  }
}

function FileReference({
  target,
  onOpenFileReference,
}: {
  target: NonNullable<ReturnType<typeof fileReferenceTarget>>
  onOpenFileReference?: (path: string) => void
}): ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  const runAndClose = (action: () => void): void => {
    action()
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <span className={styles.fileReferenceWrap} ref={wrapRef}>
      <button
        className={styles.fileReferenceButton}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={target.absolutePath}
        onClick={() => setOpen((value) => !value)}
      >
        {target.display}
      </button>
      {open ? (
        <span className={styles.fileReferenceMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(() => void writeClipboard(target.absolutePath))}
          >
            {t('message.fileReference.copyPath')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!target.relativePath}
            onClick={() => {
              if (!target.relativePath) return
              runAndClose(() => void writeClipboard(target.relativePath ?? ''))
            }}
          >
            {t('message.fileReference.copyRelativePath')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(() => onOpenFileReference?.(target.openPath))}
          >
            {t('message.fileReference.openInFiles')}
          </button>
        </span>
      ) : null}
    </span>
  )
}

function renderFileReferencesInText(text: string, options: RenderOptions): ReactNode {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  for (const match of text.matchAll(INLINE_FILE_REFERENCE_PATTERN)) {
    const rawValue = match[0]
    const index = match.index ?? 0
    if (index > 0 && /(?:https?|file):\/\/[^\s]*$/i.test(text.slice(Math.max(0, index - 24), index))) continue
    const target = fileReferenceTarget({
      label: rawValue,
      projectRoot: options.projectRoot,
    })
    if (!target) continue
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index))
    nodes.push(
      <FileReference
        key={`${rawValue}-${index}`}
        target={target}
        onOpenFileReference={options.onOpenFileReference}
      />,
    )
    lastIndex = index + rawValue.length
  }
  if (lastIndex === 0) return text
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function renderMarkdownInlineChildren(children: ReactNode, options: RenderOptions): ReactNode {
  if (typeof children === 'string') return renderFileReferencesInText(children, options)
  if (typeof children === 'number') return children
  if (Array.isArray(children)) {
    return children.map((child, index) => {
      if (typeof child !== 'string') return child
      return <span key={`inline-${index}`}>{renderFileReferencesInText(child, options)}</span>
    })
  }
  return children
}

function MarkdownLink({
  children,
  href,
  projectRoot,
  onOpenFileReference,
  ...props
}: ComponentPropsWithoutRef<'a'> & RenderOptions): ReactElement {
  const label = nodeText(children)
  const target = fileReferenceTarget({ href, label, projectRoot })
  if (target) {
    return (
      <FileReference
        target={target}
        onOpenFileReference={onOpenFileReference}
      />
    )
  }

  const external = isExternalLink(href)
  return (
    <a href={href} rel={external ? 'noreferrer' : undefined} target={external ? '_blank' : undefined} {...props}>
      {children}
    </a>
  )
}

export function MessageAuthor({ icon, label, meta }: { icon: ReactElement; label: string; meta: string }): ReactElement {
  return (
    <div className={styles.messageAuthor}>
      <span className={styles.avatar}>{icon}</span>
      <span>
        <span className={styles.authorName}>{label}</span>
        <span className={styles.authorMeta}>{meta}</span>
      </span>
    </div>
  )
}

function MarkdownText({
  text,
  className,
  projectRoot,
  onOpenFileReference,
}: {
  text: string
  className?: string
  projectRoot?: string | null
  onOpenFileReference?: (path: string) => void
}): ReactElement {
  return (
    <div className={className ?? styles.markdownBody}>
      <ReactMarkdown
        components={{
          a: (props) => (
            <MarkdownLink
              {...props}
              projectRoot={projectRoot}
              onOpenFileReference={onOpenFileReference}
            />
          ),
          p: ({ children }) => (
            <p>{renderMarkdownInlineChildren(children, { projectRoot, onOpenFileReference })}</p>
          ),
          li: ({ children }) => (
            <li>{renderMarkdownInlineChildren(children, { projectRoot, onOpenFileReference })}</li>
          ),
          pre: MarkdownPre,
        }}
        remarkPlugins={[remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function shouldCollapseUserText(text: string): boolean {
  return text.length > USER_MESSAGE_COLLAPSE_CHAR_COUNT || text.split(/\r?\n/).length > USER_MESSAGE_COLLAPSE_LINE_COUNT
}

function UserPlainText({ text }: { text: string }): ReactElement | null {
  const normalized = text.trimEnd()
  const shouldCollapse = shouldCollapseUserText(normalized)
  const [expanded, setExpanded] = useState(false)
  const collapsed = shouldCollapse && !expanded

  if (!normalized) return null

  return (
    <div
      className={styles.userMessageBubble}
      data-collapsed={collapsed ? 'true' : undefined}
      data-testid="user-message-bubble"
    >
      <div className={styles.userMessageText} data-testid="user-message-text">
        {normalized}
      </div>
      {shouldCollapse ? (
        <button
          aria-expanded={expanded}
          aria-label={expanded ? '折叠用户消息' : '展开用户消息'}
          className={styles.userMessageToggle}
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '显示更多'}
          <ChevronDown className={expanded ? styles.userMessageToggleIconOpen : styles.userMessageToggleIcon} size={14} />
        </button>
      ) : null}
    </div>
  )
}

function formatDurationMs(value: number | null): string {
  if (value === null) return ''
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`
}

function decodeFileUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith('file:')) return trimmed
  try {
    const url = new URL(trimmed)
    const pathname = decodeURIComponent(url.pathname)
    if (url.hostname) return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`
    if (/^\/[a-z]:\//i.test(pathname)) return pathname.slice(1).replaceAll('/', '\\')
    return pathname.replaceAll('/', '\\')
  } catch {
    return trimmed.replace(/^file:\/\/\/?/i, '').replaceAll('/', '\\')
  }
}

function isLocalFileReference(value?: string | null): boolean {
  if (!value) return false
  const decoded = decodeFileUrl(value)
  return /^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith('\\\\')
}

function normalizedFileReference(value: string): string {
  const decoded = decodeFileUrl(value)
  if (isLocalFileReference(decoded)) return decoded.replaceAll('/', '\\')
  return decoded
}

function filePreviewRequest(path: string, projectRoot?: string | null): { path: string; root?: string | null } {
  const normalized = normalizedFileReference(path)
  return {
    path: normalized,
    root: isLocalFileReference(normalized) ? null : projectRoot,
  }
}

function imageSource(image: MessageImage, projectRoot?: string | null): string | null {
  const source = image.url ?? image.path
  if (!source) return null
  const normalized = normalizedFileReference(source)
  if (isLocalFileReference(normalized)) return fileContentUrl({ path: normalized })
  if (/^(https?:|data:|blob:|\/)/i.test(normalized)) return normalized
  return fileContentUrl({ path: normalized, root: projectRoot })
}

function MessageImages({ images, projectRoot }: { images?: MessageImage[]; projectRoot?: string | null }): ReactElement | null {
  const [activeImage, setActiveImage] = useState<{ src: string; label: string } | null>(null)
  useEffect(() => {
    if (!activeImage) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveImage(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeImage])

  if (!images?.length) return null
  const lightbox = activeImage ? (
    <div
      className={styles.imageLightbox}
      role="dialog"
      aria-modal="true"
      aria-label={activeImage.label}
      onClick={() => setActiveImage(null)}
    >
      <div className={styles.imageLightboxToolbar}>
        <a href={activeImage.src} download aria-label="下载图片" onClick={(event) => event.stopPropagation()}>
          <Download size={18} />
        </a>
        <button type="button" aria-label="关闭图片预览" onClick={() => setActiveImage(null)}>
          <X size={22} />
        </button>
      </div>
      <img
        src={activeImage.src}
        alt={activeImage.label}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  ) : null
  return (
    <>
      <div className={styles.imageGrid}>
        {images.map((image, index) => {
          const src = imageSource(image, projectRoot)
          const label = image.alt ?? image.mimeType ?? image.path ?? image.url ?? 'image'
          return (
            <button
              className={styles.imageBlock}
              disabled={!src}
              key={`${image.url ?? image.path ?? 'image'}-${index}`}
              type="button"
              onClick={() => src ? setActiveImage({ src, label }) : undefined}
            >
              {src ? <img src={src} alt={image.alt ?? image.path ?? 'attachment'} loading="lazy" /> : null}
              <span>{label}</span>
            </button>
          )
        })}
      </div>
      {lightbox ? createPortal(lightbox, document.body) : null}
    </>
  )
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function CopyButton({ text, label = '复制内容' }: { text: string; label?: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={styles.blockActionButton}
      type="button"
      aria-label={label}
      disabled={!text}
      onClick={() => {
        void writeClipboard(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check size={13} /> : <Clipboard size={13} />}
    </button>
  )
}

function ExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }): ReactElement {
  return (
    <button
      className={styles.blockActionButton}
      type="button"
      aria-label={expanded ? '折叠内容' : '展开内容'}
      onClick={onToggle}
    >
      {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
    </button>
  )
}

function compactStatus(value?: string | null): string {
  return (value ?? '').toLowerCase().replace(/[-_\s]/g, '')
}

function isActiveMessageStatus(value?: string | null): boolean {
  const normalized = compactStatus(value)
  return Boolean(normalized && [
    'active',
    'editing',
    'inprogress',
    'pending',
    'running',
    'started',
    'streaming',
    'thinking',
    'writing',
  ].includes(normalized))
}

function isTerminalOperationStatus(value?: string | null): boolean {
  const normalized = compactStatus(value)
  return Boolean(normalized && [
    'applied',
    'aborted',
    'cancelled',
    'canceled',
    'complete',
    'completed',
    'done',
    'error',
    'failed',
    'interrupted',
    'modified',
    'stopped',
    'success',
    'succeeded',
  ].includes(normalized))
}

function isOperationItemComplete(item: GroupedOperationItem): boolean {
  if (isTerminalOperationStatus(item.status)) return true
  if (item.type === 'command') return item.exitCode !== null
  return false
}

function isOperationItemActive(item: GroupedOperationItem, turnStatus: string, forceComplete = false): boolean {
  if (forceComplete) return false
  if (!isActiveMessageStatus(turnStatus)) return false
  if (isOperationItemComplete(item)) return false
  return isActiveMessageStatus(item.status)
    || (item.type === 'command' && item.exitCode === null)
    || (item.type === 'fileChange' && item.status === null)
}

function CollapsedMessageToggle({
  icon,
  label,
  meta,
  expanded,
  active,
  onToggle,
}: {
  icon: ReactElement
  label: string
  meta?: string
  expanded: boolean
  active?: boolean
  onToggle: () => void
}): ReactElement {
  return (
    <button
      className={[styles.collapsedMessageToggle, active ? styles.collapsedMessageToggleActive : ''].filter(Boolean).join(' ')}
      type="button"
      aria-label={expanded ? '折叠内容' : '展开内容'}
      aria-expanded={expanded}
      onClick={onToggle}
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
  )
}

function BlockHeader({
  icon,
  title,
  status,
  statusTone = 'idle',
  copyText,
  expanded,
  onToggleExpanded,
}: {
  icon: ReactElement
  title: string
  status?: string | null
  statusTone?: 'ready' | 'warn' | 'idle'
  copyText?: string
  expanded?: boolean
  onToggleExpanded?: () => void
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
  )
}

function blockPreClass(expanded: boolean, extraClass = ''): string {
  return [expanded ? styles.blockPreExpanded : '', extraClass].filter(Boolean).join(' ')
}

function commandOutputText(item: CommandItem): string {
  const lines: string[] = []
  if (item.command) lines.push(`$ ${item.command}`)
  const output = item.output || item.stdout
  if (output) {
    if (lines.length) lines.push('')
    lines.push(output)
  }
  if (item.stderr) {
    if (lines.length) lines.push('')
    lines.push(item.stderr)
  }
  return lines.length ? lines.join('\n') : '暂无输出'
}

function commandFooterLabel(item: CommandItem): string {
  if (item.status === 'failed' || item.exitCode !== null && item.exitCode !== 0) return '失败'
  if (isActiveMessageStatus(item.status) && item.exitCode === null) return '运行中'
  return '成功'
}

function fileChangeEntries(item: FileChangeItem): FileChangeEntry[] {
  const entries = item.changes?.length
    ? item.changes
    : [{ path: item.path, diff: item.diff, status: item.status, kind: null }]
  return entries.filter((entry) => entry.path || entry.diff)
}

function fileChangeStats(diff: string): { additions: number; deletions: number } {
  return diff.split(/\r?\n/).reduce(
    (stats, line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) stats.additions += 1
      if (line.startsWith('-') && !line.startsWith('---')) stats.deletions += 1
      return stats
    },
    { additions: 0, deletions: 0 },
  )
}

function fileChangeTotals(entries: FileChangeEntry[]): { additions: number; deletions: number } {
  return entries.reduce(
    (total, entry) => {
      const stats = fileChangeStats(entry.diff)
      total.additions += stats.additions
      total.deletions += stats.deletions
      return total
    },
    { additions: 0, deletions: 0 },
  )
}

function fileChangeSummary(
  items: FileChangeItem[],
  turnStatus: string,
  forceComplete = false,
): { label: string; meta: string; active: boolean; totals: { additions: number; deletions: number }; entries: FileChangeEntry[] } {
  const entries = items.flatMap(fileChangeEntries)
  const totals = fileChangeTotals(entries)
  const active = items.some((item) => isOperationItemActive(item, turnStatus, forceComplete))
  const stats = totals.additions || totals.deletions ? `，+${totals.additions} -${totals.deletions}` : ''
  return {
    label: active ? '正在编辑' : '已编辑',
    meta: `${entries.length ? `${entries.length} 个文件` : '文件变更'}${stats}`,
    active,
    totals,
    entries,
  }
}

function displayPath(path: string, projectRoot?: string | null): string {
  const normalized = path.replaceAll('\\', '/')
  const root = projectRoot?.replaceAll('\\', '/').replace(/\/+$/, '')
  if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1)
  }
  return normalized
}

function fileChangeCopyText(entries: FileChangeEntry[], projectRoot?: string | null): string {
  return entries
    .map((entry) => [displayPath(entry.path, projectRoot), entry.diff].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
}

function fileChangeRowMeta(entry: FileChangeEntry): string {
  if (entry.diff) return 'diff'
  return entry.kind ?? entry.status ?? '预览'
}

function parseDiffHunkStart(line: string): { oldLine: number; newLine: number } | null {
  const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?/.exec(line)
  if (!match) return null
  return { oldLine: Number(match[1]), newLine: Number(match[2]) }
}

function DiffLine({
  line,
  oldNumber,
  newNumber,
}: {
  line: string
  oldNumber: number | null
  newNumber: number | null
}): ReactElement {
  const className =
    line.startsWith('@@')
      ? styles.diffLineHunk
      : line.startsWith('+') && !line.startsWith('+++')
        ? styles.diffLineAdded
        : line.startsWith('-') && !line.startsWith('---')
          ? styles.diffLineRemoved
          : styles.diffLineContext
  return (
    <span className={className}>
      <span className={styles.diffLineNumber}>{oldNumber ?? ''}</span>
      <span className={styles.diffLineNumber}>{newNumber ?? ''}</span>
      <span className={styles.diffLineContent}>{line || ' '}</span>
    </span>
  )
}

function FileDiffView({ diff }: { diff: string }): ReactElement {
  let oldLine: number | null = null
  let newLine: number | null = null
  const rows = diff.split(/\r?\n/).map((line) => {
    const hunkStart = parseDiffHunkStart(line)
    if (hunkStart) {
      oldLine = hunkStart.oldLine
      newLine = hunkStart.newLine
      return { line, oldNumber: null, newNumber: null }
    }
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      return { line, oldNumber: null, newNumber: null }
    }
    if (line.startsWith('+')) {
      const current = newLine
      if (newLine !== null) newLine += 1
      return { line, oldNumber: null, newNumber: current }
    }
    if (line.startsWith('-')) {
      const current = oldLine
      if (oldLine !== null) oldLine += 1
      return { line, oldNumber: current, newNumber: null }
    }
    const currentOld = oldLine
    const currentNew = newLine
    if (oldLine !== null) oldLine += 1
    if (newLine !== null) newLine += 1
    return { line, oldNumber: currentOld, newNumber: currentNew }
  })

  return (
    <pre className={styles.fileChangeDiff}>
      <code className={styles.fileChangeDiffCode}>
        {rows.map((row, index) => (
          <DiffLine
            line={row.line}
            key={`${index}-${row.line}`}
            newNumber={row.newNumber}
            oldNumber={row.oldNumber}
          />
        ))}
      </code>
    </pre>
  )
}

function CommandBlockDetails({ item }: { item: CommandItem }): ReactElement {
  const output = commandOutputText(item)
  return (
    <div className={styles.shellCommandBlock}>
      <div className={styles.shellCommandHeader}>
        <span>Shell</span>
        <CopyButton text={output} label="复制命令输出" />
      </div>
      <pre className={styles.shellCommandPre}>{output}</pre>
      <div className={styles.shellCommandFooter}>
        <span>{commandFooterLabel(item)}</span>
      </div>
    </div>
  )
}

function CommandMessage({ item, turnStatus }: { item: CommandItem; turnStatus: string }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        icon={<TerminalSquare size={16} />}
        label="命令"
        meta={item.status || turnStatus}
        expanded={expanded}
        active={isActiveMessageStatus(item.status)}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? <CommandBlockDetails item={item} /> : null}
    </article>
  )
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function FilePreviewBody({
  item,
  projectRoot,
}: {
  item: FileChangeItem
  projectRoot?: string | null
}): ReactElement {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const previewRequest = item.path ? filePreviewRequest(item.path, projectRoot) : null

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError('')
    if (!previewRequest) return () => {
      cancelled = true
    }
    setLoading(true)
    void getFilePreview(previewRequest).then(
      (value) => {
        if (cancelled) return
        setPreview(value)
        setLoading(false)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : '无法读取文件内容')
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [previewRequest?.path, previewRequest?.root])

  if (loading) {
    return <div className={styles.filePreviewNotice}>正在读取文件内容...</div>
  }
  if (error) {
    return <div className={styles.filePreviewNotice}>无法预览：{error}</div>
  }
  if (!preview) {
    return <div className={styles.filePreviewNotice}>暂无可预览内容</div>
  }
  if (preview.kind === 'image') {
    return (
      <div className={styles.filePreviewMedia}>
        <img src={fileContentUrl(previewRequest ?? { path: item.path, root: projectRoot })} alt={preview.filename} loading="lazy" />
        <span>{preview.filename} · {formatBytes(preview.size)}</span>
      </div>
    )
  }
  if (preview.kind === 'text') {
    return (
      <>
        <pre className={styles.blockPreExpanded}>{preview.content ?? ''}</pre>
        {preview.truncated ? <div className={styles.filePreviewNotice}>文件较大，仅展示前 {formatBytes(preview.content?.length ?? 0)}。</div> : null}
      </>
    )
  }
  return <div className={styles.filePreviewNotice}>{preview.filename} 是二进制文件，大小 {formatBytes(preview.size)}。</div>
}

function FileChangeSummaryCard({
  items,
  projectRoot,
  turnStatus,
  onOpenFileReference,
  forceComplete = false,
}: {
  items: FileChangeItem[]
  projectRoot?: string | null
  turnStatus: string
  onOpenFileReference?: (path: string) => void
  forceComplete?: boolean
}): ReactElement {
  const [showAll, setShowAll] = useState(false)
  const summary = fileChangeSummary(items, turnStatus, forceComplete)
  const { active, entries, totals } = summary
  const visibleEntries = showAll ? entries : entries.slice(0, FILE_CHANGE_INITIAL_ROW_COUNT)
  const mergedStatus = items.find((item) => isActiveMessageStatus(item.status))?.status
    ?? items.find((item) => item.status)?.status
    ?? null
  const copyText = fileChangeCopyText(entries, projectRoot)

  return (
    <div className={styles.fileChangeCard} data-testid="file-change-card">
      <div className={styles.fileChangeCardHeader}>
        <span className={styles.fileChangeCardIcon}>
          <FileCode2 size={15} />
        </span>
        <div className={styles.fileChangeCardTitle}>
          <strong>{summary.label} {entries.length ? `${entries.length} 个文件` : '文件变更'}</strong>
          <span>
            {totals.additions || totals.deletions ? (
              <>
                <b className={styles.diffAdded}>+{totals.additions}</b>
                <b className={styles.diffRemoved}>-{totals.deletions}</b>
              </>
            ) : (
              mergedStatus ?? (active ? '正在编辑' : '等待文件内容')
            )}
          </span>
        </div>
        <span className={styles.blockActions}>
          <CopyButton text={copyText} label="复制文件变更" />
        </span>
      </div>
      <div className={styles.fileChangeRows}>
        {visibleEntries.map((entry, index) => {
          const stats = fileChangeStats(entry.diff)
          const entryItem: FileChangeItem = {
            type: 'fileChange',
            id: `${items[0]?.id ?? 'file-change'}-${index}`,
            path: entry.path,
            diff: entry.diff,
            status: entry.status,
            changes: [entry],
          }
          const display = displayPath(entry.path || '文件变更', projectRoot)
          const rowMeta = fileChangeRowMeta(entry)
          return (
            <details className={styles.fileChangeRow} key={`${entry.path || 'file'}-${index}`}>
              <summary>
                <span className={styles.fileChangeRowMain}>
                  <span className={styles.fileChangeRowPath}>{display}</span>
                  {stats.additions || stats.deletions ? null : <small>{rowMeta}</small>}
                </span>
                <span className={styles.fileChangeRowStats}>
                  {stats.additions || stats.deletions ? (
                    <>
                      <b className={styles.diffAdded}>+{stats.additions}</b>
                      <b className={styles.diffRemoved}>-{stats.deletions}</b>
                    </>
                  ) : (
                    entry.kind ?? entry.status ?? '预览'
                  )}
                </span>
                {entry.path && onOpenFileReference ? (
                  <button
                    className={styles.fileChangeOpenButton}
                    type="button"
                    aria-label={`在右侧栏打开 ${display}`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onOpenFileReference(entry.path)
                    }}
                  >
                    <PanelRightOpen size={13} />
                  </button>
                ) : null}
                <ChevronDown className={styles.fileChangeRowChevron} size={14} />
              </summary>
              <div className={styles.fileChangeDetail}>
                {entry.diff ? (
                  <FileDiffView diff={entry.diff} />
                ) : (
                  <FilePreviewBody item={entryItem} projectRoot={projectRoot} />
                )}
              </div>
            </details>
          )
        })}
        {entries.length > FILE_CHANGE_INITIAL_ROW_COUNT ? (
          <button className={styles.fileChangeMoreButton} type="button" onClick={() => setShowAll((value) => !value)}>
            {showAll ? '收起文件列表' : `再显示 ${entries.length - visibleEntries.length} 个文件`}
            <ChevronDown className={showAll ? styles.fileChangeMoreIconOpen : undefined} size={14} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function FileChangeBlockDetails({
  item,
  projectRoot,
  turnStatus,
  onOpenFileReference,
  forceComplete,
}: {
  item: FileChangeItem
  projectRoot?: string | null
  turnStatus: string
  onOpenFileReference?: (path: string) => void
  forceComplete: boolean
}): ReactElement {
  return (
    <FileChangeSummaryCard
      forceComplete={forceComplete}
      items={[item]}
      onOpenFileReference={onOpenFileReference}
      projectRoot={projectRoot}
      turnStatus={turnStatus}
    />
  )
}

function FileChangeMessage({
  item,
  turnStatus,
  projectRoot,
  onOpenFileReference,
}: {
  item: FileChangeItem
  turnStatus: string
  projectRoot?: string | null
  onOpenFileReference?: (path: string) => void
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const summary = fileChangeSummary([item], turnStatus)
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        icon={<FileCode2 size={16} />}
        label={summary.label}
        meta={summary.meta}
        expanded={expanded}
        active={summary.active}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <FileChangeBlockDetails
          forceComplete={false}
          item={item}
          onOpenFileReference={onOpenFileReference}
          projectRoot={projectRoot}
          turnStatus={turnStatus}
        />
      ) : null}
    </article>
  )
}

function ReasoningMessage({ item, turnStatus }: { item: ReasoningItem; turnStatus: string }): ReactElement {
  const [expanded, setExpanded] = useState(!item.collapsed)
  const text = item.text || '推理内容已折叠'
  const active = isReasoningItemActive(item, turnStatus)
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        icon={<Brain size={16} />}
        label={active ? '正在思考' : '已思考'}
        meta={expanded ? turnStatus : undefined}
        expanded={expanded}
        active={active}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.reasoningBlock}>
          <BlockHeader
            icon={<Brain size={15} />}
            title="思考"
            copyText={item.text}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((value) => !value)}
          />
          <MarkdownText text={text} className={styles.reasoningMarkdown} />
        </div>
      ) : null}
    </article>
  )
}

function ToolOutputBlockDetails({ item, expanded, onToggleExpanded }: { item: ToolOutputItem; expanded: boolean; onToggleExpanded: () => void }): ReactElement {
  const text = item.text || '暂无工具输出'
  return (
    <div className={styles.commandBlock}>
      <BlockHeader
        icon={<Code2 size={15} />}
        title={item.rawType}
        status={item.status}
        copyText={text}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
      />
      <pre className={blockPreClass(expanded)}>{text}</pre>
    </div>
  )
}

function ToolOutputMessage({ item }: { item: ToolOutputItem }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        icon={<Code2 size={16} />}
        label={item.title || '工具输出'}
        meta={item.status ?? item.rawType}
        expanded={expanded}
        active={isActiveMessageStatus(item.status)}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <ToolOutputBlockDetails item={item} expanded={expanded} onToggleExpanded={() => setExpanded((value) => !value)} />
      ) : null}
    </article>
  )
}

function UnknownMessage({ item, turnStatus }: { item: UnknownItem; turnStatus: string }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const rawText = JSON.stringify(item.raw, null, 2)
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        icon={<Code2 size={16} />}
        label="未知内容"
        meta={item.rawType || turnStatus}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.commandBlock}>
          <BlockHeader
            icon={<Code2 size={15} />}
            title={item.rawType || '未知内容'}
            copyText={rawText}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((value) => !value)}
          />
          <pre className={styles.blockPreExpanded}>{rawText}</pre>
        </div>
      ) : null}
    </article>
  )
}

function ContextCompactionMessage(): ReactElement {
  return (
    <article className={styles.contextCompactionMessage}>
      <span />
      <strong>上下文已自动压缩</strong>
      <span />
    </article>
  )
}

function isGroupedOperationItem(item: MessageItem): item is GroupedOperationItem {
  return item.type === 'command' || item.type === 'fileChange' || item.type === 'toolOutput'
}

function groupedOperationSummary(
  items: GroupedOperationItem[],
  turnStatus: string,
  forceComplete: boolean,
): { label: string; meta: string; active: boolean } {
  const commandCount = items.filter((item) => item.type === 'command').length
  const fileChangeCount = items.filter((item) => item.type === 'fileChange').length
  const toolCount = items.filter((item) => item.type === 'toolOutput').length
  const active = items.some((item) => isOperationItemActive(item, turnStatus, forceComplete))
  const duration = items.reduce((total, item) => total + (item.type === 'command' && item.durationMs ? item.durationMs : 0), 0)
  const parts = [
    commandCount ? `${commandCount} 条命令` : '',
    fileChangeCount ? `${fileChangeCount} 个文件变更` : '',
    toolCount ? `${toolCount} 个工具输出` : '',
  ].filter(Boolean)
  return {
    label: active ? '正在运行' : '已运行',
    meta: `${parts.join('，') || '执行项'}${duration > 0 ? `，${active ? '已持续 ' : ''}${formatDurationMs(duration)}` : ''}`,
    active,
  }
}

function commandRunLabel(item: CommandItem, turnStatus: string, forceComplete: boolean): string {
  if (isOperationItemActive(item, turnStatus, forceComplete)) return '正在运行'
  if (item.status === 'failed' || item.exitCode !== null && item.exitCode !== 0) return '运行失败'
  return '已运行'
}

function operationTitle(item: GroupedOperationItem): string {
  if (item.type === 'command') return item.command || '命令'
  if (item.type === 'fileChange') return displayPath(fileChangeEntries(item)[0]?.path ?? item.path, undefined) || '文件变更'
  return item.title || item.rawType || '工具输出'
}

function OperationRow({
  item,
  projectRoot,
  turnStatus,
  onOpenFileReference,
  forceComplete,
}: {
  item: GroupedOperationItem
  projectRoot?: string | null
  turnStatus: string
  onOpenFileReference?: (path: string) => void
  forceComplete: boolean
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const label =
    item.type === 'command'
      ? commandRunLabel(item, turnStatus, forceComplete)
      : item.type === 'fileChange'
        ? isOperationItemActive(item, turnStatus, forceComplete) ? '正在编辑' : '已编辑'
        : isOperationItemActive(item, turnStatus, forceComplete)
          ? item.status || '正在运行'
          : item.status === 'completed'
          ? '已完成'
          : item.status || '工具输出'

  return (
    <div className={styles.operationEntry}>
      <button
        className={styles.operationEntryToggle}
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? '折叠执行详情' : '展开执行详情'}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className={styles.operationEntryLabel}>{label}</span>
        <span className={styles.operationEntryTitle}>{operationTitle(item)}</span>
      </button>
      {expanded ? (
        item.type === 'command' ? (
          <CommandBlockDetails item={item} />
        ) : item.type === 'fileChange' ? (
          <FileChangeBlockDetails
            forceComplete={forceComplete}
            item={item}
            onOpenFileReference={onOpenFileReference}
            projectRoot={projectRoot}
            turnStatus={turnStatus}
          />
        ) : (
          <ToolOutputBlockDetails item={item} expanded={expanded} onToggleExpanded={() => setExpanded((value) => !value)} />
        )
      ) : null}
    </div>
  )
}

function GroupedOperationMessage({
  items,
  turnStatus,
  projectRoot,
  onOpenFileReference,
  forceComplete,
}: {
  items: GroupedOperationItem[]
  turnStatus: string
  projectRoot?: string | null
  onOpenFileReference?: (path: string) => void
  forceComplete: boolean
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const summary = groupedOperationSummary(items, turnStatus, forceComplete)
  return (
    <article className={styles.assistantMessage} key={`operation-group-${items.map((item) => item.id).join('-')}`}>
      <CollapsedMessageToggle
        icon={<TerminalSquare size={16} />}
        label={summary.label}
        meta={summary.meta}
        expanded={expanded}
        active={summary.active}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.groupedMessageBody}>
          {items.map((item) => (
            <OperationRow
              forceComplete={forceComplete}
              item={item}
              key={item.id}
              onOpenFileReference={onOpenFileReference}
              projectRoot={projectRoot}
              turnStatus={turnStatus}
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}

function FileChangeSummaryMessage({
  items,
  projectRoot,
  turnStatus,
  onOpenFileReference,
  forceComplete,
}: {
  items: FileChangeItem[]
  projectRoot?: string | null
  turnStatus: string
  onOpenFileReference?: (path: string) => void
  forceComplete: boolean
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const summary = fileChangeSummary(items, turnStatus, forceComplete)
  return (
    <article className={styles.assistantMessage} key={`file-change-group-${items.map((item) => item.id).join('-')}`}>
      <CollapsedMessageToggle
        icon={<FileCode2 size={16} />}
        label={summary.label}
        meta={summary.meta}
        expanded={expanded}
        active={summary.active}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <FileChangeSummaryCard
          forceComplete={forceComplete}
          items={items}
          onOpenFileReference={onOpenFileReference}
          projectRoot={projectRoot}
          turnStatus={turnStatus}
        />
      ) : null}
    </article>
  )
}

function errorDisplayText(item: Extract<MessageItem, { type: 'error' }>): { summary: string; detail: string } {
  const lines = item.message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const summary = lines[0] || item.code || '连接错误'
  const detail = [
    lines.slice(1).join('\n'),
    item.detail ?? '',
    item.code ? `code: ${item.code}` : '',
  ].filter(Boolean).join('\n')
  return { summary, detail }
}

function ErrorMessage({ item }: { item: Extract<MessageItem, { type: 'error' }>; turnStatus: string }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const { summary, detail } = errorDisplayText(item)
  const copyText = [item.message, item.detail, item.code].filter(Boolean).join('\n')
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <button
        className={styles.errorInlineToggle}
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? '折叠连接错误' : '展开连接错误'}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{summary}</span>
      </button>
      {expanded ? (
        <div className={styles.errorInlineDetail}>
          <pre>{detail || summary}</pre>
          <CopyButton text={copyText} label="复制错误详情" />
        </div>
      ) : null}
    </article>
  )
}

function isContextCompactionItem(item: UnknownItem): boolean {
  const rawType = item.rawType.toLowerCase()
  return rawType.includes('contextcompaction') || rawType.includes('context_compaction') || rawType.includes('compact')
}

function unknownRawType(item: UnknownItem): string {
  if (item.raw && typeof item.raw === 'object' && !Array.isArray(item.raw)) {
    const rawRecord = item.raw as Record<string, unknown>
    if (typeof rawRecord.type === 'string') return rawRecord.type.toLowerCase()
  }
  return ''
}

function compactProtocolType(value?: string | null): string {
  return (value ?? '').toLowerCase().replace(/[-_]/g, '')
}

function asUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readUnknownString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readUnknownTextContent(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const record = asUnknownRecord(entry)
        return readUnknownString(record?.text)
          || readUnknownString(record?.content)
          || readUnknownString(record?.value)
          || readUnknownTextContent(record?.content)
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  const record = asUnknownRecord(value)
  if (!record) return ''
  return readUnknownString(record.text)
    || readUnknownString(record.content)
    || readUnknownString(record.message)
    || readUnknownString(record.value)
    || readUnknownTextContent(record.content ?? record.message ?? record.input)
}

function readUnknownImage(value: unknown): MessageImage | null {
  const record = asUnknownRecord(value)
  if (!record) return null
  const imageUrl = asUnknownRecord(record.image_url)
  const source = asUnknownRecord(record.source)
  const type = readUnknownString(record.type).toLowerCase()
  const url =
    readUnknownString(record.url)
    || readUnknownString(record.src)
    || readUnknownString(record.imageUrl)
    || readUnknownString(record.image_url)
    || readUnknownString(imageUrl?.url)
    || readUnknownString(source?.url)
    || readUnknownString(source?.src)
    || null
  const path =
    readUnknownString(record.path)
    || readUnknownString(record.filePath)
    || readUnknownString(record.file_path)
    || readUnknownString(source?.path)
    || null
  const mimeType =
    readUnknownString(record.mimeType)
    || readUnknownString(record.mime_type)
    || readUnknownString(record.mediaType)
    || readUnknownString(record.media_type)
    || null
  const alt = readUnknownString(record.alt) || readUnknownString(record.filename) || null
  if (!url && !path && !type.includes('image')) return null
  return { url, path, mimeType, alt }
}

function readUnknownImages(value: unknown): MessageImage[] {
  const values = Array.isArray(value) ? value : [value]
  return values.map(readUnknownImage).filter((entry): entry is MessageImage => Boolean(entry))
}

function compactMessageImages(images: MessageImage[]): MessageImage[] {
  const seen = new Set<string>()
  return images.filter((image) => {
    const key = `${image.url ?? ''}|${image.path ?? ''}`
    if (!key.trim() || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isUnknownSteeringUserMessage(item: UnknownItem): boolean {
  return compactProtocolType(item.rawType) === 'steeringusermessage'
    || compactProtocolType(unknownRawType(item)) === 'steeringusermessage'
}

function readSteeringUserMessage(item: UnknownItem): { text: string; images: MessageImage[] } | null {
  if (!isUnknownSteeringUserMessage(item)) return null
  const raw = asUnknownRecord(item.raw)
  const restoreMessage = asUnknownRecord(raw?.restoreMessage)
  const restoreContext = asUnknownRecord(restoreMessage?.context)
  const text =
    readUnknownString(restoreMessage?.text)
    || readUnknownTextContent(raw?.input)
    || readUnknownTextContent(raw?.content)
    || readUnknownString(raw?.text)
  const images = compactMessageImages([
    ...readUnknownImages(raw?.input),
    ...readUnknownImages(raw?.content),
    ...readUnknownImages(raw?.attachments),
    ...readUnknownImages(raw?.imageAttachments),
    ...readUnknownImages(restoreMessage?.imageAttachments),
    ...readUnknownImages(restoreContext?.imageAttachments),
  ])
  if (!text && images.length === 0) return null
  return { text, images }
}

function isSilentUnknownItem(item: UnknownItem): boolean {
  const rawType = compactProtocolType(item.rawType)
  const declaredType = compactProtocolType(unknownRawType(item))
  return rawType === 'steered' || declaredType === 'steered'
    || rawType === 'todolist' || declaredType === 'todolist'
}

function isChatFlowSilentItem(item: MessageItem): boolean {
  return item.type === 'plan' || item.type === 'unknown' && isSilentUnknownItem(item)
}

function isReasoningItemActive(item: ReasoningItem, turnStatus: string): boolean {
  if (!isActiveMessageStatus(turnStatus)) return false
  if (isTerminalOperationStatus(item.status)) return false
  return isActiveMessageStatus(item.status) || item.status === null
}

function shouldRenderReasoningItem(items: MessageItem[], index: number, turnStatus: string): boolean {
  const item = items[index]
  if (item?.type !== 'reasoning') return false
  if (!isReasoningItemActive(item, turnStatus)) return false
  return !items.slice(index + 1).some((nextItem) => nextItem.type !== 'reasoning')
}

export function renderMessageItem(item: MessageItem, turnStatus: string, options: RenderOptions = {}): ReactElement | null {
  if (item.type === 'user') {
    return (
      <article className={styles.userMessage} data-testid="user-message" key={item.id}>
        <MessageImages images={item.images} projectRoot={options.projectRoot} />
        <UserPlainText text={item.text} />
      </article>
    )
  }
  if (item.type === 'assistant') {
    return (
      <article className={styles.plainAssistantMessage} key={item.id}>
        <MarkdownText
          text={item.text}
          projectRoot={options.projectRoot}
          onOpenFileReference={options.onOpenFileReference}
        />
        <MessageImages images={item.images} projectRoot={options.projectRoot} />
      </article>
    )
  }
  if (item.type === 'reasoning') {
    if (!isActiveMessageStatus(turnStatus)) return null
    return <ReasoningMessage item={item} key={item.id} turnStatus={turnStatus} />
  }
  if (item.type === 'command') {
    return <CommandMessage item={item} key={item.id} turnStatus={turnStatus} />
  }
  if (item.type === 'fileChange') {
    return (
      <FileChangeMessage
        item={item}
        key={item.id}
        onOpenFileReference={options.onOpenFileReference}
        projectRoot={options.projectRoot}
        turnStatus={turnStatus}
      />
    )
  }
  if (item.type === 'plan') {
    return (
      <article className={styles.assistantMessage} key={item.id}>
        <MessageAuthor icon={<CheckCircle2 size={16} />} label="计划" meta={item.status ?? turnStatus} />
        <div className={styles.commandBlock}>
          <BlockHeader icon={<CheckCircle2 size={15} />} title={item.text || '计划'} copyText={item.steps.map((step) => step.text).join('\n') || item.text} />
          <ol className={styles.planList}>
            {item.steps.length ? item.steps.map((step, index) => (
              <li key={`${step.text}-${index}`}>
                <span>{step.text}</span>
                {step.status ? <StatusBadge label={step.status} tone={step.status === 'completed' ? 'ready' : 'idle'} /> : null}
              </li>
            )) : <li><span>{item.text || '暂无计划步骤'}</span></li>}
          </ol>
        </div>
      </article>
    )
  }
  if (item.type === 'approval') {
    return (
      <article className={styles.assistantMessage} key={item.id}>
        <MessageAuthor icon={<CheckCircle2 size={16} />} label="审批" meta={item.status ?? turnStatus} />
        <div className={styles.commandBlock}>
          <BlockHeader
            icon={item.kind === 'fileChange' ? <FileCode2 size={15} /> : <TerminalSquare size={15} />}
            title={item.title}
            status={item.status}
            statusTone="warn"
            copyText={[item.title, item.command, item.cwd, item.reason, item.body].filter(Boolean).join('\n')}
          />
          <div className={styles.blockMeta}>
            {item.command ? <span>{item.command}</span> : null}
            {item.cwd ? <span>cwd {item.cwd}</span> : null}
            {item.reason ? <span>{item.reason}</span> : null}
          </div>
          {item.body ? (
            <MarkdownText
              text={item.body}
              projectRoot={options.projectRoot}
              onOpenFileReference={options.onOpenFileReference}
            />
          ) : null}
        </div>
      </article>
    )
  }
  if (item.type === 'image') {
    return (
      <article className={styles.assistantMessage} key={item.id}>
        <MessageAuthor icon={<Paperclip size={16} />} label="图片" meta={item.image.mimeType ?? turnStatus} />
        <MessageImages images={[item.image]} projectRoot={options.projectRoot} />
      </article>
    )
  }
  if (item.type === 'error') {
    return <ErrorMessage item={item} key={item.id} turnStatus={turnStatus} />
  }
  if (item.type === 'toolOutput') {
    return <ToolOutputMessage item={item} key={item.id} />
  }
  if (item.type === 'unknown') {
    const steeringUserMessage = readSteeringUserMessage(item)
    if (steeringUserMessage) {
      return (
        <article className={styles.userMessage} data-testid="user-message" key={item.id}>
          <MessageImages images={steeringUserMessage.images} projectRoot={options.projectRoot} />
          {steeringUserMessage.text ? <UserPlainText text={steeringUserMessage.text} /> : null}
        </article>
      )
    }
    if (isSilentUnknownItem(item)) return null
    if (isContextCompactionItem(item)) return <ContextCompactionMessage key={item.id} />
    return <UnknownMessage item={item} key={item.id} turnStatus={turnStatus} />
  }
  return <article className={styles.assistantMessage} key="unsupported-message-item" />
}

export function renderTurnItems(items: MessageItem[], turnStatus: string, options: RenderOptions = {}): ReactElement[] {
  const rendered: ReactElement[] = []
  let operationGroup: GroupedOperationItem[] = []

  function flushOperationGroup(forceComplete: boolean): void {
    if (operationGroup.length === 0) return
    const fileChangeItems = operationGroup.filter((item): item is FileChangeItem => item.type === 'fileChange')
    if (fileChangeItems.length === operationGroup.length) {
      rendered.push(
        <FileChangeSummaryMessage
          forceComplete={forceComplete}
          items={fileChangeItems}
          key={`file-change-group-${fileChangeItems.map((item) => item.id).join('-')}`}
          onOpenFileReference={options.onOpenFileReference}
          projectRoot={options.projectRoot}
          turnStatus={turnStatus}
        />,
      )
      operationGroup = []
      return
    }
    rendered.push(
      <GroupedOperationMessage
        forceComplete={forceComplete}
        items={operationGroup}
        key={`operation-group-${operationGroup.map((item) => item.id).join('-')}`}
        onOpenFileReference={options.onOpenFileReference}
        projectRoot={options.projectRoot}
        turnStatus={turnStatus}
      />,
    )
    operationGroup = []
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item) continue
    if (item.type === 'reasoning' && !shouldRenderReasoningItem(items, index, turnStatus)) {
      continue
    }
    if (isChatFlowSilentItem(item)) {
      continue
    }
    if (isGroupedOperationItem(item)) {
      operationGroup.push(item)
      continue
    }
    flushOperationGroup(item.type !== 'reasoning')
    const renderedItem = renderMessageItem(item, turnStatus, options)
    if (renderedItem) rendered.push(renderedItem)
  }
  flushOperationGroup(false)

  return rendered
}

export function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: PendingApproval
  onDecide: (id: string, decision: ApprovalDecision) => Promise<void>
}): ReactElement {
  const amendmentCount = approval.proposedExecpolicyAmendment?.length ?? 0
  const changedFileCount = approval.changedFiles?.length ?? 0
  const [diffExpanded, setDiffExpanded] = useState(false)
  const [deciding, setDeciding] = useState<ApprovalDecision | null>(null)

  async function decide(decision: ApprovalDecision): Promise<void> {
    if (deciding) return
    setDeciding(decision)
    try {
      await onDecide(approval.id, decision)
    } finally {
      setDeciding(null)
    }
  }

  return (
    <article className={styles.approvalCard}>
      <div className={styles.approvalHeader}>
        <span className={styles.approvalIcon}>
          {approval.kind === 'fileChange' ? <FileCode2 size={16} /> : <TerminalSquare size={16} />}
        </span>
        <div>
          <h3>{approval.title}</h3>
          <p>{approval.reason ?? (approval.kind === 'fileChange' ? 'Agent 请求应用文件变更。' : 'Agent 请求执行命令。')}</p>
        </div>
      </div>
      <div className={styles.approvalBody}>
        {approval.command ? <code>{approval.command}</code> : null}
        {approval.cwd ? <span>cwd: {approval.cwd}</span> : null}
        {approval.grantRoot ? <span>root: {approval.grantRoot}</span> : null}
        {approval.filePath ? <span>file: {approval.filePath}</span> : null}
        {changedFileCount > 0 ? <span>{changedFileCount} 个变更文件</span> : null}
        {amendmentCount > 0 ? <span>{amendmentCount} 条 session 级授权建议</span> : null}
      </div>
      {approval.changedFiles?.length ? (
        <div className={styles.approvalFiles}>
          {approval.changedFiles.slice(0, 6).map((file) => <span key={file}>{file}</span>)}
        </div>
      ) : null}
      {approval.proposedExecpolicyAmendment?.length ? (
        <div className={styles.approvalFiles}>
          {approval.proposedExecpolicyAmendment.slice(0, 6).map((entry) => <code key={entry}>{entry}</code>)}
        </div>
      ) : null}
      {approval.diff ? (
        <div className={styles.approvalDiff}>
          <div className={styles.errorItemHeader}>
            <strong>Diff</strong>
            <span className={styles.blockActions}>
              <CopyButton text={approval.diff} />
              <ExpandButton expanded={diffExpanded} onToggle={() => setDiffExpanded((value) => !value)} />
            </span>
          </div>
          {diffExpanded ? <pre className={styles.blockPreExpanded}>{approval.diff}</pre> : null}
        </div>
      ) : null}
      <div className={styles.approvalActions}>
        <button type="button" disabled={Boolean(deciding)} onClick={() => void decide('accept')}>
          {deciding === 'accept' ? '处理中' : '批准'}
        </button>
        {amendmentCount > 0 ? (
          <button type="button" disabled={Boolean(deciding)} onClick={() => void decide('acceptForSession')}>
            {deciding === 'acceptForSession' ? '处理中' : '本轮批准'}
          </button>
        ) : null}
        <button type="button" disabled={Boolean(deciding)} onClick={() => void decide('decline')}>
          {deciding === 'decline' ? '处理中' : '拒绝'}
        </button>
        <button type="button" disabled={Boolean(deciding)} onClick={() => void decide('cancel')}>
          {deciding === 'cancel' ? '处理中' : '拒绝并停止'}
        </button>
      </div>
    </article>
  )
}
