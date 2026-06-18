export type ClientKind = 'desktop' | 'vscode' | 'web' | 'unknown'

export type Client = {
  id: string
  kind: ClientKind
  label: string
  connected: boolean
}

export type Owner = {
  clientId: string
  kind: ClientKind
  source: 'official-ipc' | 'web-app-server' | 'unknown'
}

export type Project = {
  id: string
  name: string
  path: string | null
  source: 'official' | 'desktop-workspace' | 'web-favorite'
}

export type ThreadGitInfo = {
  sha: string | null
  branch: string | null
  originUrl: string | null
}

export type WorkspaceKind = 'project' | 'projectless' | 'unknown'

export type TokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export type ThreadTokenUsage = {
  total: TokenUsageBreakdown
  last: TokenUsageBreakdown
  modelContextWindow: number | null
}

export type Thread = {
  id: string
  title: string
  projectId: string | null
  path: string | null
  workspaceKind?: WorkspaceKind
  effectiveCwd?: string | null
  createdAtIso?: string | null
  updatedAtIso: string | null
  inProgress: boolean
  pinned: boolean
  gitInfo: ThreadGitInfo | null
  owner: Owner | null
}

export type ThreadList = {
  projects: Project[]
  threads: Thread[]
  nextCursor: string | null
  backwardsCursor: string | null
}

export type StreamState = {
  threadId: string
  inProgress: boolean
  activeTurnId: string | null
  cacheVersion: number
  updatedAtIso: string
}

export type MessageImageContent = {
  url: string | null
  path: string | null
  mimeType: string | null
  alt: string | null
}

export type FileChangeKind = {
  type: string
  [key: string]: unknown
}

export type FileChangeContent = {
  path: string
  diff: string
  kind: FileChangeKind | null
  [key: string]: unknown
}

export type PlanStep = {
  text: string
  status: string | null
}

export type AgentTask = {
  id: string
  name: string
  status: string | null
  prompt: string
  model: string | null
  reasoningEffort: string | null
}

export type MessagePhase = 'commentary' | 'final_answer'

export type OfficialThreadItemBase = {
  type: string
  id?: string
  [key: string]: unknown
}

export type UserMessageItem = {
  type: 'userMessage'
  id: string
  clientId: string | null
  content: unknown[]
  intent?: 'message' | 'guidance'
  [key: string]: unknown
}

export type AgentMessageItem = {
  type: 'agentMessage'
  id: string
  text: string
  phase: MessagePhase | null
  memoryCitation: unknown | null
  [key: string]: unknown
}

export type HookPromptItem = {
  type: 'hookPrompt'
  id: string
  fragments: unknown[]
  [key: string]: unknown
}

export type ReasoningItem = {
  type: 'reasoning'
  id: string
  summary: string[]
  content: string[]
  status?: string | null
  [key: string]: unknown
}

export type PlanItem = {
  type: 'plan'
  id: string
  text: string
  steps?: PlanStep[]
  status?: string | null
  [key: string]: unknown
}

export type CommandExecutionItem = {
  type: 'commandExecution'
  id: string
  command: string
  cwd: string | null
  processId: string | null
  source: string | null
  status: string
  commandActions: unknown[]
  aggregatedOutput: string | null
  exitCode: number | null
  durationMs: number | null
  [key: string]: unknown
}

export type FileChangeItem = {
  type: 'fileChange'
  id: string
  changes: FileChangeContent[]
  status: string | null
  path?: string
  diff?: string
  [key: string]: unknown
}

export type McpToolCallItem = {
  type: 'mcpToolCall'
  id: string
  server: string
  tool: string
  status: string
  arguments: unknown
  mcpAppResourceUri?: string
  pluginId: string | null
  result: unknown | null
  error: unknown | null
  durationMs: number | null
  [key: string]: unknown
}

export type DynamicToolCallItem = {
  type: 'dynamicToolCall'
  id: string
  namespace: string | null
  tool: string
  arguments: unknown
  status: string
  contentItems: unknown[] | null
  success: boolean | null
  durationMs: number | null
  [key: string]: unknown
}

export type CollabAgentToolCallItem = {
  type: 'collabAgentToolCall'
  id: string
  tool: string
  status: string
  senderThreadId: string
  receiverThreadIds: string[]
  prompt: string | null
  model: string | null
  reasoningEffort: string | null
  agentsStates: Record<string, unknown>
  [key: string]: unknown
}

export type WebSearchItem = {
  type: 'webSearch'
  id: string
  query: string
  action: unknown | null
  [key: string]: unknown
}

export type ImageViewItem = {
  type: 'imageView'
  id: string
  path: string
  [key: string]: unknown
}

export type ImageGenerationItem = {
  type: 'imageGeneration'
  id: string
  status: string
  revisedPrompt: string | null
  result: string
  savedPath?: string
  [key: string]: unknown
}

export type ReviewModeItem = {
  type: 'enteredReviewMode' | 'exitedReviewMode'
  id: string
  review: string
  [key: string]: unknown
}

export type ContextCompactionItem = {
  type: 'contextCompaction'
  id: string
  [key: string]: unknown
}

declare const unknownOfficialThreadItemTypeBrand: unique symbol

export type UnknownOfficialThreadItemType = string & {
  readonly [unknownOfficialThreadItemTypeBrand]: never
}

export type UnknownOfficialThreadItem = {
  type: UnknownOfficialThreadItemType
  id: string
  [key: string]: unknown
}

export type OfficialThreadItem =
  | UserMessageItem
  | HookPromptItem
  | AgentMessageItem
  | PlanItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | DynamicToolCallItem
  | CollabAgentToolCallItem
  | WebSearchItem
  | ImageViewItem
  | ImageGenerationItem
  | ReviewModeItem
  | ContextCompactionItem
  | UnknownOfficialThreadItem

/**
 * Legacy Web-only items are accepted at historical boundaries while official
 * app-server data is canonicalized into OfficialThreadItem variants above.
 */
export type LegacyMessageItem =
  | { type: 'user'; id: string; text: string; images?: MessageImageContent[]; intent?: 'message' | 'guidance' }
  | { type: 'assistant'; id: string; text: string; images?: MessageImageContent[] }
  | { type: 'reasoning'; id: string; text: string; collapsed: boolean; status: string | null }
  | {
      type: 'command'
      id: string
      command: string
      status: string
      output: string
      stdout: string
      stderr: string
      cwd: string | null
      durationMs: number | null
      exitCode: number | null
    }
  | {
      type: 'fileChange'
      id: string
      path: string
      diff: string
      status: string | null
      changes?: FileChangeContent[]
    }
  | { type: 'plan'; id: string; text: string; steps: PlanStep[]; status: string | null }
  | {
      type: 'agentTask'
      id: string
      title: string
      status: string | null
      prompt: string
      model: string | null
      reasoningEffort: string | null
      agents: AgentTask[]
      rawType: string
    }
  | {
      type: 'approval'
      id: string
      kind: 'command' | 'fileChange' | 'unknown'
      title: string
      body: string
      status: string | null
      command: string | null
      cwd: string | null
      reason: string | null
    }
  | { type: 'image'; id: string; image: MessageImageContent }
  | { type: 'error'; id: string; message: string; code: string | null; detail: string | null }
  | { type: 'toolOutput'; id: string; title: string; text: string; status: string | null; rawType: string }
  | { type: 'unknown'; id: string; rawType: string; raw: unknown }

