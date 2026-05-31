type Source = 'app-server' | 'fallback'

export type RuntimeReasoningEffortOption = {
  reasoningEffort: string
  description: string
}

export type RuntimeModelOption = {
  id: string
  model: string
  displayName: string
  description: string
  isDefault: boolean
  defaultReasoningEffort: string
  supportedReasoningEfforts: RuntimeReasoningEffortOption[]
  inputModalities: string[]
}

export type RuntimeCollaborationModeOption = {
  name: string
  mode: 'default' | 'plan'
  model: string | null
  reasoningEffort: string | null
  developerInstructions: string | null
}

export type RuntimeOptions = {
  models: RuntimeModelOption[]
  collaborationModes: RuntimeCollaborationModeOption[]
  defaults: {
    model: string
    reasoningEffort: string
    collaborationModeName: string
  }
  source: {
    models: Source
    collaborationModes: Source
  }
  warnings: string[]
}

export type RuntimeOptionResponses = {
  modelListResponse?: unknown
  collaborationModeListResponse?: unknown
  warnings?: string[]
}

const FALLBACK_REASONING_EFFORTS: RuntimeReasoningEffortOption[] = [
  { reasoningEffort: 'medium', description: 'Medium' },
  { reasoningEffort: 'high', description: 'High' },
  { reasoningEffort: 'xhigh', description: 'Extra high' },
]

const FALLBACK_MODELS: RuntimeModelOption[] = [
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: 'Default Codex model fallback.',
    isDefault: true,
    defaultReasoningEffort: 'xhigh',
    supportedReasoningEfforts: FALLBACK_REASONING_EFFORTS,
    inputModalities: ['text', 'image'],
  },
  {
    id: 'gpt-5',
    model: 'gpt-5',
    displayName: 'GPT-5',
    description: 'Compatible Codex model fallback.',
    isDefault: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: FALLBACK_REASONING_EFFORTS,
    inputModalities: ['text', 'image'],
  },
]

const FALLBACK_COLLABORATION_MODES: RuntimeCollaborationModeOption[] = [
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
    model: null,
    reasoningEffort: null,
    developerInstructions: null,
  },
]
const FALLBACK_MODEL = FALLBACK_MODELS[0] as RuntimeModelOption
const FALLBACK_COLLABORATION_MODE = FALLBACK_COLLABORATION_MODES[0] as RuntimeCollaborationModeOption
const PREFERRED_DEFAULT_REASONING_EFFORT = 'xhigh'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter(Boolean)
    : []
}

function readDataArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return Array.isArray(record?.data) ? record.data : []
}

function dedupeReasoningEfforts(options: RuntimeReasoningEffortOption[]): RuntimeReasoningEffortOption[] {
  const seen = new Set<string>()
  return options.filter((option) => {
    if (!option.reasoningEffort || seen.has(option.reasoningEffort)) return false
    seen.add(option.reasoningEffort)
    return true
  })
}

function normalizeReasoningEfforts(value: unknown): RuntimeReasoningEffortOption[] {
  const options = Array.isArray(value)
    ? value.flatMap((entry) => {
        if (typeof entry === 'string') {
          const reasoningEffort = readString(entry)
          return reasoningEffort ? [{ reasoningEffort, description: reasoningEffort }] : []
        }
        const record = asRecord(entry)
        if (!record) return []
        const reasoningEffort = readString(record.reasoningEffort) || readString(record.reasoning_effort)
        if (!reasoningEffort) return []
        return [
          {
            reasoningEffort,
            description: readString(record.description) || reasoningEffort,
          },
        ]
      })
    : []
  return dedupeReasoningEfforts(options)
}

function selectDefaultReasoningEffort(model: RuntimeModelOption): string {
  const supported = model.supportedReasoningEfforts.map((option) => option.reasoningEffort)
  if (supported.includes(PREFERRED_DEFAULT_REASONING_EFFORT)) return PREFERRED_DEFAULT_REASONING_EFFORT
  if (model.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort
  }
  return supported[0] ?? model.defaultReasoningEffort ?? PREFERRED_DEFAULT_REASONING_EFFORT
}

export function normalizeModelListResponse(value: unknown): RuntimeModelOption[] {
  return readDataArray(value)
    .flatMap((entry) => {
      const record = asRecord(entry)
      if (!record) return []
      if (readBoolean(record.hidden) === true) return []

      const model = readString(record.model) || readString(record.id)
      const id = readString(record.id) || model
      if (!id || !model) return []

      const supportedReasoningEfforts =
        normalizeReasoningEfforts(record.supportedReasoningEfforts ?? record.supported_reasoning_efforts)
      const defaultReasoningEffort =
        readString(record.defaultReasoningEffort) ||
        readString(record.default_reasoning_effort) ||
        supportedReasoningEfforts[0]?.reasoningEffort ||
        'xhigh'

      return [
        {
          id,
          model,
          displayName: readString(record.displayName) || readString(record.display_name) || model,
          description: readString(record.description),
          isDefault: readBoolean(record.isDefault) ?? readBoolean(record.is_default) ?? false,
          defaultReasoningEffort,
          supportedReasoningEfforts: supportedReasoningEfforts.length
            ? supportedReasoningEfforts
            : [{ reasoningEffort: defaultReasoningEffort, description: defaultReasoningEffort }],
          inputModalities: readStringArray(record.inputModalities ?? record.input_modalities),
        },
      ]
    })
}

export function normalizeCollaborationModeListResponse(value: unknown): RuntimeCollaborationModeOption[] {
  return readDataArray(value)
    .flatMap((entry) => {
      const record = asRecord(entry)
      if (!record) return []
      const name = readString(record.name)
      if (!name) return []

      const rawMode = readString(record.mode)
      const mode = rawMode === 'plan' ? 'plan' : 'default'

      return [
        {
          name,
          mode,
          model: readString(record.model) || null,
          reasoningEffort: readString(record.reasoning_effort) || readString(record.reasoningEffort) || null,
          developerInstructions:
            readNullableString(record.developer_instructions) ?? readNullableString(record.developerInstructions),
        },
      ]
    })
}

export function normalizeRuntimeOptions(input: RuntimeOptionResponses): RuntimeOptions {
  const normalizedModels = normalizeModelListResponse(input.modelListResponse)
  const normalizedModes = normalizeCollaborationModeListResponse(input.collaborationModeListResponse)
  const models = normalizedModels.length ? normalizedModels : FALLBACK_MODELS
  const collaborationModes = normalizedModes.length ? normalizedModes : FALLBACK_COLLABORATION_MODES
  const defaultModel = models.find((model) => model.isDefault) ?? models[0] ?? FALLBACK_MODEL
  const defaultMode =
    collaborationModes.find((mode) => mode.mode === 'default') ?? collaborationModes[0] ?? FALLBACK_COLLABORATION_MODE

  return {
    models,
    collaborationModes,
    defaults: {
      model: defaultModel.model,
      reasoningEffort: selectDefaultReasoningEffort(defaultModel),
      collaborationModeName: defaultMode.name,
    },
    source: {
      models: normalizedModels.length ? 'app-server' : 'fallback',
      collaborationModes: normalizedModes.length ? 'app-server' : 'fallback',
    },
    warnings: input.warnings ?? [],
  }
}
