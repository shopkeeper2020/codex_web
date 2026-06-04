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
  'images',
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function itemDedupeSignature(item: MessageItem): string {
  switch (item.type) {
    case 'assistant':
    case 'reasoning':
    case 'toolOutput':
    case 'plan':
      return `${item.type}:${normalizeText(item.text)}`
    case 'command':
      return [
        item.type,
        item.command,
        item.output,
        item.stdout,
        item.stderr,
      ].map(normalizeText).join(':')
    case 'fileChange':
      return `${item.type}:${normalizeText(item.path)}:${normalizeText(item.diff)}`
    default:
      return ''
  }
}

function userDedupeSignature(item: MessageItem): string {
  return item.type === 'user' ? normalizeText(item.text) : ''
}

function duplicateUserItemIndex(item: MessageItem, items: MessageItem[]): number {
  const signature = userDedupeSignature(item)
  if (!signature) return -1
  return items.findIndex((candidate) => {
    if (candidate.type !== 'user') return false
    if (candidate.id === item.id) return true
    return userDedupeSignature(candidate) === signature
  })
}

function duplicateOutputItemIndex(item: MessageItem, items: MessageItem[]): number {
  if (item.type === 'user') return -1
  const signature = itemDedupeSignature(item)
  if (!signature) return -1
  return items.findIndex((candidate) => {
    if (candidate.id === item.id) return true
    if (candidate.type !== item.type) return false
    return itemDedupeSignature(candidate) === signature
  })
}

function isDuplicateOutputItem(item: MessageItem, items: MessageItem[]): boolean {
  return duplicateOutputItemIndex(item, items) >= 0
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

function itemsById(items: MessageItem[]): Map<string, MessageItem> {
  const map = new Map<string, MessageItem>()
  for (const item of items) {
    if (item.id) map.set(item.id, item)
  }
  return map
}

function mergedAnchorIndexForCurrentItem(
  item: MessageItem,
  merged: MessageItem[],
): number {
  if (item.id) {
    const idIndex = merged.findIndex((candidate) => candidate.id === item.id)
    if (idIndex >= 0) return idIndex
  }
  const duplicateUserIndex = duplicateUserItemIndex(item, merged)
  if (duplicateUserIndex >= 0) return duplicateUserIndex
  return duplicateOutputItemIndex(item, merged)
}

function currentItemInsertionIndex(
  currentIndex: number,
  currentItems: MessageItem[],
  merged: MessageItem[],
): number {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const anchorIndex = mergedAnchorIndexForCurrentItem(currentItems[index]!, merged)
    if (anchorIndex >= 0) return anchorIndex + 1
  }
  for (let index = currentIndex + 1; index < currentItems.length; index += 1) {
    const anchorIndex = mergedAnchorIndexForCurrentItem(currentItems[index]!, merged)
    if (anchorIndex >= 0) return anchorIndex
  }
  return merged.length
}

function mergeTurnItems(incomingTurn: Turn, currentTurn: Turn): MessageItem[] {
  const incomingById = itemsById(incomingTurn.items)
  const currentById = itemsById(currentTurn.items)
  const usedCurrentIds = new Set<string>()

  const merged = incomingTurn.items.map((incomingItem) => {
    const currentItem = incomingItem.id ? currentById.get(incomingItem.id) : null
    if (!currentItem) return incomingItem
    usedCurrentIds.add(currentItem.id)
    return mergeItemWithLiveData(incomingItem, currentItem)
  })

  for (let currentIndex = 0; currentIndex < currentTurn.items.length; currentIndex += 1) {
    const currentItem = currentTurn.items[currentIndex]!
    if (!currentItem.id || usedCurrentIds.has(currentItem.id)) continue
    if (incomingById.has(currentItem.id)) continue
    const duplicateUserIndex = duplicateUserItemIndex(currentItem, merged)
    if (duplicateUserIndex >= 0) {
      const duplicateUserItem = merged[duplicateUserIndex]
      if (duplicateUserItem) {
        merged[duplicateUserIndex] = mergeItemWithLiveData(
          duplicateUserItem,
          currentItem,
        )
      }
      continue
    }
    if (isDuplicateOutputItem(currentItem, merged)) continue
    merged.splice(
      currentItemInsertionIndex(currentIndex, currentTurn.items, merged),
      0,
      currentItem,
    )
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

function shouldCarryCurrentTurn(
  turn: Turn,
  preserveCurrentHistory: boolean,
): boolean {
  if (isPendingTurnId(turn.id)) return false
  return (
    turn.status === 'active' ||
    turn.items.some(isLiveOperationItem) ||
    (preserveCurrentHistory && turn.items.length > 0)
  )
}

function hasLiveCarryReason(turn: Turn): boolean {
  return turn.status === 'active' || turn.items.some(isLiveOperationItem)
}

function mergedTurnAnchorIndex(turn: Turn, mergedTurns: Turn[]): number {
  return mergedTurns.findIndex((candidate) => candidate.id === turn.id)
}

function currentTurnInsertionIndex(
  currentIndex: number,
  currentTurns: Turn[],
  mergedTurns: Turn[],
): number {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const anchorIndex = mergedTurnAnchorIndex(currentTurns[index]!, mergedTurns)
    if (anchorIndex >= 0) return anchorIndex + 1
  }
  for (let index = currentIndex + 1; index < currentTurns.length; index += 1) {
    const anchorIndex = mergedTurnAnchorIndex(currentTurns[index]!, mergedTurns)
    if (anchorIndex >= 0) return anchorIndex
  }
  return mergedTurns.length
}

function mergeTurnsWithLiveItems(
  incomingTurns: Turn[],
  currentTurns: Turn[],
  preserveCurrentHistory: boolean,
): Turn[] {
  const visibleIncomingTurns = incomingTurns.filter((turn) => !isPendingTurnId(turn.id))
  const currentById = new Map(currentTurns.map((turn) => [turn.id, turn]))
  const usedCurrentTurnIds = new Set<string>()
  let lastCommonCurrentIndex = -1
  const mergedTurns = visibleIncomingTurns.map((incomingTurn) => {
    const currentTurn = currentById.get(incomingTurn.id)
    if (!currentTurn) return incomingTurn
    usedCurrentTurnIds.add(currentTurn.id)
    const currentIndex = currentTurns.findIndex((turn) => turn.id === currentTurn.id)
    if (currentIndex > lastCommonCurrentIndex) lastCommonCurrentIndex = currentIndex
    return mergeTurnWithLiveItems(incomingTurn, currentTurn)
  })

  for (let currentIndex = 0; currentIndex < currentTurns.length; currentIndex += 1) {
    const currentTurn = currentTurns[currentIndex]!
    if (usedCurrentTurnIds.has(currentTurn.id)) continue
    if (!shouldCarryCurrentTurn(currentTurn, preserveCurrentHistory)) continue
    if (
      preserveCurrentHistory &&
      !hasLiveCarryReason(currentTurn) &&
      lastCommonCurrentIndex >= 0 &&
      currentIndex > lastCommonCurrentIndex
    ) {
      continue
    }
    mergedTurns.splice(
      currentTurnInsertionIndex(currentIndex, currentTurns, mergedTurns),
      0,
      currentTurn,
    )
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
    turns: mergeTurnsWithLiveItems(
      incomingDetail.turns,
      currentDetail.turns,
      incomingDetail.thread.inProgress || currentDetail.thread.inProgress,
    ),
  }
}
