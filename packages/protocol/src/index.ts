import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";

export const WINDOWS_CODEX_IPC_PIPE = "\\\\.\\pipe\\codex-ipc";
export const OFFICIAL_THREAD_STREAM_CHANGED_METHOD =
  "official/thread-stream-state-changed";
export const OFFICIAL_THREAD_ARCHIVED_METHOD = "official/thread-archived";
export const OFFICIAL_THREAD_UNARCHIVED_METHOD = "official/thread-unarchived";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const RECONNECT_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 20_000;
const INITIALIZE_REQUEST_TIMEOUT_MS = 60_000;

export const IPC_METHOD_VERSIONS: Record<string, number> = {
  "thread-stream-state-changed": 6,
  "thread-read-state-changed": 1,
  "thread-follower-start-turn": 1,
  "thread-follower-compact-thread": 1,
  "thread-follower-steer-turn": 1,
  "thread-follower-interrupt-turn": 1,
  "thread-follower-set-model-and-reasoning": 1,
  "thread-follower-set-collaboration-mode": 1,
  "thread-follower-edit-last-user-turn": 1,
  initialize: 0,
};

export type OfficialIpcFrame = Record<string, unknown>;

type PendingRequest = {
  method: string;
  resolve: (value: OfficialIpcFrame) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type OfficialIpcNotification = {
  method: string;
  params: unknown;
  atIso: string;
};

export type OfficialThreadStreamState = {
  threadId: string;
  conversationId: string;
  hostId: string;
  ownerClientId: string | null;
  sourceClientId: string | null;
  conversationState: unknown;
  changeType: "snapshot" | "patches";
  cacheVersion: number;
  updatedAtIso: string;
  isInProgress: boolean;
  activeTurnId: string;
};

type OfficialRequestHandler = {
  version: number;
  canHandle?: (params: unknown) => boolean | Promise<boolean>;
  handle: (params: unknown) => unknown | Promise<unknown>;
};

export type FollowerRequestRecord = {
  atIso: string;
  method: string;
  threadId: string;
  targetClientId: string | null;
  usedDiscovery: boolean;
  result: "pending" | "success" | "error";
  handledByClientId?: string | null;
  error?: string;
};

export type RegisteredRequestHandlerRecord = {
  method: string;
  version: number;
};

export type RawFrameRecord = {
  atIso: string;
  direction: "incoming" | "outgoing";
  byteLength: number;
  type: string;
  method: string | null;
  requestId: string | null;
  sourceClientId: string | null;
  targetClientId: string | null;
  preview: unknown;
};

export type OwnershipHandoffRecord = {
  atIso: string;
  conversationId: string;
  previousOwnerClientId: string | null;
  nextOwnerClientId: string | null;
  sourceClientId: string | null;
  reason?: string;
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

function readStatusString(value: unknown): string {
  const direct = readString(value);
  if (direct) return direct;
  const record = asRecord(value);
  return (
    readString(record?.type) ||
    readString(record?.status) ||
    readString(record?.state) ||
    readString(record?.kind)
  );
}

function compactStatus(value: unknown): string {
  return readStatusString(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isActiveStatus(value: unknown): boolean {
  return [
    "active",
    "inprogress",
    "running",
    "streaming",
    "thinking",
    "editing",
    "writing",
  ].includes(compactStatus(value));
}

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function patchPath(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (part): part is string | number =>
      typeof part === "string" || typeof part === "number",
  );
}

function getPatchParent(
  root: unknown,
  path: Array<string | number>,
): { parent: unknown; key: string | number } | null {
  if (path.length === 0) return null;
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    if (parent === null || typeof parent !== "object") return null;
    parent = (parent as Record<string, unknown>)[String(segment)];
  }
  const key = path.at(-1);
  return key === undefined ? null : { parent, key };
}

function applySingleOfficialPatch(root: unknown, patch: unknown): unknown {
  const record = asRecord(patch);
  if (!record) return root;

  const op = readString(record.op);
  const path = patchPath(record.path);

  if (path.length === 0) {
    if (op === "add" || op === "replace") return cloneJson(record.value);
    if (op === "remove") return null;
    return root;
  }

  const parentRef = getPatchParent(root, path);
  if (
    !parentRef ||
    parentRef.parent === null ||
    typeof parentRef.parent !== "object"
  )
    return root;

  const { parent, key } = parentRef;
  if (Array.isArray(parent)) {
    const index =
      typeof key === "number" ? key : Number.parseInt(String(key), 10);
    if (op === "remove") {
      if (Number.isInteger(index) && index >= 0 && index < parent.length)
        parent.splice(index, 1);
      return root;
    }
    if (op === "add") {
      if (key === "-") {
        parent.push(cloneJson(record.value));
      } else if (Number.isInteger(index)) {
        parent.splice(
          Math.max(0, Math.min(index, parent.length)),
          0,
          cloneJson(record.value),
        );
      }
      return root;
    }
    if (op === "replace" && Number.isInteger(index) && index >= 0) {
      parent[index] = cloneJson(record.value);
    }
    return root;
  }

  const objectParent = parent as Record<string, unknown>;
  const objectKey = String(key);
  if (op === "remove") {
    delete objectParent[objectKey];
  } else if (op === "add" || op === "replace") {
    objectParent[objectKey] = cloneJson(record.value);
  }
  return root;
}

export function applyOfficialIpcPatches(
  base: unknown,
  patches: unknown,
): unknown {
  if (!Array.isArray(patches)) return base;
  let next = cloneJson(base);
  for (const patch of patches) {
    next = applySingleOfficialPatch(next, patch);
  }
  return next;
}

export function readOfficialConversationId(params: unknown): string {
  const record = asRecord(params);
  if (!record) return "";
  const conversation = asRecord(record.conversation);
  const thread = asRecord(record.thread);
  const state = asRecord(record.conversationState) ?? asRecord(record.state);
  return (
    readString(record.conversationId) ||
    readString(record.conversation_id) ||
    readString(record.threadId) ||
    readString(record.thread_id) ||
    readString(conversation?.id) ||
    readString(conversation?.conversationId) ||
    readString(thread?.id) ||
    readString(thread?.threadId) ||
    readString(state?.conversationId) ||
    readString(state?.threadId)
  );
}

function readActiveTurnId(conversationState: unknown): string {
  const state = asRecord(conversationState);
  const turns = Array.isArray(state?.turns) ? state.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index]);
    if (!turn) continue;
    if (isActiveStatus(turn.status) || isActiveStatus(turn.state)) {
      return (
        readString(turn.turnId) ||
        readString(turn.turn_id) ||
        readString(turn.id)
      );
    }
  }
  return "";
}

