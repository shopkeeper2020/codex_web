import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthService } from './config.js'
import {
  type AuthStatus,
  authLoginRequestSchema,
  authOkResponseSchema,
  authSessionRevokeRequestSchema,
  authSessionRevokeResponseSchema,
  authSessionsResponseSchema,
  authSessionsRevokeCountResponseSchema,
  authStatusResponseSchema,
  formatZodError,
} from '@codex-web/api'

const AUTH_ROUTES = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/logout'])

export function installAuth(app: FastifyInstance, auth: AuthService): void {
  app.addHook('onRequest', async (request, reply) => {
    if (isPublicPath(request.url)) return
    const status = readAuthStatus(request, auth)
    if (status.authenticated) return
    await sendAuthRequired(request, reply)
  })

  app.get('/api/auth/status', async (request) =>
    authStatusResponseSchema.parse({
      data: readAuthStatus(request, auth),
    }),
  )

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = authLoginRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) })
      return
    }
    const { password } = parsed.data
    if (!auth.verifyPassword(password)) {
      await reply.code(401).send({ error: 'Invalid password' })
      return
    }

    const session = auth.createSession({
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })
    reply.setCookie(auth.cookieName, session.token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      signed: true,
      maxAge: Math.floor(auth.sessionTtlMs / 1000),
    })
    await reply.send(
      authStatusResponseSchema.parse({
        data: {
          authenticated: true,
          localBypass: isLocalhostRequest(request),
          sessionExpiresAtIso: session.expiresAtIso,
        } satisfies AuthStatus,
      }),
    )
  })

  app.post('/api/auth/logout', async (request, reply) => {
    auth.revokeSession(readSignedSessionCookie(request, auth))
    reply.clearCookie(auth.cookieName, { path: '/' })
    await reply.send(authOkResponseSchema.parse({ data: { ok: true } }))
  })

  app.get('/api/auth/sessions', async (request) =>
    authSessionsResponseSchema.parse({
      data: auth.listSessions(readSignedSessionCookie(request, auth)),
    }),
  )

  app.post('/api/auth/sessions/revoke', async (request, reply) => {
    const parsed = authSessionRevokeRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) })
      return
    }
    const { sessionId } = parsed.data
    const revoked = auth.revokeSessionById(sessionId)
    await reply.send(authSessionRevokeResponseSchema.parse({ data: { ok: revoked } }))
  })

  app.post('/api/auth/sessions/revoke-others', async (request) =>
    authSessionsRevokeCountResponseSchema.parse({
      data: { revoked: auth.revokeOtherSessions(readSignedSessionCookie(request, auth)) },
    }),
  )

  app.post('/api/auth/sessions/revoke-all', async () =>
    authSessionsRevokeCountResponseSchema.parse({
      data: { revoked: auth.revokeAllSessions() },
    }),
  )
}

function readAuthStatus(request: FastifyRequest, auth: AuthService): AuthStatus {
  if (isLocalhostRequest(request)) {
    return {
      authenticated: true,
      localBypass: true,
      sessionExpiresAtIso: null,
    }
  }
  const session = auth.readSession(readSignedSessionCookie(request, auth), { ip: request.ip })
  return {
    authenticated: Boolean(session),
    localBypass: false,
    sessionExpiresAtIso: session?.expiresAtIso ?? null,
  }
}

function readSignedSessionCookie(request: FastifyRequest, auth: AuthService): string | undefined {
  const rawCookie = request.cookies[auth.cookieName]
  if (!rawCookie) return undefined
  const unsigned = request.unsignCookie(rawCookie)
  return unsigned.valid ? unsigned.value : undefined
}

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url
  return (
    path === '/health' ||
    path === '/api/health' ||
    AUTH_ROUTES.has(path) ||
    !path.startsWith('/api/')
  )
}

function isLocalhostRequest(request: FastifyRequest): boolean {
  const ip = normalizeIp(request.ip)
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost') return false
  const host = normalizeHostHeader(request.headers.host)
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length)
  return ip
}

function normalizeHostHeader(host: string | undefined): string {
  const value = (host ?? '').trim().toLowerCase()
  if (!value) return ''
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']')
    return closingBracket > 0 ? value.slice(1, closingBracket) : value
  }
  return value.split(':')[0] ?? value
}

async function sendAuthRequired(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.url.startsWith('/api/')) {
    await reply.code(401).send({ error: 'Authentication required' })
    return
  }
  await reply
    .code(401)
    .type('text/html; charset=utf-8')
    .send('<!doctype html><title>Authentication required</title><h1>Authentication required</h1>')
}
