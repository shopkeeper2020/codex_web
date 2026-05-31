import type { ProtocolCompatibilitySnapshot } from "./protocolCompatibility.js";

export const REQUIRED_FOLLOWER_HANDLERS = [
  "thread-follower-start-turn",
  "thread-follower-steer-turn",
  "thread-follower-interrupt-turn",
];

type SyncReadinessOfficialIpc = {
  getThreadStreamState(threadId: string): unknown;
  isOwnedConversation(threadId: string): boolean;
  isExternallyOwnedConversation(threadId: string): boolean;
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

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanValue(value: unknown): boolean {
  return value === true;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readTurnRecordId(turn: Record<string, unknown>): string {
  return (
    readString(turn.turnId) ||
    readString(turn.turn_id) ||
    readString(turn.id)
  );
}

function readActiveTurnRecord(input: {
  streamState: Record<string, unknown> | null;
  activeTurnId: string;
}): Record<string, unknown> | null {
  const conversationState = asRecord(input.streamState?.conversationState);
  const turns = readArray(conversationState?.turns);
  if (input.activeTurnId) {
    for (const turnValue of turns) {
      const turn = asRecord(turnValue);
      if (turn && readTurnRecordId(turn) === input.activeTurnId) return turn;
    }
  }
  for (const turnValue of turns) {
    const turn = asRecord(turnValue);
    if (turn && readBooleanValue(turn.isInProgress)) return turn;
  }
  return null;
}

function readTurnItemCount(turn: Record<string, unknown> | null): number | null {
  if (!turn) return null;
  if (!Array.isArray(turn.items)) return null;
  return turn.items.length;
}

function readRegisteredHandlerMethods(
  compatibility: ProtocolCompatibilitySnapshot,
): string[] {
  return compatibility.adapter.registeredRequestHandlers
    .map((handler) => handler.method)
    .sort();
}

function buildCheck(
  id: string,
  status: "pass" | "warn" | "fail",
  label: string,
  detail: string,
): Record<string, string> {
  return { id, status, label, detail };
}

export function buildSyncReadiness(input: {
  compatibility: ProtocolCompatibilitySnapshot;
  officialIpcStatus: Record<string, unknown>;
  threadId?: string;
  officialIpc: SyncReadinessOfficialIpc;
}): Record<string, unknown> {
  const compatibility = input.compatibility;
  const registered = readRegisteredHandlerMethods(compatibility);
  const missingRequired = REQUIRED_FOLLOWER_HANDLERS.filter(
    (method) => !registered.includes(method),
  );
  const threadId = input.threadId?.trim() ?? "";
  const streamState = threadId
    ? asRecord(input.officialIpc.getThreadStreamState(threadId))
    : null;
  const activeTurnId = readString(streamState?.activeTurnId);
  const activeTurnRecord = readActiveTurnRecord({ streamState, activeTurnId });
  const activeTurnItemCount = readTurnItemCount(activeTurnRecord);
  const isInProgress = readBooleanValue(streamState?.isInProgress);
  const hasEmptyActiveTurn =
    Boolean(streamState) &&
    isInProgress &&
    Boolean(activeTurnId) &&
    activeTurnItemCount === 0;
  const thread = threadId
    ? {
        threadId,
        hasOfficialStreamState: Boolean(streamState),
        ownerClientId: readString(streamState?.ownerClientId) || null,
        sourceClientId: readString(streamState?.sourceClientId) || null,
        cacheVersion: readNumber(streamState?.cacheVersion),
        isInProgress,
        activeTurnId,
        hasActiveTurnRecord: Boolean(activeTurnRecord),
        activeTurnItemCount,
        hasEmptyActiveTurn,
        isWebOwned: input.officialIpc.isOwnedConversation(threadId),
        isExternallyOwned:
          input.officialIpc.isExternallyOwnedConversation(threadId),
      }
    : null;
  const recentFollowerRequests = readArray(
    input.officialIpcStatus.recentFollowerRequests,
  );
  const recentOwnershipHandoffs = readArray(
    input.officialIpcStatus.recentOwnershipHandoffs,
  );
  const ipcConnected = readBooleanValue(compatibility.officialIpc.connected);
  const ipcLastError = readString(compatibility.officialIpc.lastError);
  const appServerInitialized = readBooleanValue(
    compatibility.appServer.initialized,
  );
  const appServerLastError = readString(compatibility.appServer.lastError);
  const appServerLastWarning = readString(compatibility.appServer.lastWarning);

  return {
    generatedAtIso: new Date().toISOString(),
    compatibility,
    followerHandlers: {
      required: REQUIRED_FOLLOWER_HANDLERS,
      registered,
      missingRequired,
      missingOptional: compatibility.adapter.unregisteredFollowerMethods,
    },
    thread,
    recentFollowerRequests,
    recentOwnershipHandoffs,
    checks: [
      buildCheck(
        "official-ipc",
        ipcConnected ? "pass" : "fail",
        "Official IPC",
        ipcConnected
          ? "connected"
          : ipcLastError || "official IPC is not connected",
      ),
      buildCheck(
        "app-server",
        appServerInitialized ? "pass" : "fail",
        "App server",
        appServerInitialized
          ? appServerLastWarning
            ? `initialized with warning: ${appServerLastWarning}`
            : "initialized"
          : appServerLastError || "official app-server is not initialized",
      ),
      buildCheck(
        "required-follower-handlers",
        missingRequired.length ? "fail" : "pass",
        "Required follower handlers",
        missingRequired.length
          ? `missing ${missingRequired.join(", ")}`
          : `${registered.length} handlers registered`,
      ),
      buildCheck(
        "optional-follower-handlers",
        compatibility.adapter.unregisteredFollowerMethods.length
          ? "warn"
          : "pass",
        "Optional follower handlers",
        compatibility.adapter.unregisteredFollowerMethods.length
          ? `not implemented yet: ${compatibility.adapter.unregisteredFollowerMethods.join(", ")}`
          : "all declared follower handlers registered",
      ),
      ...(thread
        ? [
            buildCheck(
              "thread-stream-cache",
              thread.hasOfficialStreamState ? "pass" : "warn",
              "Thread stream cache",
              thread.hasOfficialStreamState
                ? `owner ${thread.ownerClientId ?? "unknown"}`
                : "no official stream snapshot cached yet",
            ),
            buildCheck(
              "thread-owner",
              thread.isWebOwned || thread.isExternallyOwned ? "pass" : "warn",
              "Thread owner",
              thread.isWebOwned
                ? "web-owned"
                : thread.isExternallyOwned
                  ? "official-owned"
                  : "owner unknown",
            ),
            buildCheck(
              "thread-active-tail",
              !thread.isInProgress
                ? "pass"
                : !thread.activeTurnId || thread.hasEmptyActiveTurn
                  ? "warn"
                  : "pass",
              "Thread active tail",
              !thread.isInProgress
                ? "thread is not active"
                : !thread.activeTurnId
                  ? "thread is active but no active turn id was reported"
                  : thread.hasEmptyActiveTurn
                    ? `active turn ${thread.activeTurnId} has no items yet`
                    : `active turn ${thread.activeTurnId} has ${
                        thread.activeTurnItemCount ?? "unknown"
                      } items`,
            ),
          ]
        : []),
    ],
  };
}
