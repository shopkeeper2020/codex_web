import {
  normalizeOfficialConversationState,
  normalizeProjectPath,
  type ThreadDetail,
  type ThreadSideConversation,
  type Turn,
} from "@codex-web/domain";
import type { OfficialThreadStreamState } from "@codex-web/protocol";

const MAX_SIDE_CONVERSATIONS = 8;
const UNLINKED_SIDE_CONVERSATION_ACTIVE_GRACE_MS = 2 * 60 * 1000;
const UNLINKED_SIDE_CONVERSATION_MAX_STALE_MS = 12 * 60 * 60 * 1000;
const UNLINKED_SIDE_CONVERSATION_ACTIVE_SCORE_BONUS = 600;
const UNLINKED_SIDE_CONVERSATION_AGE_HOUR_PENALTY = 4;
const UNLINKED_SIDE_CONVERSATION_STALE_HOUR_PENALTY = 24;
const MIN_SIDE_PARENT_OVERLAP = 0.18;
const MIN_SIDE_PARENT_INTERSECTION = 8;
const SIDE_CONVERSATION_BOUNDARY_PREFIX = "Side conversation boundary.";

const SIDE_PARENT_ID_FIELDS = [
  "parentConversationId",
  "parentThreadId",
  "sourceConversationId",
  "sourceThreadId",
  "mainConversationId",
  "mainThreadId",
  "rootConversationId",
  "rootThreadId",
  "originConversationId",
  "originThreadId",
  "forkedFromId",
  "forkedFromConversationId",
  "forkedFromThreadId",
];

const SIDE_PARENT_RECORD_FIELDS = [
  "parentConversation",
  "parentThread",
  "sourceConversation",
  "sourceThread",
  "mainConversation",
  "mainThread",
  "rootConversation",
  "rootThread",
  "originConversation",
  "originThread",
  "forkedFrom",
];

type SideCandidate = {
  detail: ThreadDetail;
  record: Record<string, unknown>;
  explicitTitle: string;
  firstUserText: string;
  text: string;
  tokens: Set<string>;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  streamUpdatedAtMs: number | null;
  state: OfficialThreadStreamState;
};

type MainCandidate = {
  detail: ThreadDetail;
  record: Record<string, unknown>;
  text: string;
  tokens: Set<string>;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  streamUpdatedAtMs: number | null;
  state: OfficialThreadStreamState;
};

type ParentScore = {
  main: MainCandidate;
  score: number;
};

const GENERIC_CJK_BIGRAMS = new Set([
  "一个",
  "一下",
  "不会",
  "不能",
  "不是",
  "为了",
  "什么",
  "他们",
  "但是",
  "使用",
  "可以",
  "因为",
  "如果",
  "已经",
  "应该",
  "我们",
  "所以",
  "时候",
  "是否",
  "没有",
  "现在",
  "这个",
  "这里",
  "还是",
  "进行",
  "那个",
  "需要",
]);

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

function collectRecordIds(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) return [];
  return [
    readString(record.id),
    readString(record.threadId),
    readString(record.conversationId),
  ].filter(Boolean);
}

function explicitParentIds(record: Record<string, unknown>): string[] {
  const directIds = SIDE_PARENT_ID_FIELDS.map((field) =>
    readString(record[field]),
  ).filter(Boolean);
  const nestedIds = SIDE_PARENT_RECORD_FIELDS.flatMap((field) =>
    collectRecordIds(record[field]),
  );
  return [...new Set([...directIds, ...nestedIds])];
}

function mainConversationIds(
  threadId: string,
  mainState: OfficialThreadStreamState | null,
  mainRecord: Record<string, unknown> | null,
): Set<string> {
  return new Set(
    [
      threadId,
      readString(mainState?.threadId),
      readString(mainState?.conversationId),
      readString(mainRecord?.id),
      readString(mainRecord?.threadId),
      readString(mainRecord?.conversationId),
    ].filter(Boolean),
  );
}

