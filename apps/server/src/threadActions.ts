import type {
  ThreadArchiveParams,
  ThreadReadParams,
  ThreadRenameParams,
  ThreadResumeParams,
  TurnStartParams,
} from './appServerProcess.js'
import { toOfficialTurnStartParams } from './appServerParams.js'

type LocalTurnStarter = {
  threadResume: (params: ThreadResumeParams) => Promise<unknown>
  turnStart: (params: TurnStartParams) => Promise<unknown>
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

export async function startLocalTurn(
  appServer: LocalTurnStarter,
  params: TurnStartParams,
  options: StartLocalTurnOptions = {},
): Promise<unknown> {
  const officialParams = toOfficialTurnStartParams(params)
  if (!options.skipResume) {
    const resumeParams: ThreadResumeParams = {
      threadId: officialParams.threadId,
      ...(officialParams.cwd ? { cwd: officialParams.cwd } : {}),
    }
    await appServer.threadResume(resumeParams)
  }
  return await appServer.turnStart(officialParams)
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
