import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import {
  ensureDirectory,
  readLocalConfigFile,
  updateLocalConfigFile,
  type LocalConfigFile,
  type RuntimeConfig,
} from '@codex-web/config'
import type { AuthStatus, AuthSession as PublicSessionRecord } from '@codex-web/api'
import { z } from 'zod'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PASSWORD_BYTES = 18
const SESSION_TOKEN_BYTES = 32
const SCRYPT_KEY_LENGTH = 64
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1

const sessionFileSchema = z.object({
  sessions: z.array(z.object({
    tokenHash: z.string().min(1),
    createdAtIso: z.string().min(1),
    expiresAtIso: z.string().min(1),
    lastSeenAtIso: z.string().min(1),
    lastIp: z.string().optional(),
    userAgent: z.string().optional(),
  })).default([]),
}).default({ sessions: [] })

type SessionRecord = z.infer<typeof sessionFileSchema>['sessions'][number]

export type AuthInitResult = {
  service: AuthService
  generatedPassword: string | null
}

export class AuthService {
  readonly cookieName = 'codex_web_session'
  readonly sessionTtlMs = SESSION_TTL_MS

  constructor(
    private readonly config: RuntimeConfig,
    readonly cookieSecret: string,
    private passwordHash: string,
  ) {}

  verifyPassword(password: string): boolean {
    if (!password) return false
    return verifyPasswordHash(password, this.passwordHash)
  }

  createSession(input: { ip?: string; userAgent?: string }): { token: string; expiresAtIso: string } {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
    const now = Date.now()
    const record: SessionRecord = {
      tokenHash: hashSessionToken(token),
      createdAtIso: new Date(now).toISOString(),
      expiresAtIso: new Date(now + SESSION_TTL_MS).toISOString(),
      lastSeenAtIso: new Date(now).toISOString(),
      lastIp: input.ip,
      userAgent: input.userAgent,
    }
    const store = this.readSessions()
    store.sessions = this.pruneSessions(store.sessions)
    store.sessions.push(record)
    this.writeSessions(store)
    return { token, expiresAtIso: record.expiresAtIso }
  }

  listSessions(currentToken: string | undefined): PublicSessionRecord[] {
    const currentHash = currentToken ? hashSessionToken(currentToken) : ''
    const store = this.readSessions()
    const sessions = this.pruneSessions(store.sessions)
    if (sessions.length !== store.sessions.length) this.writeSessions({ sessions })
    return sessions
      .map((entry) => ({
        id: sessionPublicId(entry.tokenHash),
        createdAtIso: entry.createdAtIso,
        expiresAtIso: entry.expiresAtIso,
        lastSeenAtIso: entry.lastSeenAtIso,
        lastIp: entry.lastIp ?? null,
        userAgent: entry.userAgent ?? null,
        current: Boolean(currentHash && entry.tokenHash === currentHash),
      }))
      .sort((a, b) => Date.parse(b.lastSeenAtIso) - Date.parse(a.lastSeenAtIso))
  }

  readSession(token: string | undefined, input: { ip?: string }): SessionRecord | null {
    if (!token) return null
    const tokenHash = hashSessionToken(token)
    const store = this.readSessions()
    let changed = false
    const sessions = this.pruneSessions(store.sessions)
    if (sessions.length !== store.sessions.length) changed = true
    const session = sessions.find((entry) => entry.tokenHash === tokenHash) ?? null
    if (session) {
      session.lastSeenAtIso = new Date().toISOString()
      session.lastIp = input.ip
      changed = true
    }
    if (changed) this.writeSessions({ sessions })
    return session
  }

  revokeSession(token: string | undefined): void {
    if (!token) return
    const tokenHash = hashSessionToken(token)
    const store = this.readSessions()
    const sessions = store.sessions.filter((entry) => entry.tokenHash !== tokenHash)
    if (sessions.length !== store.sessions.length) this.writeSessions({ sessions })
  }

  revokeSessionById(sessionId: string): boolean {
    if (!sessionId) return false
    const store = this.readSessions()
    const sessions = store.sessions.filter((entry) => sessionPublicId(entry.tokenHash) !== sessionId)
    if (sessions.length === store.sessions.length) return false
    this.writeSessions({ sessions })
    return true
  }