function hasExplicitMainLink(
  threadId: string,
  mainState: OfficialThreadStreamState | null,
  mainRecord: Record<string, unknown> | null,
  sideRecord: Record<string, unknown>,
): boolean {
  const mainIds = mainConversationIds(threadId, mainState, mainRecord);
  if (mainIds.size === 0) return false;
  const parentIds = explicitParentIds(sideRecord);
  return parentIds.some((id) => mainIds.has(id));
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

function isSideConversationBoundaryItem(item: Turn["items"][number]): boolean {
  return item.type === "user" && item.text.trim().startsWith(SIDE_CONVERSATION_BOUNDARY_PREFIX);
}

function visibleSideConversationTurns(turns: Turn[]): Turn[] {
  return turns.flatMap((turn) => {
    const items = turn.items.filter((item) => !isSideConversationBoundaryItem(item));
    return items.length > 0 ? [{ ...turn, items }] : [];
  });
}

function titleFromText(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return "";
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

function fallbackSideTitle(index: number): string {
  return index === 0 ? "侧边聊天" : `侧边聊天 ${index + 1}`;
}

function turnItemText(item: Turn["items"][number]): string {
  switch (item.type) {
    case "user":
    case "assistant":
    case "reasoning":
    case "toolOutput":
      return item.text;
    case "error":
      return item.message;
    case "plan":
      return item.steps.map((step) => step.text).join("\n");
    default:
      return "";
  }
}

function detailText(detail: ThreadDetail, explicitTitle = ""): string {
  const title =
    explicitTitle ||
    (detail.thread.title === "Untitled" ? "" : detail.thread.title);
  const itemTexts = detail.turns
    .flatMap((turn) => turn.items.map(turnItemText))
    .filter(Boolean);
  return [title, ...itemTexts].filter(Boolean).join("\n");
}

function contentTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []) {
    if (/^\d+$/.test(word)) continue;
    tokens.add(word);
  }

  const compact = text
    .toLowerCase()
    .replace(/[^\p{Script=Han}]+/gu, "");
  const chars = Array.from(compact);
  for (let index = 0; index < chars.length - 1; index += 1) {
    const token = `${chars[index]}${chars[index + 1]}`;
    if (!GENERIC_CJK_BIGRAMS.has(token)) tokens.add(token);
  }
  return tokens;
}

function contentSimilarity(
  leftTokens: Set<string>,
  rightTokens: Set<string>,
): {
  intersectionCount: number;
  overlapCoefficient: number;
  jaccard: number;
} {
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return { intersectionCount: 0, overlapCoefficient: 0, jaccard: 0 };
  }
  let intersectionCount = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersectionCount += 1;
  }
  return {
    intersectionCount,
    overlapCoefficient:
      intersectionCount / Math.min(leftTokens.size, rightTokens.size),
    jaccard:
      intersectionCount /
      (leftTokens.size + rightTokens.size - intersectionCount),
  };
}

function hasMeaningfulSideContent(candidate: SideCandidate): boolean {
  return (
    candidate.detail.thread.inProgress ||
    candidate.state.isInProgress ||
    candidate.detail.turns.some((turn) => turn.items.length > 0)
  );
}

