import {
  normalizeOfficialConversationState,
  normalizeProjectPath,
  type ThreadDetail,
  type ThreadSideConversation,
  type Turn,
} from "@codex-web/domain";
import type { OfficialThreadStreamState } from "@codex-web/protocol";

const RECENT_SIDE_CONVERSATION_WINDOW_MS = 90 * 60 * 1000;
const FALLBACK_SIDE_CONVERSATION_GROUP_MS = 35 * 60 * 1000;
const RECENT_SIDE_CONVERSATION_CACHE_WINDOW = 1_500;
const MAX_SIDE_CONVERSATIONS = 8;

type SideCandidate = {
  detail: ThreadDetail;
  explicitTitle: string;
  firstUserText: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  streamUpdatedAtMs: number | null;
  state: OfficialThreadStreamState;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoFromTimestampMs(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function canonicalPath(value: unknown): string {
  const path = readString(value);
  return path ? normalizeProjectPath(path).toLowerCase() : "";
}

function sideConversationRecord(
  state: OfficialThreadStreamState,
): Record<string, unknown> | null {
  const record = asRecord(state.conversationState);
  return record?.sideConversation === true ? record : null;
}

function firstUserText(turns: Turn[]): string {
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "user") continue;
      const text = item.text.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
  }
  return "";
}

