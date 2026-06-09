import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  getCodexSpawnInvocation,
  resolveCodexCommand,
} from "./codexCommand.js";

type JsonRpcRecord = Record<string, unknown>;

type PendingCall = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ServerRequestHandler = {
  handle: (
    params: unknown,
    request: { id: number; method: string },
  ) => unknown | Promise<unknown>;
};

export type AppServerNotification = {
  method: string;
  params: unknown;
  atIso: string;
};

export type ThreadListParams = {
  archived?: boolean;
  limit?: number;
  sortKey?: "updated_at" | string;
  sortDirection?: "asc" | "desc" | string;
  modelProviders?: string[];
  sourceKinds?: string[];
  cwd?: string;
  searchTerm?: string;
  useStateDbOnly?: boolean;
  cursor?: string | null;
};

export type ThreadSearchParams = {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: "created_at" | "updated_at";
  sortDirection?: "asc" | "desc";
  sourceKinds?: string[] | null;
  archived?: boolean | null;
  searchTerm: string;
};

export type ThreadReadParams = {
  threadId: string;
  includeTurns: boolean;
};

export type ThreadTurnsListParams = {
  threadId: string;
  cursor?: string | null;
  limit?: number | null;
};

export type ThreadStartParams = {
  cwd: string;
  runtimeWorkspaceRoots?: string[];
  threadSource?: string;
  permissions?: string;
  environments?: Array<Record<string, unknown>>;
};

export type ThreadResumeParams = {
  threadId: string;
  cwd?: string | null;
  permissions?: string;
  runtimeWorkspaceRoots?: string[];
  excludeTurns?: boolean;
  environments?: Array<Record<string, unknown>>;
};

export type ThreadForkParams = {
  threadId: string;
  path?: string | null;
  cwd?: string | null;
  threadSource?: string;
  config?: Record<string, unknown>;
  developerInstructions?: string;
  excludeTurns?: boolean;
  ephemeral?: boolean;
};

export type ThreadRollbackParams = {
  threadId: string;
  numTurns: number;
};

export type ThreadInjectItemsParams = {
  threadId: string;
  items: Array<Record<string, unknown>>;
};

export type TurnStartParams = {
  threadId: string;
  input: Array<Record<string, unknown>>;
  clientUserMessageId?: string;
  cwd?: string | null;
  attachments?: Array<Record<string, unknown>>;
  restoreMessage?: Record<string, unknown>;
  model?: string;
  serviceTier?: string | null;
  effort?: string;
  summary?: string | null;
  personality?: string | null;
  outputSchema?: Record<string, unknown>;
  collaborationMode?: Record<string, unknown>;
  approvalPolicy?: string;
  approvalsReviewer?: string;
  sandboxPolicy?: SandboxPolicy;
  permissions?: string;
  runtimeWorkspaceRoots?: string[];
  environments?: Array<Record<string, unknown>>;
};

export type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly"; networkAccess: boolean }
  | {
      type: "workspaceWrite";
      writableRoots: string[];
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
    };

export type TurnSteerParams = {
  threadId: string;
  expectedTurnId: string;
  input: Array<Record<string, unknown>>;
  clientUserMessageId?: string;
  restoreMessage?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
};

export type TurnInterruptParams = {
  threadId: string;
  turnId: string;
};

export type ThreadArchiveParams = {
  threadId: string;
};

export type ThreadUnarchiveParams = {
  threadId: string;
};

export type ThreadRenameParams = {
  threadId: string;
  name: string;
};

export type ThreadCompactStartParams = {
  threadId: string;
};

export type ThreadGoalGetParams = {
  threadId: string;
};

export type ThreadGoalSetParams = {
  threadId: string;
  objective?: string;
  status?: "active" | "paused";
};

export type ThreadGoalClearParams = {
  threadId: string;
};

export type ThreadSettingsUpdateParams = {
  threadId: string;
  cwd?: string | null;
  approvalPolicy?: string | null;
  approvalsReviewer?: string | null;
  sandboxPolicy?: SandboxPolicy | null;
  permissions?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: string | null;
  summary?: string | null;
  personality?: string | null;
  collaborationMode?: Record<string, unknown> | null;
};

