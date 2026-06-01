import { describe, expect, it } from 'vitest'
import {
  mergeThreadListProjects,
  normalizeOfficialConversationState,
  normalizeOfficialThreadDetail,
  normalizeOfficialThreadList,
} from './index.js'

describe('domain normalization', () => {
  it('normalizes official thread/list into projects and threads', () => {
    const normalized = normalizeOfficialThreadList({
      data: [
        {
          id: 'thread-a',
          name: 'Build web shell',
          cwd: 'C:\\workspace\\codex_web',
          updatedAt: 1_779_998_000,
          status: { type: 'notLoaded' },
        },
        {
          id: 'thread-b',
          preview: 'Lowercase duplicate',
          cwd: 'c:\\workspace\\codex_web',
          updatedAt: '2026-05-29T00:00:00.000Z',
          status: { type: 'active' },
        },
      ],
      nextCursor: 'next',
      backwardsCursor: 'back',
    })

    expect(normalized.projects).toHaveLength(1)
    expect(normalized.projects[0]?.name).toBe('codex_web')
    expect(normalized.threads[0]).toMatchObject({
      id: 'thread-a',
      title: 'Build web shell',
      projectId: 'C:\\workspace\\codex_web',
      inProgress: false,
    })
    expect(normalized.threads[1]).toMatchObject({
      id: 'thread-b',
      title: 'Lowercase duplicate',
      projectId: 'C:\\workspace\\codex_web',
      inProgress: true,
    })
    expect(normalized.nextCursor).toBe('next')
    expect(normalized.backwardsCursor).toBe('back')
  })

  it('merges web favorite projects without duplicating official projects', () => {
    const normalized = normalizeOfficialThreadList({
      data: [
        {
          id: 'thread-a',
          name: 'Build web shell',
          cwd: 'C:\\workspace\\codex_web',
        },
      ],
    })

    const merged = mergeThreadListProjects(normalized, [
      'c:\\workspace\\codex_web\\',
      'C:\\workspace\\Local Agent',
    ])

    expect(merged.projects).toHaveLength(2)
    expect(merged.projects.map((project) => project.source)).toEqual(['official', 'web-favorite'])
    expect(merged.projects.find((project) => project.id === 'C:\\workspace\\codex_web')?.source).toBe('official')
    expect(merged.projects.find((project) => project.id === 'C:\\workspace\\Local Agent')).toMatchObject({
      name: 'Local Agent',
      source: 'web-favorite',
    })
  })

  it('normalizes app-server thread/read turns and message text', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-a',
      owner: { clientId: 'owner-a', kind: 'desktop', source: 'official-ipc' },
      thread: {
        id: 'thread-a',
        name: 'Demo',
        cwd: 'C:\\workspace\\codex_web',
        turns: [
          {
            id: 'turn-a',
            status: 'completed',
            items: [
              {
                type: 'userMessage',
                id: 'item-user',
                content: [{ type: 'text', text: 'hello' }],
              },
              {
                type: 'agentMessage',
                id: 'item-agent',
                text: 'world',
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.thread.owner?.clientId).toBe('owner-a')
    expect(normalized?.turns[0]?.items).toEqual([
      { type: 'user', id: 'item-user', text: 'hello' },
      { type: 'assistant', id: 'item-agent', text: 'world' },
    ])
  })

  it('drops sparse or null official turn item placeholders', () => {
    const sparseItems = [
      {
        type: 'userMessage',
        id: 'item-user',
        content: [{ type: 'text', text: 'hello' }],
      },
    ]
    sparseItems.length = 4
    sparseItems.push(null as never, undefined as never, {
      type: 'agentMessage',
      id: 'item-agent',
      text: 'world',
    } as never)

    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-sparse-items',
      owner: null,
      thread: {
        id: 'thread-sparse-items',
        turns: [
          {
            id: 'turn-sparse-items',
            items: sparseItems,
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items).toEqual([
      { type: 'user', id: 'item-user', text: 'hello' },
      { type: 'assistant', id: 'item-agent', text: 'world' },
    ])
  })

  it('normalizes explicit official subagent arrays without inventing missing agents', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-agents',
      owner: null,
      source: 'official-ipc',
      thread: {
        id: 'thread-agents',
        subAgents: [
          {
            id: 'agent-noether',
            name: 'Noether',
            role: 'explorer',
            status: { type: 'active' },
          },
          {
            agentId: 'agent-boole',
            agentNickname: 'Boole',
            agentRole: 'worker',
            state: 'completed',
          },
        ],
        turns: [],
      },
    })

    expect(normalized?.subAgents).toEqual([
      {
        id: 'agent-noether',
        name: 'Noether',
        role: 'explorer',
        status: 'active',
        source: 'official-ipc',
      },
      {
        id: 'agent-boole',
        name: 'Boole',
        role: 'worker',
        status: 'completed',
        source: 'official-ipc',
      },
    ])

    const withoutExplicitAgents = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-no-agents',
      owner: null,
      thread: {
        id: 'thread-no-agents',
        agentNickname: 'ParentAgent',
        agentRole: 'explorer',
        turns: [],
      },
    })
    expect(withoutExplicitAgents?.subAgents).toEqual([])
  })

  it('normalizes official collab agent tool-call states into subagents', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-collab-agents',
      owner: null,
      source: 'official-ipc',
      thread: {
        id: 'thread-collab-agents',
        turns: [
          {
            id: 'turn-active',
            items: [
              {
                type: 'collabAgentToolCall',
                id: 'call-spawn',
                tool: 'spawnAgent',
                status: 'completed',
                receiverThreadIds: ['00000000-0000-4000-8000-000000000001'],
                receiverThreads: [
                  {
                    threadId: '00000000-0000-4000-8000-000000000001',
                    thread: null,
                  },
                ],
                agentsStates: {
                  '00000000-0000-4000-8000-000000000001': {
                    status: 'pendingInit',
                    message: null,
                  },
                },
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.subAgents).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Agent 00000000',
        role: 'spawnAgent',
        status: 'pendingInit',
        source: 'official-ipc',
      },
    ])
  })

  it('normalizes steering user messages and official file change arrays', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-steer',
      owner: null,
      thread: {
        id: 'thread-steer',
        turns: [
          {
            id: 'turn-steer',
            items: [
              {
                type: 'steeringUserMessage',
                id: 'steer-user-a',
                input: [
                  { type: 'text', text: '这里是不是少了一部分东西？\n' },
                  { type: 'text', text: '<image>' },
                  { type: 'image', url: 'data:image/png;base64,one' },
                ],
                restoreMessage: {
                  text: '这里是不是少了一部分东西？',
                  context: {
                    imageAttachments: [
                      {
                        src: 'data:image/png;base64,two',
                        filename: 'image.png',
                        uploadStatus: 'idle',
                      },
                    ],
                  },
                },
              },
              {
                type: 'unknown',
                id: 'legacy-steer-user',
                rawType: 'steeringUserMessage',
                raw: {
                  type: 'steeringUserMessage',
                  id: 'raw-steer-user',
                  input: [
                    { type: 'text', text: '旧缓存里的引导消息\n' },
                  ],
                  imageAttachments: [
                    {
                      src: 'data:image/png;base64,legacy',
                      filename: 'legacy.png',
                    },
                  ],
                },
              },
              {
                type: 'fileChange',
                id: 'file-change-array',
                status: 'completed',
                changes: [
                  {
                    path: 'C:\\workspace\\codex_web\\docs\\implementation_status.md',
                    kind: { type: 'update', move_path: null },
                    diff: '@@\n+sentinel\n-old',
                  },
                  {
                    path: 'docs/mvp_gap_tracker.md',
                    kind: { type: 'create' },
                    diff: '@@\n+todo',
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items[0]).toMatchObject({
      type: 'user',
      id: 'steer-user-a',
      text: '这里是不是少了一部分东西？',
      images: [
        { url: 'data:image/png;base64,one', path: null },
        { url: 'data:image/png;base64,two', path: null, alt: 'image.png' },
      ],
    })
    expect(normalized?.turns[0]?.items[1]).toMatchObject({
      type: 'user',
      id: 'legacy-steer-user',
      text: '旧缓存里的引导消息',
      images: [
        { url: 'data:image/png;base64,legacy', path: null, alt: 'legacy.png' },
      ],
    })
    expect(normalized?.turns[0]?.items[2]).toEqual({
      type: 'fileChange',
      id: 'file-change-array',
      path: 'C:\\workspace\\codex_web\\docs\\implementation_status.md',
      diff: '@@\n+sentinel\n-old',
      status: 'completed',
      changes: [
        {
          path: 'C:\\workspace\\codex_web\\docs\\implementation_status.md',
          diff: '@@\n+sentinel\n-old',
          status: 'completed',
          kind: 'update',
        },
        {
          path: 'docs/mvp_gap_tracker.md',
          diff: '@@\n+todo',
          status: 'completed',
          kind: 'create',
        },
      ],
    })
  })

  it('marks the active turn from official IPC stream metadata', () => {
    const normalized = normalizeOfficialConversationState({
      threadId: 'thread-a',
      ownerClientId: 'owner-a',
      cacheVersion: 1,
      updatedAtIso: '2026-05-29T00:00:00.000Z',
      isInProgress: true,
      activeTurnId: 'turn-active',
      conversationState: {
        id: 'thread-a',
        name: 'Live thread',
        turns: [
          { id: 'turn-old', status: 'completed', items: [] },
          { id: 'turn-active', status: 'unknown', items: [] },
        ],
      },
    })

    expect(normalized?.thread.inProgress).toBe(true)
    expect(normalized?.turns[1]?.status).toBe('active')
  })

  it('normalizes official active status variants for running, editing, and thinking UI', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-active-status',
      owner: null,
      thread: {
        id: 'thread-active-status',
        name: 'Active status variants',
        status: 'in_progress',
        turns: [
          {
            id: 'turn-active-status',
            status: { type: 'running' },
            items: [
              {
                type: 'commandExecution',
                id: 'cmd-running',
                command: 'pnpm build',
                status: { type: 'running' },
                stdout: 'building',
                exitCode: null,
              },
              {
                type: 'fileChange',
                id: 'file-editing',
                status: { type: 'editing' },
                changes: [
                  {
                    path: 'docs/implementation_status.md',
                    diff: '@@\n+active edit',
                    status: { type: 'editing' },
                  },
                ],
              },
              {
                type: 'reasoning',
                id: 'thinking-now',
                state: { type: 'thinking' },
                text: 'checking active path',
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.thread.inProgress).toBe(true)
    expect(normalized?.turns[0]?.status).toBe('active')
    expect(normalized?.turns[0]?.items).toMatchObject([
      {
        type: 'command',
        id: 'cmd-running',
        status: 'running',
        exitCode: null,
      },
      {
        type: 'fileChange',
        id: 'file-editing',
        status: 'editing',
        changes: [{ status: 'editing' }],
      },
      {
        type: 'reasoning',
        id: 'thinking-now',
        status: 'thinking',
      },
    ])
  })

  it('normalizes richer official item types into first-class message items', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-rich',
      owner: null,
      thread: {
        id: 'thread-rich',
        turns: [
          {
            id: 'turn-rich',
            items: [
              {
                type: 'commandExecution',
                id: 'cmd-a',
                command: 'pnpm test',
                status: 'completed',
                cwd: 'C:\\workspace\\codex_web',
                durationMs: 1234,
                exitCode: 0,
                stdout: 'ok',
              },
              {
                type: 'plan',
                id: 'plan-a',
                steps: [
                  { text: 'Read code', status: 'completed' },
                  { text: 'Patch UI', status: 'pending' },
                ],
              },
              {
                type: 'todo-list',
                id: 'todo-a',
                plan: [
                  { step: 'Mirror Desktop progress', status: 'completed' },
                  { step: 'Keep commands grouped', status: 'pending' },
                ],
              },
              {
                type: 'commandApproval',
                id: 'approval-a',
                title: 'Run command?',
                command: 'pnpm build',
                cwd: 'C:\\workspace\\codex_web',
                reason: 'Need verification',
              },
              {
                type: 'image',
                id: 'image-a',
                url: 'http://127.0.0.1/image.png',
                mimeType: 'image/png',
                alt: 'screenshot',
              },
              {
                type: 'error',
                id: 'error-a',
                message: 'Something failed',
                code: 'E_TEST',
              },
              {
                type: 'mcpToolOutput',
                id: 'tool-a',
                name: 'filesystem',
                output: 'listed files',
                status: 'completed',
              },
              {
                type: 'webSearch',
                id: 'search-a',
                query: 'codex desktop ipc',
                results: [{ title: 'IPC notes', url: 'https://example.test' }],
                status: 'completed',
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items).toEqual([
      {
        type: 'command',
        id: 'cmd-a',
        command: 'pnpm test',
        status: 'completed',
        output: 'ok',
        stdout: 'ok',
        stderr: '',
        cwd: 'C:\\workspace\\codex_web',
        durationMs: 1234,
        exitCode: 0,
      },
      {
        type: 'plan',
        id: 'plan-a',
        text: '',
        steps: [
          { text: 'Read code', status: 'completed' },
          { text: 'Patch UI', status: 'pending' },
        ],
        status: null,
      },
      {
        type: 'plan',
        id: 'todo-a',
        text: '',
        steps: [
          { text: 'Mirror Desktop progress', status: 'completed' },
          { text: 'Keep commands grouped', status: 'pending' },
        ],
        status: null,
      },
      {
        type: 'approval',
        id: 'approval-a',
        kind: 'command',
        title: 'Run command?',
        body: '',
        status: null,
        command: 'pnpm build',
        cwd: 'C:\\workspace\\codex_web',
        reason: 'Need verification',
      },
      {
        type: 'image',
        id: 'image-a',
        image: {
          url: 'http://127.0.0.1/image.png',
          path: null,
          mimeType: 'image/png',
          alt: 'screenshot',
        },
      },
      {
        type: 'error',
        id: 'error-a',
        message: 'Something failed',
        code: 'E_TEST',
        detail: null,
      },
      {
        type: 'toolOutput',
        id: 'tool-a',
        title: 'filesystem',
        text: 'listed files',
        status: 'completed',
        rawType: 'mcpToolOutput',
      },
      {
        type: 'toolOutput',
        id: 'search-a',
        title: 'Web search: codex desktop ipc',
        text: '',
        status: 'completed',
        rawType: 'webSearch',
      },
    ])
  })
})
