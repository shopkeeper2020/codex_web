import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  PanelRightOpen,
  Paperclip,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import {
  fileContentUrl,
  getFilePreview,
  type ApprovalDecision,
  type FilePreview,
  type MessageItem,
  type PendingApproval,
} from '../../api'
import {
  asThreadItemRecord,
  isAgentMessageItem,
  isUserMessageItem,
  migrateLegacyMessageItemForRender,
  migrateLegacyMessageItemsForRender,
  readCommandOutput,
  readFileChangeEntries,
  readMessageItemStatus,
  readMessageItemText,
  readThreadItemString,
} from '../officialThreadItems'
import { deriveTurnProcessCollapse } from '../turnProcessCollapse'
import styles from '../App.module.css'
import { AgentMessageBlock, type AgentMessageBlockItem } from './messageBlocks/AgentMessageBlock'
import {
  CommandBlockDetails,
  CommandExecutionBlock,
  type CommandExecutionBlockItem,
} from './messageBlocks/CommandExecutionBlock'
import { ProcessedTurnItemsMessage } from './messageBlocks/ProcessedTurnItemsMessage'
import {
  UserMessageBlock,
  userMessageActionsForItem,
  type UserMessageActions,
  type UserMessageBlockItem,
} from './messageBlocks/UserMessageBlock'
import {
  ToolOrOfficialUnknownBlock,
  ToolOutputBlockDetails,
  WebSearchSummaryMessage,
  isSilentUnknownItem,
  isWebSearchRenderItem,
  type ToolOrOfficialUnknownBlockItem,
  type ToolOutputBlockItem,
  type UnknownOfficialBlockItem,
  type WebSearchRenderItem,
} from './messageBlocks/ToolOrOfficialUnknownBlock'
import {
  BlockHeader,
  CollapsedMessageToggle,
  CopyButton,
  ExpandButton,
  MarkdownText,
  MessageAuthor,
  MessageImages,
  compactStatus,
  displayPath,
  filePreviewRequest,
  formatDurationMs,
  isActiveMessageStatus,
  isTerminalOperationStatus,
  isVideoMedia,
  renderFileReferencesInText,
} from './messageBlocks/shared'
import { StatusBadge } from './StatusBadge'

export { MessageAuthor } from './messageBlocks/shared'
type CommandItem = CommandExecutionBlockItem
type FileChangeItem = Extract<MessageItem, { type: 'fileChange' }>
type FileChangeEntry = ReturnType<typeof readFileChangeEntries>[number]
type AgentTaskItem = Extract<MessageItem, { type: 'agentTask' }>
type AgentTaskEntry = AgentTaskItem['agents'][number]
type ReasoningItem = Extract<MessageItem, { type: 'reasoning' }>
type ToolOutputItem = ToolOutputBlockItem
type UnknownItem = UnknownOfficialBlockItem
type UserMessageItem = UserMessageBlockItem
type PlanMessageItem = Extract<MessageItem, { type: 'plan' }>
type ApprovalItem = Extract<MessageItem, { type: 'approval' }>
type ImageItem = Extract<MessageItem, { type: 'image' }>
type ErrorItem = Extract<MessageItem, { type: 'error' }>
type GroupedOperationItem = CommandItem | FileChangeItem | ToolOutputItem
type RenderOptions = {
  projectRoot?: string | null
  onOpenFileReference?: (path: string) => void
  getUserMessageActions?: (item: UserMessageItem) => UserMessageActions | null
  disableProcessCollapse?: boolean
  processedContext?: boolean
}

const AGENT_TASK_COLLAPSE_LINE_COUNT = 7
const AGENT_TASK_COLLAPSE_CHAR_COUNT = 520
const FILE_CHANGE_INITIAL_ROW_COUNT = 3

function messageItemType(item: MessageItem): string {
  return readThreadItemString(asThreadItemRecord(item)?.type)
}

function isRenderableUserMessageItem(item: MessageItem): item is UserMessageItem {
  return isUserMessageItem(item)
}

function isRenderableCommandItem(item: MessageItem): item is CommandItem {
  const type = messageItemType(item)
  return type === 'command' || type === 'commandExecution'
}

function isReasoningMessageItem(item: MessageItem): item is ReasoningItem {
  return messageItemType(item) === 'reasoning'
}

