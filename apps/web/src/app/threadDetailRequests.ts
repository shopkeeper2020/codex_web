export type ThreadDetailRequestState = {
  activeRequestId: number
  activeThreadId: string
}

export type ThreadDetailRequestToken = {
  requestId: number
  threadId: string
}

export const INITIAL_THREAD_DETAIL_REQUEST_STATE: ThreadDetailRequestState = {
  activeRequestId: 0,
  activeThreadId: '',
}

export function beginThreadDetailRequest(
  current: ThreadDetailRequestState,
  threadId: string,
): { state: ThreadDetailRequestState; token: ThreadDetailRequestToken } {
  const requestId = current.activeRequestId + 1
  const normalizedThreadId = threadId.trim()
  return {
    state: {
      activeRequestId: requestId,
      activeThreadId: normalizedThreadId,
    },
    token: {
      requestId,
      threadId: normalizedThreadId,
    },
  }
}

export function shouldApplyThreadDetailResponse(
  current: ThreadDetailRequestState,
  token: ThreadDetailRequestToken,
): boolean {
  return current.activeRequestId === token.requestId && current.activeThreadId === token.threadId
}
