import { describe, expect, it } from 'vitest'
import {
  INITIAL_THREAD_DETAIL_REQUEST_STATE,
  beginThreadDetailRequest,
  shouldApplyThreadDetailResponse,
} from './threadDetailRequests'

describe('thread detail request ordering', () => {
  it('accepts only the latest request response for the active thread', () => {
    const first = beginThreadDetailRequest(INITIAL_THREAD_DETAIL_REQUEST_STATE, 'thread-a')
    const second = beginThreadDetailRequest(first.state, 'thread-a')

    expect(shouldApplyThreadDetailResponse(second.state, first.token)).toBe(false)
    expect(shouldApplyThreadDetailResponse(second.state, second.token)).toBe(true)
  })

  it('rejects a late response after the user switches threads', () => {
    const first = beginThreadDetailRequest(INITIAL_THREAD_DETAIL_REQUEST_STATE, 'thread-a')
    const second = beginThreadDetailRequest(first.state, 'thread-b')

    expect(shouldApplyThreadDetailResponse(second.state, first.token)).toBe(false)
    expect(shouldApplyThreadDetailResponse(second.state, second.token)).toBe(true)
  })
})
