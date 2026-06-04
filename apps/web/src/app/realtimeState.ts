export type MinimalRealtimeEvent = {
  type?: string;
  sequence?: unknown;
  payload?: unknown;
  params?: unknown;
  approval?: unknown;
  threadId?: unknown;
  conversationId?: unknown;
  cacheVersion?: unknown;
  atIso?: string;
  serverInstanceId?: string;
  serverStartedAtIso?: string;
};

export type RealtimeThreadEventDecision = {
  accepted: boolean;
  threadId: string;
  cacheVersion: number | null;
};

export type RealtimeSequenceTrackerState = {
  serverInstance: string;
  seenSequences: Set<number>;
  sequenceOrder: number[];
};

const MAX_TRACKED_REALTIME_SEQUENCES = 2_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

function readThreadIdFromRecord(
  value: Record<string, unknown> | null,
): string {
  if (!value) return "";
  return (
    readString(value.threadId) ||
    readString(value.thread_id) ||
    readString(value.conversationId)
  );
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readRealtimeThreadId(event: MinimalRealtimeEvent): string {
  return (
    readThreadIdFromRecord(event as Record<string, unknown>) ||
    readThreadIdFromRecord(asRecord(event.payload)) ||
    readThreadIdFromRecord(asRecord(event.params)) ||
    readThreadIdFromRecord(asRecord(event.approval))
  );
}

export function readRealtimeCacheVersion(
  event: MinimalRealtimeEvent,
): number | null {
  const payload = asRecord(event.payload);
  return readFiniteNumber(payload?.cacheVersion) ?? readFiniteNumber(event.cacheVersion);
}

export function readRealtimeServerInstance(
  event: MinimalRealtimeEvent,
): string {
  if (event.type !== "connected") return "";
  return (
    readString(event.serverInstanceId) ||
    readString(event.serverStartedAtIso) ||
    readString(event.atIso)
  );
}

export function updateRealtimeServerInstance(
  versionsByThreadId: Map<string, number>,
  currentServerInstance: string,
  event: MinimalRealtimeEvent,
): string {
  const nextServerInstance = readRealtimeServerInstance(event);
  if (!nextServerInstance) return currentServerInstance;
  if (currentServerInstance && nextServerInstance !== currentServerInstance) {
    versionsByThreadId.clear();
  }
  return nextServerInstance;
}

export function createRealtimeSequenceTrackerState(): RealtimeSequenceTrackerState {
  return {
    serverInstance: "",
    seenSequences: new Set<number>(),
    sequenceOrder: [],
  };
}

export function acceptRealtimeEventSequence(
  state: RealtimeSequenceTrackerState,
  event: MinimalRealtimeEvent,
): boolean {
  const nextServerInstance = readRealtimeServerInstance(event);
  if (nextServerInstance && nextServerInstance !== state.serverInstance) {
    state.serverInstance = nextServerInstance;
    state.seenSequences.clear();
    state.sequenceOrder = [];
  }

  const sequence = readFiniteNumber(event.sequence);
  if (sequence === null || !Number.isInteger(sequence) || sequence <= 0) {
    return true;
  }
  if (state.seenSequences.has(sequence)) return false;

  state.seenSequences.add(sequence);
  state.sequenceOrder.push(sequence);
  while (state.sequenceOrder.length > MAX_TRACKED_REALTIME_SEQUENCES) {
    const expired = state.sequenceOrder.shift();
    if (expired !== undefined) state.seenSequences.delete(expired);
  }
  return true;
}

export function acceptRealtimeThreadEvent(
  versionsByThreadId: Map<string, number>,
  event: MinimalRealtimeEvent,
): RealtimeThreadEventDecision {
  const threadId = readRealtimeThreadId(event);
  const cacheVersion = readRealtimeCacheVersion(event);
  if (!threadId || cacheVersion === null) {
    return { accepted: true, threadId, cacheVersion };
  }

  const currentVersion = versionsByThreadId.get(threadId);
  if (currentVersion !== undefined && cacheVersion <= currentVersion) {
    return { accepted: false, threadId, cacheVersion };
  }

  versionsByThreadId.set(threadId, cacheVersion);
  return { accepted: true, threadId, cacheVersion };
}