function titleFromText(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return "";
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

function fallbackSideTitle(index: number): string {
  return index === 0 ? "侧边聊天" : `侧边聊天 ${index + 1}`;
}

function isSameConversationContext(
  mainState: OfficialThreadStreamState | null,
  mainRecord: Record<string, unknown> | null,
  sideState: OfficialThreadStreamState,
  sideRecord: Record<string, unknown>,
  detail: ThreadDetail,
): boolean {
  const mainCwd =
    canonicalPath(mainRecord?.cwd) ||
    canonicalPath(detail.thread.path) ||
    canonicalPath(detail.thread.projectId);
  const sideCwd = canonicalPath(sideRecord.cwd);
  if (mainCwd && sideCwd && mainCwd !== sideCwd) return false;

  const mainSource = readString(mainRecord?.source);
  const sideSource = readString(sideRecord.source);
  if (mainSource && sideSource && mainSource !== sideSource) return false;

  if (mainState?.hostId && sideState.hostId && mainState.hostId !== sideState.hostId) {
    return false;
  }

  return true;
}

function buildSideCandidate(
  state: OfficialThreadStreamState,
): SideCandidate | null {
  const record = sideConversationRecord(state);
  if (!record) return null;
  const detail = normalizeOfficialConversationState({
    threadId: state.threadId,
    ownerClientId: state.ownerClientId,
    cacheVersion: state.cacheVersion,
    updatedAtIso: state.updatedAtIso,
    isInProgress: state.isInProgress,
    activeTurnId: state.activeTurnId,
    conversationState: state.conversationState,
  });
  if (!detail) return null;
  return {
    detail,
    explicitTitle:
      readString(record.title) ||
      readString(record.name) ||
      readString(record.preview),
    firstUserText: firstUserText(detail.turns),
    createdAtMs: readTimestampMs(record.createdAt),
    updatedAtMs: readTimestampMs(record.updatedAt),
    streamUpdatedAtMs: readTimestampMs(state.updatedAtIso),
    state,
  };
}

function isRecentForMainThread(
  candidate: SideCandidate,
  mainState: OfficialThreadStreamState | null,
): boolean {
  if (!mainState) return true;
  if (candidate.state.isInProgress) return true;

  const isEmptyUntitledSideConversation =
    !candidate.explicitTitle &&
    !candidate.firstUserText &&
    candidate.detail.turns.length === 0;
  const isNearMainCacheVersion =
    candidate.state.cacheVersion >=
    mainState.cacheVersion - RECENT_SIDE_CONVERSATION_CACHE_WINDOW;
  if (isEmptyUntitledSideConversation) return isNearMainCacheVersion;

  const mainUpdatedAtMs = readTimestampMs(mainState.updatedAtIso);
  const candidateUpdatedAtMs =
    candidate.streamUpdatedAtMs ?? candidate.updatedAtMs ?? candidate.createdAtMs;
  if (
    mainUpdatedAtMs !== null &&
    candidateUpdatedAtMs !== null &&
    candidateUpdatedAtMs >= mainUpdatedAtMs - RECENT_SIDE_CONVERSATION_WINDOW_MS
  ) {
    return true;
  }

  return isNearMainCacheVersion;
}

function selectSideCandidates(
  candidates: SideCandidate[],
  mainState: OfficialThreadStreamState | null,
): SideCandidate[] {
  const recentCandidates = candidates.filter((candidate) =>
    isRecentForMainThread(candidate, mainState),
  );
  if (recentCandidates.length > 0) return recentCandidates;

  const newestUpdatedAt = Math.max(
    ...candidates.map(
      (candidate) =>
        candidate.streamUpdatedAtMs ?? candidate.updatedAtMs ?? candidate.createdAtMs ?? 0,
    ),
  );
  return candidates.filter((candidate) => {
    const updatedAt =
      candidate.streamUpdatedAtMs ?? candidate.updatedAtMs ?? candidate.createdAtMs ?? 0;
    return updatedAt >= newestUpdatedAt - FALLBACK_SIDE_CONVERSATION_GROUP_MS;
  });
}

export function attachOfficialSideConversations(input: {
  detail: ThreadDetail | null;
  threadId: string;
  streamStates: OfficialThreadStreamState[];
}): ThreadDetail | null {
  if (!input.detail) return input.detail;
  const mainState =
    input.streamStates.find((state) => state.threadId === input.threadId) ??
    null;
  const mainRecord = asRecord(mainState?.conversationState);
  if (mainRecord?.sideConversation === true) {
    return { ...input.detail, sideConversations: [] };
  }

  const candidates = input.streamStates
    .filter((state) => state.threadId !== input.threadId)
    .map((state) => {
      const record = sideConversationRecord(state);
      if (!record) return null;
      if (
        !isSameConversationContext(
          mainState,
          mainRecord,
          state,
          record,
          input.detail as ThreadDetail,
        )
      ) {
        return null;
      }
      return buildSideCandidate(state);
    })
    .filter((candidate): candidate is SideCandidate => Boolean(candidate));

  const sideConversations = selectSideCandidates(candidates, mainState)
    .sort((left, right) => {
      const leftHasTitle = left.explicitTitle || left.firstUserText ? 1 : 0;
      const rightHasTitle = right.explicitTitle || right.firstUserText ? 1 : 0;
      if (leftHasTitle !== rightHasTitle) return rightHasTitle - leftHasTitle;
      return (
        (right.streamUpdatedAtMs ?? right.updatedAtMs ?? right.createdAtMs ?? 0) -
        (left.streamUpdatedAtMs ?? left.updatedAtMs ?? left.createdAtMs ?? 0)
      );
    })
    .slice(0, MAX_SIDE_CONVERSATIONS)
    .map((candidate, index): ThreadSideConversation => {
      const record = sideConversationRecord(candidate.state);
      const title =
        titleFromText(candidate.explicitTitle) ||
        titleFromText(candidate.firstUserText) ||
        fallbackSideTitle(index);
      return {
        id: candidate.state.threadId,
        title,
        createdAtIso: isoFromTimestampMs(candidate.createdAtMs),
        updatedAtIso:
          isoFromTimestampMs(candidate.updatedAtMs) ??
          candidate.state.updatedAtIso ??
          null,
        inProgress: candidate.state.isInProgress || candidate.detail.thread.inProgress,
        hasUnread: readBoolean(record?.hasUnreadTurn),
        turnCount: candidate.detail.turns.length,
        turns: candidate.detail.turns,
      };
    });

  return {
    ...input.detail,
    sideConversations,
  };
}
