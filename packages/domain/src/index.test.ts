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
          gitInfo: { sha: 'abcdef1234567890', branch: 'main', originUrl: null },
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
      gitInfo: { sha: 'abcdef1234567890', branch: 'main', originUrl: null },
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

  it('prefers Desktop saved workspace roots for the visible project menu', () => {
    const normalized = normalizeOfficialThreadList({
      data: [
        {
          id: 'thread-a',
          name: 'Build web shell',
          cwd: 'C:\\workspace\\codex_web',
        },
        {
          id: 'thread-old',
          name: 'Old project',
          cwd: 'C:\\Users\\lwm\\Documents\\Codex\\2026-04-18-python',
        },
      ],
    })

    const merged = mergeThreadListProjects(
      normalized,
      [],
      [
        'C:\\workspace\\codex_web',
        'C:\\workspace\\mcp_server',
        'C:\\workspace\\Local Agent',
      ],
    )

    expect(merged.projects.map((project) => project.name)).toEqual([
      'codex_web',
      'mcp_server',
      'Local Agent',
    ])
    expect(merged.projects.map((project) => project.source)).toEqual([
      'desktop-workspace',
      'desktop-workspace',
      'desktop-workspace',
    ])
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
    expect(normalized?.turns[0]?.items).toMatchObject([
      {
        type: 'userMessage',
        id: 'item-user',
        clientId: null,
        content: [{ type: 'text', text: 'hello' }],
      },
      {
        type: 'agentMessage',
        id: 'item-agent',
        text: 'world',
        phase: null,
        memoryCitation: null,
      },
    ])
  })

  it('preserves agent message phase, memory citations, and unknown official fields', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-agent-phase',
      owner: null,
      thread: {
        id: 'thread-agent-phase',
        turns: [
          {
            id: 'turn-agent-phase',
            items: [
              {
                type: 'agentMessage',
                id: 'item-final',
                text: 'final answer',
                phase: 'final_answer',
                memoryCitation: { source: 'memory-a' },
                traceToken: 'official-extra',
              },
              {
                type: 'agentMessage',
                id: 'item-unknown-phase',
                text: 'unknown phase',
                phase: 'diagnostic',
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items).toMatchObject([
      {
        type: 'agentMessage',
        id: 'item-final',
        text: 'final answer',
        phase: 'final_answer',
        memoryCitation: { source: 'memory-a' },
        traceToken: 'official-extra',
      },
      {
        type: 'agentMessage',
        id: 'item-unknown-phase',
        text: 'unknown phase',
        phase: null,
        memoryCitation: null,
      },
    ])
  })

  it('preserves future official thread items without wrapping their type', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-future-item',
      owner: null,
      thread: {
        id: 'thread-future-item',
        turns: [
          {
            id: 'turn-future-item',
            items: [
              {
                type: 'futureOfficialItem',
                id: 'future-a',
                text: 'future official payload',
                extraField: { stable: true },
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items[0]).toMatchObject({
      type: 'futureOfficialItem',
      id: 'future-a',
      text: 'future official payload',
      extraField: { stable: true },
    })
  })

  it('normalizes official fork source and turn timestamps', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-forked',
      owner: null,
      thread: {
        id: 'thread-forked',
        name: 'Forked',
        forkedFromId: 'thread-source',
        createdAt: '2026-06-04T04:01:00.000Z',
        turns: [
          {
            id: 'turn-a',
            status: 'completed',
            startedAt: '2026-06-04T03:59:00.000Z',
            completedAt: '2026-06-04T04:00:00.000Z',
            items: [{ type: 'agentMessage', id: 'item-agent', text: 'done' }],
          },
        ],
      },
    })

    expect(normalized?.derivedFromThreadId).toBe('thread-source')
    expect(normalized?.thread.createdAtIso).toBe('2026-06-04T04:01:00.000Z')
    expect(normalized?.turns[0]?.startedAtIso).toBe(
      '2026-06-04T03:59:00.000Z',
    )
    expect(normalized?.turns[0]?.completedAtIso).toBe(
      '2026-06-04T04:00:00.000Z',
    )
  })

  it('preserves assistant markdown whitespace from live snapshots', () => {
    const markdown = [
      '天气如下：',
      '',
      '| 日期 | 天气 |',
      '|---|---|',
      '| 6月3日 | 多云 |',
      '',
    ].join('\n')
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-markdown-live',
      owner: null,
      thread: {
        id: 'thread-markdown-live',
        turns: [
          {
            id: 'turn-live',
            status: 'active',
            items: [
              {
                type: 'agentMessage',
                id: 'item-agent',
                text: markdown,
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items).toMatchObject([
      {
        type: 'agentMessage',
        id: 'item-agent',
        text: markdown,
        phase: null,
        memoryCitation: null,
      },
    ])
  })

  it('merges pending user turn shadows into official live turns', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-pending-user',
      owner: null,
      thread: {
        id: 'thread-pending-user',
        turns: [
          {
            id: 'pending-client-user-1',
            status: 'inProgress',
            items: [
              {
                type: 'userMessage',
                id: 'client-user-1',
                content: [{ type: 'text', text: '再整理北京的。' }],
              },
            ],
          },
          {
            id: 'turn-official',
            status: 'inProgress',
            items: [
              {
                type: 'userMessage',
                id: 'official-user-1',
                content: [{ type: 'text', text: '再整理北京的。' }],
              },
              {
                type: 'agentMessage',
                id: 'assistant-1',
                text: '正在思考',
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns).toEqual([
      {
        id: 'turn-official',
        status: 'active',
        items: [
          {
            type: 'userMessage',
            id: 'official-user-1',
            clientId: null,
            content: [{ type: 'text', text: '再整理北京的。' }],
          },
          {
            type: 'agentMessage',
            id: 'assistant-1',
            text: '正在思考',
            phase: null,
            memoryCitation: null,
          },
        ],
      },
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

    expect(normalized?.turns[0]?.items).toMatchObject([
      {
        type: 'userMessage',
        id: 'item-user',
        clientId: null,
        content: [{ type: 'text', text: 'hello' }],
      },
      {
        type: 'agentMessage',
        id: 'item-agent',
        text: 'world',
        phase: null,
        memoryCitation: null,
      },
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
                prompt: [
                  '请协助查证 C:\\Users\\user\\Desktop\\日报\\_factcheck_work\\extracted_text 内以下文件。',
                  '1) 02_阿伦日报-2+3页（2016-2025）.txt',
                  '',
                  '任务：逐个主事件抽取主要事实声称，用网络资料核对。',
                ].join('\n'),
                model: 'gpt-5.5',
                reasoningEffort: 'xhigh',
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
    expect(normalized?.turns[0]?.items[0]).toMatchObject({
      type: 'collabAgentToolCall',
      id: 'call-spawn',
      status: 'completed',
      tool: 'spawnAgent',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      receiverThreadIds: ['00000000-0000-4000-8000-000000000001'],
    })
  })

  it('normalizes desktop textual agent generation messages into agent tasks', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-agent-text',
      owner: null,
      thread: {
        id: 'thread-agent-text',
        turns: [
          {
            id: 'turn-agent-text',
            status: 'active',
            items: [
              {
                type: 'agentMessage',
                id: 'item-agent-text',
                text: [
                  '正在生成1個智能體',
                  '正在生成',
                  '輸入：你是本倉庫的子 agent reviewer。',
                  '',
                  '工作目標：只審查本次改動，不要修改文件。',
                ].join('\n'),
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items[0]).toMatchObject({
      type: 'agentMessage',
      id: 'item-agent-text',
      phase: null,
      memoryCitation: null,
    })
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
                    futurePatchField: { kept: true },
                  },
                  {
                    path: 'docs/mvp_gap_tracker.md',
                    kind: { type: 'add' },
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
      type: 'userMessage',
      id: 'steer-user-a',
      intent: 'guidance',
      content: [{ type: 'text', text: '这里是不是少了一部分东西？', text_elements: [] }],
    })
    expect(normalized?.turns[0]?.items[1]).toMatchObject({
      type: 'userMessage',
      id: 'legacy-steer-user',
      intent: 'guidance',
      content: [{ type: 'text', text: '旧缓存里的引导消息', text_elements: [] }],
    })
    expect(normalized?.turns[0]?.items[2]).toEqual({
      type: 'fileChange',
      id: 'file-change-array',
      status: 'completed',
      changes: [
        {
          path: 'C:\\workspace\\codex_web\\docs\\implementation_status.md',
          diff: '@@\n+sentinel\n-old',
          futurePatchField: { kept: true },
          kind: { type: 'update', move_path: null },
        },
        {
          path: 'docs/mvp_gap_tracker.md',
          diff: '@@\n+todo',
          kind: { type: 'add' },
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
                aggregatedOutput: 'building',
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
        type: 'commandExecution',
        id: 'cmd-running',
        status: 'running',
        exitCode: null,
      },
      {
        type: 'fileChange',
        id: 'file-editing',
        status: 'editing',
        changes: [
          {
            path: 'docs/implementation_status.md',
            diff: '@@\n+active edit',
          },
        ],
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
                type: 'video',
                id: 'video-a',
                path: 'C:\\Users\\user\\Downloads\\result_joined_long_first.mp4',
                mimeType: 'video/mp4',
                alt: 'joined video',
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
                state: { type: 'futureWebSearchState' },
                futureSearchField: { kept: true },
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items).toMatchObject([
      {
        type: 'commandExecution',
        id: 'cmd-a',
        command: 'pnpm test',
        status: 'completed',
        aggregatedOutput: 'ok',
        cwd: 'C:\\workspace\\codex_web',
        processId: null,
        source: null,
        commandActions: [],
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
        type: 'image',
        id: 'video-a',
        image: {
          url: null,
          path: 'C:\\Users\\user\\Downloads\\result_joined_long_first.mp4',
          mimeType: 'video/mp4',
          alt: 'joined video',
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
        type: 'mcpToolCall',
        id: 'tool-a',
        server: 'filesystem',
        tool: 'mcpToolOutput',
        result: 'listed files',
        status: 'completed',
      },
      {
        type: 'webSearch',
        id: 'search-a',
        query: 'codex desktop ipc',
        state: { type: 'futureWebSearchState' },
        futureSearchField: { kept: true },
      },
    ])
    expect(normalized?.turns[0]?.items[0]).not.toHaveProperty('stdout')
    expect(normalized?.turns[0]?.items[0]).not.toHaveProperty('stderr')
    expect(normalized?.turns[0]?.items[8]).not.toHaveProperty('status')
  })

  it('keeps official commandExecution aggregatedOutput whitespace intact', () => {
    const normalized = normalizeOfficialThreadDetail({
      fallbackThreadId: 'thread-command-output',
      owner: null,
      thread: {
        id: 'thread-command-output',
        turns: [
          {
            id: 'turn-command-output',
            items: [
              {
                type: 'commandExecution',
                id: 'cmd-output',
                command: 'printf',
                status: 'completed',
                cwd: 'C:\\workspace\\codex_web',
                processId: null,
                source: 'agent',
                commandActions: [],
                aggregatedOutput: '  indented output\n\n',
                exitCode: 0,
                durationMs: 10,
              },
            ],
          },
        ],
      },
    })

    expect(normalized?.turns[0]?.items[0]).toMatchObject({
      type: 'commandExecution',
      id: 'cmd-output',
      aggregatedOutput: '  indented output\n\n',
    })
  })
})