export type PermissionProfileListParams = {
  cwd?: string;
  cursor?: string | null;
  limit?: number;
};

export type SkillsListParams = {
  cwds?: string[];
  forceReload?: boolean;
  perCwdExtraUserRoots?: Array<Record<string, unknown>> | null;
};

export type AuthStatusParams = {
  includeToken?: boolean;
  refreshToken?: boolean;
};

export type AuthStatusResult = {
  authMethod?: string;
  authToken?: string | null;
  requiresOpenaiAuth?: boolean;
  [key: string]: unknown;
};

function asRecord(value: unknown): JsonRpcRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRpcRecord)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorFromJsonRpc(value: unknown, fallback: string): Error {
  const record = asRecord(value);
  const message = readString(record?.message) || fallback;
  const error = new Error(message);
  const code = record?.code;
  if (typeof code === "number" || typeof code === "string") {
    Object.assign(error, { code });
  }
  return error;
}

export type AppServerStderrClassification =
  | { level: "warning" | "error"; message: string }
  | { level: "ignore"; message: string };

export function classifyAppServerStderrLine(
  line: string,
): AppServerStderrClassification {
  const trimmed = line.trim();
  if (!trimmed) return { level: "ignore", message: "" };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record = asRecord(parsed);
    const level = readString(record?.level).toLowerCase();
    const fields = asRecord(record?.fields);
    const message =
      readString(fields?.message) || readString(record?.message) || trimmed;
    if (level === "warn" || level === "warning")
      return { level: "warning", message };
    if (level === "error" || level === "fatal")
      return { level: "error", message };
    if (level === "info" || level === "debug" || level === "trace")
      return { level: "ignore", message };
  } catch {
    // Fall through to text classification.
  }

  if (/\bwarn(?:ing)?\b/i.test(trimmed))
    return { level: "warning", message: trimmed };
  return { level: "error", message: trimmed };
}

