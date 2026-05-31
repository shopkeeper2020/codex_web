export type MinimalRealtimeEvent = {
  type?: string;
  payload?: unknown;
  atIso?: string;
  serverInstanceId?: string;
  serverStartedAtIso?: string;
};

export type RealtimeThreadEventDecision = {
  accepted: boolean;
  threadId: string;
  cacheVersion: number | null;
};

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

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readRealtimeThreadId(event: MinimalRealtimeEvent): string {
  const payload = asRecord(event.payload);
  return readString(payload?.threadId) || readString(payload?.conversationId);
}

export function readRealtimeCacheVersion(
  event: MinimalRealtimeEvent,
): number | null {
  const payload = asRecord(event.payload);
  return readFiniteNumber(payload?.cacheVersion);
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
