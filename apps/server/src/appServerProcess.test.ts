import { describe, expect, it } from 'vitest'
import { classifyAppServerStderrLine } from './appServerProcess.js'

describe('app-server process stderr classification', () => {
  it('classifies structured warning logs without treating them as errors', () => {
    expect(classifyAppServerStderrLine(JSON.stringify({
      timestamp: '2026-05-29T00:00:00.000Z',
      level: 'WARN',
      fields: { message: 'state db discrepancy during read repair' },
      target: 'codex_rollout::state_db',
    }))).toEqual({
      level: 'warning',
      message: 'state db discrepancy during read repair',
    })
  })

  it('classifies structured errors as errors', () => {
    expect(classifyAppServerStderrLine(JSON.stringify({
      level: 'ERROR',
      fields: { message: 'app-server failed' },
    }))).toEqual({
      level: 'error',
      message: 'app-server failed',
    })
  })

  it('ignores info logs and treats unknown stderr text as errors', () => {
    expect(classifyAppServerStderrLine(JSON.stringify({
      level: 'INFO',
      fields: { message: 'ready' },
    }))).toEqual({
      level: 'ignore',
      message: 'ready',
    })
    expect(classifyAppServerStderrLine('panic: boom')).toEqual({
      level: 'error',
      message: 'panic: boom',
    })
  })
})
