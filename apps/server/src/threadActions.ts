import type {
  ThreadArchiveParams,
  ThreadReadParams,
  ThreadRenameParams,
  ThreadResumeParams,
  ThreadRollbackParams,
  TurnStartParams,
} from './appServerProcess.js'
import { randomUUID } from 'node:crypto'
import { toOfficialTurnStartParams } from './appServerParams.js'

type LocalTurnStarter = {
  threadResume: (params: ThreadResumeParams) => Promise<unknown>
  turnStart: (params: TurnStartParams) => Promise<unknown>
}

type LocalTurnEditor = LocalTurnStarter & {
  threadRollback: (params: ThreadRollbackParams) => Promise<unknown>
}

type StartLocalTurnOptions = {
  skipResume?: boolean
}

type ThreadArchiver = {
  threadArchive: (params: ThreadArchiveParams) => Promise<unknown>
  threadRead: (params: ThreadReadParams) => Promise<unknown>
  threadRename: (params: ThreadRenameParams) => Promise<unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

function threadResumeParamsForTurnStart(params: TurnStartParams): ThreadResumeParams {
  return {
    threadId: params.threadId,
    ...(params.cwd ? { cwd: params.cwd } : {}),
  }
}

function readTurnRecordId(turn: Record<string, unknown>): string {
  return readString(turn.turnId) || readString(turn.turn_id) || readString(turn.id)
}

function compactStatus(value: unknown): string {
  const record = asRecord(value)
  return (
    readString(value) ||
    readString(record?.type) ||
    readString(record?.status) ||
    readString(record?.state) ||
    readString(record?.kind)
  )
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function isActiveStatus(value: unknown): boolean {
  return [
    'active',
    'inprogress',
    'running',
    'streaming',
    'thinking',
    'editing',
    'writing',
  ].includes(compactStatus(value))
}

function readTurns(conversationState: unknown): Record<string, unknown>[] {
  const record = asRecord(conversationState)
  const turns = Array.isArray(record?.turns) ? record.turns : []
  return turns
    .map((turn) => asRecord(turn))
    .filter((turn): turn is Record<string, unknown> => Boolean(turn))
}

function replaceFirstTextInput(
  input: unknown,
  message: string,
): Array<Record<string, unknown>> {
  const entries = Array.isArray(input) ? input : []
  let replaced = false
  const next = entries
    .map((entry) => {
      const record = asRecord(entry)
      if (!record) return null
      if (!replaced && readString(record.type) === 'text') {
        replaced = true
        return { ...record, text: message, text_elements: [] }
      }
      return record
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
  if (replaced) return next
  return [{ type: 'text', text: message, text_elements: [] }, ...next]
}

const EDIT_TURN_PARAM_KEYS = [
  'cwd',
  'model',
  'serviceTier',
  'effort',
  'summary',
  'personality',
  'outputSchema',
  'collaborationMode',
  'approvalPolicy',
  'approvalsReviewer',
  'sandboxPolicy',
  'permissions',
  'runtimeWorkspaceRoots',
  'environments',
  'attachments',
  'commentAttachments',
]

export function buildEditedLastUserTurnStartParams(input: {
  threadId: string
  turnId: string
  message: string
  conversationState: unknown
  overrides?: Partial<TurnStartParams> & Record<string, unknown>
}): TurnStartParams {
  const turns = readTurns(input.conversationState)
  const turn =
    turns.find((candidate) => readTurnRecordId(candidate) === input.turnId) ??
    null
  if (!turn) throw new Error('Conversation state not found.')
  const lastTurn = turns.at(-1) ?? null
  if (!lastTurn || readTurnRecordId(lastTurn) !== input.turnId) {
    throw new Error('Only the most recent message can be edited.')
  }
  if (
    isActiveStatus(turn.status) ||
    isActiveStatus(turn.state) ||
    isActiveStatus(turn.threadRuntimeStatus)
  ) {
    throw new Error('Cannot edit a message while a turn is in progress.')
  }

  const originalParams = asRecord(turn.params) ?? {}
  const params: TurnStartParams & Record<string, unknown> = {
    threadId: input.threadId,
    clientUserMessageId: randomUUID(),
    input: replaceFirstTextInput(originalParams.input, input.message),
  }
  for (const key of EDIT_TURN_PARAM_KEYS) {
    const value = originalParams[key]
    if (value !== undefined) params[key] = value
  }
  if (input.overrides) {
    for (const [key, value] of Object.entries(input.overrides)) {
      if (value !== undefined) params[key] = value
    }
  }
  params.threadId = input.threadId
  return params
}

export async function startLocalTurn(
  appServer: LocalTurnStarter,
  params: TurnStartParams,
  options: StartLocalTurnOptions = {},
): Promise<unknown> {
  const officialParams = toOfficialTurnStartParams(params)
  if (!options.skipResume) {
    await appServer.threadResume(threadResumeParamsForTurnStart(officialParams))
  }
  return await appServer.turnStart(officialParams)
}

export async function resumeLocalThreadForTurn(
  appServer: LocalTurnStarter,
  params: TurnStartParams,
): Promise<void> {
  await appServer.threadResume(
    threadResumeParamsForTurnStart(toOfficialTurnStartParams(params)),
  )
}

export async function editLocalLastUserTurn(
  appServer: LocalTurnEditor,
  input: {
    threadId: string
    turnId: string
    message: string
    conversationState: unknown
    overrides?: Partial<TurnStartParams> & Record<string, unknown>
  },
  options: StartLocalTurnOptions = {},
): Promise<unknown> {
  const params = buildEditedLastUserTurnStartParams(input)
  if (!options.skipResume) {
    await resumeLocalThreadForTurn(appServer, params)
  }
  await appServer.threadRollback({ threadId: input.threadId, numTurns: 1 })
  return await startLocalTurn(appServer, params, { ...options, skipResume: true })
}

export function readThreadArchiveFallbackName(value: unknown): string {
  const record = asRecord(value)
  const thread = asRecord(record?.thread)
  return readString(thread?.name) || readString(thread?.title) || readString(thread?.preview) || 'Untitled thread'
}

export function isArchivedThreadReadResult(value: unknown): boolean {
  const record = asRecord(value)
  const thread = asRecord(record?.thread)
  const sessionPath = readString(thread?.path)
  return sessionPath.split(/[\\/]+/u).includes('archived_sessions')
}

export async function archiveThreadWithRecovery(appServer: ThreadArchiver, threadId: string): Promise<unknown> {
  try {
    return await appServer.threadArchive({ threadId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('no rollout found')) throw error
  }

  let threadReadResult: unknown = null
  try {
    threadReadResult = await appServer.threadRead({ threadId, includeTurns: false })
    if (isArchivedThreadReadResult(threadReadResult)) return null
  } catch {
    // If metadata cannot be read, still try materializing a title before retrying archive.
  }

  await appServer.threadRename({
    threadId,
    name: readThreadArchiveFallbackName(threadReadResult),
  })
  return await appServer.threadArchive({ threadId })
}