function readIsInProgress(conversationState: unknown): boolean {
  const state = asRecord(conversationState);
  if (!state) return false;
  if (state.inProgress === true) return true;
  if (isActiveStatus(state.status) || isActiveStatus(state.state)) return true;

  const runtimeStatus = asRecord(state.threadRuntimeStatus);
  return (
    isActiveStatus(runtimeStatus) ||
    readActiveTurnId(conversationState).length > 0
  );
}

function isSuccessResponse(frame: OfficialIpcFrame): boolean {
  return (
    frame.resultType === "success" ||
    (!("resultType" in frame) && "result" in frame)
  );
}

function responseErrorMessage(
  frame: OfficialIpcFrame,
  fallback: string,
): string {
  const error = asRecord(frame.error);
  return readString(error?.message) || readString(frame.message) || fallback;
}

export class OfficialIpcBridge {
  private socket: Socket | null = null;
  private incoming = Buffer.alloc(0);
  private clientId: string | null = null;
  private connected = false;
  private connecting = false;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private listeners = new Set<(value: OfficialIpcNotification) => void>();
  private requestHandlers = new Map<string, OfficialRequestHandler>();
  private streamStates = new Map<string, OfficialThreadStreamState>();
  private ownedConversationIds = new Set<string>();
  private followerRequestHistory: FollowerRequestRecord[] = [];
  private ownershipHandoffHistory: OwnershipHandoffRecord[] = [];
  private rawFrameLogging = false;
  private rawFrameHistory: RawFrameRecord[] = [];
  private cacheVersion = 0;
  private lastError: string | null = null;

  constructor(
    private readonly pipePath = process.platform === "win32"
      ? WINDOWS_CODEX_IPC_PIPE
      : "",
  ) {}

