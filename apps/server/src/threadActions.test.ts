import { describe, expect, it } from 'vitest'
import { archiveThreadWithRecovery, editLocalLastUserTurn, startLocalTurn } from './threadActions.js'
import type {
  ThreadArchiveParams,
  ThreadReadParams,
  ThreadRenameParams,
  ThreadResumeParams,
  ThreadRollbackParams,
  TurnStartParams,
} from './appServerProcess.js'

describe('thread actions', () => {
  it('resumes before starting a local turn', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const appServer = {
      async threadResume(params: ThreadResumeParams): Promise<unknown> {
        calls.push({ method: 'thread/resume', params })
        return { ok: true }
      },
      async turnStart(params: TurnStartParams): Promise<unknown> {
        calls.push({ method: 'turn/start', params })
        return { turn: { id: 'turn-a' } }
      },
    }

    await expect(startLocalTurn(appServer, { threadId: 'thread-a', input: [] })).resolves.toEqual({
      turn: { id: 'turn-a' },
    })
    expect(calls).toEqual([
      { method: 'thread/resume', params: { threadId: 'thread-a' } },
      { method: 'turn/start', params: { threadId: 'thread-a', input: [] } },
    ])
  })

  it('does not start a local turn when resume fails', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const appServer = {
      async threadResume(params: ThreadResumeParams): Promise<unknown> {
        calls.push({ method: 'thread/resume', params })
        throw new Error('thread/resume failed')
      },
      async turnStart(params: TurnStartParams): Promise<unknown> {
        calls.push({ method: 'turn/start', params })
        return { turn: { id: 'turn-a' } }
      },
    }

    await expect(
      startLocalTurn(appServer, { threadId: 'thread-a', input: [] }),
    ).rejects.toThrow('thread/resume failed')
    expect(calls).toEqual([
      { method: 'thread/resume', params: { threadId: 'thread-a' } },
    ])
  })

  it('can start the first local turn for a new empty thread without resume', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const appServer = {
      async threadResume(params: ThreadResumeParams): Promise<unknown> {
        calls.push({ method: 'thread/resume', params })
        throw new Error('thread/resume should not be called')
      },
      async turnStart(params: TurnStartParams): Promise<unknown> {
        calls.push({ method: 'turn/start', params })
        return { turn: { id: 'turn-first' } }
      },
    }

    await expect(
      startLocalTurn(appServer, { threadId: 'thread-new', input: [] }, { skipResume: true }),
    ).resolves.toEqual({ turn: { id: 'turn-first' } })
    expect(calls).toEqual([
      { method: 'turn/start', params: { threadId: 'thread-new', input: [] } },
    ])
  })

  it('strips UI-only turn fields before calling the raw app-server', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const appServer = {
      async threadResume(params: ThreadResumeParams): Promise<unknown> {
        calls.push({ method: 'thread/resume', params })
        return { ok: true }
      },
      async turnStart(params: TurnStartParams): Promise<unknown> {
        calls.push({ method: 'turn/start', params })
        return { turn: { id: 'turn-b' } }
      },
    }

    await startLocalTurn(appServer, {
      threadId: 'thread-b',
      input: [{ type: 'text', text: 'hello' }],
      clientUserMessageId: 'client-msg-b',
      cwd: 'C:\\workspace\\codex_web',
      attachments: [{ path: 'C:\\workspace\\codex_web\\image.png' }],
      restoreMessage: { text: 'hello' },
    })

    expect(calls).toEqual([
      {
        method: 'thread/resume',
        params: { threadId: 'thread-b', cwd: 'C:\\workspace\\codex_web' },
      },
      {
        method: 'turn/start',
        params: {
          threadId: 'thread-b',
          input: [{ type: 'text', text: 'hello' }],
          clientUserMessageId: 'client-msg-b',
          cwd: 'C:\\workspace\\codex_web',
        },
      },
    ])
  })

  it('resumes an existing thread before editing the last user turn', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const appServer = {
      async threadResume(params: ThreadResumeParams): Promise<unknown> {
        calls.push({ method: 'thread/resume', params })
        return { ok: true }
      },
      async threadRollback(params: ThreadRollbackParams): Promise<unknown> {
        calls.push({ method: 'thread/rollback', params })
        return { ok: true }
      },
      async turnStart(params: TurnStartParams): Promise<unknown> {
        calls.push({ method: 'turn/start', params })
        return { turn: { id: 'turn-edited' } }
      },
    }

    await expect(
      editLocalLastUserTurn(appServer, {
        threadId: 'thread-b',
        turnId: 'turn-last',
        message: 'edited',
        conversationState: {
          id: 'thread-b',
          turns: [
            {
              turnId: 'turn-last',
              status: 'completed',
              params: {
                cwd: 'C:\\workspace\\codex_web',
                input: [{ type: 'text', text: 'original', text_elements: [] }],
              },
            },
          ],
        },
      }),
    ).resolves.toEqual({ turn: { id: 'turn-edited' } })
    expect(calls).toEqual([
      {
        method: 'thread/resume',
        params: { threadId: 'thread-b', cwd: 'C:\\workspace\\codex_web' },
      },
      { method: 'thread/rollback', params: { threadId: 'thread-b', numTurns: 1 } },
      {
        method: 'turn/start',
        params: {
          clientUserMessageId: expect.any(String),
          threadId: 'thread-b',
          cwd: 'C:\\workspace\\codex_web',
          input: [{ type: 'text', text: 'edited', text_elements: [] }],
        },
      },
    ])
  })

  it('sets a fallback title and retries archive when no rollout is materialized', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    let archiveCalls = 0
    const appServer = {
      async threadArchive(params: ThreadArchiveParams): Promise<unknown> {
        calls.push({ method: 'thread/archive', params })
        archiveCalls += 1
        if (archiveCalls === 1) throw new Error('no rollout found for thread thread-a')
        return { ok: true }
      },
      async threadRead(params: ThreadReadParams): Promise<unknown> {
        calls.push({ method: 'thread/read', params })
        return { thread: { id: 'thread-a', preview: 'Fallback name' } }
      },
      async threadRename(params: ThreadRenameParams): Promise<unknown> {
        calls.push({ method: 'thread/name/set', params })
        return { ok: true }
      },
    }

    await expect(archiveThreadWithRecovery(appServer, 'thread-a')).resolves.toEqual({ ok: true })
    expect(calls).toEqual([
      { method: 'thread/archive', params: { threadId: 'thread-a' } },
      { method: 'thread/read', params: { threadId: 'thread-a', includeTurns: false } },
      { method: 'thread/name/set', params: { threadId: 'thread-a', name: 'Fallback name' } },
      { method: 'thread/archive', params: { threadId: 'thread-a' } },
    ])
  })

  it('treats no-rollout archive of an already archived thread as successful', async () => {
    const appServer = {
      async threadArchive(): Promise<unknown> {
        throw new Error('no rollout found for thread thread-a')
      },
      async threadRead(): Promise<unknown> {
        return { thread: { path: 'C:\\Users\\example\\.codex\\archived_sessions\\rollout-thread-a.jsonl' } }
      },
      async threadRename(): Promise<unknown> {
        throw new Error('rename should not be called')
      },
    }

    await expect(archiveThreadWithRecovery(appServer, 'thread-a')).resolves.toBeNull()
  })
})
