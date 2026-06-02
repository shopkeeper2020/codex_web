import { describe, expect, it } from "vitest";
import { buildProtocolCompatibility } from "./protocolCompatibility.js";
import { buildSyncReadiness } from "./syncReadiness.js";

const registeredHandlers = [
  { method: "thread-follower-compact-thread", version: 1 },
  { method: "thread-follower-interrupt-turn", version: 1 },
  { method: "thread-follower-set-collaboration-mode", version: 1 },
  { method: "thread-follower-set-model-and-reasoning", version: 1 },
  { method: "thread-follower-start-turn", version: 1 },
  { method: "thread-follower-steer-turn", version: 1 },
];

const expectedMissingOptional = [
  "thread-follower-command-approval-decision",
  "thread-follower-edit-last-user-turn",
  "thread-follower-file-approval-decision",
  "thread-follower-permissions-request-approval-response",
  "thread-follower-set-queued-follow-ups-state",
  "thread-follower-submit-mcp-server-elicitation-response",
  "thread-follower-submit-user-input",
];

const connectedIpcStatus = {
  supported: true,
  connected: true,
  clientId: "web-client",
  pipePath: "\\\\.\\pipe\\codex-ipc",
  registeredRequestHandlers: registeredHandlers,
  recentFollowerRequests: [{ method: "thread-follower-start-turn" }],
  recentOwnershipHandoffs: [{ conversationId: "thread-1" }],
  rawFrameLogging: false,
  recentRawFrames: [],
  lastError: null,
};

const initializedAppServerStatus = {
  running: true,
  pid: 1234,
  initialized: true,
  pendingCallCount: 0,
  lastError: null,
  lastWarning: null,
};

function buildCompatibility(input?: {
  officialIpc?: Record<string, unknown>;
  appServer?: Record<string, unknown>;
}) {
  return buildProtocolCompatibility({
    officialIpc: input?.officialIpc ?? connectedIpcStatus,
    appServer: input?.appServer ?? initializedAppServerStatus,
  });
}

describe("sync readiness snapshot", () => {
  it("reports required handler coverage and optional follower gaps", () => {
    const readiness = buildSyncReadiness({
      compatibility: buildCompatibility(),
      officialIpcStatus: connectedIpcStatus,
      officialIpc: {
        getThreadStreamState: () => null,
        isOwnedConversation: () => false,
        isExternallyOwnedConversation: () => false,
      },
    });

    expect(readiness).toMatchObject({
      followerHandlers: {
        missingRequired: [],
        missingOptional: expectedMissingOptional,
      },
      recentFollowerRequests: connectedIpcStatus.recentFollowerRequests,
      recentOwnershipHandoffs: connectedIpcStatus.recentOwnershipHandoffs,
    });
    expect(readiness).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "required-follower-handlers",
          status: "pass",
        }),
        expect.objectContaining({
          id: "optional-follower-handlers",
          status: "warn",
        }),
      ]),
    });
  });

  it("adds owner diagnostics for a thread-specific readiness request", () => {
    const readiness = buildSyncReadiness({
      compatibility: buildCompatibility(),
      officialIpcStatus: connectedIpcStatus,
      threadId: "thread-1",
      officialIpc: {
        getThreadStreamState: () => ({
          ownerClientId: "desktop-client",
          sourceClientId: "desktop-client",
          cacheVersion: 42,
          isInProgress: true,
          activeTurnId: "turn-active",
          conversationState: {
            turns: [
              {
                id: "turn-active",
                status: "active",
                items: [{ id: "item-1", type: "assistant" }],
              },
            ],
          },
        }),
        isOwnedConversation: () => false,
        isExternallyOwnedConversation: () => true,
      },
    });

    expect(readiness).toMatchObject({
      thread: {
        threadId: "thread-1",
        hasOfficialStreamState: true,
        ownerClientId: "desktop-client",
        sourceClientId: "desktop-client",
        cacheVersion: 42,
        isInProgress: true,
        activeTurnId: "turn-active",
        hasActiveTurnRecord: true,
        activeTurnItemCount: 1,
        hasEmptyActiveTurn: false,
        isWebOwned: false,
        isExternallyOwned: true,
      },
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "thread-stream-cache",
          status: "pass",
          detail: "owner desktop-client",
        }),
        expect.objectContaining({
          id: "thread-owner",
          status: "pass",
          detail: "official-owned",
        }),
        expect.objectContaining({
          id: "thread-active-tail",
          status: "pass",
          detail: "active turn turn-active has 1 items",
        }),
      ]),
    });
  });

  it("warns when an active official thread only has an empty active turn shell", () => {
    const readiness = buildSyncReadiness({
      compatibility: buildCompatibility(),
      officialIpcStatus: connectedIpcStatus,
      threadId: "thread-empty-active",
      officialIpc: {
        getThreadStreamState: () => ({
          ownerClientId: "desktop-client",
          sourceClientId: "desktop-client",
          cacheVersion: 43,
          isInProgress: true,
          activeTurnId: "turn-empty",
          conversationState: {
            turns: [{ id: "turn-empty", status: "active", items: [] }],
          },
        }),
        isOwnedConversation: () => false,
        isExternallyOwnedConversation: () => true,
      },
    });

    expect(readiness).toMatchObject({
      thread: {
        threadId: "thread-empty-active",
        isInProgress: true,
        activeTurnId: "turn-empty",
        hasActiveTurnRecord: true,
        activeTurnItemCount: 0,
        hasEmptyActiveTurn: true,
      },
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "thread-active-tail",
          status: "warn",
          detail: "active turn turn-empty has no items yet",
        }),
      ]),
    });
  });

  it("marks missing required handlers as a failure", () => {
    const officialIpc = {
      ...connectedIpcStatus,
      registeredRequestHandlers: [
        { method: "thread-follower-start-turn", version: 1 },
      ],
    };
    const readiness = buildSyncReadiness({
      compatibility: buildCompatibility({ officialIpc }),
      officialIpcStatus: officialIpc,
      officialIpc: {
        getThreadStreamState: () => null,
        isOwnedConversation: () => false,
        isExternallyOwnedConversation: () => false,
      },
    });

    expect(readiness).toMatchObject({
      followerHandlers: {
        missingRequired: [
          "thread-follower-steer-turn",
          "thread-follower-interrupt-turn",
        ],
      },
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "required-follower-handlers",
          status: "fail",
        }),
      ]),
    });
  });
});