function isFileChangeMessageItem(item: MessageItem): item is FileChangeItem {
  return messageItemType(item) === 'fileChange'
}

function isPlanMessageItem(item: MessageItem): item is PlanMessageItem {
  return messageItemType(item) === 'plan'
}

function isAgentTaskMessageItem(item: MessageItem): item is AgentTaskItem {
  return messageItemType(item) === 'agentTask'
}

function isApprovalMessageItem(item: MessageItem): item is ApprovalItem {
  return messageItemType(item) === 'approval'
}

function isImageMessageItem(item: MessageItem): item is ImageItem {
  return messageItemType(item) === 'image'
}

function isErrorMessageItem(item: MessageItem): item is ErrorItem {
  return messageItemType(item) === 'error'
}

function isUnknownMessageItem(item: MessageItem): item is UnknownItem {
  return messageItemType(item) === 'unknown'
}

function isToolBlockItem(item: MessageItem): boolean {
  const type = messageItemType(item)
  return type === 'toolOutput' || type === 'webSearch' || type === 'mcpToolCall' || type === 'dynamicToolCall'
}

function isOperationItemComplete(item: GroupedOperationItem): boolean {
  const status = readMessageItemStatus(item)
  if (isTerminalOperationStatus(status)) return true
  const command = readCommandOutput(item)
  if (command) return command.exitCode !== null
  return false
}

function isOperationItemActive(item: GroupedOperationItem, turnStatus: string, forceComplete = false): boolean {
  if (forceComplete) return false
  if (!isActiveMessageStatus(turnStatus)) return false
  if (isOperationItemComplete(item)) return false
  const status = readMessageItemStatus(item)
  const command = readCommandOutput(item)
  return isActiveMessageStatus(status)
    || (command !== null && command.exitCode === null)
    || (item.type === 'fileChange' && status === null)
}

function isWebSearchItemActive(item: WebSearchRenderItem, turnStatus: string, forceComplete = false): boolean {
  if (item.type === 'toolOutput') return isOperationItemActive(item, turnStatus, forceComplete)
  if (forceComplete) return false
  if (!isActiveMessageStatus(turnStatus)) return false
  const status = readMessageItemStatus(item)
  if (isTerminalOperationStatus(status)) return false
  return isActiveMessageStatus(status)
}

function fileChangeEntries(item: FileChangeItem): FileChangeEntry[] {
  return readFileChangeEntries(item)
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

function fileChangeCopyText(entries: FileChangeEntry[], projectRoot?: string | null): string {
  return entries
    .map((entry) => [displayPath(entry.path, projectRoot), entry.diff].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
}

function fileChangeKindLabel(kind: FileChangeEntry['kind']): string {
  return typeof kind?.type === 'string' ? kind.type : ''
}

function fileChangeRowMeta(entry: FileChangeEntry): string {
  if (entry.diff) return 'diff'
  return fileChangeKindLabel(entry.kind) || entry.status || '预览'
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
  const previewPath = fileChangeEntries(item)[0]?.path ?? ''
  const previewRequest = previewPath ? filePreviewRequest(previewPath, projectRoot) : null

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
        <img src={fileContentUrl(previewRequest ?? { path: previewPath, root: projectRoot })} alt={preview.filename} loading="lazy" />
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
                    fileChangeKindLabel(entry.kind) || entry.status || '预览'
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

function ReasoningMessage({
  item,
  turnStatus,
  forceComplete = false,
}: {
  item: ReasoningItem
  turnStatus: string
  forceComplete?: boolean
}): ReactElement {
  const record = asThreadItemRecord(item)
  const [expanded, setExpanded] = useState(record?.collapsed === false)
  const text = readMessageItemText(item) || '推理内容已折叠'
  const active = !forceComplete && isReasoningItemActive(item, turnStatus)
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        icon={<Brain size={16} />}
        label={active ? '正在思考' : '已思考'}
        meta={expanded ? (forceComplete ? 'completed' : turnStatus) : undefined}
        expanded={expanded}
        active={active}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.reasoningBlock}>
          <BlockHeader
            icon={<Brain size={15} />}
            title="思考"
            copyText={text}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((value) => !value)}
          />
          <MarkdownText text={text} className={styles.reasoningMarkdown} />
        </div>
      ) : null}
    </article>
  )
}

