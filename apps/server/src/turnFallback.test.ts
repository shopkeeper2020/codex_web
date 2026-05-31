import { describe, expect, it } from 'vitest'
import { decideLocalTurnFallback } from './turnFallback.js'

function ipcState(input: { webOwned?: boolean; hasOfficialState?: boolean }) {
  return {
    isOwnedConversation: () => Boolean(input.webOwned),
    getThreadStreamState: () => (input.hasOfficialState ? { conversationId: 'thread-a' } : null),
  }
}

describe('local turn fallback decisions', () => {
  it('allows fallback when Web owns the conversation', () => {
    expect(decideLocalTurnFallback({
      action: 'steer',
      threadId: 'thread-a',
      errorMessage: 'no-official-owner',
      officialIpc: ipcState({ webOwned: true, hasOfficialState: true }),
    })).toEqual({ allow: true, reason: 'web-owned' })
  })

  it('blocks fallback for official-known conversations whose owner is unavailable', () => {
    expect(decideLocalTurnFallback({
      action: 'start',
      threadId: 'thread-a',
      errorMessage: 'no-client-found',
      officialIpc: ipcState({ hasOfficialState: true }),
    })).toMatchObject({
      allow: false,
      reason: 'official-owner-unavailable',
      statusCode: 409,
    })
  })

  it('treats generic follower request failures as an unavailable official owner', () => {
    expect(decideLocalTurnFallback({
      action: 'steer',
      threadId: 'thread-a',
      errorMessage: 'official-ipc-request-failed:thread-follower-steer-turn',
      officialIpc: ipcState({ hasOfficialState: true }),
    })).toEqual({
      allow: false,
      reason: 'official-owner-unavailable',
      statusCode: 409,
      error: 'official-owner-unavailable:official-ipc-request-failed:thread-follower-steer-turn',
    })
  })

  it('requires an official owner for generic follower request failures without cached official state', () => {
    expect(decideLocalTurnFallback({
      action: 'interrupt',
      threadId: 'thread-a',
      errorMessage: 'official-ipc-request-failed:thread-follower-interrupt-turn',
      officialIpc: ipcState({}),
    })).toEqual({
      allow: false,
      reason: 'official-owner-required',
      statusCode: 409,
      error: 'official-owner-required:official-ipc-request-failed:thread-follower-interrupt-turn',
    })
  })

  it('blocks local fallback for unknown owner state, including start requests', () => {
    expect(decideLocalTurnFallback({
      action: 'start',
      threadId: 'thread-a',
      errorMessage: 'official-ipc-not-connected',
      officialIpc: ipcState({}),
    })).toMatchObject({
      allow: false,
      reason: 'official-owner-required',
      statusCode: 503,
    })

    expect(decideLocalTurnFallback({
      action: 'interrupt',
      threadId: 'thread-a',
      errorMessage: 'official-ipc-not-connected',
      officialIpc: ipcState({}),
    })).toMatchObject({
      allow: false,
      reason: 'official-owner-required',
      statusCode: 503,
    })
  })
})
