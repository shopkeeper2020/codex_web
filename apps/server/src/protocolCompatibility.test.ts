import { describe, expect, it } from "vitest";
import { IPC_METHOD_VERSIONS } from "@codex-web/protocol";
import {
  buildProtocolCompatibility,
  summarizeProtocolCompatibility,
} from "./protocolCompatibility.js";

const connectedIpc = {
  supported: true,
  connected: true,
  clientId: "client-a",
  pipePath: "\\\\.\\pipe\\codex-ipc",
  registeredRequestHandlers: [
    { method: "thread-follower-compact-thread", version: 1 },
    { method: "thread-follower-edit-last-user-turn", version: 1 },
    { method: "thread-follower-interrupt-turn", version: 1 },
    { method: "thread-follower-start-turn", version: 1 },
    { method: "thread-follower-steer-turn", version: 1 },
    { method: "thread-follower-update-thread-settings", version: 1 },
  ],
  lastError: null,
};

const expectedUnregisteredFollowerMethods = [
  "thread-follower-command-approval-decision",
  "thread-follower-file-approval-decision",
  "thread-follower-permissions-request-approval-response",
  "thread-follower-set-queued-follow-ups-state",
  "thread-follower-submit-mcp-server-elicitation-response",
  "thread-follower-submit-user-input",
];

const initializedAppServer = {
  running: true,
  pid: 1234,
  initialized: true,
  lastError: null,
  lastWarning: null,
};

describe("protocol compatibility snapshot", () => {
  it("builds the public adapter map and compatible summary", () => {
    const snapshot = buildProtocolCompatibility({
      officialIpc: connectedIpc,
      appServer: initializedAppServer,
    });

    expect(snapshot.adapter).toMatchObject({
      name: "codex_web",
      version: "0.1.0",
      ipcMethodVersions: IPC_METHOD_VERSIONS,
      registeredRequestHandlers: connectedIpc.registeredRequestHandlers,
      unregisteredFollowerMethods: expectedUnregisteredFollowerMethods,
    });
    expect(snapshot.adapter.followerMethodCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "thread-follower-start-turn",
          localHandlerRegistered: true,
          requiredForRealtimeSync: true,
          supportLevel: "implemented",
          appServerRpcMapping: "turn/start",
        }),
        expect.objectContaining({
          method: "thread-follower-compact-thread",
          localHandlerRegistered: true,
          supportLevel: "implemented",
          safeToImplement: true,
          appServerRpcMapping: "thread/compact/start",
        }),
        expect.objectContaining({
          method: "thread-follower-update-thread-settings",
          localHandlerRegistered: true,
          supportLevel: "implemented",
          safeToImplement: true,
          appServerRpcMapping: "thread/settings/update",
        }),
        expect.objectContaining({
          method: "thread-follower-edit-last-user-turn",
          localHandlerRegistered: true,
          supportLevel: "implemented",
          safeToImplement: true,
          appServerRpcMapping: "thread/rollback + turn/start",
        }),
        expect.objectContaining({
          method: "thread-follower-command-approval-decision",
          supportLevel: "candidate",
          safeToImplement: true,
          appServerRpcMapping:
            "item/commandExecution/requestApproval response",
        }),
        expect.objectContaining({
          method: "thread-follower-submit-user-input",
          supportLevel: "candidate",
          safeToImplement: true,
          appServerRpcMapping: "item/tool/requestUserInput response",
        }),
      ]),
    );
    expect(snapshot.summary).toEqual({
      state: "compatible",
      reason: null,
      methodCount: Object.keys(IPC_METHOD_VERSIONS).length,
      registeredHandlerCount: 6,
    });
  });

  it("keeps initialized app-server warnings visible without marking them fatal", () => {
    expect(
      summarizeProtocolCompatibility({
        officialIpc: connectedIpc,
        appServer: {
          ...initializedAppServer,
          lastWarning: "state db discrepancy during read_repair_rollout_path",
        },
      }),
    ).toMatchObject({
      state: "warning",
      reason: "state db discrepancy during read_repair_rollout_path",
    });
  });

  it("marks disconnected official IPC as offline", () => {
    expect(
      summarizeProtocolCompatibility({
        officialIpc: {
          ...connectedIpc,
          connected: false,
          lastError: "connect ENOENT",
        },
        appServer: initializedAppServer,
      }),
    ).toMatchObject({
      state: "offline",
      reason: "connect ENOENT",
    });
  });

  it("marks initialized app-server errors as error", () => {
    expect(
      summarizeProtocolCompatibility({
        officialIpc: connectedIpc,
        appServer: {
          ...initializedAppServer,
          lastError: "JSON-RPC parse failed",
        },
      }),
    ).toMatchObject({
      state: "error",
      reason: "JSON-RPC parse failed",
    });
  });
});
