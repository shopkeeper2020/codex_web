import { describe, expect, it } from 'vitest'
import {
  normalizeCollaborationModeListResponse,
  normalizeModelListResponse,
  normalizeRuntimeOptions,
} from './runtimeOptions.js'

describe('runtime options normalization', () => {
  it('normalizes official model/list responses into public model options', () => {
    const models = normalizeModelListResponse({
      data: [
        {
          id: 'model-a-id',
          model: 'model-a',
          displayName: 'Model A',
          description: 'fast path',
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: 'high',
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'Medium' },
            { reasoningEffort: 'high', description: 'High' },
          ],
          inputModalities: ['text', 'image'],
        },
        { id: 'hidden-id', model: 'hidden-model', hidden: true },
      ],
    })

    expect(models).toEqual([
      {
        id: 'model-a-id',
        model: 'model-a',
        displayName: 'Model A',
        description: 'fast path',
        isDefault: true,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: 'Medium' },
          { reasoningEffort: 'high', description: 'High' },
        ],
        inputModalities: ['text', 'image'],
      },
    ])
  })

  it('normalizes official collaboration modes and keeps plan settings', () => {
    const modes = normalizeCollaborationModeListResponse({
      data: [
        { name: 'Default', mode: 'default' },
        {
          name: 'Plan',
          mode: 'plan',
          model: 'model-a',
          reasoning_effort: 'medium',
          developer_instructions: 'plan first',
        },
      ],
    })

    expect(modes).toEqual([
      {
        name: 'Default',
        mode: 'default',
        model: null,
        reasoningEffort: null,
        developerInstructions: null,
      },
      {
        name: 'Plan',
        mode: 'plan',
        model: 'model-a',
        reasoningEffort: 'medium',
        developerInstructions: 'plan first',
      },
    ])
  })

  it('falls back when official runtime option responses are empty', () => {
    const options = normalizeRuntimeOptions({
      modelListResponse: { data: [] },
      collaborationModeListResponse: { data: [] },
      warnings: ['model/list failed'],
    })

    expect(options.source).toEqual({ models: 'fallback', collaborationModes: 'fallback' })
    expect(options.models[0]?.model).toBe('gpt-5.5')
    expect(options.collaborationModes.map((mode) => mode.mode)).toEqual(['default', 'plan'])
    expect(options.defaults).toMatchObject({
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      collaborationModeName: 'Default',
    })
    expect(options.warnings).toEqual(['model/list failed'])
  })

  it('uses the Desktop-aligned xhigh default when the official model supports it', () => {
    const options = normalizeRuntimeOptions({
      modelListResponse: {
        data: [
          {
            id: 'model-a-id',
            model: 'model-a',
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'medium', description: 'Medium' },
              { reasoningEffort: 'high', description: 'High' },
              { reasoningEffort: 'xhigh', description: 'Extra high' },
            ],
          },
        ],
      },
      collaborationModeListResponse: { data: [{ name: 'Default', mode: 'default' }] },
    })

    expect(options.defaults).toMatchObject({
      model: 'model-a',
      reasoningEffort: 'xhigh',
      collaborationModeName: 'Default',
    })
    expect(options.models[0]?.defaultReasoningEffort).toBe('medium')
  })
})
