import { describe, expect, it } from 'vitest'
import type { ThreadDetail } from '../api'
import {
  INITIAL_THREAD_DETAIL_REQUEST_STATE,
  beginThreadDetailRequest,
  mergeThreadDetailWithLiveItems,
  shouldApplyThreadDetailResponse,
} from './threadDetailRequests'

function detail(
  threadId: string,
  input: Pick<ThreadDetail, 'turns'> & { inProgress?: boolean },
): ThreadDetail {
  return {
    thread: {
      id: threadId,
      title: 'Thread',
      projectId: null,
      path: null,
      updatedAtIso: null,
      inProgress: input.inProgress ?? false,
      pinned: false,
      owner: null,
    },
    goal: null,
    turns: input.turns,
    subAgents: [],
    sideConversations: [],
  }
}

describe('thread detail request ordering', () => {
  it('accepts only the latest request response for the active thread', () => {
    const first = beginThreadDetailRequest(INITIAL_THREAD_DETAIL_REQUEST_STATE, 'thread-a')
    const second = beginThreadDetailRequest(first.state, 'thread-a')

    expect(shouldApplyThreadDetailResponse(second.state, first.token)).toBe(false)
    expect(shouldApplyThreadDetailResponse(second.state, second.token)).toBe(true)
  })

  it('rejects a late response after the user switches threads', () => {
    const first = beginThreadDetailRequest(INITIAL_THREAD_DETAIL_REQUEST_STATE, 'thread-a')
    const second = beginThreadDetailRequest(first.state, 'thread-b')

    expect(shouldApplyThreadDetailResponse(second.state, first.token)).toBe(false)
    expect(shouldApplyThreadDetailResponse(second.state, second.token)).toBe(true)
  })

  it('preserves live command items when a stored summary refresh omits them', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            { type: 'user', id: 'user-a', text: 'Run tests' },
            { type: 'assistant', id: 'assistant-a', text: 'I will run' },
            {
              type: 'command',
              id: 'command-a',
              command: 'pnpm test',
              status: 'completed',
              output: 'stdout: ok',
              stdout: 'stdout: ok',
              stderr: '',
              cwd: null,
              durationMs: 1200,
              exitCode: 0,
            },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: false,
      turns: [
        {
          id: 'turn-a',
          status: 'completed',
          items: [
            { type: 'user', id: 'user-a', text: 'Run tests' },
            { type: 'assistant', id: 'assistant-a', text: 'I will run\n\nDone.' },
          ],
        },
      ],
    })

    const merged = mergeThreadDetailWithLiveItems(current, incoming)

    expect(merged?.thread.inProgress).toBe(false)
    expect(merged?.turns[0]?.status).toBe('completed')
    expect(merged?.turns[0]?.items).toEqual([
      { type: 'user', id: 'user-a', text: 'Run tests' },
      { type: 'assistant', id: 'assistant-a', text: 'I will run\n\nDone.' },
      {
        type: 'command',
        id: 'command-a',
        command: 'pnpm test',
        status: 'completed',
        output: 'stdout: ok',
        stdout: 'stdout: ok',
        stderr: '',
        cwd: null,
        durationMs: 1200,
        exitCode: 0,
      },
    ])
  })

  it('uses completed item status while keeping richer streamed output', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            {
              type: 'command',
              id: 'command-a',
              command: 'pnpm test',
              status: 'active',
              output: 'stdout: streamed output',
              stdout: 'stdout: streamed output',
              stderr: '',
              cwd: null,
              durationMs: null,
              exitCode: null,
            },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: false,
      turns: [
        {
          id: 'turn-a',
          status: 'completed',
          items: [
            {
              type: 'command',
              id: 'command-a',
              command: 'pnpm test',
              status: 'completed',
              output: '',
              stdout: '',
              stderr: '',
              cwd: null,
              durationMs: 1500,
              exitCode: 0,
            },
          ],
        },
      ],
    })

    const command = mergeThreadDetailWithLiveItems(current, incoming)
      ?.turns[0]?.items[0]

    expect(command).toMatchObject({
      type: 'command',
      status: 'completed',
      output: 'stdout: streamed output',
      stdout: 'stdout: streamed output',
      durationMs: 1500,
      exitCode: 0,
    })
  })

  it('does not merge details from a different thread', () => {
    const current = detail('thread-a', {
      turns: [
        {
          id: 'turn-a',
          status: 'completed',
          items: [{ type: 'assistant', id: 'assistant-a', text: 'old' }],
        },
      ],
    })
    const incoming = detail('thread-b', {
      turns: [
        {
          id: 'turn-b',
          status: 'completed',
          items: [{ type: 'assistant', id: 'assistant-b', text: 'new' }],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)).toBe(incoming)
  })
})
