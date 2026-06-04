import type { MessageItem, ThreadDetail, Turn } from '../api'

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

const RICH_ITEM_KEYS = [
  'text',
  'message',
  'content',
  'body',
  'detail',
  'output',
  'aggregatedOutput',
  'aggregated_output',
  'stdout',
  'stdoutText',
  'stderr',
  'stderrText',
  'diff',
  'patch',
  'command',
  'title',
  'path',
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function jsonValueScore(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (value === null || value === undefined) return 0
  try {
    return JSON.stringify(value).length
  } catch {
    return 1
  }
}

function richerValue(incomingValue: unknown, currentValue: unknown): unknown {
  if (incomingValue === undefined) return currentValue
  if (currentValue === undefined) return incomingValue
  return jsonValueScore(currentValue) > jsonValueScore(incomingValue)
    ? currentValue
    : incomingValue
}

function mergeItemWithLiveData(incomingItem: MessageItem, currentItem: MessageItem): MessageItem {
  const incomingRecord = asRecord(incomingItem)
  const currentRecord = asRecord(currentItem)
  if (!incomingRecord || !currentRecord) return incomingItem

  const merged: Record<string, unknown> = { ...currentRecord, ...incomingRecord }
  for (const key of RICH_ITEM_KEYS) {
    if (!(key in incomingRecord) && !(key in currentRecord)) continue
    merged[key] = richerValue(incomingRecord[key], currentRecord[key])
  }
  return merged as MessageItem
}

function isLiveOperationItem(item: MessageItem): boolean {
  return item.type === 'command' || item.type === 'fileChange' || item.type === 'toolOutput'
}

function isPendingTurnId(turnId: string): boolean {
  return turnId.startsWith('pending-')
}

function turnItemsScore(turn: Turn): number {
  const operationScore = turn.items.filter(isLiveOperationItem).length * 100_000
  const itemCountScore = turn.items.length * 1_000
  return operationScore + itemCountScore + jsonValueScore(turn.items)
}

function itemsById(items: MessageItem[]): Map<string, MessageItem> {
  const map = new Map<string, MessageItem>()
  for (const item of items) {
    if (item.id) map.set(item.id, item)
  }
  return map
}

function mergeTurnItems(incomingTurn: Turn, currentTurn: Turn): MessageItem[] {
  const incomingById = itemsById(incomingTurn.items)
  const currentById = itemsById(currentTurn.items)
  const preferCurrentOrder = turnItemsScore(currentTurn) > turnItemsScore(incomingTurn)
  const baseItems = preferCurrentOrder ? currentTurn.items : incomingTurn.items
  const otherItems = preferCurrentOrder ? incomingTurn.items : currentTurn.items
  const usedOtherIds = new Set<string>()

  const merged = baseItems.map((baseItem) => {
    const otherItem = baseItem.id ? (preferCurrentOrder ? incomingById.get(baseItem.id) : currentById.get(baseItem.id)) : null
    if (!otherItem) return baseItem
    usedOtherIds.add(otherItem.id)
    const incomingItem = incomingById.get(baseItem.id)
    const currentItem = currentById.get(baseItem.id)
    return incomingItem && currentItem
      ? mergeItemWithLiveData(incomingItem, currentItem)
      : baseItem
  })

  for (const otherItem of otherItems) {
    if (!otherItem.id || usedOtherIds.has(otherItem.id)) continue
    if (baseItems.some((baseItem) => baseItem.id === otherItem.id)) continue
    merged.push(otherItem)
  }
  return merged
}

function mergeTurnWithLiveItems(incomingTurn: Turn, currentTurn: Turn): Turn {
  return {
    ...currentTurn,
    ...incomingTurn,
    items: mergeTurnItems(incomingTurn, currentTurn),
  }
}

function shouldCarryCurrentTurn(turn: Turn): boolean {
  if (isPendingTurnId(turn.id)) return false
  return turn.status === 'active' || turn.items.some(isLiveOperationItem)
}

function mergeTurnsWithLiveItems(incomingTurns: Turn[], currentTurns: Turn[]): Turn[] {
  const visibleIncomingTurns = incomingTurns.filter((turn) => !isPendingTurnId(turn.id))
  const currentById = new Map(currentTurns.map((turn) => [turn.id, turn]))
  const usedCurrentTurnIds = new Set<string>()
  const mergedTurns = visibleIncomingTurns.map((incomingTurn) => {
    const currentTurn = currentById.get(incomingTurn.id)
    if (!currentTurn) return incomingTurn
    usedCurrentTurnIds.add(currentTurn.id)
    return mergeTurnWithLiveItems(incomingTurn, currentTurn)
  })

  for (const currentTurn of currentTurns) {
    if (usedCurrentTurnIds.has(currentTurn.id)) continue
    if (!shouldCarryCurrentTurn(currentTurn)) continue
    mergedTurns.push(currentTurn)
  }
  return mergedTurns
}

export function mergeThreadDetailWithLiveItems(
  currentDetail: ThreadDetail | null,
  incomingDetail: ThreadDetail | null,
): ThreadDetail | null {
  if (!incomingDetail) return incomingDetail
  if (!currentDetail || currentDetail.thread.id !== incomingDetail.thread.id) {
    return incomingDetail
  }

  return {
    ...incomingDetail,
    turns: mergeTurnsWithLiveItems(incomingDetail.turns, currentDetail.turns),
  }
}
