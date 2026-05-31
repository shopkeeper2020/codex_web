import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

export const DEFAULT_SERVER_HOST = '0.0.0.0'
export const DEFAULT_SERVER_PORT = 18930
export const DEFAULT_WEB_DEV_PORT = 18931

const runtimeConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1).default(DEFAULT_SERVER_HOST),
    port: z.number().int().min(1).max(65535).default(DEFAULT_SERVER_PORT),
  }).default({ host: DEFAULT_SERVER_HOST, port: DEFAULT_SERVER_PORT }),
  dev: z.object({
    frontendPort: z.number().int().min(1).max(65535).default(DEFAULT_WEB_DEV_PORT),
  }).default({ frontendPort: DEFAULT_WEB_DEV_PORT }),
  ui: z.object({
    theme: z.enum(['light']).default('light'),
  }).default({ theme: 'light' }),
  diagnostics: z.object({
    rawFrameLogging: z.boolean().default(false),
  }).default({ rawFrameLogging: false }),
  dataDir: z.string().min(1).optional(),
})

const localConfigFileSchema = z.object({
  server: z.object({
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
  }).optional(),
  dev: z.object({
    frontendPort: z.number().int().min(1).max(65535).optional(),
  }).optional(),
  dataDir: z.string().min(1).optional(),
  auth: z.object({
    passwordHash: z.string().min(1).optional(),
    passwordGeneratedAtIso: z.string().min(1).optional(),
    passwordChangedAtIso: z.string().min(1).optional(),
    sessionSecret: z.string().min(32).optional(),
  }).optional(),
  ui: z.object({
    theme: z.enum(['light']).optional(),
  }).optional(),
  diagnostics: z.object({
    rawFrameLogging: z.boolean().optional(),
  }).optional(),
  projects: z.object({
    favorites: z.array(z.string().min(1)).optional(),
  }).optional(),
}).passthrough()

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema> & {
  projectRoot: string
  dataDir: string
  configPath: string
}

export type LocalConfigFile = z.infer<typeof localConfigFileSchema>

export function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

export function getLocalConfigPath(projectRoot: string): string {
  return resolve(resolve(projectRoot), 'data', 'config.local.json')
}

export function readLocalConfigFile(projectRoot: string): LocalConfigFile {
  const configPath = getLocalConfigPath(projectRoot)
  ensureDirectory(dirname(configPath))
  if (!existsSync(configPath)) return {}
  return localConfigFileSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')) as unknown)
}

export function writeLocalConfigFile(projectRoot: string, config: LocalConfigFile): void {
  const configPath = getLocalConfigPath(projectRoot)
  ensureDirectory(dirname(configPath))
  writeFileSync(configPath, `${JSON.stringify(localConfigFileSchema.parse(config), null, 2)}\n`, 'utf8')
}

export function updateLocalConfigFile(
  projectRoot: string,
  updater: (config: LocalConfigFile) => LocalConfigFile,
): LocalConfigFile {
  const next = updater(readLocalConfigFile(projectRoot))
  writeLocalConfigFile(projectRoot, next)
  return next
}

export function loadRuntimeConfig(projectRoot: string): RuntimeConfig {
  const normalizedProjectRoot = resolve(projectRoot)
  const defaultDataDir = resolve(normalizedProjectRoot, 'data')
  const configPath = getLocalConfigPath(normalizedProjectRoot)
  ensureDirectory(dirname(configPath))

  let raw: unknown = {}
  if (existsSync(configPath)) {
    raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
  }

  const parsed = runtimeConfigSchema.parse(raw)
  const dataDir = resolve(normalizedProjectRoot, parsed.dataDir ?? defaultDataDir)
  ensureDirectory(dataDir)
  ensureDirectory(resolve(dataDir, 'attachments'))
  ensureDirectory(resolve(dataDir, 'logs'))
  ensureDirectory(resolve(dataDir, 'tmp'))

  return {
    ...parsed,
    projectRoot: normalizedProjectRoot,
    dataDir,
    configPath,
  }
}
