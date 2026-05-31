import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export type SpawnInvocation = {
  command: string
  args: string[]
  shell: boolean
}

function findVsCodeExtensionCodex(): string {
  const userProfile = process.env.USERPROFILE || process.env.HOME || ''
  if (!userProfile) return ''

  const extensionRoots = [
    join(userProfile, '.vscode', 'extensions'),
    join(userProfile, '.vscode-insiders', 'extensions'),
  ]

  for (const extensionRoot of extensionRoots) {
    if (!existsSync(extensionRoot)) continue
    const extensionDirs = readdirSync(extensionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
      .map((entry) => entry.name)
      .sort()
      .reverse()

    for (const extensionDir of extensionDirs) {
      const candidate = join(extensionRoot, extensionDir, 'bin', 'windows-x86_64', 'codex.exe')
      if (existsSync(candidate)) return candidate
    }
  }

  return ''
}

function canExecute(command: string): boolean {
  try {
    accessSync(command, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveCodexCommand(): string {
  const explicit = process.env.CODEX_WEB_CODEX_COMMAND?.trim()
  if (explicit) return explicit

  const bundledVsCodeCodex = findVsCodeExtensionCodex()
  if (bundledVsCodeCodex) return bundledVsCodeCodex

  const candidates = [
    process.env.CODEXUI_CODEX_COMMAND?.trim(),
    'codex',
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (candidate === 'codex') return candidate
    if (canExecute(candidate)) return candidate
  }

  return 'codex'
}

export function getCodexSpawnInvocation(command: string, args: string[]): SpawnInvocation {
  if (process.platform !== 'win32') {
    return { command, args, shell: false }
  }

  if (isAbsolute(command) && command.toLowerCase().endsWith('.exe')) {
    return { command, args, shell: false }
  }

  return {
    command,
    args,
    shell: true,
  }
}
