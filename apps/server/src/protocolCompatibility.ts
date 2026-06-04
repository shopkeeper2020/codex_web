import {
  IPC_METHOD_VERSIONS,
  OFFICIAL_FOLLOWER_METHODS,
} from "@codex-web/protocol";

export type ProtocolCompatibilityState =
  | "compatible"
  | "warning"
  | "offline"
  | "error";

export type ProtocolCompatibilitySummary = {
  state: ProtocolCompatibilityState;
  reason: string | null;
  methodCount: number;
  registeredHandlerCount: number;
};

export type RegisteredRequestHandlerSummary = {
  method: string;
  version: number;
};

export type FollowerMethodSupportLevel =
  | "implemented"
  | "candidate"
  | "research-required"
  | "risky";

export type FollowerMethodCapabilitySummary = {
  method: string;
  version: number;
  protocolKnown: boolean;
  localHandlerRegistered: boolean;
  requiredForRealtimeSync: boolean;
  officialForHostCommandFound: boolean;
  officialForHostCommand: string | null;
  ownerBehavior: string;
  appServerRpcMapping: string | null;
  supportLevel: FollowerMethodSupportLevel;
  safeToImplement: boolean;
  note: string;
};

export type ProtocolCompatibilitySnapshot = {
  adapter: {
    name: string;
    version: string;
    ipcMethodVersions: Record<string, number>;
    registeredRequestHandlers: RegisteredRequestHandlerSummary[];
    unregisteredFollowerMethods: string[];
    followerMethodCapabilities: FollowerMethodCapabilitySummary[];
  };
  officialIpc: Record<string, unknown>;
  appServer: Record<string, unknown>;
  summary: ProtocolCompatibilitySummary;
};

type FollowerMethodCapabilityDefinition = Omit<
  FollowerMethodCapabilitySummary,
  "version" | "protocolKnown" | "localHandlerRegistered"
>;

const FOLLOWER_METHOD_CAPABILITY_DEFINITIONS: FollowerMethodCapabilityDefinition[] =
  [
    {
      method: "thread-follower-start-turn",
      requiredForRealtimeSync: true,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-start-turn-for-host",
      ownerBehavior: "owner delegates to turn/start for the active thread",
      appServerRpcMapping: "turn/start",
      supportLevel: "implemented",
      safeToImplement: true,
      note: "Required for Web sends into Desktop/VS Code-owned threads and for official clients to send into Web-owned threads.",
    },
    {
      method: "thread-follower-steer-turn",
      requiredForRealtimeSync: true,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-steer-turn-for-host",
      ownerBehavior:
        "owner accepts top-level input/restoreMessage/attachments and resolves the active turn",
      appServerRpcMapping: "turn/steer",
      supportLevel: "implemented",
      safeToImplement: true,
      note: "Required for guiding an active turn without starting a duplicate turn.",
    },
    {
      method: "thread-follower-interrupt-turn",
      requiredForRealtimeSync: true,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-interrupt-turn-for-host",
      ownerBehavior: "owner delegates to turn/interrupt",
      appServerRpcMapping: "turn/interrupt",
      supportLevel: "implemented",
      safeToImplement: true,
      note: "Required for stopping the same active turn across clients.",
    },
    {
      method: "thread-follower-compact-thread",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-compact-thread-for-host",
      ownerBehavior: "owner delegates to thread/compact/start",
      appServerRpcMapping: "thread/compact/start",
      supportLevel: "implemented",
      safeToImplement: true,
      note: "Implemented only for Web-owned conversations and guarded by the same owner canHandle check as other follower handlers.",
    },
    {
      method: "thread-follower-set-model-and-reasoning",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand:
        "thread-follower-set-model-and-reasoning-for-host",
      ownerBehavior:
        "owner updates next-turn model/latestReasoningEffort settings",
      appServerRpcMapping: "thread/settings/update",
      supportLevel: "implemented",
      safeToImplement: true,
      note: "Implemented for Web-owned conversations via official thread/settings/update.",
    },
    {
      method: "thread-follower-set-collaboration-mode",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-set-collaboration-mode-for-host",
      ownerBehavior:
        "owner updates next-turn collaborationMode settings",
      appServerRpcMapping: "thread/settings/update",
      supportLevel: "implemented",
      safeToImplement: true,
      note: "Implemented for Web-owned conversations via official thread/settings/update.",
    },
    {
      method: "thread-follower-edit-last-user-turn",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-edit-last-user-turn-for-host",
      ownerBehavior:
        "owner performs thread/rollback then starts a replacement turn",
      appServerRpcMapping: "thread/rollback + turn/start",
      supportLevel: "implemented",
      safeToImplement: true,
      note: "Implemented with last-turn and active-turn guards; rollback does not restore local file changes.",
    },
    {
      method: "thread-follower-command-approval-decision",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand:
        "thread-follower-command-approval-decision-for-host",
      ownerBehavior:
        "owner applies a command approval decision to the pending server request",
      appServerRpcMapping: "item/commandExecution/requestApproval response",
      supportLevel: "candidate",
      safeToImplement: true,
      note: "Required for full parity when Web approves or rejects an official-owned command request.",
    },
    {
      method: "thread-follower-file-approval-decision",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-file-approval-decision-for-host",
      ownerBehavior:
        "owner applies a file-change approval decision to the pending server request",
      appServerRpcMapping: "item/fileChange/requestApproval response",
      supportLevel: "candidate",
      safeToImplement: true,
      note: "Required for full parity when Web approves or rejects an official-owned file-change request.",
    },
    {
      method: "thread-follower-permissions-request-approval-response",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand:
        "thread-follower-permissions-request-approval-response-for-host",
      ownerBehavior:
        "owner applies a permissions approval response to the pending server request",
      appServerRpcMapping: "item/permissions/requestApproval response",
      supportLevel: "candidate",
      safeToImplement: true,
      note: "Required for full parity with owner-side permission expansion requests.",
    },
    {
      method: "thread-follower-submit-user-input",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-submit-user-input-for-host",
      ownerBehavior:
        "owner submits structured user input answers to the pending tool request",
      appServerRpcMapping: "item/tool/requestUserInput response",
      supportLevel: "candidate",
      safeToImplement: true,
      note: "Required for full parity when an official-owned turn asks Web for user input.",
    },
    {
      method: "thread-follower-submit-mcp-server-elicitation-response",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand:
        "thread-follower-submit-mcp-server-elicitation-response-for-host",
      ownerBehavior:
        "owner submits an MCP elicitation response to the pending tool request",
      appServerRpcMapping: "item/tool/requestOptionSelection response",
      supportLevel: "candidate",
      safeToImplement: true,
      note: "Required for full parity with MCP elicitation requests during official-owned turns.",
    },
    {
      method: "thread-follower-set-queued-follow-ups-state",
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand:
        "thread-follower-set-queued-follow-ups-state-for-host",
      ownerBehavior:
        "owner updates queued follow-up messages for the active conversation",
      appServerRpcMapping: null,
      supportLevel: "candidate",
      safeToImplement: true,
      note: "Required for full parity with official queued follow-up synchronization.",
    },
  ];

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  return typeof record[key] === "boolean" ? record[key] : null;
}

