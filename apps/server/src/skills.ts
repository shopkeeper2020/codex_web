export type SkillOption = {
  id: string
  name: string
  displayName: string
  description: string
  shortDescription: string
  path: string
  cwd: string
  scope: 'user' | 'repo' | 'system' | 'admin' | 'unknown'
  enabled: boolean
  brandColor: string | null
}

export type SkillList = {
  skills: SkillOption[]
  errors: Array<{ cwd: string; message: string; path: string | null }>
  source: 'app-server' | 'fallback'
  warnings: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readDataArray(value: unknown): unknown[] {
  const record = asRecord(value)
  return Array.isArray(record?.data) ? record.data : []
}

function readScope(value: unknown): SkillOption['scope'] {
  const scope = readString(value)
  return scope === 'user' || scope === 'repo' || scope === 'system' || scope === 'admin' ? scope : 'unknown'
}

function skillId(name: string, path: string): string {
  return `${name}::${path}`
}

export function normalizeSkillsListResponse(value: unknown, warnings: string[] = []): SkillList {
  const errors: SkillList['errors'] = []
  const skillsById = new Map<string, SkillOption>()

  for (const entry of readDataArray(value)) {
    const entryRecord = asRecord(entry)
    if (!entryRecord) continue
    const cwd = readString(entryRecord.cwd)

    if (Array.isArray(entryRecord.errors)) {
      for (const error of entryRecord.errors) {
        const errorRecord = asRecord(error)
        if (!errorRecord) continue
        errors.push({
          cwd,
          message: readString(errorRecord.message) || 'Skill load failed',
          path: readString(errorRecord.path) || null,
        })
      }
    }

    if (!Array.isArray(entryRecord.skills)) continue
    for (const skill of entryRecord.skills) {
      const skillRecord = asRecord(skill)
      if (!skillRecord) continue
      const name = readString(skillRecord.name)
      const path = readString(skillRecord.path)
      if (!name || !path) continue
      const interfaceRecord = asRecord(skillRecord.interface)
      const shortDescription =
        readString(interfaceRecord?.shortDescription) ||
        readString(interfaceRecord?.short_description) ||
        readString(skillRecord.shortDescription) ||
        readString(skillRecord.short_description)
      const option: SkillOption = {
        id: skillId(name, path),
        name,
        displayName: readString(interfaceRecord?.displayName) || readString(interfaceRecord?.display_name) || name,
        description: readString(skillRecord.description),
        shortDescription,
        path,
        cwd,
        scope: readScope(skillRecord.scope),
        enabled: readBoolean(skillRecord.enabled) ?? true,
        brandColor: readString(interfaceRecord?.brandColor) || readString(interfaceRecord?.brand_color) || null,
      }
      if (!skillsById.has(option.id)) skillsById.set(option.id, option)
    }
  }

  const skills = [...skillsById.values()].sort((a, b) => {
    const scopeCompare = a.scope.localeCompare(b.scope)
    return scopeCompare || a.displayName.localeCompare(b.displayName)
  })

  return {
    skills,
    errors,
    source: skills.length || errors.length ? 'app-server' : 'fallback',
    warnings,
  }
}