function hasMeaningfulParentSimilarity(input: {
  intersectionCount: number;
  overlapCoefficient: number;
  jaccard: number;
}): boolean {
  return (
    (input.intersectionCount >= MIN_SIDE_PARENT_INTERSECTION &&
      input.overlapCoefficient >= MIN_SIDE_PARENT_OVERLAP) ||
    (input.intersectionCount >= 20 && input.jaccard >= 0.015)
  );
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

function scoreUnlinkedParent(
  main: MainCandidate,
  side: SideCandidate,
): ParentScore | null {
  if (
    !isSameConversationContext(
      main.state,
      main.record,
      side.state,
      side.record,
      main.detail,
    )
  ) {
    return null;
  }

  const sideAnchorMs =
    side.createdAtMs ?? side.updatedAtMs ?? side.streamUpdatedAtMs;
  const mainUpdatedAtMs = main.updatedAtMs ?? main.streamUpdatedAtMs;
  if (
    sideAnchorMs !== null &&
    main.createdAtMs !== null &&
    sideAnchorMs + UNLINKED_SIDE_CONVERSATION_ACTIVE_GRACE_MS <
      main.createdAtMs
  ) {
    return null;
  }
  if (
    sideAnchorMs !== null &&
    mainUpdatedAtMs !== null &&
    sideAnchorMs - mainUpdatedAtMs > UNLINKED_SIDE_CONVERSATION_MAX_STALE_MS
  ) {
    return null;
  }

  const similarity = contentSimilarity(side.tokens, main.tokens);
  if (!hasMeaningfulParentSimilarity(similarity)) return null;

  const activeSpan =
    sideAnchorMs !== null &&
    main.createdAtMs !== null &&
    mainUpdatedAtMs !== null &&
    sideAnchorMs >= main.createdAtMs &&
    sideAnchorMs <=
      mainUpdatedAtMs + UNLINKED_SIDE_CONVERSATION_ACTIVE_GRACE_MS;
  const ageHours =
    sideAnchorMs !== null && main.createdAtMs !== null
      ? Math.max(0, sideAnchorMs - main.createdAtMs) / 3_600_000
      : 24;
  const staleHours =
    sideAnchorMs !== null && mainUpdatedAtMs !== null
      ? Math.max(0, sideAnchorMs - mainUpdatedAtMs) / 3_600_000
      : 24;
  const score =
    similarity.overlapCoefficient * 1000 +
    similarity.jaccard * 200 +
    Math.min(similarity.intersectionCount, 80) +
    (activeSpan ? UNLINKED_SIDE_CONVERSATION_ACTIVE_SCORE_BONUS : 0) -
    Math.min(ageHours, 24) * UNLINKED_SIDE_CONVERSATION_AGE_HOUR_PENALTY -
    Math.min(staleHours, 24) *
      UNLINKED_SIDE_CONVERSATION_STALE_HOUR_PENALTY;

  return { main, score };
}

function bestUnlinkedParent(
  side: SideCandidate,
  mains: MainCandidate[],
): MainCandidate | null {
  const best = mains
    .map((main) => scoreUnlinkedParent(main, side))
    .filter((score): score is ParentScore => Boolean(score))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return (
        (right.main.updatedAtMs ?? right.main.streamUpdatedAtMs ?? 0) -
        (left.main.updatedAtMs ?? left.main.streamUpdatedAtMs ?? 0)
      );
    })[0];
  return best?.main ?? null;
}

function buildMainCandidate(
  state: OfficialThreadStreamState,
): MainCandidate | null {
  const record = asRecord(state.conversationState);
  if (!record || record.sideConversation === true) return null;
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
  const text = detailText(detail);
  return {
    detail,
    record,
    text,
    tokens: contentTokens(text),
    createdAtMs: readTimestampMs(record.createdAt),
    updatedAtMs: readTimestampMs(record.updatedAt),
    streamUpdatedAtMs: readTimestampMs(state.updatedAtIso),
    state,
  };
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
  const visibleTurns = visibleSideConversationTurns(detail.turns);
  const visibleDetail = { ...detail, turns: visibleTurns };
  const explicitTitle =
    readString(record.title) ||
    readString(record.name) ||
    readString(record.preview);
  const text = detailText(visibleDetail, explicitTitle);
  return {
    detail: visibleDetail,
    record,
    explicitTitle,
    firstUserText: firstUserText(visibleTurns),
    text,
    tokens: contentTokens(text),
    createdAtMs: readTimestampMs(record.createdAt),
    updatedAtMs: readTimestampMs(record.updatedAt),
    streamUpdatedAtMs: readTimestampMs(state.updatedAtIso),
    state,
  };
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

  const mainCandidates = input.streamStates
    .map(buildMainCandidate)
    .filter((candidate): candidate is MainCandidate => Boolean(candidate));
  const currentMain = mainCandidates.find(
    (candidate) => candidate.state.threadId === input.threadId,
  );

  const candidates = input.streamStates
    .filter((state) => state.threadId !== input.threadId)
    .map((state) => {
      const candidate = buildSideCandidate(state);
      if (!candidate || !hasMeaningfulSideContent(candidate)) return null;

      const parentIds = explicitParentIds(candidate.record);
      if (parentIds.length > 0) {
        if (
          !hasExplicitMainLink(
            input.threadId,
            mainState,
            mainRecord,
            candidate.record,
          )
        ) {
          return null;
        }
        return isSameConversationContext(
          mainState,
          mainRecord,
          state,
          candidate.record,
          input.detail as ThreadDetail,
        )
          ? candidate
          : null;
      }

      if (!currentMain) return null;
      const parent = bestUnlinkedParent(candidate, mainCandidates);
      return parent?.state.threadId === currentMain.state.threadId
        ? candidate
        : null;
    })
    .filter((candidate): candidate is SideCandidate => Boolean(candidate));

  const sideConversations = candidates
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