function agentTaskEntries(item: AgentTaskItem): AgentTaskEntry[] {
  if (item.agents.length) return item.agents
  return [
    {
      id: `${item.id}-agent`,
      name: item.title || 'Agent',
      status: item.status,
      prompt: item.prompt,
      model: item.model,
      reasoningEffort: item.reasoningEffort,
    },
  ]
}

function isActiveAgentStatus(value?: string | null): boolean {
  const normalized = compactStatus(value)
  return isActiveMessageStatus(value) || [
    'initializing',
    'pendinginit',
    'queued',
    'starting',
    'working',
  ].includes(normalized)
}

function isAgentTaskActive(item: AgentTaskItem, turnStatus: string): boolean {
  if (!isActiveMessageStatus(turnStatus)) return false
  if (isActiveAgentStatus(item.status)) return true
  return agentTaskEntries(item).some((agent) => isActiveAgentStatus(agent.status))
}

function agentTaskSummary(item: AgentTaskItem, turnStatus: string): { label: string; active: boolean } {
  const count = Math.max(1, agentTaskEntries(item).length)
  const active = isAgentTaskActive(item, turnStatus)
  return {
    label: `${active ? '正在生成' : '已生成'} ${count} 个智能体`,
    active,
  }
}

function agentTaskStatusLabel(status: string | null, active: boolean): string {
  if (active) return '正在生成'
  if (status && ['failed', 'error'].includes(compactStatus(status))) return '生成失败'
  return '已生成'
}

function splitAgentPrompt(prompt: string): { input: string; task: string } {
  const normalized = prompt.trim()
  if (!normalized) return { input: '', task: '' }
  const markerPattern = /(?:任务|任務|工作目标|工作目標)\s*[:：]\s*/u
  const match =
    new RegExp(`(?:^|\\r?\\n\\s*\\r?\\n)\\s*${markerPattern.source}`, 'u').exec(normalized) ||
    new RegExp(`(?:^|\\r?\\n)\\s*${markerPattern.source}`, 'u').exec(normalized)
  if (!match || match.index === undefined) return { input: normalized, task: '' }

  const marker = markerPattern.exec(match[0])
  if (!marker || marker.index === undefined) return { input: normalized, task: '' }
  const markerStart = match.index + marker.index
  const taskStart = markerStart + marker[0].length
  return {
    input: normalized.slice(0, markerStart).trim(),
    task: normalized.slice(taskStart).trim(),
  }
}

function AgentTaskSection({
  label,
  text,
  projectRoot,
  onOpenFileReference,
}: {
  label: string
  text: string
  projectRoot?: string | null
  onOpenFileReference?: (path: string) => void
}): ReactElement | null {
  const shouldCollapse =
    text.length > AGENT_TASK_COLLAPSE_CHAR_COUNT ||
    text.split(/\r?\n/).length > AGENT_TASK_COLLAPSE_LINE_COUNT
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const collapsed = shouldCollapse && !expanded
  return (
    <div className={styles.agentTaskSection}>
      <span className={styles.agentTaskLabel}>{label}</span>
      <span className={[styles.agentTaskText, collapsed ? styles.agentTaskTextCollapsed : ''].filter(Boolean).join(' ')}>
        {renderFileReferencesInText(text, { projectRoot, onOpenFileReference })}
      </span>
      {shouldCollapse ? (
        <button
          aria-expanded={expanded}
          className={styles.agentTaskToggle}
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '展开'}
          <ChevronDown className={expanded ? styles.agentTaskToggleIconOpen : styles.agentTaskToggleIcon} size={14} />
        </button>
      ) : null}
    </div>
  )
}