function readString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" && record[key].trim()
    ? record[key].trim()
    : "";
}

function readRegisteredRequestHandlers(
  status: Record<string, unknown>,
): RegisteredRequestHandlerSummary[] {
  const value = status.registeredRequestHandlers;
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry): RegisteredRequestHandlerSummary[] => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      return typeof record.method === "string" &&
        Number.isInteger(record.version)
        ? [{ method: record.method, version: record.version as number }]
        : [];
    })
    .sort((left, right) => left.method.localeCompare(right.method));
}

function unregisteredFollowerMethods(
  registeredHandlers: RegisteredRequestHandlerSummary[],
): string[] {
  const registered = new Set(
    registeredHandlers.map((handler) => handler.method),
  );
  return OFFICIAL_FOLLOWER_METHODS
    .filter((method) => !registered.has(method))
    .sort();
}

export function buildFollowerMethodCapabilities(
  registeredHandlers: RegisteredRequestHandlerSummary[],
): FollowerMethodCapabilitySummary[] {
  const registered = new Set(
    registeredHandlers.map((handler) => handler.method),
  );
  return FOLLOWER_METHOD_CAPABILITY_DEFINITIONS.map((definition) => ({
    ...definition,
    version: IPC_METHOD_VERSIONS[definition.method] ?? -1,
    protocolKnown: definition.method in IPC_METHOD_VERSIONS,
    localHandlerRegistered: registered.has(definition.method),
  })).sort((left, right) => left.method.localeCompare(right.method));
}

export function summarizeProtocolCompatibility(input: {
  officialIpc: Record<string, unknown>;
  appServer: Record<string, unknown>;
}): ProtocolCompatibilitySummary {
  const methodCount = Object.keys(IPC_METHOD_VERSIONS).length;
  const registeredHandlerCount = readRegisteredRequestHandlers(
    input.officialIpc,
  ).length;
  const ipcSupported = readBoolean(input.officialIpc, "supported");
  const ipcConnected = readBoolean(input.officialIpc, "connected");
  const appServerInitialized = readBoolean(input.appServer, "initialized");
  const ipcError = readString(input.officialIpc, "lastError");
  const pipePath = readString(input.officialIpc, "pipePath");
  const appServerError = readString(input.appServer, "lastError");
  const appServerWarning = readString(input.appServer, "lastWarning");

  if (ipcSupported === false || ipcConnected !== true) {
    return {
      state: "offline",
      reason: ipcError || pipePath || "official IPC is not connected",
      methodCount,
      registeredHandlerCount,
    };
  }

  if (appServerInitialized !== true) {
    return {
      state: "offline",
      reason:
        appServerError ||
        appServerWarning ||
        "official app-server is not initialized",
      methodCount,
      registeredHandlerCount,
    };
  }

  if (appServerError) {
    return {
      state: "error",
      reason: appServerError,
      methodCount,
      registeredHandlerCount,
    };
  }

  if (appServerWarning) {
    return {
      state: "warning",
      reason: appServerWarning,
      methodCount,
      registeredHandlerCount,
    };
  }

  return {
    state: "compatible",
    reason: null,
    methodCount,
    registeredHandlerCount,
  };
}

export function buildProtocolCompatibility(input: {
  officialIpc: Record<string, unknown>;
  appServer: Record<string, unknown>;
}): ProtocolCompatibilitySnapshot {
  const registeredRequestHandlers = readRegisteredRequestHandlers(
    input.officialIpc,
  );
  return {
    adapter: {
      name: "codex_web",
      version: "0.1.0",
      ipcMethodVersions: IPC_METHOD_VERSIONS,
      registeredRequestHandlers,
      unregisteredFollowerMethods: unregisteredFollowerMethods(
        registeredRequestHandlers,
      ),
      followerMethodCapabilities: buildFollowerMethodCapabilities(
        registeredRequestHandlers,
      ),
    },
    officialIpc: input.officialIpc,
    appServer: input.appServer,
    summary: summarizeProtocolCompatibility(input),
  };
}
