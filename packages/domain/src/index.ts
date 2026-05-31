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
  source: 'official' | 'web-favorite'
}

export type Thread = {
  id: string
  title: string
  projectId: string | null
  path: string | null
  updatedAtIso: string | null
  inProgress: boolean
  pinned: boolean
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

export type FileChangeContent = {
  path: string
  diff: string
  status: string | null
  kind: string | null
}

export type PlanStep = {
  text: string
  status: string | null
}

export type MessageItem =
  | { type: 'user'; id: string; text: string; images?: MessageImageContent[] }
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

export type Turn = {
  id: string
  status: 'idle' | 'active' | 'completed' | 'failed' | 'interrupted' | 'unknown'
  items: MessageItem[]
}

export type ThreadSubAgent = {
  id: string
  name: string
  role: string | null
  status: string | null
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

function readTextContent(value: unknown): string {
  if (typeof value === 'string') return value.trim() === '<image>' ? '' : value
  const record = asRecord(value)
  if (record) {
    const direct =
      readString(record.text) ||
      readString(record.content) ||
      readString(record.message) ||
      readString(record.value)
    if (direct) return direct.trim() === '<image>' ? '' : direct
    const nested = readTextContent(record.content ?? record.message ?? record.delta)
    if (nested) return nested
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim() === '<image>' ? '' : entry
        const entryRecord = asRecord(entry)
        const text =
          readString(entryRecord?.text) ||
          readString(entryRecord?.content) ||
          readString(entryRecord?.value) ||
          readTextContent(entryRecord?.content)
        return text.trim() === '<image>' ? '' : text
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

function readCommandOutput(record: Record<string, unknown>): { output: string; stdout: string; stderr: string } {
  const stdout = readString(record.stdout) || readString(record.stdoutText)
  const stderr = readString(record.stderr) || readString(record.stderrText)
  const output =
    readString(record.output) ||
    readString(record.aggregatedOutput) ||
    readString(record.aggregated_output) ||
    readString(record.text) ||
    [stdout, stderr].filter(Boolean).join('\n')
  return { output, stdout, stderr }
}

function readFileChangeKind(value: unknown): string | null {
  const record = asRecord(value)
  return readString(record?.type) || readString(value) || null
}

function normalizeFileChanges(record: Record<string, unknown> | null): FileChangeContent[] {
  const parentStatus = readStatusString(record?.status) || null
  const changes = readArray(record?.changes)
    .map((entry) => {
      const entryRecord = asRecord(entry)
      const path =
        readString(entryRecord?.path) ||
        readString(entryRecord?.filePath) ||
        readString(entryRecord?.file_path)
      const diff = readString(entryRecord?.diff) || readString(entryRecord?.patch)
      if (!path && !diff) return null
      return {
        path,
        diff,
        status: readStatusString(entryRecord?.status) || parentStatus,
        kind: readFileChangeKind(entryRecord?.kind),
      }
    })
    .filter((entry): entry is FileChangeContent => Boolean(entry))

  if (changes.length) return changes

  const path =
    readString(record?.path) ||
    readString(record?.filePath) ||
    readString(record?.file_path)
  const diff = readString(record?.diff) || readString(record?.patch)
  if (!path && !diff) return []
  return [
    {
      path,
      diff,
      status: parentStatus,
      kind: null,
    },
  ]
}

function normalizeMessageItem(value: unknown, index: number): MessageItem {
  const record = asRecord(value)
  const type = readString(record?.type)
  const normalizedType = type.toLowerCase()
  const compactType = normalizedType.replace(/[-_]/g, '')
  const id = readString(record?.id) || `${type || 'item'}-${index}`

  if (normalizedType === 'unknown') {
    const rawRecord = asRecord(record?.raw)
    const rawType = readString(record?.rawType) || readString(rawRecord?.type)
    const compactRawType = rawType.toLowerCase().replace(/[-_]/g, '')
    if (rawRecord && compactRawType === 'steeringusermessage') {
      const normalizedRaw = normalizeMessageItem(rawRecord, index)
      return { ...normalizedRaw, id }
    }
  }

  if (type === 'userMessage' || normalizedType === 'user') {
    const images = readUserImages(record)
    return {
      type: 'user',
      id,
      text: readTextContent(record?.content) || readString(record?.text),
      ...(images.length ? { images } : {}),
    }
  }
  if (compactType === 'steeringusermessage') {
    const restoreMessage = asRecord(record?.restoreMessage)
    const text =
      readString(restoreMessage?.text) ||
      readTextContent(record?.input) ||
      readTextContent(record?.content) ||
      readString(record?.text)
    const images = readUserImages(record)
    return {
      type: 'user',
      id,
      text,
      ...(images.length ? { images } : {}),
    }
  }
  if (type === 'agentMessage' || type === 'assistantMessage' || normalizedType === 'assistant') {
    const images = readImagesContent(record?.content)
    return {
      type: 'assistant',
      id,
      text: readString(record?.text) || readTextContent(record?.content),
      ...(images.length ? { images } : {}),
    }
  }
  if (type === 'reasoning' || normalizedType.includes('thinking')) {
    return {
      type: 'reasoning',
      id,
      text: readString(record?.text) || readTextContent(record?.content),
      collapsed: true,
      status: readStatusString(record?.status) || readStatusString(record?.state) || null,
    }
  }
  if (type === 'command' || type === 'commandExecution') {
    const output = readCommandOutput(record ?? {})
    return {
      type: 'command',
      id,
      command: readString(record?.command) || readString(record?.cmd) || readString(record?.commandLine),
      status: readStatusString(record?.status) || 'unknown',
      output: output.output,
      stdout: output.stdout,
      stderr: output.stderr,
      cwd: readString(record?.cwd) || readString(record?.workingDirectory) || readString(record?.working_directory) || null,
      durationMs:
        readNumber(record?.durationMs) ??
        readNumber(record?.duration_ms) ??
        readNumber(record?.elapsedMs) ??
        readNumber(record?.elapsed_ms),
      exitCode: readNumber(record?.exitCode) ?? readNumber(record?.exit_code),
    }
  }
  if (type === 'fileChange' || normalizedType.includes('filechange') || normalizedType.includes('patch')) {
    const changes = normalizeFileChanges(record)
    const firstChange = changes[0]
    return {
      type: 'fileChange',
      id,
      path: firstChange?.path ?? '',
      diff: firstChange?.diff ?? '',
      status: readStatusString(record?.status) || firstChange?.status || null,
      ...(changes.length ? { changes } : {}),
    }
  }
  if (normalizedType.includes('plan') || normalizedType === 'todo-list' || normalizedType === 'todo_list' || normalizedType === 'todolist') {
    return {
      type: 'plan',
      id,
      text: readTextContent(record?.text ?? record?.content ?? record?.explanation ?? record?.plan),
      steps: normalizePlanSteps(record?.steps ?? record?.items ?? record?.plan),
      status: readStatusString(record?.status) || null,
    }
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
    const query = readString(record?.query) || readString(record?.searchQuery) || readString(record?.search_query)
    return {
      type: 'toolOutput',
      id,
      title: query ? `Web search: ${query}` : 'Web search',
      text: readTextContent(record?.output ?? record?.results ?? record?.content ?? record?.text ?? record?.result),
      status: readStatusString(record?.status) || null,
      rawType: type || 'webSearch',
    }
  }
  if (normalizedType.includes('tool') || normalizedType.includes('mcp') || normalizedType.includes('function')) {
    return {
      type: 'toolOutput',
      id,
      title: readString(record?.title) || readString(record?.name) || type || 'Tool output',
      text: readTextContent(record?.output ?? record?.content ?? record?.text ?? record?.result),
      status: readStatusString(record?.status) || null,
      rawType: type || 'unknown',
    }
  }
  return { type: 'unknown', id, rawType: type || 'unknown', raw: value }
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
  return {
    id: id || `${source}-subagent-${index}`,
    name,
    role,
    status,
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
            status: readStatusString(state?.status) || readStatusString(item.status) || null,
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
          status: readStatusString(item.status) || null,
        })
      }
    }
  }
  return entries
}

