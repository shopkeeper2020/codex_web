import { describe, expect, it } from 'vitest'
import { normalizeSkillsListResponse } from './skills.js'

describe('skills normalization', () => {
  it('normalizes skills/list responses into public skill options', () => {
    const result = normalizeSkillsListResponse({
      data: [
        {
          cwd: 'C:\\workspace\\codex_web',
          skills: [
            {
              name: 'docs',
              description: 'Write docs',
              shortDescription: 'Docs',
              path: 'C:\\Users\\example\\.codex\\skills\\docs\\SKILL.md',
              scope: 'user',
              enabled: true,
              interface: {
                displayName: 'Documentation',
                shortDescription: 'Better docs',
                brandColor: '#3366ff',
              },
            },
          ],
          errors: [],
        },
      ],
    })

    expect(result).toEqual({
      skills: [
        {
          id: 'docs::C:\\Users\\example\\.codex\\skills\\docs\\SKILL.md',
          name: 'docs',
          displayName: 'Documentation',
          description: 'Write docs',
          shortDescription: 'Better docs',
          path: 'C:\\Users\\example\\.codex\\skills\\docs\\SKILL.md',
          cwd: 'C:\\workspace\\codex_web',
          scope: 'user',
          enabled: true,
          brandColor: '#3366ff',
        },
      ],
      errors: [],
      source: 'app-server',
      warnings: [],
    })
  })

  it('keeps skill loading errors and falls back when empty', () => {
    const result = normalizeSkillsListResponse({
      data: [
        {
          cwd: 'E:\\missing',
          skills: [],
          errors: [{ message: 'bad metadata', path: 'E:\\missing\\SKILL.md' }],
        },
      ],
    })

    expect(result.source).toBe('app-server')
    expect(result.skills).toEqual([])
    expect(result.errors).toEqual([
      { cwd: 'E:\\missing', message: 'bad metadata', path: 'E:\\missing\\SKILL.md' },
    ])
  })
})