  revokeOtherSessions(currentToken: string | undefined): number {
    const currentHash = currentToken ? hashSessionToken(currentToken) : ''
    const store = this.readSessions()
    const sessions = currentHash
      ? store.sessions.filter((entry) => entry.tokenHash === currentHash)
      : []
    const revoked = store.sessions.length - sessions.length
    if (revoked > 0) this.writeSessions({ sessions })
    return revoked
  }

  revokeAllSessions(): number {
    const store = this.readSessions()
    if (store.sessions.length > 0) this.writeSessions({ sessions: [] })
    return store.sessions.length
  }

  updatePassword(password: string): void {
    this.passwordHash = hashPassword(password)
    updateLocalConfigFile(this.config.projectRoot, (current) => mergeAuthConfig(current, {
      passwordHash: this.passwordHash,
      passwordChangedAtIso: new Date().toISOString(),
      sessionSecret: current.auth?.sessionSecret ?? this.cookieSecret,
    }))
    this.revokeAllSessions()
  }

  private get sessionsPath(): string {
    return resolve(this.config.dataDir, 'auth.sessions.json')
  }

  private readSessions(): { sessions: SessionRecord[] } {
    if (!existsSync(this.sessionsPath)) return { sessions: [] }
    return sessionFileSchema.parse(JSON.parse(readFileSync(this.sessionsPath, 'utf8')) as unknown)
  }

  private writeSessions(store: { sessions: SessionRecord[] }): void {
    ensureDirectory(this.config.dataDir)
    writeFileSync(this.sessionsPath, `${JSON.stringify(sessionFileSchema.parse(store), null, 2)}\n`, 'utf8')
  }

  private pruneSessions(sessions: SessionRecord[]): SessionRecord[] {
    const now = Date.now()
    return sessions.filter((entry) => Date.parse(entry.expiresAtIso) > now)
  }
}

export function resetLanPassword(config: RuntimeConfig): { password: string; sessionSecret: string } {
  const password = randomBytes(PASSWORD_BYTES).toString('base64url')
  const sessionSecret = randomBytes(32).toString('base64url')
  updateLocalConfigFile(config.projectRoot, (current) => mergeAuthConfig(current, {
    passwordHash: hashPassword(password),
    passwordGeneratedAtIso: current.auth?.passwordGeneratedAtIso ?? new Date().toISOString(),
    passwordChangedAtIso: new Date().toISOString(),
    sessionSecret,
  }))
  const sessionsPath = resolve(config.dataDir, 'auth.sessions.json')
  rmSync(sessionsPath, { force: true })
  return { password, sessionSecret }
}

export function initializeAuth(config: RuntimeConfig): AuthInitResult {
  const localConfig = readLocalConfigFile(config.projectRoot)
  const passwordHash = localConfig.auth?.passwordHash
  const sessionSecret = localConfig.auth?.sessionSecret
  if (passwordHash && sessionSecret) {
    return { service: new AuthService(config, sessionSecret, passwordHash), generatedPassword: null }
  }

  const generatedPassword = passwordHash ? null : randomBytes(PASSWORD_BYTES).toString('base64url')
  const nextPasswordHash = passwordHash ?? hashPassword(generatedPassword ?? '')
  const nextSessionSecret = sessionSecret ?? randomBytes(32).toString('base64url')
  updateLocalConfigFile(config.projectRoot, (current) => mergeAuthConfig(current, {
    passwordHash: nextPasswordHash,
    passwordGeneratedAtIso: localConfig.auth?.passwordGeneratedAtIso ?? new Date().toISOString(),
    sessionSecret: nextSessionSecret,
  }))

  return {
    service: new AuthService(config, nextSessionSecret, nextPasswordHash),
    generatedPassword,
  }
}

function mergeAuthConfig(
  config: LocalConfigFile,
  auth: NonNullable<LocalConfigFile['auth']>,
): LocalConfigFile {
  return {
    ...config,
    auth: {
      ...config.auth,
      ...auth,
    },
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url')
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('base64url')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`
}

function verifyPasswordHash(password: string, encodedHash: string): boolean {
  const [algorithm, nRaw, rRaw, pRaw, salt, expectedHash] = encodedHash.split('$')
  if (algorithm !== 'scrypt' || !nRaw || !rRaw || !pRaw || !salt || !expectedHash) return false
  const expected = Buffer.from(expectedHash, 'base64url')
  const actual = scryptSync(password, salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
  })
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function sessionPublicId(tokenHash: string): string {
  return tokenHash.slice(0, 16)
}
