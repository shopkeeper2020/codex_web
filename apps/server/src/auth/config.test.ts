import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRuntimeConfig, readLocalConfigFile } from '@codex-web/config'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeAuth, resetLanPassword } from './config.js'

const roots: string[] = []

function tempConfig() {
  const root = mkdtempSync(join(tmpdir(), 'codex-web-auth-'))
  roots.push(root)
  return loadRuntimeConfig(root)
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('AuthService session management', () => {
  it('lists sessions and can revoke by public session id', () => {
    const { service } = initializeAuth(tempConfig())
    const first = service.createSession({ ip: '192.168.1.2', userAgent: 'Edge' })
    service.createSession({ ip: '192.168.1.3', userAgent: 'Chrome' })

    const sessions = service.listSessions(first.token)
    expect(sessions).toHaveLength(2)
    expect(sessions.some((session) => session.current)).toBe(true)

    const other = sessions.find((session) => !session.current)
    expect(other).toBeDefined()
    expect(service.revokeSessionById(other?.id ?? '')).toBe(true)
    expect(service.listSessions(first.token)).toHaveLength(1)
  })

  it('revokes other sessions and all sessions', () => {
    const { service } = initializeAuth(tempConfig())
    const current = service.createSession({ ip: '192.168.1.2' })
    service.createSession({ ip: '192.168.1.3' })

    expect(service.revokeOtherSessions(current.token)).toBe(1)
    expect(service.listSessions(current.token)).toHaveLength(1)
    expect(service.revokeAllSessions()).toBe(1)
    expect(service.listSessions(current.token)).toHaveLength(0)
  })

  it('resets LAN password, rotates session secret, and clears sessions', () => {
    const config = tempConfig()
    const { service } = initializeAuth(config)
    service.createSession({ ip: '192.168.1.2' })
    const before = readLocalConfigFile(config.projectRoot).auth?.sessionSecret

    const result = resetLanPassword(config)
    const afterConfig = readLocalConfigFile(config.projectRoot)

    expect(result.password).toHaveLength(24)
    expect(afterConfig.auth?.passwordHash).toBeTruthy()
    expect(afterConfig.auth?.sessionSecret).toBeTruthy()
    expect(afterConfig.auth?.sessionSecret).not.toBe(before)
    expect(initializeAuth(loadRuntimeConfig(config.projectRoot)).service.listSessions(undefined)).toHaveLength(0)
  })
})