function AgentTaskMessage({
  item,
  turnStatus,
  projectRoot,
  onOpenFileReference,
}: {
  item: AgentTaskItem
  turnStatus: string
  projectRoot?: string | null
  onOpenFileReference?: (path: string) => void
}): ReactElement {
  const summary = agentTaskSummary(item, turnStatus)
  const [expanded, setExpanded] = useState(true)
  const entries = agentTaskEntries(item)
  return (
    <article className={styles.assistantMessage} key={item.id}>
      <CollapsedMessageToggle
        icon={<Bot size={16} />}
        label={summary.label}
        expanded={expanded}
        active={summary.active}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <div className={styles.agentTaskBody}>
          {entries.map((agent, index) => {
            const sections = splitAgentPrompt(agent.prompt || item.prompt)
            const active = isActiveAgentStatus(agent.status) && isActiveMessageStatus(turnStatus)
            return (
              <section className={styles.agentTaskEntry} key={agent.id || `${item.id}-agent-${index}`}>
                <div className={styles.agentTaskStatus}>
                  <span>{agentTaskStatusLabel(agent.status ?? item.status, active)}</span>
                  {entries.length > 1 && agent.name ? <span>{agent.name}</span> : null}
                </div>
                <AgentTaskSection
                  label="输入："
                  text={sections.input}
                  projectRoot={projectRoot}
                  onOpenFileReference={onOpenFileReference}
                />
                <AgentTaskSection
                  label="任务："
                  text={sections.task}
                  projectRoot={projectRoot}
                  onOpenFileReference={onOpenFileReference}
                />
                {!sections.input && !sections.task ? (
                  <span className={styles.agentTaskEmpty}>暂无智能体输入</span>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}

function isGroupedOperationItem(item: MessageItem): item is GroupedOperationItem {
  const type = messageItemType(item)
  return type === 'command' || type === 'commandExecution' || type === 'fileChange' || type === 'toolOutput'
}

function groupedOperationSummary(
  items: GroupedOperationItem[],
  turnStatus: string,
  forceComplete: boolean,
): { label: string; meta: string; active: boolean } {
  const commandCount = items.filter(isRenderableCommandItem).length
  const fileChangeCount = items.filter((item) => item.type === 'fileChange').length
  const toolCount = items.filter((item) => item.type === 'toolOutput').length
  const active = items.some((item) => isOperationItemActive(item, turnStatus, forceComplete))
  const duration = items.reduce((total, item) => total + (readCommandOutput(item)?.durationMs ?? 0), 0)
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
  const command = readCommandOutput(item)
  if (command?.status === 'declined') return '已拒绝'
  if (command && (command.status === 'failed' || command.exitCode !== null && command.exitCode !== 0)) return '运行失败'
  return '已运行'
}

function operationTitle(item: GroupedOperationItem): string {
  if (isRenderableCommandItem(item)) {
    const command = readCommandOutput(item)
    return command?.command || '命令'
  }
  if (item.type === 'fileChange') return displayPath(fileChangeEntries(item)[0]?.path ?? '', undefined) || '文件变更'
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
    isRenderableCommandItem(item)
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
        isRenderableCommandItem(item) ? (
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

function isChatFlowSilentItem(item: MessageItem): boolean {
  return isPlanMessageItem(item) || (isUnknownMessageItem(item) && isSilentUnknownItem(item))
}

function isReasoningItemActive(item: ReasoningItem, turnStatus: string): boolean {
  if (!isActiveMessageStatus(turnStatus)) return false
  const status = readMessageItemStatus(item)
  if (isTerminalOperationStatus(status)) return false
  return isActiveMessageStatus(status) || status === null
}

function shouldRenderReasoningItem(
  items: MessageItem[],
  index: number,
  turnStatus: string,
  processedContext = false,
): boolean {
  const item = items[index]
  if (!item || !isReasoningMessageItem(item)) return false
  if (processedContext) return true
  if (!isReasoningItemActive(item, turnStatus)) return false
  return !items.slice(index + 1).some((nextItem) => !isReasoningMessageItem(nextItem))
}

export function renderMessageItem(rawItem: MessageItem, turnStatus: string, options: RenderOptions = {}): ReactElement | null {
  const item = migrateLegacyMessageItemForRender(rawItem)
  if (isRenderableUserMessageItem(item)) {
    return (
      <UserMessageBlock
        actions={userMessageActionsForItem({
          getUserMessageActions: options.getUserMessageActions,
          item,
        })}
        item={item}
        key={item.id}
        projectRoot={options.projectRoot}
      />
    )
  }
  if (isAgentMessageItem(item)) {
    return (
      <AgentMessageBlock
        item={item as AgentMessageBlockItem}
        key={item.id}
        onOpenFileReference={options.onOpenFileReference}
        projectRoot={options.projectRoot}
      />
    )
  }
  if (isReasoningMessageItem(item)) {
    if (!options.processedContext && !isActiveMessageStatus(turnStatus)) return null
    return (
      <ReasoningMessage
        forceComplete={options.processedContext}
        item={item}
        key={item.id}
        turnStatus={turnStatus}
      />
    )
  }
  if (isRenderableCommandItem(item)) {
    return <CommandExecutionBlock item={item} key={item.id} turnStatus={turnStatus} />
  }
  if (isFileChangeMessageItem(item)) {
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
  if (isPlanMessageItem(item)) {
    const steps = item.steps ?? []
    return (
      <article className={styles.assistantMessage} key={item.id}>
        <MessageAuthor icon={<CheckCircle2 size={16} />} label="计划" meta={item.status ?? turnStatus} />
        <div className={styles.commandBlock}>
          <BlockHeader icon={<CheckCircle2 size={15} />} title={item.text || '计划'} copyText={steps.map((step) => step.text).join('\n') || item.text} />
          <ol className={styles.planList}>
            {steps.length ? steps.map((step, index) => (
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
  if (isAgentTaskMessageItem(item)) {
    return (
      <AgentTaskMessage
        item={item}
        key={item.id}
        onOpenFileReference={options.onOpenFileReference}
        projectRoot={options.projectRoot}
        turnStatus={turnStatus}
      />
    )
  }
  if (isApprovalMessageItem(item)) {
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
  if (isImageMessageItem(item)) {
    const video = isVideoMedia(item.image)
    return (
      <article className={styles.assistantMessage} key={item.id}>
        <MessageAuthor icon={<Paperclip size={16} />} label={video ? '视频' : '图片'} meta={item.image.mimeType ?? turnStatus} />
        <MessageImages images={[item.image]} projectRoot={options.projectRoot} />
      </article>
    )
  }
  if (isErrorMessageItem(item)) {
    return <ErrorMessage item={item} key={item.id} turnStatus={turnStatus} />
  }
  if (isToolBlockItem(item)) {
    return <ToolOrOfficialUnknownBlock item={item} key={item.id} turnStatus={turnStatus} />
  }
  if (isUnknownMessageItem(item)) {
    return (
      <ToolOrOfficialUnknownBlock
        item={item}
        key={item.id}
        projectRoot={options.projectRoot}
        turnStatus={turnStatus}
      />
    )
  }
  return (
    <ToolOrOfficialUnknownBlock
      item={item}
      key={item.id}
      projectRoot={options.projectRoot}
      turnStatus={turnStatus}
    />
  )
}

export function renderTurnItems(items: MessageItem[], turnStatus: string, options: RenderOptions = {}): ReactElement[] {
  const renderItems = migrateLegacyMessageItemsForRender(items)
  if (!options.disableProcessCollapse) {
    const collapsed = deriveTurnProcessCollapse(renderItems, turnStatus)
    if (collapsed) {
      const key = [
        'processed-turn-items',
        ...collapsed.processItems.map((item) => item.id),
        collapsed.finalAndAfterItems[0]?.id ?? collapsed.finalAnswerIndex,
      ].join('-')
      return [
        ...renderTurnItems(collapsed.beforeItems, turnStatus, {
          ...options,
          disableProcessCollapse: true,
        }),
        <ProcessedTurnItemsMessage
          items={collapsed.processItems}
          key={key}
          renderItems={(nestedItems, nestedTurnStatus) =>
            renderTurnItems(nestedItems, nestedTurnStatus, {
              ...options,
              disableProcessCollapse: true,
              processedContext: true,
            })
          }
          turnStatus={turnStatus}
        />,
        ...renderTurnItems(collapsed.finalAndAfterItems, turnStatus, {
          ...options,
          disableProcessCollapse: true,
        }),
      ]
    }
  }
  const rendered: ReactElement[] = []
  let operationGroup: GroupedOperationItem[] = []
  let webSearchGroup: WebSearchRenderItem[] = []

  function flushOperationGroup(forceComplete: boolean): void {
    if (operationGroup.length === 0) return
    const groupForceComplete = options.processedContext ? true : forceComplete
    const fileChangeItems = operationGroup.filter((item): item is FileChangeItem => item.type === 'fileChange')
    if (fileChangeItems.length === operationGroup.length) {
      rendered.push(
        <FileChangeSummaryMessage
          forceComplete={groupForceComplete}
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
    const webSearchItems = operationGroup.filter(
      (item): item is ToolOutputItem => item.type === 'toolOutput' && isWebSearchRenderItem(item),
    )
    if (webSearchItems.length === operationGroup.length) {
      rendered.push(
        <WebSearchSummaryMessage
          forceComplete={groupForceComplete}
          isItemActive={(item) => isWebSearchItemActive(item, turnStatus, groupForceComplete)}
          items={webSearchItems}
          key={`web-search-group-${webSearchItems.map((item) => item.id).join('-')}`}
          turnStatus={turnStatus}
        />,
      )
      operationGroup = []
      return
    }
    rendered.push(
      <GroupedOperationMessage
        forceComplete={groupForceComplete}
        items={operationGroup}
        key={`operation-group-${operationGroup.map((item) => item.id).join('-')}`}
        onOpenFileReference={options.onOpenFileReference}
        projectRoot={options.projectRoot}
        turnStatus={turnStatus}
      />,
    )
    operationGroup = []
  }

  function flushWebSearchGroup(forceComplete: boolean): void {
    if (webSearchGroup.length === 0) return
    const groupForceComplete = options.processedContext ? true : forceComplete
    rendered.push(
      <WebSearchSummaryMessage
        forceComplete={groupForceComplete}
        isItemActive={(item) => isWebSearchItemActive(item, turnStatus, groupForceComplete)}
        items={webSearchGroup}
        key={`web-search-group-${webSearchGroup.map((item) => item.id).join('-')}`}
        turnStatus={turnStatus}
      />,
    )
    webSearchGroup = []
  }

  for (let index = 0; index < renderItems.length; index += 1) {
    const item = renderItems[index]
    if (!item) continue
    if (
      isReasoningMessageItem(item)
      && !shouldRenderReasoningItem(renderItems, index, turnStatus, options.processedContext)
    ) {
      continue
    }
    if (isWebSearchRenderItem(item)) {
      flushOperationGroup(true)
      webSearchGroup.push(item)
      continue
    }
    if (isChatFlowSilentItem(item)) {
      continue
    }
    if (isGroupedOperationItem(item)) {
      flushWebSearchGroup(true)
      operationGroup.push(item)
      continue
    }
    flushWebSearchGroup(!isReasoningMessageItem(item))
    flushOperationGroup(!isReasoningMessageItem(item))
    const renderedItem = renderMessageItem(item, turnStatus, options)
    if (renderedItem) rendered.push(renderedItem)
  }
  flushWebSearchGroup(false)
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
  const permissionCount = approval.permissions ? Object.keys(approval.permissions).length : 0
  const fallbackReason =
    approval.kind === 'fileChange'
      ? 'Agent 请求应用文件变更。'
      : approval.kind === 'permissions'
        ? 'Agent 请求额外权限。'
        : 'Agent 请求执行命令。'
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
          {approval.kind === 'fileChange' ? (
            <FileCode2 size={16} />
          ) : approval.kind === 'permissions' ? (
            <ShieldCheck size={16} />
          ) : (
            <TerminalSquare size={16} />
          )}
        </span>
        <div>
          <h3>{approval.title}</h3>
          <p>{approval.reason ?? fallbackReason}</p>
        </div>
      </div>
      <div className={styles.approvalBody}>
        {approval.command ? <code>{approval.command}</code> : null}
        {approval.cwd ? <span>cwd: {approval.cwd}</span> : null}
        {approval.grantRoot ? <span>root: {approval.grantRoot}</span> : null}
        {approval.filePath ? <span>file: {approval.filePath}</span> : null}
        {changedFileCount > 0 ? <span>{changedFileCount} 个变更文件</span> : null}
        {amendmentCount > 0 ? <span>{amendmentCount} 条 session 级授权建议</span> : null}
        {permissionCount > 0 ? <span>{permissionCount} 类权限</span> : null}
      </div>
      {approval.permissions ? (
        <div className={styles.approvalFiles}>
          <code>{JSON.stringify(approval.permissions)}</code>
        </div>
      ) : null}
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