  start(): void {
    if (this.disposed || this.connected || this.connecting) return;
    if (!this.pipePath) {
      this.lastError = "official-ipc-not-supported";
      return;
    }

    this.connecting = true;
    const socket = connect(this.pipePath);
    this.socket = socket;

    socket.on("connect", () => {
      this.connected = true;
      this.connecting = false;
      this.lastError = null;
      this.incoming = Buffer.alloc(0);
      void this.initialize();
    });

    socket.on("data", (chunk) => {
      this.handleData(chunk);
    });

    socket.on("error", (error) => {
      this.lastError = error.message;
    });

    socket.on("close", () => {
      this.connected = false;
      this.connecting = false;
      this.socket = null;
      this.clientId = null;
      this.incoming = Buffer.alloc(0);
      for (const [requestId, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(
          new Error(`official-ipc-disconnected:${pending.method}`),
        );
        this.pendingRequests.delete(requestId);
      }
      this.scheduleReconnect();
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`official-ipc-disposed:${pending.method}`));
      this.pendingRequests.delete(requestId);
    }
    this.socket?.destroy();
    this.socket = null;
    this.listeners.clear();
    this.requestHandlers.clear();
    this.streamStates.clear();
    this.ownedConversationIds.clear();
  }

  onNotification(
    listener: (value: OfficialIpcNotification) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): Record<string, unknown> {
    return {
      supported: Boolean(this.pipePath),
      connected: this.connected,
      clientId: this.clientId,
      pipePath: this.pipePath || null,
      cachedConversationCount: this.streamStates.size,
      ownedConversationCount: this.ownedConversationIds.size,
      registeredRequestHandlers: this.getRegisteredRequestHandlers(),
      recentFollowerRequests: this.followerRequestHistory.slice(-20),
      recentOwnershipHandoffs: this.ownershipHandoffHistory.slice(-20),
      rawFrameLogging: this.rawFrameLogging,
      recentRawFrames: this.rawFrameHistory.slice(-40),
      lastError: this.lastError,
    };
  }

  setRawFrameLogging(enabled: boolean): void {
    this.rawFrameLogging = enabled;
    if (!enabled) this.rawFrameHistory = [];
  }

  getThreadStreamState(threadId: string): OfficialThreadStreamState | null {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return null;
    const state = this.streamStates.get(normalizedThreadId);
    return state ? cloneJson(state) : null;
  }

  listThreadStreamStates(): OfficialThreadStreamState[] {
    return Array.from(this.streamStates.values()).map((state) =>
      cloneJson(state),
    );
  }

  restoreThreadStreamState(state: OfficialThreadStreamState): boolean {
    const normalizedThreadId = state.threadId.trim();
    const normalizedConversationId = state.conversationId.trim();
    if (
      !normalizedThreadId ||
      !normalizedConversationId ||
      !state.conversationState
    )
      return false;
    const existing = this.streamStates.get(normalizedConversationId);
    this.cacheVersion = Math.max(this.cacheVersion, state.cacheVersion);
    this.releaseOwnedConversationIfExternal({
      conversationId: normalizedConversationId,
      previousOwnerClientId: existing?.ownerClientId ?? null,
      nextOwnerClientId: state.ownerClientId,
      sourceClientId: state.sourceClientId,
    });
    this.streamStates.set(normalizedConversationId, cloneJson(state));
    return true;
  }

  isOwnedConversation(conversationId: string): boolean {
    const normalizedConversationId = conversationId.trim();
    const state = this.streamStates.get(normalizedConversationId);
    if (
      state?.ownerClientId &&
      this.clientId &&
      state.ownerClientId !== this.clientId
    )
      return false;
    return this.ownedConversationIds.has(normalizedConversationId);
  }

  isExternallyOwnedConversation(conversationId: string): boolean {
    const normalizedConversationId = conversationId.trim();
    const state = this.streamStates.get(normalizedConversationId);
    if (!state?.ownerClientId || !this.clientId) return false;
    return (
      state.ownerClientId !== this.clientId &&
      !this.ownedConversationIds.has(normalizedConversationId)
    );
  }

  canOwnConversations(): boolean {
    return Boolean(this.clientId);
  }

  registerRequestHandler(
    method: string,
    handler: Omit<OfficialRequestHandler, "version"> & { version?: number },
  ): void {
    this.requestHandlers.set(method, {
      version: handler.version ?? IPC_METHOD_VERSIONS[method] ?? 0,
      canHandle: handler.canHandle,
      handle: handler.handle,
    });
  }