export class CodexAppServerProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private stdoutBuffer = "";
  private pending = new Map<number, PendingCall>();
  private listeners = new Set<(notification: AppServerNotification) => void>();
  private serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private initialized = false;
  private starting: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastWarning: string | null = null;

  constructor(private readonly timeoutMs = 30_000) {}

  getStatus(): Record<string, unknown> {
    return {
      running: Boolean(this.child && !this.child.killed),
      pid: this.child?.pid ?? null,
      initialized: this.initialized,
      pendingCallCount: this.pending.size,
      lastError: this.lastError,
      lastWarning: this.lastWarning,
    };
  }

  onNotification(
    listener: (notification: AppServerNotification) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  registerServerRequestHandler(
    method: string,
    handler: ServerRequestHandler,
  ): void {
    this.serverRequestHandlers.set(method, handler);
  }

  async threadList(params: ThreadListParams = {}): Promise<unknown> {
    return await this.rpc("thread/list", {
      archived: params.archived ?? false,
      limit: params.limit ?? 50,
      sortKey: params.sortKey ?? "updated_at",
      modelProviders: params.modelProviders ?? [],
      ...(params.sortDirection ? { sortDirection: params.sortDirection } : {}),
      ...(params.sourceKinds ? { sourceKinds: params.sourceKinds } : {}),
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.searchTerm ? { searchTerm: params.searchTerm } : {}),
      ...(params.useStateDbOnly === undefined
        ? {}
        : { useStateDbOnly: params.useStateDbOnly }),
      ...(params.cursor ? { cursor: params.cursor } : {}),
    });
  }

  async threadSearch(params: ThreadSearchParams): Promise<unknown> {
    return await this.rpc("thread/search", {
      cursor: params.cursor ?? null,
      limit: params.limit ?? null,
      sortKey: params.sortKey ?? null,
      sortDirection: params.sortDirection ?? null,
      sourceKinds: params.sourceKinds ?? null,
      archived: params.archived ?? null,
      searchTerm: params.searchTerm,
    });
  }

  async threadRead(params: ThreadReadParams): Promise<unknown> {
    return await this.rpc("thread/read", params);
  }

  async threadTurnsList(params: ThreadTurnsListParams): Promise<unknown> {
    return await this.rpc("thread/turns/list", {
      threadId: params.threadId,
      cursor: params.cursor ?? null,
      limit: params.limit ?? null,
    });
  }

  async threadStart(params: ThreadStartParams): Promise<unknown> {
    return await this.rpc("thread/start", params);
  }

  async threadResume(params: ThreadResumeParams): Promise<unknown> {
    return await this.rpc("thread/resume", params);
  }

  async threadFork(params: ThreadForkParams): Promise<unknown> {
    return await this.rpc("thread/fork", params);
  }

  async threadRollback(params: ThreadRollbackParams): Promise<unknown> {
    return await this.rpc("thread/rollback", params);
  }

  async threadInjectItems(params: ThreadInjectItemsParams): Promise<unknown> {
    return await this.rpc("thread/inject_items", params);
  }

  async turnStart(params: TurnStartParams): Promise<unknown> {
    return await this.rpc("turn/start", params);
  }

  async turnSteer(params: TurnSteerParams): Promise<unknown> {
    return await this.rpc("turn/steer", params);
  }

  async turnInterrupt(params: TurnInterruptParams): Promise<unknown> {
    return await this.rpc("turn/interrupt", params);
  }

  async threadArchive(params: ThreadArchiveParams): Promise<unknown> {
    return await this.rpc("thread/archive", params);
  }

  async threadUnarchive(params: ThreadUnarchiveParams): Promise<unknown> {
    return await this.rpc("thread/unarchive", params);
  }

  async threadRename(params: ThreadRenameParams): Promise<unknown> {
    return await this.rpc("thread/name/set", params);
  }

  async threadCompactStart(params: ThreadCompactStartParams): Promise<unknown> {
    return await this.rpc("thread/compact/start", params);
  }

  async threadGoalGet(params: ThreadGoalGetParams): Promise<unknown> {
    return await this.rpc("thread/goal/get", params);
  }

  async threadGoalSet(params: ThreadGoalSetParams): Promise<unknown> {
    return await this.rpc("thread/goal/set", params);
  }

  async threadGoalClear(params: ThreadGoalClearParams): Promise<unknown> {
    return await this.rpc("thread/goal/clear", params);
  }

  async threadSettingsUpdate(
    params: ThreadSettingsUpdateParams,
  ): Promise<unknown> {
    return await this.rpc("thread/settings/update", params);
  }

  async modelList(
    params: { includeHidden?: boolean; limit?: number } = {},
  ): Promise<unknown> {
    return await this.rpc("model/list", {
      includeHidden: params.includeHidden ?? false,
      limit: params.limit ?? 100,
    });
  }

  async collaborationModeList(): Promise<unknown> {
    return await this.rpc("collaborationMode/list", {});
  }

  async permissionProfileList(
    params: PermissionProfileListParams = {},
  ): Promise<unknown> {
    return await this.rpc("permissionProfile/list", {
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    });
  }

  async skillsList(params: SkillsListParams = {}): Promise<unknown> {
    return await this.rpc("skills/list", {
      cwds: params.cwds ?? [],
      forceReload: params.forceReload ?? false,
      perCwdExtraUserRoots: params.perCwdExtraUserRoots ?? null,
    });
  }

  async accountRead(params: { refreshToken?: boolean } = {}): Promise<unknown> {
    return await this.rpc("account/read", {
      refreshToken: params.refreshToken ?? false,
    });
  }

  async accountRateLimitsRead(): Promise<unknown> {
    return await this.rpc("account/rateLimits/read", {});
  }

  async getAuthStatus(
    params: AuthStatusParams = {},
  ): Promise<AuthStatusResult> {
    return await this.rpc<AuthStatusResult>("getAuthStatus", {
      includeToken: params.includeToken ?? false,
      refreshToken: params.refreshToken ?? false,
    });
  }

  async getAuthToken(
    params: Pick<AuthStatusParams, "refreshToken"> = {},
  ): Promise<string | null> {
    const status = await this.getAuthStatus({
      includeToken: true,
      refreshToken: params.refreshToken ?? false,
    });
    return typeof status.authToken === "string" && status.authToken.trim()
      ? status.authToken.trim()
      : null;
  }

  async configRequirementsRead(): Promise<unknown> {
    return await this.rpc("configRequirements/read", {});
  }

  async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureInitialized();
    return await this.call<T>(method, params);
  }

  async warmUp(): Promise<void> {
    await this.ensureInitialized();
  }

  dispose(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`app-server-disposed:${pending.method}`));
      this.pending.delete(id);
    }
    this.child?.kill();
    this.child = null;
    this.initialized = false;
    this.starting = null;
    this.listeners.clear();
    this.serverRequestHandlers.clear();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.starting) return await this.starting;
    this.starting = this.startAndInitialize();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startAndInitialize(): Promise<void> {
    this.start();
    await this.call("initialize", {
      clientInfo: {
        name: "codex_web",
        title: "Codex Web",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.sendNotification("initialized");
    this.initialized = true;
  }

  private start(): void {
    if (this.child && !this.child.killed) return;

    const command = resolveCodexCommand();
    const invocation = getCodexSpawnInvocation(command, ["app-server"]);
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: invocation.shell,
      env: process.env,
    });
    this.child = child;
    this.initialized = false;
    this.stdoutBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.handleStdout(chunk);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const classification = classifyAppServerStderrLine(line);
        if (classification.level === "warning")
          this.lastWarning = classification.message.slice(0, 1000);
        if (classification.level === "error")
          this.lastError = classification.message.slice(0, 1000);
      }
    });

    child.on("error", (error) => {
      this.lastError = error.message;
    });

    child.on("exit", (code, signal) => {
      this.lastError = `app-server-exit:${code ?? "null"}:${signal ?? "null"}`;
      this.initialized = false;
      this.child = null;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`app-server-exited:${pending.method}`));
        this.pending.delete(id);
      }
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) return;
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let payload: JsonRpcRecord;
    try {
      const parsed = JSON.parse(line) as unknown;
      const record = asRecord(parsed);
      if (!record) return;
      payload = record;
    } catch {
      this.lastError = `app-server-invalid-json:${line.slice(0, 200)}`;
      return;
    }

    const id = typeof payload.id === "number" ? payload.id : null;
    const method = readString(payload.method);

    if (id !== null && this.pending.has(id)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      if ("error" in payload) {
        pending.reject(
          errorFromJsonRpc(
            payload.error,
            `app-server-rpc-failed:${pending.method}`,
          ),
        );
      } else {
        pending.resolve(payload.result ?? null);
      }
      return;
    }

    if (method && id === null) {
      this.emitNotification({
        method,
        params: payload.params ?? null,
        atIso: new Date().toISOString(),
      });
      return;
    }

    if (method && id !== null) {
      void this.handleServerRequest(id, method, payload.params ?? null);
    }
  }

  private async handleServerRequest(
    id: number,
    method: string,
    params: unknown,
  ): Promise<void> {
    const handler = this.serverRequestHandlers.get(method);
    if (!handler) {
      this.replyToServerRequest(id, method, {
        error: {
          code: -32601,
          message: `client request not implemented: ${method}`,
        },
      });
      return;
    }

    try {
      const result = await handler.handle(params, { id, method });
      this.replyToServerRequest(id, method, { result: result ?? {} });
    } catch (error) {
      this.replyToServerRequest(id, method, {
        error: {
          code: -32000,
          message:
            error instanceof Error
              ? error.message
              : `client request failed: ${method}`,
        },
      });
    }
  }

  private call<T>(method: string, params?: unknown): Promise<T> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("app-server-not-running"));
    }
    const id = this.nextId++;
    const frame: JsonRpcRecord = {
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server-timeout:${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.child?.stdin.write(`${JSON.stringify(frame)}\n`);
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.child?.stdin.writable) return;
    const frame: JsonRpcRecord = {
      method,
      ...(params === undefined ? {} : { params }),
    };
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private replyToServerRequest(
    id: number,
    method: string,
    payload: { result?: unknown; error?: unknown },
  ): void {
    if (!this.child?.stdin.writable) return;
    const frame = {
      id,
      ...payload,
    };
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
    this.emitNotification({
      method: "client/server-request-unhandled",
      params: { id, method },
      atIso: new Date().toISOString(),
    });
  }

  private emitNotification(notification: AppServerNotification): void {
    for (const listener of this.listeners) listener(notification);
  }
}