export type MessageItem = OfficialThreadItem | LegacyMessageItem

export type Turn = {
  id: string
  status: 'idle' | 'active' | 'completed' | 'failed' | 'interrupted' | 'unknown'
  startedAtIso?: string | null
  completedAtIso?: string | null
  items: MessageItem[]
}

export type ThreadSubAgent = {
  id: string
  name: string
  role: string | null
  status: string | null
  model?: string | null
  reasoningEffort?: string | null
  parentThreadId?: string | null
  source: 'official-ipc' | 'app-server'
}

export type ThreadSideConversation = {
  id: string
  title: string
  createdAtIso: string | null
  updatedAtIso: string | null
  inProgress: boolean
  hasUnread: boolean
  turnCount: number
  turns: Turn[]
}

export type ThreadGoalStatus = 'active' | 'paused' | 'completed' | 'unknown'

export type ThreadGoal = {
  threadId: string | null
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number | null
  timeUsedSeconds: number | null
  createdAtIso: string | null
  updatedAtIso: string | null
}

export type ThreadDetail = {
  thread: Thread
  goal: ThreadGoal | null
  tokenUsage?: ThreadTokenUsage | null
  derivedFromThreadId?: string | null
  turns: Turn[]
  subAgents: ThreadSubAgent[]
  sideConversations: ThreadSideConversation[]
}

export type Attachment = {
  id: string
  filename: string
  mimeType: string
  size: number
  path: string
  sha256: string
  createdAtIso: string
  threadId: string | null
  turnId: string | null
  officialReferenceId: string | null
}

export type FileBrowserEntry = {
  name: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  path: string
  relativePath: string
  size: number | null
  mtimeIso: string | null
  extension: string | null
}

export type FileBrowserListing = {
  root: string
  path: string
  relativePath: string
  parentRelativePath: string | null
  entries: FileBrowserEntry[]
  limited: boolean
}

export type Approval = {
  id: string
  threadId: string
  title: string
  body: string
  status: 'pending' | 'approved' | 'rejected'
}

