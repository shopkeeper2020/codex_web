import type { ThreadArchiveParams, ThreadReadParams, ThreadRenameParams, TurnStartParams } from './appServerProcess.js'

type LocalTurnStarter = {
  rpc: (method: string, params?: unknown) => Promise<unknown>
  turnStart: (params: TurnStartParams) => Promise<unknown>
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

export async function startLocalTurn(appServer: LocalTurnStarter, params: TurnStartParams): Promise<unknown> {
  try {
    await appServer.rpc('thread/resume', {
      threadId: params.threadId,
      ...(params.cwd ? { cwd: params.cwd, path: null } : {}),
    })
  } catch {
    // Older app-server versions may not require or expose resume; turn/start remains the source of truth.
  }
  return await appServer.turnStart(params)
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
