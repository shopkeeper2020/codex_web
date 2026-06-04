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
      gitInfo: null,
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

  it('does not duplicate same streamed assistant output when ids differ', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            { type: 'assistant', id: 'assistant-live', text: 'streamed answer' },
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
            { type: 'assistant', id: 'assistant-final', text: 'streamed answer' },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns[0]?.items).toEqual([
      { type: 'assistant', id: 'assistant-final', text: 'streamed answer' },
    ])
  })

  it('does not duplicate same streamed command output when ids differ', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            {
              type: 'command',
              id: 'command-live',
              command: 'pnpm test',
              status: 'active',
              output: 'ok',
              stdout: 'ok',
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
              id: 'command-final',
              command: 'pnpm test',
              status: 'completed',
              output: 'ok',
              stdout: 'ok',
              stderr: '',
              cwd: null,
              durationMs: 100,
              exitCode: 0,
            },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns[0]?.items).toEqual([
      {
        type: 'command',
        id: 'command-final',
        command: 'pnpm test',
        status: 'completed',
        output: 'ok',
        stdout: 'ok',
        stderr: '',
        cwd: null,
        durationMs: 100,
        exitCode: 0,
      },
    ])
  })

  it('does not duplicate the same user item when live and detail ids differ', () => {
    const image = {
      url: null,
      path: 'E:\\cache\\Desktop\\screenshot.png',
      mimeType: 'image/png',
      alt: null,
    }
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            { type: 'user', id: 'user-live', text: '同一条用户输入为什么出现2次？', images: [image] },
            { type: 'assistant', id: 'assistant-a', text: '我来检查。' },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            { type: 'user', id: 'user-final', text: '同一条用户输入为什么出现2次？' },
            { type: 'assistant', id: 'assistant-a', text: '我来检查。' },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns[0]?.items).toEqual([
      { type: 'user', id: 'user-final', text: '同一条用户输入为什么出现2次？', images: [image] },
      { type: 'assistant', id: 'assistant-a', text: '我来检查。' },
    ])
  })

  it('preserves existing history when an in-progress detail snapshot only has the active turn', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-previous',
          status: 'completed',
          items: [
            { type: 'user', id: 'user-previous', text: '帮我进行修复。' },
            { type: 'assistant', id: 'assistant-previous', text: '已完成修复。' },
          ],
        },
        {
          id: 'turn-active',
          status: 'active',
          items: [
            { type: 'user', id: 'user-active-live', text: '同一条用户输入为什么出现2次？' },
            { type: 'assistant', id: 'assistant-active', text: '我来检查。' },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-active',
          status: 'active',
          items: [
            { type: 'assistant', id: 'assistant-active', text: '我来检查。' },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns).toEqual([
      {
        id: 'turn-previous',
        status: 'completed',
        items: [
          { type: 'user', id: 'user-previous', text: '帮我进行修复。' },
          { type: 'assistant', id: 'assistant-previous', text: '已完成修复。' },
        ],
      },
      {
        id: 'turn-active',
        status: 'active',
        items: [
          { type: 'user', id: 'user-active-live', text: '同一条用户输入为什么出现2次？' },
          { type: 'assistant', id: 'assistant-active', text: '我来检查。' },
        ],
      },
    ])
  })

  it('does not reinsert turns pruned by an edit rollback before the replacement turn', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-before',
          status: 'completed',
          items: [
            { type: 'user', id: 'user-before', text: '北京未来一周天气怎样？' },
            { type: 'assistant', id: 'assistant-before', text: '北京这周前冷后暖。' },
          ],
        },
        {
          id: 'turn-edited-away',
          status: 'completed',
          items: [
            { type: 'user', id: 'user-old', text: '上海的呢？' },
            { type: 'assistant', id: 'assistant-old', text: '上海整体舒适。' },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-before',
          status: 'completed',
          items: [
            { type: 'user', id: 'user-before', text: '北京未来一周天气怎样？' },
            { type: 'assistant', id: 'assistant-before', text: '北京这周前冷后暖。' },
          ],
        },
        {
          id: 'turn-replacement',
          status: 'active',
          items: [
            { type: 'user', id: 'user-new', text: '新疆的呢？' },
            { type: 'assistant', id: 'assistant-new', text: '新疆昼夜温差明显。' },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns).toEqual([
      {
        id: 'turn-before',
        status: 'completed',
        items: [
          { type: 'user', id: 'user-before', text: '北京未来一周天气怎样？' },
          { type: 'assistant', id: 'assistant-before', text: '北京这周前冷后暖。' },
        ],
      },
      {
        id: 'turn-replacement',
        status: 'active',
        items: [
          { type: 'user', id: 'user-new', text: '新疆的呢？' },
          { type: 'assistant', id: 'assistant-new', text: '新疆昼夜温差明显。' },
        ],
      },
    ])
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

  it('drops current pending turns when the official turn arrives', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'pending-client-user-1',
          status: 'active',
          items: [
            { type: 'user', id: 'client-user-1', text: '帮我找一下OpenAI这两天的发布会的帖子或者视频。' },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-official',
          status: 'active',
          items: [
            { type: 'user', id: 'official-user-1', text: '帮我找一下OpenAI这两天的发布会的帖子或者视频。' },
            { type: 'assistant', id: 'assistant-a', text: '我已定位到这两天最相关的是 OpenAI 6 月 2 日。' },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns).toEqual([
      {
        id: 'turn-official',
        status: 'active',
        items: [
          { type: 'user', id: 'official-user-1', text: '帮我找一下OpenAI这两天的发布会的帖子或者视频。' },
          { type: 'assistant', id: 'assistant-a', text: '我已定位到这两天最相关的是 OpenAI 6 月 2 日。' },
        ],
      },
    ])
  })

  it('does not reintroduce a late pending snapshot after the official turn is live', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-official',
          status: 'active',
          items: [
            { type: 'user', id: 'official-user-1', text: '帮我找一下OpenAI这两天的发布会的帖子或者视频。' },
            { type: 'assistant', id: 'assistant-a', text: '我已定位到这两天最相关的是 OpenAI 6 月 2 日。' },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'pending-client-user-1',
          status: 'active',
          items: [
            { type: 'user', id: 'client-user-1', text: '帮我找一下OpenAI这两天的发布会的帖子或者视频。' },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns).toEqual([
      {
        id: 'turn-official',
        status: 'active',
        items: [
          { type: 'user', id: 'official-user-1', text: '帮我找一下OpenAI这两天的发布会的帖子或者视频。' },
          { type: 'assistant', id: 'assistant-a', text: '我已定位到这两天最相关的是 OpenAI 6 月 2 日。' },
        ],
      },
    ])
  })

  it('drops unmatched pending turns while waiting for official app-server items', () => {
    const current = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'pending-client-user-1',
          status: 'active',
          items: [
            { type: 'user', id: 'client-user-1', text: '等官方真实 turn。' },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      inProgress: true,
      turns: [
        {
          id: 'turn-old',
          status: 'completed',
          items: [{ type: 'assistant', id: 'assistant-old', text: '上一轮' }],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns).toEqual([
      {
        id: 'turn-old',
        status: 'completed',
        items: [{ type: 'assistant', id: 'assistant-old', text: '上一轮' }],
      },
    ])
  })

  it('keeps repeated non-pending user turns distinct', () => {
    const incoming = detail('thread-a', {
      turns: [
        {
          id: 'turn-a',
          status: 'completed',
          items: [{ type: 'user', id: 'user-a', text: '继续' }],
        },
        {
          id: 'turn-b',
          status: 'completed',
          items: [{ type: 'user', id: 'user-b', text: '继续' }],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(null, incoming)?.turns).toHaveLength(2)
  })

  it('keeps distinct official user items in the same turn distinct', () => {
    const current = detail('thread-a', {
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            { type: 'user', id: 'user-b', text: '继续分析' },
          ],
        },
      ],
    })
    const incoming = detail('thread-a', {
      turns: [
        {
          id: 'turn-a',
          status: 'active',
          items: [
            { type: 'user', id: 'user-a', text: '继续' },
          ],
        },
      ],
    })

    expect(mergeThreadDetailWithLiveItems(current, incoming)?.turns[0]?.items).toEqual([
      { type: 'user', id: 'user-a', text: '继续' },
      { type: 'user', id: 'user-b', text: '继续分析' },
    ])
  })
})