function normalizeThreadSubAgents(
  record: Record<string, unknown>,
  source: ThreadSubAgent['source'],
): ThreadSubAgent[] {
  const seen = new Set<string>()
  return [...readSubAgentArrays(record), ...readCollabAgentEntries(record)]
    .map((entry, index) => normalizeSubAgentEntry(entry, index, source))
    .filter((entry): entry is ThreadSubAgent => {
      if (!entry) return false
      const key = `${entry.id.toLowerCase()}|${entry.name.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function normalizeOfficialThreadSummary(value: unknown, owner: Owner | null = null): Thread | null {
  const record = asRecord(value)
  if (!record) return null
  const id = readString(record.id) || readString(record.sessionId) || readString(record.threadId)
  if (!id) return null

  const title = readString(record.name) || readString(record.title) || readString(record.preview) || 'Untitled'
  const cwd = readString(record.cwd)
  const path = readString(record.path)
  const projectId = cwd || null
  return {
    id,
    title,
    projectId,
    path: cwd || path || null,
    updatedAtIso: readIsoFromTimestamp(record.updatedAt ?? record.updated_at ?? record.updatedAtMs),
    inProgress: readBooleanInProgress(record.status) || readBooleanInProgress(record.threadRuntimeStatus),
    pinned: readBoolean(record.pinned) || readBoolean(record.isPinned) || readBoolean(record.is_pinned),
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

export function mergeThreadListProjects(list: ThreadList, favoriteProjectPaths: string[]): ThreadList {
  const existingProjectKeys = new Set<string>()
  for (const project of list.projects) {
    const key = projectKey(project.path ?? project.id)
    if (key) existingProjectKeys.add(key)
  }
  const favoriteProjects: Project[] = []
  for (const path of favoriteProjectPaths) {
    const favorite = projectFromPath(path, 'web-favorite')
    if (!favorite) continue
    const key = projectKey(favorite.path ?? favorite.id)
    if (existingProjectKeys.has(key)) continue
    existingProjectKeys.add(key)
    favoriteProjects.push(favorite)
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
    updatedAtIso: null,
    inProgress: false,
    pinned: false,
    owner: input.owner,
  }
  const turnsRaw = Array.isArray(threadRecord.turns) ? threadRecord.turns : []
  return {
    thread,
    goal: readThreadGoal(threadRecord),
    subAgents: normalizeThreadSubAgents(threadRecord, input.source ?? 'app-server'),
    sideConversations: [],
    turns: turnsRaw.map((turnValue, turnIndex) => {
      const turn = asRecord(turnValue)
      const itemsRaw = Array.isArray(turn?.items) ? turn.items : []
      return {
        id: readString(turn?.turnId) || readString(turn?.id) || `turn-${turnIndex}`,
        status: readTurnStatus(turn?.status),
        items: itemsRaw.map(normalizeMessageItem),
      }
    }),
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