export type DiagnosticEvent = {
  id: string
  atIso: string
  level: 'info' | 'warn' | 'error'
  source: string
  message: string
  data?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRawString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readThreadGitInfo(value: unknown): ThreadGitInfo | null {
  const record = asRecord(value)
  if (!record) return null
  return {
    sha: readString(record.sha) || null,
    branch: readString(record.branch) || null,
    originUrl: readString(record.originUrl) || null,
  }
}

function readContentString(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (value.trim() === '<image>') return ''
  return value.trim().length > 0 ? value : ''
}

function readStatusString(value: unknown): string {
  const direct = readString(value)
  if (direct) return direct
  const record = asRecord(value)
  if (!record) return ''
  return (
    readStatusString(record.type) ||
    readStatusString(record.status) ||
    readStatusString(record.state) ||
    readStatusString(record.kind)
  )
}

function compactStatus(value: unknown): string {
  return readStatusString(value).toLowerCase().replace(/[-_\s]/g, '')
}

function isActiveStatus(value: unknown): boolean {
  return [
    'active',
    'editing',
    'inprogress',
    'running',
    'streaming',
    'thinking',
    'writing',
  ].includes(compactStatus(value))
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readTokenCount(value: unknown): number {
  return Math.max(0, Math.trunc(readNumber(value) ?? 0))
}

function normalizeTokenUsageBreakdown(value: unknown): TokenUsageBreakdown {
  const record = asRecord(value) ?? {}
  return {
    totalTokens: readTokenCount(record.totalTokens ?? record.total_tokens),
    inputTokens: readTokenCount(record.inputTokens ?? record.input_tokens),
    cachedInputTokens: readTokenCount(record.cachedInputTokens ?? record.cached_input_tokens),
    outputTokens: readTokenCount(record.outputTokens ?? record.output_tokens),
    reasoningOutputTokens: readTokenCount(record.reasoningOutputTokens ?? record.reasoning_output_tokens),
  }
}

export function normalizeThreadTokenUsage(value: unknown): ThreadTokenUsage | null {
  const record = asRecord(value)
  if (!record) return null
  const total = normalizeTokenUsageBreakdown(record.total)
  const last = normalizeTokenUsageBreakdown(record.last)
  const hasTotal =
    total.totalTokens > 0 ||
    total.inputTokens > 0 ||
    total.cachedInputTokens > 0 ||
    total.outputTokens > 0 ||
    total.reasoningOutputTokens > 0
  const hasLast =
    last.totalTokens > 0 ||
    last.inputTokens > 0 ||
    last.cachedInputTokens > 0 ||
    last.outputTokens > 0 ||
    last.reasoningOutputTokens > 0
  const modelContextWindow = readNumber(record.modelContextWindow ?? record.model_context_window)
  if (!hasTotal && !hasLast && modelContextWindow == null) return null
  return {
    total,
    last,
    modelContextWindow,
  }
}

function readThreadTokenUsage(record: Record<string, unknown>): ThreadTokenUsage | null {
  const runtimeStatus = asRecord(record.threadRuntimeStatus)
  const conversationState = asRecord(record.conversationState)
  return (
    normalizeThreadTokenUsage(record.tokenUsage) ??
    normalizeThreadTokenUsage(record.latestTokenUsage) ??
    normalizeThreadTokenUsage(record.latestTokenUsageInfo) ??
    normalizeThreadTokenUsage(runtimeStatus?.tokenUsage) ??
    normalizeThreadTokenUsage(runtimeStatus?.latestTokenUsage) ??
    normalizeThreadTokenUsage(conversationState?.tokenUsage) ??
    normalizeThreadTokenUsage(conversationState?.latestTokenUsageInfo)
  )
}

function readWorkspaceKind(record: Record<string, unknown>): WorkspaceKind | undefined {
  const direct = readString(record.workspaceKind) || readString(record.workspace_kind)
  if (direct === 'project' || direct === 'projectless') return direct
  if (direct) return 'unknown'
  const source = asRecord(record.source)
  const sourceKind = readString(source?.workspaceKind) || readString(source?.workspace_kind)
  if (sourceKind === 'project' || sourceKind === 'projectless') return sourceKind
  if (sourceKind) return 'unknown'
  return undefined
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function readIsoFromTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000
    return new Date(milliseconds).toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

function readBooleanInProgress(value: unknown): boolean {
  return value === true || isActiveStatus(value)
}

function readTurnStatus(value: unknown): Turn['status'] {
  const status = compactStatus(value)
  if (isActiveStatus(value)) return 'active'
  if (['completed', 'complete', 'done', 'success', 'succeeded'].includes(status)) return 'completed'
  if (['failed', 'failure', 'error'].includes(status)) return 'failed'
  if (['interrupted', 'interrupt', 'canceled', 'cancelled'].includes(status)) return 'interrupted'
  if (['idle', 'notloaded'].includes(status)) return 'idle'
  return 'unknown'
}

function readThreadGoalStatus(value: unknown): ThreadGoalStatus {
  const status = compactStatus(value)
  if (isActiveStatus(value) || ['resumed', 'resume'].includes(status)) return 'active'
  if (['paused', 'pause', 'suspended', 'suspend'].includes(status)) return 'paused'
  if (['completed', 'complete', 'done', 'success', 'succeeded'].includes(status)) return 'completed'
  return 'unknown'
}

export function normalizeThreadGoal(value: unknown): ThreadGoal | null {
  const directObjective = readString(value)
  if (directObjective) {
    return {
      threadId: null,
      objective: directObjective,
      status: 'active',
      tokenBudget: null,
      tokensUsed: null,
      timeUsedSeconds: null,
      createdAtIso: null,
      updatedAtIso: null,
    }
  }

  const record = asRecord(value)
  if (!record) return null
  const nestedGoal = normalizeThreadGoal(record.goal)
  const objective =
    readString(record.objective) ||
    readString(record.prompt) ||
    readString(record.text) ||
    readString(record.title)
  if (!objective) return nestedGoal

  return {
    threadId:
      readString(record.threadId) ||
      readString(record.conversationId) ||
      readString(record.sessionId) ||
      null,
    objective,
    status: readThreadGoalStatus(record.status ?? record.state),
    tokenBudget: readNumber(record.tokenBudget ?? record.token_budget),
    tokensUsed: readNumber(record.tokensUsed ?? record.tokens_used),
    timeUsedSeconds: readNumber(
      record.timeUsedSeconds ?? record.time_used_seconds,
    ),
    createdAtIso: readIsoFromTimestamp(record.createdAt ?? record.created_at),
    updatedAtIso: readIsoFromTimestamp(record.updatedAt ?? record.updated_at),
  }
}

function readThreadGoal(record: Record<string, unknown>): ThreadGoal | null {
  const runtimeStatus = asRecord(record.threadRuntimeStatus)
  const conversationState = asRecord(record.conversationState)
  return (
    normalizeThreadGoal(record.goal) ||
    normalizeThreadGoal(record.threadGoal) ||
    normalizeThreadGoal(record.activeGoal) ||
    normalizeThreadGoal(record.currentGoal) ||
    normalizeThreadGoal(runtimeStatus?.goal) ||
    normalizeThreadGoal(runtimeStatus?.threadGoal) ||
    normalizeThreadGoal(conversationState?.goal) ||
    normalizeThreadGoal(conversationState?.threadGoal)
  )
}

function readDerivedFromThreadId(record: Record<string, unknown>): string | null {
  return (
    readString(record.forkedFromId) ||
    readString(record.forked_from_id) ||
    readString(record.sourceThreadId) ||
    readString(record.source_thread_id) ||
    readString(record.sourceConversationId) ||
    readString(record.source_conversation_id) ||
    null
  )
}

function readTurnStartedAtIso(record: Record<string, unknown> | null): string | null {
  if (!record) return null
  return (
    readIsoFromTimestamp(record.startedAt) ||
    readIsoFromTimestamp(record.started_at) ||
    readIsoFromTimestamp(record.startedAtMs) ||
    readIsoFromTimestamp(record.createdAt) ||
    readIsoFromTimestamp(record.created_at) ||
    null
  )
}

function readTurnCompletedAtIso(record: Record<string, unknown> | null): string | null {
  if (!record) return null
  return (
    readIsoFromTimestamp(record.completedAt) ||
    readIsoFromTimestamp(record.completed_at) ||
    readIsoFromTimestamp(record.completedAtMs) ||
    readIsoFromTimestamp(record.finishedAt) ||
    readIsoFromTimestamp(record.finished_at) ||
    readIsoFromTimestamp(record.updatedAt) ||
    readIsoFromTimestamp(record.updated_at) ||
    null
  )
}

function readTextContent(value: unknown): string {
  if (typeof value === 'string') return readContentString(value)
  const record = asRecord(value)
  if (record) {
    const direct =
      readContentString(record.text) ||
      readContentString(record.content) ||
      readContentString(record.message) ||
      readContentString(record.value)
    if (direct) return direct
    const nested = readTextContent(record.content ?? record.message ?? record.delta)
    if (nested) return nested
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return readContentString(entry)
        const entryRecord = asRecord(entry)
        const text =
          readContentString(entryRecord?.text) ||
          readContentString(entryRecord?.content) ||
          readContentString(entryRecord?.value) ||
          readTextContent(entryRecord?.content)
        return text
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

function readImagesContent(value: unknown): MessageImageContent[] {
  const values = Array.isArray(value) ? value : [value]
  return values.map(readImageContent).filter((entry): entry is MessageImageContent => Boolean(entry))
}

function compactImages(images: MessageImageContent[]): MessageImageContent[] {
  const seen = new Set<string>()
  return images.filter((image) => {
    if (!image.url && !image.path) return false
    const key = `${image.url ?? ''}|${image.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readImageContent(value: unknown): MessageImageContent | null {
  const record = asRecord(value)
  if (!record) return null
  const imageUrlRecord = asRecord(record.image_url)
  const sourceRecord = asRecord(record.source)
  const type = readString(record.type).toLowerCase()
  const url =
    readString(record.url) ||
    readString(record.src) ||
    readString(record.imageUrl) ||
    readString(record.image_url) ||
    readString(imageUrlRecord?.url) ||
    readString(sourceRecord?.url) ||
    readString(sourceRecord?.src) ||
    null
  const path =
    readString(record.path) ||
    readString(record.filePath) ||
    readString(record.file_path) ||
    readString(sourceRecord?.path) ||
    null
  const mimeType =
    readString(record.mimeType) ||
    readString(record.mime_type) ||
    readString(record.mediaType) ||
    readString(record.media_type) ||
    null
  const alt = readString(record.alt) || readString(record.filename) || null
  if (!url && !path && !type.includes('image')) return null
  return { url, path, mimeType, alt }
}

function readUserImages(record: Record<string, unknown> | null): MessageImageContent[] {
  const restoreMessage = asRecord(record?.restoreMessage)
  const restoreContext = asRecord(restoreMessage?.context)
  return compactImages([
    ...readImagesContent(record?.content),
    ...readImagesContent(record?.input),
    ...readImagesContent(record?.attachments),
    ...readImagesContent(record?.imageAttachments),
    ...readImagesContent(restoreMessage?.imageAttachments),
    ...readImagesContent(restoreContext?.imageAttachments),
  ])
}

function normalizePlanSteps(value: unknown): PlanStep[] {
  return readArray(value)
    .map((entry) => {
      const record = asRecord(entry)
      const text = readTextContent(record?.step ?? record?.text ?? record?.title ?? record?.content ?? entry)
      if (!text) return null
      return {
        text,
        status: readStatusString(record?.status) || readStatusString(record?.state) || null,
      }
    })
    .filter((entry): entry is PlanStep => Boolean(entry))
}

function readCommandAggregatedOutput(record: Record<string, unknown>): string | null {
  if (typeof record.aggregatedOutput === 'string') return record.aggregatedOutput
  if (record.aggregatedOutput === null) return null
  if (typeof record.output === 'string') return record.output
  if (typeof record.aggregated_output === 'string') return record.aggregated_output
  if (typeof record.text === 'string') return record.text

  const streams = [record.stdout, record.stderr, record.stdoutText, record.stderrText]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  return streams.length ? streams.join('\n') : null
}

function canonicalCommandExecutionFields(record: Record<string, unknown>): Record<string, unknown> {
  const {
    aggregated_output,
    cmd,
    commandLine,
    elapsed_ms,
    elapsedMs,
    exit_code,
    output,
    stderr,
    stderrText,
    stdout,
    stdoutText,
    text,
    working_directory,
    workingDirectory,
    ...fields
  } = record
  return fields
}

function readFileChangeKind(value: unknown): FileChangeKind | null {
  const record = asRecord(value)
  if (record) {
    const type = readString(record.type)
    return type ? { ...record, type } : null
  }
  const type = readString(value)
  if (!type) return null
  if (type === 'create') return { type: 'add' }
  if (type === 'update') return { type: 'update', move_path: null }
  return { type }
}

function normalizeFileChanges(record: Record<string, unknown> | null): FileChangeContent[] {
  const changes = readArray(record?.changes)
    .map((entry) => {
      const entryRecord = asRecord(entry)
      const entryFields = { ...(entryRecord ?? {}) }
      delete entryFields.status
      const path =
        readRawString(entryRecord?.path) ||
        readRawString(entryRecord?.filePath) ||
        readRawString(entryRecord?.file_path)
      const diff = readRawString(entryRecord?.diff) || readRawString(entryRecord?.patch)
      if (!path && !diff) return null
      return {
        ...entryFields,
        path,
        diff,
        kind: readFileChangeKind(entryRecord?.kind),
      }
    })
    .filter((entry): entry is FileChangeContent => Boolean(entry))

  if (changes.length) return changes

  const path =
    readRawString(record?.path) ||
    readRawString(record?.filePath) ||
    readRawString(record?.file_path)
  const diff = readRawString(record?.diff) || readRawString(record?.patch)
  if (!path && !diff) return []
  return [
    {
      path,
      diff,
      kind: null,
    },
  ]
}

function readAgentTaskPrompt(record: Record<string, unknown> | null): string {
  return (
    readString(record?.prompt) ||
    readTextContent(record?.prompt ?? record?.input ?? record?.content ?? record?.message ?? record?.text)
  )
}

function hasAgentTaskPayload(record: Record<string, unknown> | null): boolean {
  if (!record) return false
  return Boolean(
    readAgentTaskPrompt(record) ||
      asRecord(record.agentsStates) ||
      readArray(record.receiverThreadIds).length ||
      readArray(record.receiverThreads).length,
  )
}

function isAgentTaskToolCall(
  record: Record<string, unknown> | null,
  normalizedType: string,
  compactType: string,
): boolean {
  if (!record) return false
  const tool = readString(record.tool).toLowerCase()
  const looksLikeAgentToolCall =
    compactType === 'collabagenttoolcall' ||
    compactType === 'spawnagent' ||
    tool === 'spawnagent' ||
    (normalizedType.includes('collabagent') && normalizedType.includes('tool')) ||
    (compactType.includes('agent') && compactType.includes('toolcall'))
  return looksLikeAgentToolCall && hasAgentTaskPayload(record)
}

function normalizeAgentTaskAgents(
  record: Record<string, unknown>,
  fallbackId: string,
  fallbackPrompt: string,
  fallbackStatus: string | null,
  fallbackModel: string | null,
  fallbackReasoningEffort: string | null,
): AgentTask[] {
  const agents: AgentTask[] = []
  const seen = new Set<string>()
  const agentsStates = asRecord(record.agentsStates)
  const receiverThreads = readArray(record.receiverThreads)
  const receiverById = new Map<string, unknown>()
  for (const receiver of receiverThreads) {
    const id = readReceiverThreadId(receiver)
    if (id) receiverById.set(id, receiver)
  }

  const pushAgent = (id: string, receiver: unknown, stateValue: unknown, index: number): void => {
    const key = id || `${fallbackId}-agent-${index}`
    if (seen.has(key)) return
    seen.add(key)
    const state = asRecord(stateValue)
    const prompt = readAgentTaskPrompt(state) || fallbackPrompt
    agents.push({
      id: key,
      name:
        readString(state?.name) ||
        readString(state?.agentNickname) ||
        readReceiverThreadName(receiver) ||
        `Agent ${shortAgentId(key)}`,
      status:
        readStatusString(state?.status) ||
        readStatusString(state?.state) ||
        fallbackStatus,
      prompt,
      model: readString(state?.model) || fallbackModel,
      reasoningEffort:
        readString(state?.reasoningEffort) ||
        readString(state?.reasoning_effort) ||
        fallbackReasoningEffort,
    })
  }

  if (agentsStates) {
    for (const [id, stateValue] of Object.entries(agentsStates)) {
      pushAgent(id, receiverById.get(id), stateValue, agents.length)
    }
  }

  for (const receiverIdValue of readArray(record.receiverThreadIds)) {
    const id = readString(receiverIdValue)
    if (!id) continue
    pushAgent(id, receiverById.get(id), null, agents.length)
  }

  for (const receiver of receiverThreads) {
    const id = readReceiverThreadId(receiver)
    if (!id) continue
    pushAgent(id, receiver, null, agents.length)
  }

  if (agents.length === 0 && fallbackPrompt) {
    pushAgent(`${fallbackId}-agent`, null, null, 0)
  }

  return agents
}

function normalizeAgentTaskMessageItem(
  record: Record<string, unknown>,
  id: string,
  rawType: string,
): MessageItem {
  const prompt = readAgentTaskPrompt(record)
  const status = readStatusString(record.status) || readStatusString(record.state) || null
  const model = readString(record.model) || null
  const reasoningEffort = readString(record.reasoningEffort) || readString(record.reasoning_effort) || null
  return {
    type: 'agentTask',
    id,
    title: readString(record.title) || readString(record.name) || readString(record.tool) || 'spawnAgent',
    status,
    prompt,
    model,
    reasoningEffort,
    agents: normalizeAgentTaskAgents(record, id, prompt, status, model, reasoningEffort),
    rawType: rawType || 'collabAgentToolCall',
  }
}

function normalizeAgentTaskTextMessageItem(
  text: string,
  id: string,
  rawType: string,
): MessageItem | null {
  const normalized = text.trim()
  const header = /^(正在生成|已生成)\s*\d+\s*[个個]智能[体體](?:\s|$)/u.exec(normalized)
  if (!header) return null
  if (!/(?:输入|輸入|任务|任務|工作目标|工作目標)\s*[:：]/u.test(normalized)) return null

  const status = header[1] === '正在生成' ? 'active' : 'completed'
  const prompt = normalized
    .slice(header[0].length)
    .replace(/^\s*(?:正在生成|已生成)\s*/u, '')
    .trim()
  const agentPrompt = prompt || normalized
  return {
    type: 'agentTask',
    id,
    title: 'spawnAgent',
    status,
    prompt: agentPrompt,
    model: null,
    reasoningEffort: null,
    agents: [
      {
        id: `${id}-agent`,
        name: 'Agent',
        status,
        prompt: agentPrompt,
        model: null,
        reasoningEffort: null,
      },
    ],
    rawType: rawType || 'assistantAgentTaskText',
  }
}

const OFFICIAL_THREAD_ITEM_TYPES = new Set([
  'userMessage',
  'hookPrompt',
  'agentMessage',
  'plan',
  'reasoning',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'webSearch',
  'imageView',
  'imageGeneration',
  'enteredReviewMode',
  'exitedReviewMode',
  'contextCompaction',
])

function readMessagePhase(value: unknown): MessagePhase | null {
  return value === 'commentary' || value === 'final_answer' ? value : null
}

function isOfficialThreadItemType(type: string): boolean {
  return OFFICIAL_THREAD_ITEM_TYPES.has(type)
}

function normalizeOfficialThreadItem(
  record: Record<string, unknown>,
  type: string,
  id: string,
): MessageItem {
  if (type === 'userMessage') {
    const text = readTextContent(record.content) || readString(record.text)
    return {
      ...record,
      type,
      id,
      clientId: readString(record.clientId) || null,
      content: Array.isArray(record.content) ? record.content : legacyContentFromText(text),
    }
  }
  if (type === 'agentMessage') {
    return {
      ...record,
      type,
      id,
      text: readTextContent(record.text) || readTextContent(record.content),
      phase: readMessagePhase(record.phase),
      memoryCitation: record.memoryCitation ?? null,
    }
  }
  if (type === 'hookPrompt') {
    return {
      ...record,
      type,
      id,
      fragments: readArray(record.fragments),
    }
  }
  if (type === 'plan') {
    const steps = normalizePlanSteps(record.steps ?? record.items ?? record.plan)
    return {
      ...record,
      type,
      id,
      text: readTextContent(record.text ?? record.content ?? record.explanation ?? record.plan),
      ...(steps.length ? { steps } : {}),
      status: readStatusString(record.status) || null,
    }
  }
  if (type === 'reasoning') {
    const summary = readArray(record.summary).map(readTextContent).filter(Boolean)
    const content = readArray(record.content).map(readTextContent).filter(Boolean)
    const text = readTextContent(record.text)
    return {
      ...record,
      type,
      id,
      summary,
      content: content.length ? content : text ? [text] : [],
      status: readStatusString(record.status ?? record.state) || null,
    }
  }
  if (type === 'commandExecution') {
    const commandFields = canonicalCommandExecutionFields(record)
    return {
      ...commandFields,
      type,
      id,
      command: readString(record.command) || readString(record.cmd) || readString(record.commandLine),
      cwd: readString(record.cwd) || readString(record.workingDirectory) || readString(record.working_directory) || null,
      processId: readString(record.processId) || null,
      source: readString(record.source) || null,
      status: readStatusString(record.status) || 'unknown',
      commandActions: readArray(record.commandActions),
      aggregatedOutput: readCommandAggregatedOutput(record),
      durationMs:
        readNumber(record.durationMs) ??
        readNumber(record.duration_ms) ??
        readNumber(record.elapsedMs) ??
        readNumber(record.elapsed_ms),
      exitCode: readNumber(record.exitCode) ?? readNumber(record.exit_code),
    }
  }
  if (type === 'fileChange') {
    const changes = normalizeFileChanges(record)
    return {
      ...record,
      type,
      id,
      changes,
      status: readStatusString(record.status) || null,
    }
  }
  if (type === 'mcpToolCall') {
    return {
      ...record,
      type,
      id,
      server: readString(record.server),
      tool: readString(record.tool),
      status: readStatusString(record.status) || 'unknown',
      arguments: record.arguments ?? null,
      pluginId: readString(record.pluginId) || null,
      result: record.result ?? null,
      error: record.error ?? null,
      durationMs: readNumber(record.durationMs) ?? readNumber(record.duration_ms),
    }
  }
  if (type === 'dynamicToolCall') {
    return {
      ...record,
      type,
      id,
      namespace: readString(record.namespace) || null,
      tool: readString(record.tool),
      arguments: record.arguments ?? null,
      status: readStatusString(record.status) || 'unknown',
      contentItems: Array.isArray(record.contentItems) ? record.contentItems : null,
      success: typeof record.success === 'boolean' ? record.success : null,
      durationMs: readNumber(record.durationMs) ?? readNumber(record.duration_ms),
    }
  }
  if (type === 'collabAgentToolCall') {
    return {
      ...record,
      type,
      id,
      tool: readString(record.tool),
      status: readStatusString(record.status) || 'unknown',
      senderThreadId: readString(record.senderThreadId),
      receiverThreadIds: readArray(record.receiverThreadIds).map(readString).filter(Boolean),
      prompt: readString(record.prompt) || readTextContent(record.prompt) || null,
      model: readString(record.model) || null,
      reasoningEffort: readString(record.reasoningEffort) || readString(record.reasoning_effort) || null,
      agentsStates: asRecord(record.agentsStates) ?? {},
    }
  }
  if (type === 'webSearch') {
    const action = asRecord(record.action)
    const query =
      readString(record.query) ||
      readString(record.searchQuery) ||
      readString(record.search_query) ||
      readString(action?.query) ||
      readString(action?.url)
    return {
      ...record,
      type,
      id,
      query,
      action: record.action ?? null,
    }
  }
  if (type === 'imageView') {
    return {
      ...record,
      type,
      id,
      path: readString(record.path),
    }
  }
  if (type === 'imageGeneration') {
    return {
      ...record,
      type,
      id,
      status: readStatusString(record.status) || 'unknown',
      revisedPrompt: readString(record.revisedPrompt) || null,
      result: readString(record.result),
    }
  }
  if (type === 'enteredReviewMode' || type === 'exitedReviewMode') {
    return {
      ...record,
      type,
      id,
      review: readString(record.review),
    }
  }
  if (type === 'contextCompaction') {
    return { ...record, type, id }
  }
  return { type: 'unknown', id, rawType: type || 'unknown', raw: record }
}

function normalizeUnknownOfficialThreadItem(
  record: Record<string, unknown>,
  type: string,
  id: string,
): UnknownOfficialThreadItem {
  return {
    ...record,
    type: type as UnknownOfficialThreadItemType,
    id,
  }
}

function legacyContentFromText(text: string): unknown[] {
  return text ? [{ type: 'text', text, text_elements: [] }] : []
}

export function normalizeMessageItem(value: unknown, index = 0): MessageItem {
  const record = asRecord(value)
  const type = readString(record?.type)
  const normalizedType = type.toLowerCase()
  const compactType = normalizedType.replace(/[-_]/g, '')
  const id = readString(record?.id) || `${type || 'item'}-${index}`

  if (record && isOfficialThreadItemType(type)) {
    return normalizeOfficialThreadItem(record, type, id)
  }

  if (normalizedType === 'unknown') {
    const rawRecord = asRecord(record?.raw)
    const rawType = readString(record?.rawType) || readString(rawRecord?.type)
    const compactRawType = rawType.toLowerCase().replace(/[-_]/g, '')
    if (rawRecord && isOfficialThreadItemType(rawType)) {
      const normalizedRaw = normalizeMessageItem(rawRecord, index)
      return { ...normalizedRaw, id }
    }
    if (rawRecord && compactRawType === 'steeringusermessage') {
      const normalizedRaw = normalizeMessageItem(rawRecord, index)
      return { ...normalizedRaw, id }
    }
  }

  if (type === 'userMessage' || normalizedType === 'user') {
    const text = readTextContent(record?.content) || readString(record?.text)
    return {
      ...record,
      type: 'userMessage',
      id,
      clientId: readString(record?.clientId) || null,
      content: Array.isArray(record?.content) ? record.content : legacyContentFromText(text),
    }
  }
  if (compactType === 'steeringusermessage') {
    const restoreMessage = asRecord(record?.restoreMessage)
    const text =
      readString(restoreMessage?.text) ||
      readTextContent(record?.input) ||
      readTextContent(record?.content) ||
      readString(record?.text)
    return {
      ...record,
      type: 'userMessage',
      id,
      clientId: null,
      content: legacyContentFromText(text),
      intent: 'guidance',
    }
  }
  if (type === 'agentMessage' || type === 'assistantMessage' || normalizedType === 'assistant') {
    const text = readTextContent(record?.text) || readTextContent(record?.content)
    return {
      ...record,
      type: 'agentMessage',
      id,
      text,
      phase: readMessagePhase(record?.phase),
      memoryCitation: record?.memoryCitation ?? null,
    }
  }
  if (type === 'command' || type === 'commandExecution') {
    return normalizeOfficialThreadItem(record ?? {}, 'commandExecution', id)
  }
  if (normalizedType.includes('plan') || normalizedType === 'todo-list' || normalizedType === 'todo_list' || normalizedType === 'todolist') {
    return normalizeOfficialThreadItem(record ?? {}, 'plan', id)
  }
  if (normalizedType.includes('approval') || normalizedType.includes('permission')) {
    const kind = normalizedType.includes('file') ? 'fileChange' : normalizedType.includes('command') ? 'command' : 'unknown'
    return {
      type: 'approval',
      id,
      kind,
      title: readString(record?.title) || 'Approval required',
      body: readTextContent(record?.body ?? record?.message ?? record?.content),
      status: readStatusString(record?.status) || null,
      command: readString(record?.command) || null,
      cwd: readString(record?.cwd) || null,
      reason: readString(record?.reason) || null,
    }
  }
  const image = readImageContent(value)
  if (image) {
    return { type: 'image', id, image }
  }
  const errorRecord = asRecord(record?.error)
  if (normalizedType.includes('error') || errorRecord) {
    return {
      type: 'error',
      id,
      message:
        readString(record?.message) ||
        readString(errorRecord?.message) ||
        readTextContent(record?.content) ||
        'Unknown error',
      code: readString(record?.code) || readString(errorRecord?.code) || null,
      detail: readString(record?.detail) || readString(errorRecord?.detail) || null,
    }
  }
  if (normalizedType === 'websearch' || normalizedType === 'web_search' || normalizedType.includes('websearch')) {
    return normalizeOfficialThreadItem(record ?? {}, 'webSearch', id)
  }
  if (normalizedType.includes('mcp') || normalizedType.includes('function')) {
    return {
      ...record,
      type: 'mcpToolCall',
      id,
      server: readString(record?.server) || readString(record?.name),
      tool: readString(record?.tool) || readString(record?.title) || type || 'tool',
      status: readStatusString(record?.status) || 'unknown',
      arguments: record?.arguments ?? null,
      pluginId: readString(record?.pluginId) || null,
      result: record?.result ?? record?.output ?? record?.content ?? null,
      error: record?.error ?? null,
      durationMs: readNumber(record?.durationMs) ?? readNumber(record?.duration_ms),
    }
  }
  if (record && type && normalizedType !== 'unknown') {
    return normalizeUnknownOfficialThreadItem(record, type, id)
  }
  return { type: 'unknown', id, rawType: type || 'unknown', raw: value }
}

function isPendingTurnId(turnId: string): boolean {
  return turnId.startsWith('pending-')
}

function normalizedUserText(item: MessageItem): string {
  if (item.type === 'userMessage') {
    return readTextContent(asRecord(item)?.content).replace(/\s+/g, ' ').trim()
  }
  if (item.type === 'user') {
    const record = asRecord(item)
    return readTextContent(record?.text).replace(/\s+/g, ' ').trim()
  }
  return ''
}

function duplicateUserItemIndex(items: MessageItem[], item: MessageItem): number {
  if (item.type !== 'userMessage' && item.type !== 'user') return -1
  const text = normalizedUserText(item)
  return items.findIndex((entry) => {
    if (entry.type !== 'userMessage' && entry.type !== 'user') return false
    if (entry.id === item.id) return true
    return text.length > 0 && normalizedUserText(entry) === text
  })
}

function mergeTurnItems(pendingItems: MessageItem[], targetItems: MessageItem[]): MessageItem[] {
  const merged = [...pendingItems]
  for (const item of targetItems) {
    const duplicateIndex = duplicateUserItemIndex(merged, item)
    if (duplicateIndex >= 0) {
      merged[duplicateIndex] = item
    } else {
      merged.push(item)
    }
  }
  return merged
}

function mergePendingTurnShadows(turns: Turn[]): Turn[] {
  const result: Turn[] = []
  let pendingTurns: Turn[] = []
  for (const turn of turns) {
    if (isPendingTurnId(turn.id)) {
      pendingTurns.push(turn)
      continue
    }
    if (pendingTurns.length === 0) {
      result.push(turn)
      continue
    }
    const pendingItems = pendingTurns.flatMap((pendingTurn) => pendingTurn.items)
    result.push({
      ...turn,
      items: mergeTurnItems(pendingItems, turn.items),
    })
    pendingTurns = []
  }
  return [...result, ...pendingTurns]
}

function readSubAgentArrays(record: Record<string, unknown>): unknown[] {
  const runtimeStatus = asRecord(record.threadRuntimeStatus)
  const conversationState = asRecord(record.conversationState)
  return [
    record.subAgents,
    record.subagents,
    record.childAgents,
    record.workerAgents,
    record.agents,
    runtimeStatus?.subAgents,
    runtimeStatus?.subagents,
    runtimeStatus?.childAgents,
    runtimeStatus?.workerAgents,
    runtimeStatus?.agents,
    conversationState?.subAgents,
    conversationState?.subagents,
    conversationState?.childAgents,
    conversationState?.workerAgents,
    conversationState?.agents,
  ].flatMap(readArray)
}

function shortAgentId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

function normalizeSubAgentEntry(
  value: unknown,
  index: number,
  source: ThreadSubAgent['source'],
): ThreadSubAgent | null {
  const record = asRecord(value)
  if (!record) return null
  const id =
    readString(record.id) ||
    readString(record.agentId) ||
    readString(record.agent_id) ||
    readString(record.clientId) ||
    readString(record.client_id) ||
    readString(record.sessionId) ||
    readString(record.threadId) ||
    readString(record.conversationId)
  const name =
    readString(record.name) ||
    readString(record.nickname) ||
    readString(record.agentNickname) ||
    readString(record.displayName) ||
    readString(record.label) ||
    readString(record.title) ||
    (id ? `Agent ${shortAgentId(id)}` : '')
  if (!name) return null
  const role =
    readString(record.role) ||
    readString(record.agentRole) ||
    readString(record.kind) ||
    readString(record.type) ||
    null
  const status =
    readStatusString(record.status) ||
    readStatusString(record.state) ||
    readStatusString(record.phase) ||
    null
  const parentThreadId = readString(record.parentThreadId) || readString(record.parent_thread_id) || null
  const model = readString(record.model) || null
  const reasoningEffort = readString(record.reasoningEffort) || readString(record.reasoning_effort) || null
  return {
    id: id || `${source}-subagent-${index}`,
    name,
    role,
    status,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(parentThreadId ? { parentThreadId } : {}),
    source,
  }
}

function readReceiverThreadName(value: unknown): string {
  const receiver = asRecord(value)
  const thread = asRecord(receiver?.thread)
  return (
    readString(receiver?.name) ||
    readString(receiver?.nickname) ||
    readString(receiver?.agentNickname) ||
    readString(receiver?.title) ||
    readString(thread?.name) ||
    readString(thread?.title) ||
    readString(thread?.agentNickname)
  )
}

function readReceiverThreadRole(value: unknown): string {
  const receiver = asRecord(value)
  const thread = asRecord(receiver?.thread)
  return (
    readString(receiver?.role) ||
    readString(receiver?.agentRole) ||
    readString(receiver?.kind) ||
    readString(thread?.agentRole) ||
    readString(thread?.role)
  )
}

function readReceiverThreadId(value: unknown): string {
  const receiver = asRecord(value)
  const thread = asRecord(receiver?.thread)
  return (
    readString(receiver?.threadId) ||
    readString(receiver?.id) ||
    readString(receiver?.agentId) ||
    readString(thread?.id) ||
    readString(thread?.threadId) ||
    readString(thread?.sessionId)
  )
}

function readCollabAgentEntries(record: Record<string, unknown>): unknown[] {
  const entries: Record<string, unknown>[] = []
  const turns = readArray(record.turns)
  for (const turnValue of turns) {
    const turn = asRecord(turnValue)
    for (const itemValue of readArray(turn?.items)) {
      const item = asRecord(itemValue)
      if (!item) continue
      const agentsStates = asRecord(item.agentsStates)
      const receiverThreads = readArray(item.receiverThreads)
      const receiverById = new Map<string, unknown>()
      const tool = readString(item.tool)
      const itemStatus = tool === 'closeAgent'
        ? 'shutdown'
        : readStatusString(item.status) || null
      for (const receiver of receiverThreads) {
        const id = readReceiverThreadId(receiver)
        if (id) receiverById.set(id, receiver)
      }

      if (agentsStates) {
        for (const [id, stateValue] of Object.entries(agentsStates)) {
          const state = asRecord(stateValue)
          const receiver = receiverById.get(id)
          entries.push({
            id,
            name: readReceiverThreadName(receiver) || `Agent ${shortAgentId(id)}`,
            role: readReceiverThreadRole(receiver) || readString(item.tool) || null,
            status: tool === 'closeAgent' ? 'shutdown' : readStatusString(state?.status) || itemStatus,
            model: readString(item.model) || null,
            reasoningEffort: readString(item.reasoningEffort) || readString(item.reasoning_effort) || null,
            parentThreadId: readString(item.senderThreadId) || null,
          })
        }
      }

      for (const receiverIdValue of readArray(item.receiverThreadIds)) {
        const id = readString(receiverIdValue)
        if (!id || agentsStates?.[id]) continue
        const receiver = receiverById.get(id)
        entries.push({
          id,
          name: readReceiverThreadName(receiver) || `Agent ${shortAgentId(id)}`,
          role: readReceiverThreadRole(receiver) || readString(item.tool) || null,
          status: itemStatus,
          model: readString(item.model) || null,
          reasoningEffort: readString(item.reasoningEffort) || readString(item.reasoning_effort) || null,
          parentThreadId: readString(item.senderThreadId) || null,
        })
      }
    }
  }
  return entries
}

function subAgentStatusRank(status: string | null): number {
  const compacted = compactStatus(status)
  if (
    [
      'shutdown',
      'closed',
      'completed',
      'complete',
      'done',
      'failed',
      'errored',
      'error',
      'notfound',
      'interrupted',
    ].includes(compacted)
  ) {
    return 4
  }
  if (['running', 'active', 'inprogress', 'pendinginit'].includes(compacted)) return 3
  if (compacted) return 2
  return 1
}

function mergeThreadSubAgent(left: ThreadSubAgent, right: ThreadSubAgent): ThreadSubAgent {
  const preferRightStatus = subAgentStatusRank(right.status) >= subAgentStatusRank(left.status)
  const model = left.model ?? right.model ?? null
  const reasoningEffort = left.reasoningEffort ?? right.reasoningEffort ?? null
  const parentThreadId = left.parentThreadId ?? right.parentThreadId ?? null
  return {
    ...left,
    name:
      left.name.startsWith('Agent ') && !right.name.startsWith('Agent ')
        ? right.name
        : left.name,
    role: left.role === 'spawnAgent' || !left.role ? right.role ?? left.role : left.role,
    status: preferRightStatus ? right.status : left.status,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(parentThreadId ? { parentThreadId } : {}),
    source: left.source,
  }
}

export function normalizeThreadSubAgents(
  record: Record<string, unknown>,
  source: ThreadSubAgent['source'],
): ThreadSubAgent[] {
  const byId = new Map<string, ThreadSubAgent>()
  for (const entry of [...readSubAgentArrays(record), ...readCollabAgentEntries(record)]) {
    const normalized = normalizeSubAgentEntry(entry, byId.size, source)
    if (!normalized) continue
    const key = normalized.id.toLowerCase()
    const existing = byId.get(key)
    byId.set(key, existing ? mergeThreadSubAgent(existing, normalized) : normalized)
  }
  return [...byId.values()]
}

export function normalizeOfficialThreadSummary(value: unknown, owner: Owner | null = null): Thread | null {
  const record = asRecord(value)
  if (!record) return null
  const id = readString(record.id) || readString(record.sessionId) || readString(record.threadId)
  if (!id) return null

  const title = readString(record.name) || readString(record.title) || readString(record.preview) || 'Untitled'
  const cwd = readString(record.cwd)
  const effectiveCwd = readString(record.effectiveCwd) || readString(record.effective_cwd) || cwd || null
  const path = readString(record.path)
  const workspaceKind = readWorkspaceKind(record) ?? (cwd ? 'unknown' : undefined)
  const projectId = workspaceKind === 'project' ? cwd || path || null : null
  const createdAtIso = readIsoFromTimestamp(record.createdAt ?? record.created_at ?? record.createdAtMs)
  return {
    id,
    title,
    projectId,
    path: workspaceKind === 'project' ? cwd || path || null : path || null,
    ...(workspaceKind ? { workspaceKind } : {}),
    effectiveCwd,
    ...(createdAtIso ? { createdAtIso } : {}),
    updatedAtIso: readIsoFromTimestamp(record.updatedAt ?? record.updated_at ?? record.updatedAtMs),
    inProgress: readBooleanInProgress(record.status) || readBooleanInProgress(record.threadRuntimeStatus),
    pinned: readBoolean(record.pinned) || readBoolean(record.isPinned) || readBoolean(record.is_pinned),
    gitInfo: readThreadGitInfo(record.gitInfo),
    owner,
  }
}

function projectNameFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const name = normalized.split('/').filter(Boolean).at(-1)
  return name || path
}

function projectKey(path: string): string {
  return normalizeProjectPath(path).toLocaleLowerCase()
}

export function normalizeProjectPath(path: string): string {
  return path.trim().replaceAll('/', '\\').replace(/\\+$/, '')
}

export function projectFromPath(path: string, source: Project['source'] = 'web-favorite'): Project | null {
  const normalizedPath = normalizeProjectPath(path)
  if (!normalizedPath) return null
  return {
    id: normalizedPath,
    name: projectNameFromPath(normalizedPath),
    path: normalizedPath,
    source,
  }
}

export function mergeThreadListProjects(
  list: ThreadList,
  favoriteProjectPaths: string[],
  desktopWorkspaceRootPaths: string[] = [],
): ThreadList {
  if (desktopWorkspaceRootPaths.length > 0) {
    const preferredProjectKeys = new Set<string>()
    const preferredProjects: Project[] = []
    const appendPreferredProject = (project: Project | null): void => {
      if (!project) return
      const key = projectKey(project.path ?? project.id)
      if (preferredProjectKeys.has(key)) return
      preferredProjectKeys.add(key)
      preferredProjects.push(project)
    }

    for (const path of desktopWorkspaceRootPaths) {
      appendPreferredProject(projectFromPath(path, 'desktop-workspace'))
    }
    for (const path of favoriteProjectPaths) {
      appendPreferredProject(projectFromPath(path, 'web-favorite'))
    }

    return {
      ...list,
      projects: preferredProjects,
    }
  }

  const existingProjectKeys = new Set<string>()
  for (const project of list.projects) {
    const key = projectKey(project.path ?? project.id)
    if (key) existingProjectKeys.add(key)
  }

  const favoriteProjects: Project[] = []
  const appendFavoriteProject = (project: Project | null): void => {
    if (!project) return
    const key = projectKey(project.path ?? project.id)
    if (existingProjectKeys.has(key)) return
    existingProjectKeys.add(key)
    favoriteProjects.push(project)
  }
  for (const path of favoriteProjectPaths) {
    appendFavoriteProject(projectFromPath(path, 'web-favorite'))
  }
  return {
    ...list,
    projects: [
      ...list.projects,
      ...favoriteProjects.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN')),
    ],
  }
}

export function normalizeOfficialThreadList(
  value: unknown,
  ownerByThreadId: Record<string, Owner | null> = {},
): ThreadList {
  const record = asRecord(value)
  const rawThreads = Array.isArray(record?.data) ? record.data : Array.isArray(value) ? value : []
  const rawNormalizedThreads = rawThreads
    .map((entry) => {
      const id = readString(asRecord(entry)?.id) || readString(asRecord(entry)?.sessionId)
      return normalizeOfficialThreadSummary(entry, id ? (ownerByThreadId[id] ?? null) : null)
    })
    .filter((entry): entry is Thread => Boolean(entry))

  const canonicalProjectIdByKey = new Map<string, string>()
  const threads = rawNormalizedThreads.map((thread) => {
    if (!thread.projectId) return thread
    const key = projectKey(thread.projectId)
    const canonicalProjectId = canonicalProjectIdByKey.get(key) ?? thread.projectId
    canonicalProjectIdByKey.set(key, canonicalProjectId)
    return { ...thread, projectId: canonicalProjectId, path: canonicalProjectId }
  })

  const projectsById = new Map<string, Project>()
  for (const thread of threads) {
    if (!thread.projectId || projectsById.has(thread.projectId)) continue
    const project = projectFromPath(thread.projectId, 'official')
    if (project) projectsById.set(thread.projectId, project)
  }

  return {
    projects: [...projectsById.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN')),
    threads,
    nextCursor: readString(record?.nextCursor) || null,
    backwardsCursor: readString(record?.backwardsCursor) || null,
  }
}

export function normalizeOfficialThreadDetail(input: {
  thread: unknown
  owner: Owner | null
  fallbackThreadId: string
  source?: ThreadSubAgent['source']
}): ThreadDetail | null {
  const threadRecord = asRecord(input.thread)
  if (!threadRecord) return null
  const thread = normalizeOfficialThreadSummary(threadRecord, input.owner) ?? {
    id: input.fallbackThreadId,
    title: 'Untitled',
    projectId: null,
    path: null,
    workspaceKind: 'unknown',
    effectiveCwd: null,
    updatedAtIso: null,
    inProgress: false,
    pinned: false,
    gitInfo: null,
    owner: input.owner,
  }
  const turnsRaw = Array.isArray(threadRecord.turns) ? threadRecord.turns : []
  return {
    thread,
    goal: readThreadGoal(threadRecord),
    tokenUsage: readThreadTokenUsage(threadRecord),
    derivedFromThreadId: readDerivedFromThreadId(threadRecord),
    subAgents: normalizeThreadSubAgents(threadRecord, input.source ?? 'app-server'),
    sideConversations: [],
    turns: mergePendingTurnShadows(turnsRaw.map((turnValue, turnIndex) => {
      const turn = asRecord(turnValue)
      const itemsRaw = Array.isArray(turn?.items) ? turn.items : []
      const startedAtIso = readTurnStartedAtIso(turn)
      const completedAtIso = readTurnCompletedAtIso(turn)
      return {
        id: readString(turn?.turnId) || readString(turn?.id) || `turn-${turnIndex}`,
        status: readTurnStatus(turn?.status),
        ...(startedAtIso ? { startedAtIso } : {}),
        ...(completedAtIso ? { completedAtIso } : {}),
        items: itemsRaw.flatMap((itemValue, itemIndex) =>
          itemValue == null ? [] : [normalizeMessageItem(itemValue, itemIndex)],
        ),
      }
    })),
  }
}

export function normalizeOfficialConversationState(input: {
  threadId: string
  ownerClientId: string | null
  cacheVersion: number
  updatedAtIso: string
  isInProgress: boolean
  activeTurnId: string
  conversationState: unknown
}): ThreadDetail | null {
  const state = asRecord(input.conversationState)
  if (!state) return null
  const detail = normalizeOfficialThreadDetail({
    thread: {
      ...state,
      updatedAt: state.updatedAt ?? state.updated_at ?? input.updatedAtIso,
      status: input.isInProgress ? 'active' : state.status,
    },
    source: 'official-ipc',
    owner: input.ownerClientId
      ? { clientId: input.ownerClientId, kind: 'unknown', source: 'official-ipc' }
      : null,
    fallbackThreadId: input.threadId,
  })
  if (detail) {
    detail.thread.updatedAtIso = detail.thread.updatedAtIso ?? input.updatedAtIso
    detail.thread.inProgress = input.isInProgress
    if (input.activeTurnId) {
      detail.turns = detail.turns.map((turn) =>
        turn.id === input.activeTurnId ? { ...turn, status: 'active' } : turn,
      )
    }
  }
  return detail
}