  async sendThreadFollowerStartTurn(
    threadId: string,
    turnStartParams: unknown,
  ): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-start-turn",
      threadId,
      { conversationId: threadId, turnStartParams },
      ownerClientId,
    );
  }

  async sendThreadFollowerInterruptTurn(
    threadId: string,
    turnId: string,
  ): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-interrupt-turn",
      threadId,
      { conversationId: threadId, turnId },
      ownerClientId,
    );
  }

  async sendThreadFollowerSteerTurn(
    threadId: string,
    turnSteerParams: unknown,
  ): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-steer-turn",
      threadId,
      this.buildThreadFollowerSteerParams(threadId, turnSteerParams),
      ownerClientId,
    );
  }

  async sendThreadFollowerCompactThread(threadId: string): Promise<unknown> {
    if (this.isOwnedConversation(threadId))
      throw new Error("no-official-owner");
    const ownerClientId = this.getExternalOwnerClientId(threadId) || undefined;
    return await this.sendFollowerRequestWithDiscoveryRetry(
      "thread-follower-compact-thread",
      threadId,
      { conversationId: threadId },
      ownerClientId,
    );
  }

  private buildThreadFollowerSteerParams(
    threadId: string,
    turnSteerParams: unknown,
  ): Record<string, unknown> {
    const record = asRecord(turnSteerParams) ?? {};
    const params: Record<string, unknown> = {
      conversationId: threadId,
      input: Array.isArray(record.input) ? record.input : [],
    };
    if ("restoreMessage" in record)
      params.restoreMessage = record.restoreMessage;
    if ("attachments" in record) params.attachments = record.attachments;
    return params;
  }

  private async sendFollowerRequestWithDiscoveryRetry(
    method: string,
    threadId: string,
    params: unknown,
    ownerClientId?: string,
  ): Promise<unknown> {
    const requestRecord = this.startFollowerRequestRecord(
      method,
      threadId,
      ownerClientId,
    );
    try {
      const response = await this.sendRequest(method, params, ownerClientId);
      this.finishFollowerRequestRecord(requestRecord, "success", response);
      return response.result ?? null;
    } catch (error) {
      this.finishFollowerRequestRecord(requestRecord, "error", null, error);
      if (!this.shouldRetryFollowerViaDiscovery(method, ownerClientId, error)) {
        throw error;
      }
      const discoveryRecord = this.startFollowerRequestRecord(method, threadId);
      try {
        const response = await this.sendRequest(method, params);
        this.finishFollowerRequestRecord(discoveryRecord, "success", response);
        return response.result ?? null;
      } catch (discoveryError) {
        this.finishFollowerRequestRecord(
          discoveryRecord,
          "error",
          null,
          discoveryError,
        );
        throw discoveryError;
      }
    }
  }

  private shouldRetryFollowerViaDiscovery(
    method: string,
    ownerClientId: string | undefined,
    error: unknown,
  ): boolean {
    if (!ownerClientId) return false;
    const message = error instanceof Error ? error.message : String(error);
    return (
      message === `official-ipc-request-failed:${method}` ||
      message.includes("no-client") ||
      message.includes("client-not-found") ||
      message.includes("target-client") ||
      message.includes(`official-ipc-timeout:${method}`) ||
      message.includes(`official-ipc-disconnected:${method}`)
    );
  }

  broadcastConversationSnapshot(
    threadId: string,
    conversationState: unknown,
  ): boolean {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId || !this.clientId) return false;
    this.ownedConversationIds.add(normalizedThreadId);
    this.storeThreadStreamState({
      threadId: normalizedThreadId,
      conversationId: normalizedThreadId,
      hostId: "local",
      ownerClientId: this.clientId,
      sourceClientId: this.clientId,
      conversationState,
      changeType: "snapshot",
    });
    this.sendBroadcast("thread-stream-state-changed", {
      hostId: "local",
      conversationId: normalizedThreadId,
      change: { type: "snapshot", conversationState },
    });
    return true;
  }

  hydrateThreadStreamState(input: {
    threadId: string;
    conversationState: unknown;
    hostId?: string | null;
    ownerClientId?: string | null;
    sourceClientId?: string | null;
  }): boolean {
    const normalizedThreadId = input.threadId.trim();
    if (!normalizedThreadId || !input.conversationState) return false;
    const existing = this.streamStates.get(normalizedThreadId);
    const ownerClientId =
      input.ownerClientId ?? existing?.ownerClientId ?? null;
    const sourceClientId =
      input.sourceClientId ?? existing?.sourceClientId ?? null;
    this.releaseOwnedConversationIfExternal({
      conversationId: normalizedThreadId,
      previousOwnerClientId: existing?.ownerClientId ?? null,
      nextOwnerClientId: ownerClientId,
      sourceClientId,
    });
    this.storeThreadStreamState({
      threadId: normalizedThreadId,
      conversationId: normalizedThreadId,
      hostId: input.hostId || existing?.hostId || "local",
      ownerClientId,
      sourceClientId,
      conversationState: input.conversationState,
      changeType: "snapshot",
    });
    if (
      this.lastError ===
      `official-ipc-patches-without-snapshot:${normalizedThreadId}`
    ) {
      this.lastError = null;
    }
    return true;
  }

  releaseOwnedConversation(threadId: string, reason?: string): void {
    const normalizedThreadId = threadId.trim();
    if (!this.ownedConversationIds.has(normalizedThreadId)) return;
    const existing = this.streamStates.get(normalizedThreadId);
    this.ownedConversationIds.delete(normalizedThreadId);
    this.streamStates.delete(normalizedThreadId);
    this.recordOwnershipHandoff({
      conversationId: normalizedThreadId,
      previousOwnerClientId: existing?.ownerClientId ?? this.clientId,
      nextOwnerClientId: null,
      sourceClientId: this.clientId,
      reason,
    });
  }

  private getRegisteredRequestHandlers(): RegisteredRequestHandlerRecord[] {
    return Array.from(this.requestHandlers.entries())
      .map(([method, handler]) => ({ method, version: handler.version }))
      .sort((left, right) => left.method.localeCompare(right.method));
  }

  private startFollowerRequestRecord(
    method: string,
    threadId: string,
    targetClientId?: string,
  ): FollowerRequestRecord {
    const record: FollowerRequestRecord = {
      atIso: new Date().toISOString(),
      method,
      threadId,
      targetClientId: targetClientId ?? null,
      usedDiscovery: !targetClientId,
      result: "pending",
    };
    this.followerRequestHistory.push(record);
    if (this.followerRequestHistory.length > 20) {
      this.followerRequestHistory.splice(
        0,
        this.followerRequestHistory.length - 20,
      );
    }
    return record;
  }

  private finishFollowerRequestRecord(
    record: FollowerRequestRecord,
    result: "success" | "error",
    response: OfficialIpcFrame | null,
    error?: unknown,
  ): void {
    record.result = result;
    record.handledByClientId = readString(response?.handledByClientId) || null;
    if (error)
      record.error = error instanceof Error ? error.message : String(error);
  }

  private getExternalOwnerClientId(threadId: string): string {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return "";
    const state = this.streamStates.get(normalizedThreadId);
    const ownerClientId = state?.ownerClientId ?? "";
    if (!ownerClientId || ownerClientId === this.clientId) return "";
    return ownerClientId;
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || !this.pipePath) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, RECONNECT_DELAY_MS);
  }

  private async initialize(): Promise<void> {
    try {
      const response = await this.sendRequest(
        "initialize",
        { clientType: "codex-web-local" },
        undefined,
        0,
        INITIALIZE_REQUEST_TIMEOUT_MS,
      );
      const result = asRecord(response.result);
      const clientId =
        readString(result?.clientId) || readString(response.handledByClientId);
      if (clientId) this.clientId = clientId;
    } catch (error) {
      this.lastError =
        error instanceof Error
          ? error.message
          : "official-ipc-initialize-failed";
    }
  }

  private handleData(chunk: Buffer): void {
    this.incoming = Buffer.concat([this.incoming, chunk]);
    while (this.incoming.length >= 4) {
      const frameLength = this.incoming.readUInt32LE(0);
      if (frameLength <= 0 || frameLength > MAX_FRAME_BYTES) {
        this.lastError = `official-ipc-invalid-frame:${frameLength}`;
        this.socket?.destroy();
        return;
      }
      if (this.incoming.length < frameLength + 4) return;
      const raw = this.incoming.subarray(4, frameLength + 4).toString("utf8");
      this.incoming = this.incoming.subarray(frameLength + 4);
      try {
        const frame = JSON.parse(raw) as OfficialIpcFrame;
        this.recordRawFrame("incoming", frame, frameLength);
        this.handleFrame(frame);
      } catch (error) {
        this.lastError =
          error instanceof Error
            ? error.message
            : "official-ipc-frame-parse-failed";
      }
    }
  }

  private handleFrame(frame: OfficialIpcFrame): void {
    const type = readString(frame.type);
    if (type === "response") {
      this.handleResponse(frame);
      return;
    }
    if (type === "broadcast") {
      this.handleBroadcast(frame);
      return;
    }
    if (type === "client-discovery-request") {
      void this.handleClientDiscoveryRequest(frame);
      return;
    }
    if (type === "request") {
      void this.handleRequest(frame);
    }
  }

  private handleResponse(frame: OfficialIpcFrame): void {
    const requestId = readString(frame.requestId);
    const pending = requestId ? this.pendingRequests.get(requestId) : null;
    if (!pending) return;
    this.pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    if (isSuccessResponse(frame)) pending.resolve(frame);
    else
      pending.reject(
        new Error(
          responseErrorMessage(
            frame,
            `official-ipc-request-failed:${pending.method}`,
          ),
        ),
      );
  }

  private handleBroadcast(frame: OfficialIpcFrame): void {
    const method = readString(frame.method);
    if (method === "thread-stream-state-changed") {
      this.handleThreadStreamStateChanged(frame);
      return;
    }
    if (method === "thread-archived") {
      this.handleThreadArchived(frame);
      return;
    }
    if (method === "thread-unarchived") {
      this.handleThreadUnarchived(frame);
    }
  }

  private readThreadLifecycleBroadcast(frame: OfficialIpcFrame): {
    threadId: string;
    sourceClientId: string | null;
  } | null {
    const params = asRecord(frame.params);
    const threadId = readOfficialConversationId(params);
    if (!threadId) return null;
    return {
      threadId,
      sourceClientId:
        readString(frame.sourceClientId) ||
        readString(params?.sourceClientId) ||
        null,
    };
  }

  private handleThreadArchived(frame: OfficialIpcFrame): void {
    const lifecycle = this.readThreadLifecycleBroadcast(frame);
    if (!lifecycle) return;
    const existing = this.streamStates.get(lifecycle.threadId);
    const wasOwned = this.ownedConversationIds.delete(lifecycle.threadId);
    this.streamStates.delete(lifecycle.threadId);
    if (wasOwned || existing) {
      this.recordOwnershipHandoff({
        conversationId: lifecycle.threadId,
        previousOwnerClientId: existing?.ownerClientId ?? this.clientId,
        nextOwnerClientId: null,
        sourceClientId: lifecycle.sourceClientId,
        reason: "thread-archived",
      });
    }
    this.emitNotification({
      method: OFFICIAL_THREAD_ARCHIVED_METHOD,
      params: {
        threadId: lifecycle.threadId,
        conversationId: lifecycle.threadId,
        sourceClientId: lifecycle.sourceClientId,
      },
      atIso: new Date().toISOString(),
    });
  }

  private handleThreadUnarchived(frame: OfficialIpcFrame): void {
    const lifecycle = this.readThreadLifecycleBroadcast(frame);
    if (!lifecycle) return;
    this.emitNotification({
      method: OFFICIAL_THREAD_UNARCHIVED_METHOD,
      params: {
        threadId: lifecycle.threadId,
        conversationId: lifecycle.threadId,
        sourceClientId: lifecycle.sourceClientId,
      },
      atIso: new Date().toISOString(),
    });
  }

  private handleThreadStreamStateChanged(frame: OfficialIpcFrame): void {
    const params = asRecord(frame.params);
    if (!params) return;
    const hostId =
      readString(params.hostId) || readString(params.host_id) || "local";

    const conversationId = readOfficialConversationId(params);
    if (!conversationId) return;

    const change = asRecord(params.change);
    const changeType = readString(change?.type);
    const existing = this.streamStates.get(conversationId);
    const sourceClientId =
      readString(frame.sourceClientId) ||
      readString(params.sourceClientId) ||
      null;
    const ownerClientId = sourceClientId || existing?.ownerClientId || null;

    let conversationState: unknown = null;
    if (changeType === "snapshot") {
      conversationState = change?.conversationState ?? null;
    } else if (changeType === "patches") {
      if (!existing) {
        this.lastError = `official-ipc-patches-without-snapshot:${conversationId}`;
        this.emitNotification({
          method: OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
          params: {
            threadId: conversationId,
            conversationId,
            hostId,
            ownerClientId,
            sourceClientId,
            changeType: "patches-without-snapshot",
            cacheVersion: this.cacheVersion,
            isInProgress: false,
            activeTurnId: "",
          },
          atIso: new Date().toISOString(),
        });
        return;
      }
      conversationState = applyOfficialIpcPatches(
        existing.conversationState,
        change?.patches,
      );
    } else {
      return;
    }
    if (!conversationState) return;
    if (
      changeType === "snapshot" &&
      this.shouldIgnoreInactiveSnapshot({
        existing,
        conversationState,
        sourceClientId,
      })
    ) {
      return;
    }
    this.releaseOwnedConversationIfExternal({
      conversationId,
      previousOwnerClientId: existing?.ownerClientId ?? null,
      nextOwnerClientId: ownerClientId,
      sourceClientId,
    });

    this.storeThreadStreamState({
      threadId: conversationId,
      conversationId,
      hostId,
      ownerClientId,
      sourceClientId,
      conversationState,
      changeType: changeType === "patches" ? "patches" : "snapshot",
    });
    if (
      this.lastError ===
      `official-ipc-patches-without-snapshot:${conversationId}`
    ) {
      this.lastError = null;
    }
  }

  private shouldIgnoreInactiveSnapshot(input: {
    existing: OfficialThreadStreamState | undefined;
    conversationState: unknown;
    sourceClientId: string | null;
  }): boolean {
    if (!input.existing?.isInProgress) return false;
    if (readIsInProgress(input.conversationState)) return false;
    const conversation = asRecord(input.conversationState);
    const status = compactStatus(conversation?.status ?? conversation?.state);
    if (status === "notloaded") return true;
    return Boolean(
      input.sourceClientId &&
      input.existing.ownerClientId &&
      input.sourceClientId !== input.existing.ownerClientId,
    );
  }

  private storeThreadStreamState(input: {
    threadId: string;
    conversationId: string;
    hostId: string;
    ownerClientId: string | null;
    sourceClientId: string | null;
    conversationState: unknown;
    changeType: "snapshot" | "patches";
  }): void {
    const cacheVersion = ++this.cacheVersion;
    const state: OfficialThreadStreamState = {
      ...input,
      cacheVersion,
      updatedAtIso: new Date().toISOString(),
      isInProgress: readIsInProgress(input.conversationState),
      activeTurnId: readActiveTurnId(input.conversationState),
    };
    this.streamStates.set(input.conversationId, state);
    this.emitNotification({
      method: OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
      params: {
        threadId: input.threadId,
        conversationId: input.conversationId,
        hostId: input.hostId,
        ownerClientId: input.ownerClientId,
        sourceClientId: input.sourceClientId,
        changeType: input.changeType,
        cacheVersion,
        isInProgress: state.isInProgress,
        activeTurnId: state.activeTurnId,
      },
      atIso: state.updatedAtIso,
    });
  }

  private releaseOwnedConversationIfExternal(input: {
    conversationId: string;
    previousOwnerClientId: string | null;
    nextOwnerClientId: string | null;
    sourceClientId: string | null;
  }): void {
    if (!this.ownedConversationIds.has(input.conversationId)) return;
    const externalSource = Boolean(
      input.sourceClientId && input.sourceClientId !== this.clientId,
    );
    const externalOwner = Boolean(
      input.nextOwnerClientId && input.nextOwnerClientId !== this.clientId,
    );
    if (!externalSource && !externalOwner) return;
    this.ownedConversationIds.delete(input.conversationId);
    this.recordOwnershipHandoff(input);
  }

  private recordOwnershipHandoff(input: {
    conversationId: string;
    previousOwnerClientId: string | null;
    nextOwnerClientId: string | null;
    sourceClientId: string | null;
    reason?: string;
  }): void {
    this.ownershipHandoffHistory.push({
      atIso: new Date().toISOString(),
      conversationId: input.conversationId,
      previousOwnerClientId: input.previousOwnerClientId,
      nextOwnerClientId: input.nextOwnerClientId,
      sourceClientId: input.sourceClientId,
      reason: input.reason,
    });
    if (this.ownershipHandoffHistory.length > 20) {
      this.ownershipHandoffHistory.splice(
        0,
        this.ownershipHandoffHistory.length - 20,
      );
    }
  }

  private async handleClientDiscoveryRequest(
    frame: OfficialIpcFrame,
  ): Promise<void> {
    const requestId = readString(frame.requestId);
    if (!requestId) return;
    const method = readString(frame.method);
    const params = frame.params ?? null;
    const canHandle = await this.canHandleRequest(
      method,
      params,
      typeof frame.version === "number" ? frame.version : undefined,
    );
    this.sendFrame({
      type: "client-discovery-response",
      requestId,
      clientId: this.clientId,
      canHandle,
    });
  }

  private async handleRequest(frame: OfficialIpcFrame): Promise<void> {
    const requestId = readString(frame.requestId);
    const method = readString(frame.method);
    if (!requestId || !method) return;
    const handler = this.requestHandlers.get(method);
    const canHandle = handler
      ? await this.canHandleRequest(
          method,
          frame.params ?? null,
          typeof frame.version === "number" ? frame.version : undefined,
        )
      : false;
    if (!handler || !canHandle) {
      this.sendFrame({
        type: "response",
        requestId,
        method,
        resultType: "error",
        error: { message: `no-handler:${method}` },
      });
      return;
    }

    try {
      const result = await handler.handle(frame.params ?? null);
      this.sendFrame({
        type: "response",
        requestId,
        method,
        resultType: "success",
        result,
      });
    } catch (error) {
      this.sendFrame({
        type: "response",
        requestId,
        method,
        resultType: "error",
        error: {
          message:
            error instanceof Error ? error.message : `request-failed:${method}`,
        },
      });
    }
  }

  private async canHandleRequest(
    method: string,
    params: unknown,
    version: number | undefined,
  ): Promise<boolean> {
    const handler = this.requestHandlers.get(method);
    if (!handler) return false;
    if (typeof version === "number" && version > handler.version) return false;
    if (!handler.canHandle) return true;
    try {
      return await handler.canHandle(params);
    } catch {
      return false;
    }
  }

  private sendRequest(
    method: string,
    params: unknown,
    targetClientId?: string,
    version = IPC_METHOD_VERSIONS[method] ?? 0,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<OfficialIpcFrame> {
    if (!this.connected || !this.socket) {
      this.start();
      return Promise.reject(new Error("official-ipc-not-connected"));
    }

    const requestId = randomUUID();
    const frame: OfficialIpcFrame = {
      type: "request",
      requestId,
      method,
      version,
      params,
    };
    if (this.clientId) frame.sourceClientId = this.clientId;
    if (targetClientId) frame.targetClientId = targetClientId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`official-ipc-timeout:${method}`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { method, resolve, reject, timeout });
      try {
        this.sendFrame(frame);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(
          error instanceof Error
            ? error
            : new Error(`official-ipc-send-failed:${method}`),
        );
      }
    });
  }

  private sendBroadcast(method: string, params: unknown): void {
    if (!this.connected || !this.socket) {
      this.start();
      return;
    }
    const frame: OfficialIpcFrame = {
      type: "broadcast",
      method,
      version: IPC_METHOD_VERSIONS[method] ?? 0,
      params,
    };
    if (this.clientId) frame.sourceClientId = this.clientId;
    this.sendFrame(frame);
  }

  private sendFrame(frame: OfficialIpcFrame): void {
    if (!this.socket || !this.connected)
      throw new Error("official-ipc-not-connected");
    const payload = Buffer.from(JSON.stringify(frame), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(payload.length, 0);
    this.recordRawFrame("outgoing", frame, payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }

  private emitNotification(notification: OfficialIpcNotification): void {
    for (const listener of this.listeners) listener(notification);
  }

  private recordRawFrame(
    direction: RawFrameRecord["direction"],
    frame: OfficialIpcFrame,
    byteLength: number,
  ): void {
    if (!this.rawFrameLogging) return;
    const record: RawFrameRecord = {
      atIso: new Date().toISOString(),
      direction,
      byteLength,
      type: readString(frame.type) || "unknown",
      method: readString(frame.method) || null,
      requestId: readString(frame.requestId) || null,
      sourceClientId: readString(frame.sourceClientId) || null,
      targetClientId: readString(frame.targetClientId) || null,
      preview: this.buildRawFramePreview(frame),
    };
    this.rawFrameHistory.push(record);
    if (this.rawFrameHistory.length > 40) {
      this.rawFrameHistory.splice(0, this.rawFrameHistory.length - 40);
    }
  }

  private buildRawFramePreview(frame: OfficialIpcFrame): unknown {
    const preview = { ...frame };
    if ("params" in preview) preview.params = "[redacted]";
    if ("result" in preview) preview.result = "[redacted]";
    return preview;
  }
}
