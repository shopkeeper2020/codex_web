import { basename, isAbsolute, relative, resolve } from "node:path";
import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  accountStatusResponseSchema,
  approvalDecisionRequestSchema,
  approvalDecisionResponseSchema,
  appServerStatusResponseSchema,
  approvalsResponseSchema,
  attachmentCleanupResponseSchema,
  attachmentResponseSchema,
  attachmentStorageResponseSchema,
  attachmentsResponseSchema,
  cacheStatusResponseSchema,
  diagnosticsExportResponseSchema,
  diagnosticsResponseSchema,
  favoriteProjectRemoveRequestSchema,
  favoriteProjectRequestSchema,
  favoriteProjectsResponseSchema,
  fileBrowserListingResponseSchema,
  filePreviewResponseSchema,
  formatZodError,
  authOkResponseSchema,
  lanAccessResponseSchema,
  nativeDictationStartResponseSchema,
  nativeDictationStatusResponseSchema,
  nativeDictationTranscribeResponseSchema,
  officialIpcStatusResponseSchema,
  lanPasswordUpdateRequestSchema,
  protocolCompatibilityResponseSchema,
  runtimeOptionsResponseSchema,
  settingsResponseSchema,
  settingsUpdateRequestSchema,
  sideConversationCloseRequestSchema,
  sideConversationCloseResponseSchema,
  sideConversationCreateRequestSchema,
  sideConversationCreateResponseSchema,
  skillsResponseSchema,
  syncReadinessResponseSchema,
  threadArchiveRequestSchema,
  threadArchiveResponseSchema,
  threadCompactRequestSchema,
  threadCompactResponseSchema,
  threadCreateRequestSchema,
  threadCreateResponseSchema,
  threadDetailResponseSchema,
  threadGoalClearRequestSchema,
  threadGoalResponseSchema,
  threadGoalSetRequestSchema,
  threadListResponseSchema,
  threadPinRequestSchema,
  threadPinResponseSchema,
  threadRenameRequestSchema,
  threadRenameResponseSchema,
  threadStopBackgroundRequestSchema,
  threadStopBackgroundResponseSchema,
  threadUnarchiveRequestSchema,
  threadUnarchiveResponseSchema,
  turnInterruptRequestSchema,
  turnStartRequestSchema,
  turnSteerRequestSchema,
  workspaceStatusResponseSchema,
  type AccountStatusResponse,
} from "@codex-web/api";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_DEV_PORT,
  loadRuntimeConfig,
  readLocalConfigFile,
  updateLocalConfigFile,
  type LocalConfigFile,
  type RuntimeConfig,
} from "@codex-web/config";
import {
  mergeThreadListProjects,
  normalizeOfficialConversationState,
  normalizeOfficialThreadDetail,
  normalizeThreadGoal,
  normalizeOfficialThreadList,
  normalizeProjectPath,
  projectFromPath,
  type Project,
  type Owner,
  type Thread,
  type ThreadList,
  type ThreadDetail,
  type ThreadGoal,
  type ThreadSideConversation,
  type Attachment,
} from "@codex-web/domain";
import {
  OFFICIAL_THREAD_ARCHIVED_METHOD,
  OFFICIAL_THREAD_STREAM_CHANGED_METHOD,
  OFFICIAL_THREAD_UNARCHIVED_METHOD,
  OfficialIpcBridge,
  classifyAppServerNotification,
  type OfficialIpcNotification,
  type OfficialThreadStreamState,
} from "@codex-web/protocol";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { CodexAppServerProcess } from "./appServerProcess.js";
import { initializeAuth } from "./auth/config.js";
import { installAuth } from "./auth/middleware.js";
import type {
  SandboxPolicy,
  TurnStartParams,
  TurnSteerParams,
} from "./appServerProcess.js";
import { Diagnostics } from "./diagnostics.js";
import { syncDesktopWorkspaceRoot } from "./desktopWorkspaceRoots.js";
import { buildSafeDiagnosticsExport } from "./diagnosticsExport.js";
import { DatabaseStore } from "./db/index.js";
import { EventBus } from "./events.js";
import { archiveThreadWithRecovery, startLocalTurn } from "./threadActions.js";
import { toOfficialTurnSteerParams } from "./appServerParams.js";
import { cleanupUnassociatedAttachments } from "./attachmentCleanup.js";
import {
  persistMultipartAttachment,
  toTurnStartAttachment,
  toTurnStartImageInput,
  type TurnStartImageInput,
} from "./attachments.js";
import { ApprovalCoordinator } from "./approvals.js";
import { FileBrowserError, listProjectDirectory } from "./fileBrowser.js";
import {
  createFilePreviewStream,
  detectFileMimeType,
  readFilePreview,
  resolveFilePreviewPath,
} from "./filePreview.js";
import { normalizeRuntimeOptions } from "./runtimeOptions.js";
import { normalizeSkillsListResponse } from "./skills.js";
import { attachOfficialSideConversations } from "./sideConversations.js";
import {
  installLocalOwnerSnapshotSync,
  preserveSideConversationMetadata,
  readAppServerThreadSnapshot,
} from "./syncCoordinator.js";
import { decideLocalTurnFallback } from "./turnFallback.js";
import { buildProtocolCompatibility } from "./protocolCompatibility.js";
import { buildSyncReadiness } from "./syncReadiness.js";
import { readWorkspaceStatus } from "./workspaceStatus.js";
import { buildLanAccess } from "./lanAccess.js";
import {
  NativeDictationError,
  getNativeDictationStatus,
  triggerNativeDictation,
} from "./nativeDictation.js";
import {
  NativeTranscriptionError,
  transcribeNativeAudio,
} from "./nativeTranscription.js";
import { LocalLiveThreadStore } from "./localLiveThreadStore.js";

const THREAD_GOAL_READ_TIMEOUT_MS = 1200;
const ACCOUNT_STATUS_CACHE_TTL_MS = 30_000;
const APP_SERVER_LIVE_DELTA_METHODS = new Set([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
]);
const SIDE_CONVERSATION_BOUNDARY_TEXT = `Side conversation boundary.

Everything before this boundary is inherited history from the parent thread. It is reference context only. It is not your current task.

Do not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.

You are a side-conversation assistant, separate from the main thread. Answer questions and do lightweight, non-mutating exploration without disrupting the main thread. If there is no user question after this boundary yet, wait for one.

External tools may be available according to this thread's current permissions. Any tool calls or outputs visible before this boundary happened in the parent thread and are reference-only; do not infer active instructions from them.

Do not modify files, source, git state, permissions, configuration, or workspace state unless the user explicitly asks for that mutation after this boundary. Do not request escalated permissions or broader sandbox access unless the user explicitly requests a mutation that requires it. If the user explicitly requests a mutation, keep it minimal, local to the request, and avoid disrupting the main thread.`;

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function isTransientEmptyRolloutReadError(error: unknown): boolean {
  const message = errorMessage(error).toLocaleLowerCase();
  return (
    message.includes("failed to read thread") &&
    message.includes("rollout") &&
    message.includes("jsonl") &&
    message.includes("is empty")
  );
}

function readOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function readOptionalPort(value: unknown): number | null {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  const port = Math.trunc(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => readString(entry)).filter(Boolean)
    : [];
}

function readNumberTimestampIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

function sideConversationTitle(index = 0): string {
  return index === 0 ? "侧边聊天" : `侧边聊天 ${index + 1}`;
}

function sideConversationFromFork(input: {
  threadId: string;
  forkThread: Record<string, unknown>;
  title?: string;
}): ThreadSideConversation {
  return {
    id: input.threadId,
    title: input.title ?? sideConversationTitle(),
    createdAtIso: readNumberTimestampIso(input.forkThread.createdAt),
    updatedAtIso:
      readNumberTimestampIso(input.forkThread.updatedAt) ??
      readNumberTimestampIso(input.forkThread.createdAt),
    inProgress: false,
    hasUnread: false,
    turnCount: 0,
    turns: [],
  };
}

function buildSideConversationSnapshot(input: {
  sideThreadId: string;
  parentThreadId: string;
  cwd: string | null;
  forkThread: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...input.forkThread,
    id: input.sideThreadId,
    cwd: input.cwd ?? (readString(input.forkThread.cwd) || null),
    source: readString(input.forkThread.source) || "user",
    sideConversation: true,
    ephemeral: true,
    parentThreadId: input.parentThreadId,
    parentConversationId: input.parentThreadId,
    sourceThreadId: input.parentThreadId,
    sourceConversationId: input.parentThreadId,
    forkedFromId:
      readString(input.forkThread.forkedFromId) || input.parentThreadId,
    turns: [],
  };
}

function readActiveTurnIdFromStreamState(
  state: OfficialThreadStreamState | null,
): string {
  if (readString(state?.activeTurnId)) return readString(state?.activeTurnId);
  const record = asRecord(state?.conversationState);
  const turns = Array.isArray(record?.turns) ? record.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index]);
    if (
      turn &&
      (isActiveStatus(turn.status) ||
        isActiveStatus(turn.state) ||
        isActiveStatus(turn.threadRuntimeStatus))
    ) {
      return readTurnRecordId(turn);
    }
  }
  return "";
}

function readSkillInputs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const name = readString(record.name);
    const path = readString(record.path);
    return name && path ? [{ type: "skill", name, path }] : [];
  });
}

function summarizeRuntimeSelection(input: {
  model?: unknown;
  effort?: unknown;
  skills?: unknown;
  attachmentCount?: number;
  collaborationMode?: unknown;
}): Record<string, unknown> {
  const collaborationMode = asRecord(input.collaborationMode);
  const collaborationSettings = asRecord(collaborationMode?.settings);
  return {
    model: readString(input.model) || null,
    effort: readString(input.effort) || null,
    skillCount: readSkillInputs(input.skills).length,
    attachmentCount: input.attachmentCount ?? 0,
    collaborationMode: readString(collaborationMode?.mode) || null,
    collaborationModel: readString(collaborationSettings?.model) || null,
    collaborationReasoningEffort:
      readString(collaborationSettings?.reasoning_effort) ||
      readString(collaborationSettings?.reasoningEffort) ||
      null,
  };
}

function configuredServer(
  localConfig: LocalConfigFile,
): RuntimeConfig["server"] {
  return {
    host: localConfig.server?.host ?? DEFAULT_SERVER_HOST,
    port: localConfig.server?.port ?? DEFAULT_SERVER_PORT,
  };
}

function configuredDev(localConfig: LocalConfigFile): RuntimeConfig["dev"] {
  return {
    frontendPort: localConfig.dev?.frontendPort ?? DEFAULT_WEB_DEV_PORT,
  };
}

function buildPublicConfig(config: RuntimeConfig): Record<string, unknown> {
  const localConfig = readLocalConfigFile(config.projectRoot);
  const nextServer = configuredServer(localConfig);
  const nextDev = configuredDev(localConfig);
  return {
    server: config.server,
    dev: config.dev,
    dataDir: config.dataDir,
    ui: {
      theme: localConfig.ui?.theme ?? config.ui.theme,
    },
    diagnostics: {
      rawFrameLogging:
        localConfig.diagnostics?.rawFrameLogging ??
        config.diagnostics.rawFrameLogging,
    },
    configured: {
      server: nextServer,
      dev: nextDev,
    },
    restartRequired:
      nextServer.host !== config.server.host ||
      nextServer.port !== config.server.port ||
      nextDev.frontendPort !== config.dev.frontendPort,
  };
}

function readFavoriteProjectPaths(config: RuntimeConfig): string[] {
  return (readLocalConfigFile(config.projectRoot).projects?.favorites ?? [])
    .map((path) => normalizeProjectPath(path))
    .filter((path): path is string => Boolean(path));
}

function readFavoriteProjects(config: RuntimeConfig): Project[] {
  return readFavoriteProjectPaths(config)
    .map((path) => projectFromPath(path, "web-favorite"))
    .filter((project): project is Project => Boolean(project));
}

function validateProjectDirectory(path: string): string {
  const normalizedPath = normalizeProjectPath(path);
  if (!normalizedPath) throw new Error("Project path is required");
  try {
    if (!statSync(normalizedPath).isDirectory())
      throw new Error("Project path must be a directory");
  } catch {
    throw new Error("Project path must be an existing directory");
  }
  return normalizedPath;
}

function favoriteProjectExists(paths: string[], path: string): boolean {
  const key = normalizeProjectPath(path).toLocaleLowerCase();
  return paths.some(
    (entry) => normalizeProjectPath(entry).toLocaleLowerCase() === key,
  );
}

function sameProjectPath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftPath = normalizeProjectPath(left ?? "");
  const rightPath = normalizeProjectPath(right ?? "");
  if (!leftPath || !rightPath) return false;
  return leftPath.toLocaleLowerCase() === rightPath.toLocaleLowerCase();
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

function contentDispositionFilename(filename: string): string {
  const fallback =
    filename.replace(/[^\x20-\x7e]|["\\\r\n]/g, "_") || "attachment";
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

type ByteRange =
  | { kind: "full" }
  | { kind: "invalid" }
  | { kind: "partial"; start: number; end: number; length: number };

function parseByteRangeHeader(
  rangeHeader: string | undefined,
  size: number,
): ByteRange {
  if (!rangeHeader) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || size < 0) return { kind: "invalid" };

  const [, startText, endText] = match;
  if (!startText && !endText) return { kind: "invalid" };

  let start = 0;
  let end = size - 1;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return { kind: "invalid" };
    }
    start = Math.max(size - suffixLength, 0);
  } else {
    start = Number(startText);
    if (!Number.isInteger(start) || start < 0) return { kind: "invalid" };
    if (endText) {
      end = Number(endText);
      if (!Number.isInteger(end) || end < start) return { kind: "invalid" };
    }
  }

  if (size <= 0 || start >= size) return { kind: "invalid" };
  end = Math.min(end, size - 1);
  return { kind: "partial", start, end, length: end - start + 1 };
}

function buildPublicAccountStatus(input: {
  accountResponse?: unknown;
  rateLimitsResponse?: unknown;
  configRequirementsResponse?: unknown;
  warnings: string[];
}): Record<string, unknown> {
  const accountRecord = asRecord(input.accountResponse);
  const account = asRecord(accountRecord?.account);
  const rateLimitsRoot = asRecord(input.rateLimitsResponse);
  const rateLimits = asRecord(rateLimitsRoot?.rateLimits);
  const credits = asRecord(rateLimits?.credits);
  const primary = asRecord(rateLimits?.primary);
  const secondary = asRecord(rateLimits?.secondary);
  const configRequirements = asRecord(input.configRequirementsResponse);

  return {
    account: account
      ? {
          type: readString(account.type) || "unknown",
          email: readString(account.email) || null,
          planType: readString(account.planType) || null,
        }
      : null,
    requiresOpenaiAuth: readOptionalBoolean(accountRecord?.requiresOpenaiAuth),
    rateLimits: rateLimits
      ? {
          limitId: readString(rateLimits.limitId) || null,
          limitName: readString(rateLimits.limitName) || null,
          planType: readString(rateLimits.planType) || null,
          primary: primary
            ? {
                usedPercent:
                  typeof primary.usedPercent === "number"
                    ? primary.usedPercent
                    : null,
                resetsAt:
                  typeof primary.resetsAt === "number"
                    ? primary.resetsAt
                    : null,
                windowDurationMins:
                  typeof primary.windowDurationMins === "number"
                    ? primary.windowDurationMins
                    : null,
              }
            : null,
          secondary: secondary
            ? {
                usedPercent:
                  typeof secondary.usedPercent === "number"
                    ? secondary.usedPercent
                    : null,
                resetsAt:
                  typeof secondary.resetsAt === "number"
                    ? secondary.resetsAt
                    : null,
                windowDurationMins:
                  typeof secondary.windowDurationMins === "number"
                    ? secondary.windowDurationMins
                    : null,
              }
            : null,
          credits: credits
            ? {
                hasCredits: readOptionalBoolean(credits.hasCredits),
                unlimited: readOptionalBoolean(credits.unlimited),
                balance: readString(credits.balance) || null,
              }
            : null,
        }
      : null,
    requirements: asRecord(configRequirements?.requirements) ?? null,
    source:
      accountRecord || rateLimitsRoot || configRequirements
        ? "app-server"
        : "fallback",
    warnings: input.warnings,
  };
}

function mergeSettingsPatch(
  current: LocalConfigFile,
  patch: Record<string, unknown>,
): LocalConfigFile {
  const serverPatch = asRecord(patch.server);
  const devPatch = asRecord(patch.dev);
  const uiPatch = asRecord(patch.ui);
  const diagnosticsPatch = asRecord(patch.diagnostics);

  const host = readString(serverPatch?.host);
  const port = readOptionalPort(serverPatch?.port);
  const frontendPort = readOptionalPort(devPatch?.frontendPort);
  const rawFrameLogging = readOptionalBoolean(
    diagnosticsPatch?.rawFrameLogging,
  );
  const theme = readString(uiPatch?.theme);

  return {
    ...current,
    server: {
      ...current.server,
      ...(host ? { host } : {}),
      ...(port ? { port } : {}),
    },
    dev: {
      ...current.dev,
      ...(frontendPort ? { frontendPort } : {}),
    },
    ui: {
      ...current.ui,
      ...(theme === "light" ? { theme } : {}),
    },
    diagnostics: {
      ...current.diagnostics,
      ...(rawFrameLogging === null ? {} : { rawFrameLogging }),
    },
  };
}

function ownerFromOfficialState(
  officialIpc: OfficialIpcBridge,
  threadId: string,
): Owner | null {
  const state = officialIpc.getThreadStreamState(threadId);
  if (!state?.ownerClientId) return null;
  return {
    clientId: state.ownerClientId,
    kind: "unknown",
    source: "official-ipc",
  };
}

function detailHasEmptyActiveTurn(detail: ThreadDetail | null): boolean {
  return Boolean(
    detail?.thread.inProgress &&
    detail.turns.some(
      (turn) => turn.status === "active" && turn.items.length === 0,
    ),
  );
}

function compactStatus(value: unknown): string {
  const direct = readString(value);
  if (direct) return direct.toLowerCase().replace(/[\s_-]+/g, "");
  const record = asRecord(value);
  return (
    readString(record?.type) ||
    readString(record?.status) ||
    readString(record?.state) ||
    readString(record?.kind)
  )
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

function isTerminalStatus(value: unknown): boolean {
  return [
    "completed",
    "complete",
    "done",
    "success",
    "succeeded",
    "failed",
    "failure",
    "error",
    "interrupted",
    "interrupt",
    "canceled",
    "cancelled",
  ].includes(compactStatus(value));
}

function readTurnRecordId(turn: Record<string, unknown>): string {
  return (
    readString(turn.turnId) || readString(turn.turn_id) || readString(turn.id)
  );
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

function readConversationUpdatedAtMs(conversationState: unknown): number | null {
  const record = asRecord(conversationState);
  if (!record) return null;
  return (
    readTimestampMs(record.updatedAtIso) ??
    readTimestampMs(record.updatedAt) ??
    readTimestampMs(record.updated_at)
  );
}

function streamStateUpdatedAtMs(state: OfficialThreadStreamState): number | null {
  return readTimestampMs(state.updatedAtIso);
}

function stateContainsSettledActiveTurn(
  conversationState: unknown,
  activeTurnId: string,
): boolean {
  if (!activeTurnId) return true;
  const record = asRecord(conversationState);
  const turns = Array.isArray(record?.turns) ? record.turns : [];
  const turn = turns
    .map((value) => asRecord(value))
    .find((value) => value && readTurnRecordId(value) === activeTurnId);
  if (!turn) return false;
  return (
    isTerminalStatus(turn.status) ||
    isTerminalStatus(turn.state) ||
    isTerminalStatus(turn.threadRuntimeStatus)
  );
}

type PermissionMode = "default" | "auto-review" | "full-access" | "custom";

function readPermissionMode(value: unknown): PermissionMode | null {
  const mode = readString(value);
  if (
    mode === "default" ||
    mode === "auto-review" ||
    mode === "full-access" ||
    mode === "custom"
  ) {
    return mode;
  }
  return null;
}

function buildPermissionOverrides(
  value: unknown,
): Pick<
  TurnStartParams,
  "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy"
> {
  const mode = readPermissionMode(value);
  if (!mode || mode === "custom") return {};
  if (mode === "full-access") {
    return {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: buildSandboxPolicy("danger-full-access"),
    };
  }
  if (mode === "auto-review") {
    return {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxPolicy: buildSandboxPolicy("workspace-write"),
    };
  }
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxPolicy: buildSandboxPolicy("workspace-write"),
  };
}

function buildSandboxPolicy(
  mode: "danger-full-access" | "read-only" | "workspace-write",
): SandboxPolicy {
  if (mode === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (mode === "read-only") {
    return { type: "readOnly", networkAccess: false };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [],
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: false,
  };
}

function collectActiveTurnIds(
  threadId: string,
  officialIpc: OfficialIpcBridge,
): string[] {
  const ids = new Set<string>();
  const state = officialIpc.getThreadStreamState(threadId);
  if (state?.activeTurnId) ids.add(state.activeTurnId);
  const record = asRecord(state?.conversationState);
  const turns = Array.isArray(record?.turns) ? record.turns : [];
  for (const turnValue of turns) {
    const turn = asRecord(turnValue);
    if (!turn) continue;
    const id = readTurnRecordId(turn);
    if (
      id &&
      (isActiveStatus(turn.status) ||
        isActiveStatus(turn.state) ||
        isActiveStatus(turn.threadRuntimeStatus))
    ) {
      ids.add(id);
    }
  }
  return [...ids];
}

function conversationStateAlreadyActive(conversationState: unknown): boolean {
  const record = asRecord(conversationState);
  if (!record) return false;
  if (record.inProgress === true) return true;
  if (
    isActiveStatus(record.status) ||
    isActiveStatus(record.state) ||
    isActiveStatus(record.threadRuntimeStatus)
  ) {
    return true;
  }
  const turns = Array.isArray(record.turns) ? record.turns : [];
  return turns.some((turnValue) => {
    const turn = asRecord(turnValue);
    return Boolean(
      turn &&
      (isActiveStatus(turn.status) ||
        isActiveStatus(turn.state) ||
        isActiveStatus(turn.threadRuntimeStatus)),
    );
  });
}

const STALE_OFFICIAL_ACTIVE_GRACE_MS = 30_000;
const STALE_OFFICIAL_ACTIVE_TIMESTAMP_TOLERANCE_MS = 1_000;

function shouldRetireStaleOfficialActiveState(
  conversationState: unknown,
  streamState: OfficialThreadStreamState,
): boolean {
  if (!streamState.isInProgress) return false;
  if (conversationStateAlreadyActive(conversationState)) return false;

  const activeTurnId = readActiveTurnIdFromStreamState(streamState);
  if (!stateContainsSettledActiveTurn(conversationState, activeTurnId)) {
    return false;
  }

  const conversationUpdatedAtMs =
    readConversationUpdatedAtMs(conversationState);
  const stateUpdatedAtMs = streamStateUpdatedAtMs(streamState);
  if (
    conversationUpdatedAtMs !== null &&
    stateUpdatedAtMs !== null &&
    conversationUpdatedAtMs +
      STALE_OFFICIAL_ACTIVE_TIMESTAMP_TOLERANCE_MS >=
      stateUpdatedAtMs
  ) {
    return true;
  }

  return Boolean(
    stateUpdatedAtMs !== null &&
      Date.now() - stateUpdatedAtMs > STALE_OFFICIAL_ACTIVE_GRACE_MS,
  );
}

function preserveOfficialLiveState(
  conversationState: unknown,
  streamState: OfficialThreadStreamState,
): unknown {
  if (!streamState.isInProgress) return conversationState;
  if (shouldRetireStaleOfficialActiveState(conversationState, streamState))
    return conversationState;
  if (conversationStateAlreadyActive(conversationState))
    return conversationState;

  const record = asRecord(conversationState);
  if (!record) return conversationState;
  const activeTurnId = readActiveTurnIdFromStreamState(streamState);
  const turns = Array.isArray(record.turns) ? record.turns : [];
  let matchedActiveTurn = false;
  const nextTurns =
    activeTurnId.length > 0
      ? turns.map((turnValue) => {
          const turn = asRecord(turnValue);
          if (!turn || readTurnRecordId(turn) !== activeTurnId)
            return turnValue;
          matchedActiveTurn = true;
          return {
            ...turn,
            status: "active",
          };
        })
      : turns;

  if (activeTurnId.length > 0 && !matchedActiveTurn) {
    nextTurns.push({ id: activeTurnId, status: "active", items: [] });
  }

  return {
    ...record,
    status: "active",
    threadRuntimeStatus: {
      ...(asRecord(record.threadRuntimeStatus) ?? {}),
      type: "active",
    },
    turns: nextTurns,
  };
}

function readTurnItems(value: unknown): unknown[] {
  const turn = asRecord(value);
  return Array.isArray(turn?.items) ? turn.items : [];
}

function turnItemsScore(value: unknown): number {
  const items = readTurnItems(value);
  try {
    return JSON.stringify(items).length;
  } catch {
    return items.length;
  }
}

const RICH_TEXT_ITEM_KEYS = new Set([
  "text",
  "message",
  "content",
  "body",
  "detail",
  "output",
  "aggregatedOutput",
  "aggregated_output",
  "stdout",
  "stdoutText",
  "stderr",
  "stderrText",
  "diff",
  "patch",
]);

function readItemRecordId(item: unknown): string {
  const record = asRecord(item);
  return (
    readString(record?.id) ||
    readString(record?.itemId) ||
    readString(record?.item_id) ||
    readString(record?.callId) ||
    readString(record?.call_id)
  );
}

function jsonValueScore(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 1;
  }
}

function richerItemTextValue(primaryValue: unknown, liveValue: unknown): unknown {
  if (primaryValue === undefined) return liveValue;
  if (liveValue === undefined) return primaryValue;
  return jsonValueScore(primaryValue) > jsonValueScore(liveValue)
    ? primaryValue
    : liveValue;
}

function mergeItemWithRicherText(
  primary: unknown,
  live: unknown,
  prefer: "primary" | "live",
): unknown {
  const primaryRecord = asRecord(primary);
  const liveRecord = asRecord(live);
  if (!primaryRecord || !liveRecord) return prefer === "primary" ? primary : live;

  const merged =
    prefer === "primary"
      ? { ...liveRecord, ...primaryRecord }
      : { ...primaryRecord, ...liveRecord };

  for (const key of RICH_TEXT_ITEM_KEYS) {
    if (!(key in primaryRecord) && !(key in liveRecord)) continue;
    merged[key] = richerItemTextValue(primaryRecord[key], liveRecord[key]);
  }

  return merged;
}

function mergeStableIdItems(
  baseItems: unknown[],
  otherItems: unknown[],
  prefer: "primary" | "live",
): unknown[] {
  const otherById = new Map<string, unknown>();
  for (const item of otherItems) {
    const id = readItemRecordId(item);
    if (id) otherById.set(id, item);
  }

  const usedOtherIds = new Set<string>();
  const merged = baseItems.map((item) => {
    const id = readItemRecordId(item);
    const other = id ? otherById.get(id) : null;
    if (!id || !other) return item;
    usedOtherIds.add(id);
    return prefer === "primary"
      ? mergeItemWithRicherText(item, other, prefer)
      : mergeItemWithRicherText(other, item, prefer);
  });

  for (const item of otherItems) {
    const id = readItemRecordId(item);
    if (!id || usedOtherIds.has(id)) continue;
    merged.push(item);
  }

  return merged;
}

function mergeTurnWithRicherItems(primary: unknown, live: unknown): unknown {
  const primaryTurn = asRecord(primary);
  const liveTurn = asRecord(live);
  if (!primaryTurn || !liveTurn) return primary ?? live;
  const primaryItems = readTurnItems(primaryTurn);
  const liveItems = readTurnItems(liveTurn);
  const liveIsRicher =
    liveItems.length > primaryItems.length ||
    (liveItems.length === primaryItems.length &&
      liveItems.length > 0 &&
      turnItemsScore(liveTurn) > turnItemsScore(primaryTurn));
  const items = liveIsRicher
    ? mergeStableIdItems(liveItems, primaryItems, "live")
    : mergeStableIdItems(primaryItems, liveItems, "primary");
  return {
    ...liveTurn,
    ...primaryTurn,
    items,
  };
}

function preserveRicherOfficialStreamItems(
  conversationState: unknown,
  streamConversationState: unknown,
): unknown {
  const record = asRecord(conversationState);
  const streamRecord = asRecord(streamConversationState);
  if (!record || !streamRecord) return conversationState;
  const turns = Array.isArray(record.turns) ? record.turns : [];
  const streamTurns = Array.isArray(streamRecord.turns) ? streamRecord.turns : [];
  if (streamTurns.length === 0) return conversationState;

  const streamTurnsById = new Map<string, unknown>();
  for (const turnValue of streamTurns) {
    const turn = asRecord(turnValue);
    if (!turn) continue;
    const id = readTurnRecordId(turn);
    if (id) streamTurnsById.set(id, turnValue);
  }

  const usedStreamTurnIds = new Set<string>();
  const mergedTurns = turns.map((turnValue) => {
    const turn = asRecord(turnValue);
    if (!turn) return turnValue;
    const id = readTurnRecordId(turn);
    const streamTurn = id ? streamTurnsById.get(id) : null;
    if (!streamTurn) return turnValue;
    usedStreamTurnIds.add(id);
    return mergeTurnWithRicherItems(turnValue, streamTurn);
  });

  for (const streamTurnValue of streamTurns) {
    const streamTurn = asRecord(streamTurnValue);
    if (!streamTurn) continue;
    const id = readTurnRecordId(streamTurn);
    if (!id || usedStreamTurnIds.has(id)) continue;
    if (readTurnItems(streamTurn).length === 0) continue;
    mergedTurns.push(streamTurnValue);
  }

  return {
    ...record,
    turns: mergedTurns,
  };
}

function overlayLiveStreamStateOnThreadList(
  list: ThreadList,
  officialIpc: OfficialIpcBridge,
): ThreadList {
  let changed = false;
  const threads = list.threads.map((thread) => {
    const state = officialIpc.getThreadStreamState(thread.id);
    if (!state) return thread;
    const owner =
      ownerFromOfficialState(officialIpc, thread.id) ?? thread.owner;
    const inProgress = thread.inProgress || state.isInProgress;
    const updatedAtIso =
      state.isInProgress && state.updatedAtIso
        ? state.updatedAtIso
        : thread.updatedAtIso;
    if (
      owner === thread.owner &&
      inProgress === thread.inProgress &&
      updatedAtIso === thread.updatedAtIso
    ) {
      return thread;
    }
    changed = true;
    return { ...thread, owner, inProgress, updatedAtIso };
  });
  return changed ? { ...list, threads } : list;
}

function overlayPinnedThreads(
  list: ThreadList,
  pinnedThreadIds: Set<string>,
): ThreadList {
  let changed = false;
  const threads = list.threads.map((thread) => {
    const pinned = thread.pinned || pinnedThreadIds.has(thread.id);
    if (thread.pinned === pinned) return thread;
    changed = true;
    return { ...thread, pinned };
  });
  return changed ? { ...list, threads } : list;
}

function hydratePinnedDetail(
  detail: ThreadDetail | null,
  pinnedThreadIds: Set<string>,
): ThreadDetail | null {
  if (!detail) return null;
  const pinned = detail.thread.pinned || pinnedThreadIds.has(detail.thread.id);
  if (detail.thread.pinned === pinned) return detail;
  return { ...detail, thread: { ...detail.thread, pinned } };
}

async function buildTurnStartParams(input: {
  threadId: string;
  text: string;
  cwd?: unknown;
  model?: unknown;
  effort?: unknown;
  attachments?: Attachment[];
  skills?: unknown;
  collaborationMode?: unknown;
  permissionMode?: unknown;
}): Promise<TurnStartParams> {
  const attachments = input.attachments ?? [];
  const imageInputs = (
    await Promise.all(
      attachments.map((attachment) => toTurnStartImageInput(attachment)),
    )
  ).filter((entry): entry is TurnStartImageInput => Boolean(entry));
  const skillInputs = readSkillInputs(input.skills);
  const textInputs =
    input.text.trim() || (imageInputs.length === 0 && skillInputs.length === 0)
      ? [{ type: "text", text: input.text, text_elements: [] }]
      : [];
  const clientUserMessageId = randomUUID();
  const params: TurnStartParams = {
    threadId: input.threadId,
    clientUserMessageId,
    input: [
      ...textInputs,
      ...imageInputs.map((entry) => entry.input),
      ...skillInputs,
    ],
  };
  const model = readString(input.model);
  const effort = readString(input.effort);
  const cwd = readString(input.cwd);
  if (cwd) params.cwd = cwd;
  if (model) params.model = model;
  if (effort) params.effort = effort;
  if (attachments.length > 0)
    params.attachments = attachments.map(toTurnStartAttachment);
  if (imageInputs.length > 0) {
    params.restoreMessage = buildRestoreMessage({
      id: clientUserMessageId,
      text: input.text,
      cwd,
      imageAttachments: imageInputs.map((entry) => entry.restoreAttachment),
    });
  }
  const collaborationMode = asRecord(input.collaborationMode);
  if (collaborationMode) params.collaborationMode = collaborationMode;
  Object.assign(params, buildPermissionOverrides(input.permissionMode));
  return params;
}

function readUnixSeconds(value: unknown, fallbackSeconds: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value / 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed / 1000;
  }
  return fallbackSeconds;
}

function normalizePendingUserInput(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const type = readString(record.type);
  if (type === "text") {
    return {
      type: "text",
      text: typeof record.text === "string" ? record.text : "",
      text_elements: Array.isArray(record.text_elements)
        ? record.text_elements
        : [],
    };
  }
  if (type === "localImage") {
    const path = readString(record.path);
    if (!path) return null;
    return {
      type: "localImage",
      path,
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
    };
  }
  if (type === "image") {
    const url = readString(record.url);
    if (!url) return null;
    return {
      type: "image",
      url,
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
    };
  }
  if (type === "skill" || type === "mention") {
    const name = readString(record.name);
    const path = readString(record.path);
    if (!name || !path) return null;
    return { type, name, path };
  }
  return null;
}

function buildPendingTurnParams(
  params: TurnStartParams,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    "cwd",
    "model",
    "effort",
    "serviceTier",
    "summary",
    "personality",
    "outputSchema",
    "collaborationMode",
    "approvalPolicy",
    "approvalsReviewer",
    "sandboxPolicy",
    "permissions",
    "runtimeWorkspaceRoots",
    "environments",
  ]) {
    const value = (params as unknown as Record<string, unknown>)[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function buildPendingLocalTurnSnapshot(input: {
  threadId: string;
  params: TurnStartParams;
  baseThread: Record<string, unknown> | null;
  fallbackDetail: ThreadDetail | null;
  fallbackCwd: string;
  nowMs?: number;
}): Record<string, unknown> {
  const nowMs = input.nowMs ?? Date.now();
  const nowSeconds = nowMs / 1000;
  const base = input.baseThread ?? {};
  const detailThread = input.fallbackDetail?.thread;
  const threadId =
    readString(base.id) ||
    readString(base.sessionId) ||
    detailThread?.id ||
    input.threadId;
  const cwd =
    readString(base.cwd) ||
    readString(input.params.cwd) ||
    detailThread?.projectId ||
    detailThread?.path ||
    input.fallbackCwd;
  const existingTurns = Array.isArray(base.turns) ? base.turns : [];
  const content = input.params.input
    .map(normalizePendingUserInput)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const userMessageId =
    readString(input.params.clientUserMessageId) || randomUUID();
  const pendingTurnId = `pending-${userMessageId}`;
  const pendingTurn = {
    id: pendingTurnId,
    turnId: pendingTurnId,
    items: [
      {
        type: "userMessage",
        id: userMessageId,
        clientId: userMessageId,
        content,
      },
    ],
    itemsView: "full",
    status: "inProgress",
    error: null,
    startedAt: nowSeconds,
    completedAt: null,
    durationMs: null,
    turnStartedAtMs: nowMs,
    params: buildPendingTurnParams(input.params),
    diff: [],
    commandExecutionStartedAtMsById: {},
    hookRuns: [],
  };
  const name =
    readString(base.name) ||
    readString(base.title) ||
    detailThread?.title ||
    readString(base.preview) ||
    readString(content[0]?.text) ||
    null;
  return {
    ...base,
    id: threadId,
    sessionId: readString(base.sessionId) || threadId,
    preview:
      readString(base.preview) ||
      readString(base.name) ||
      readString(base.title) ||
      detailThread?.title ||
      readString(content[0]?.text),
    createdAt: readUnixSeconds(base.createdAt ?? base.created_at, nowSeconds),
    updatedAt: nowSeconds,
    status: { type: "active", activeFlags: [] },
    threadRuntimeStatus: { type: "active", activeFlags: [] },
    cwd,
    threadSource: readString(base.threadSource) || "user",
    title: readString(base.title) || name,
    name,
    turns: [...existingTurns, pendingTurn],
  };
}

function buildIdleLocalThreadSnapshot(input: {
  threadId: string;
  thread: unknown;
  detail: ThreadDetail | null;
  fallbackCwd: string;
  nowMs?: number;
}): Record<string, unknown> {
  const nowMs = input.nowMs ?? Date.now();
  const nowSeconds = nowMs / 1000;
  const base = asRecord(input.thread) ?? {};
  const detailThread = input.detail?.thread;
  const threadId =
    readString(base.id) ||
    readString(base.sessionId) ||
    detailThread?.id ||
    input.threadId;
  const cwd =
    readString(base.cwd) ||
    detailThread?.projectId ||
    detailThread?.path ||
    input.fallbackCwd;
  const name =
    readString(base.name) ||
    readString(base.title) ||
    detailThread?.title ||
    null;
  const preview =
    readString(base.preview) ||
    readString(base.name) ||
    readString(base.title) ||
    detailThread?.title ||
    "";
  const title = readString(base.title) || name || preview || null;
  const normalizedName = name || title;
  return {
    ...base,
    id: threadId,
    sessionId: readString(base.sessionId) || threadId,
    preview,
    createdAt: readUnixSeconds(base.createdAt ?? base.created_at, nowSeconds),
    updatedAt: readUnixSeconds(base.updatedAt ?? base.updated_at, nowSeconds),
    status: { ...(asRecord(base.status) ?? {}), type: "idle" },
    threadRuntimeStatus: {
      ...(asRecord(base.threadRuntimeStatus) ?? asRecord(base.status) ?? {}),
      type: "idle",
    },
    cwd,
    threadSource: readString(base.threadSource) || "user",
    title,
    name: normalizedName,
    turns: Array.isArray(base.turns) ? base.turns : [],
  };
}

async function buildTurnSteerParams(input: {
  threadId: string;
  expectedTurnId: string;
  text: string;
  cwd?: unknown;
  attachments?: Attachment[];
  skills?: unknown;
}): Promise<TurnSteerParams> {
  const attachments = input.attachments ?? [];
  const imageInputs = (
    await Promise.all(
      attachments.map((attachment) => toTurnStartImageInput(attachment)),
    )
  ).filter((entry): entry is TurnStartImageInput => Boolean(entry));
  const skillInputs = readSkillInputs(input.skills);
  const textInputs =
    input.text.trim() || (imageInputs.length === 0 && skillInputs.length === 0)
      ? [{ type: "text", text: input.text, text_elements: [] }]
      : [];
  const clientUserMessageId = randomUUID();
  const params: TurnSteerParams = {
    threadId: input.threadId,
    expectedTurnId: input.expectedTurnId,
    clientUserMessageId,
    input: [
      ...textInputs,
      ...imageInputs.map((entry) => entry.input),
      ...skillInputs,
    ],
    restoreMessage: buildSteerRestoreMessage({
      id: clientUserMessageId,
      text: input.text,
      cwd: input.cwd,
      imageAttachments: imageInputs.map((entry) => entry.restoreAttachment),
    }),
  };
  if (attachments.length > 0)
    params.attachments = attachments.map(toTurnStartAttachment);
  return params;
}

function buildSteerRestoreMessage(input: {
  id?: string;
  text: string;
  cwd?: unknown;
  imageAttachments?: Record<string, unknown>[];
}): Record<string, unknown> {
  return buildRestoreMessage(input);
}

function buildRestoreMessage(input: {
  id?: string;
  text: string;
  cwd?: unknown;
  imageAttachments?: Record<string, unknown>[];
}): Record<string, unknown> {
  const cwd = readString(input.cwd);
  return {
    id: input.id ?? randomUUID(),
    text: input.text,
    context: {
      addedFiles: [],
      prompt: input.text,
      ideContext: null,
      imageAttachments: input.imageAttachments ?? [],
      appshotContexts: [],
      fileAttachments: [],
      inAppBrowserContext: null,
      commentAttachments: [],
      mcpAppModelContextAttachments: [],
      selectedTextAttachments: [],
      pullRequestChecks: [],
      workspaceRoots: cwd ? [cwd] : [],
    },
    cwd: cwd || null,
    createdAt: Date.now(),
  };
}

function buildLocalTurnSteerParams(params: TurnSteerParams): TurnSteerParams {
  return toOfficialTurnSteerParams(params);
}

export type ServerContext = {
  app: FastifyInstance;
  config: RuntimeConfig;
  bus: EventBus;
  diagnostics: Diagnostics;
  officialIpc: OfficialIpcBridge;
  appServer: CodexAppServerProcess;
  database: DatabaseStore;
  approvals: ApprovalCoordinator;
};

export type CreateServerOverrides = {
  officialIpc?: OfficialIpcBridge;
  appServer?: CodexAppServerProcess;
};

export async function createServer(
  projectRoot = process.cwd(),
  overrides: CreateServerOverrides = {},
): Promise<ServerContext> {
  const config = loadRuntimeConfig(projectRoot);
  const auth = initializeAuth(config);
  const database = DatabaseStore.open(config);
  const bus = new EventBus();
  const diagnostics = new Diagnostics(bus);
  const approvals = new ApprovalCoordinator(bus);
  const officialIpc = overrides.officialIpc ?? new OfficialIpcBridge();
  const appServer = overrides.appServer ?? new CodexAppServerProcess();
  const pendingPatchHydrations = new Set<string>();
  const serverInstanceId = randomUUID();
  const serverStartedAtIso = new Date().toISOString();
  const logPath = resolve(config.dataDir, "logs", "server.log");
  const app = Fastify({
    logger: {
      level: "info",
      file: logPath,
    },
  });
  officialIpc.setRawFrameLogging(config.diagnostics.rawFrameLogging);
  const clearedDerivedCaches = database.clearDerivedCaches();
  const clearedDerivedCacheCount =
    clearedDerivedCaches.projectCount +
    clearedDerivedCaches.threadCount +
    clearedDerivedCaches.threadDetailCount +
    clearedDerivedCaches.officialStreamStateCount;
  if (clearedDerivedCacheCount > 0) {
    database.compactStorage();
    diagnostics.record("info", "cache", "derived-sqlite-cache-cleared", {
      ...clearedDerivedCaches,
    });
  }

  const hydrateSideConversations = (
    threadId: string,
    detail: ThreadDetail | null,
  ): ThreadDetail | null => {
    const streamStates: readonly OfficialThreadStreamState[] =
      officialIpc.listThreadStreamStateViews?.() ??
      officialIpc.listThreadStreamStates();
    return attachOfficialSideConversations({
      detail,
      threadId,
      streamStates,
    });
  };

  const hydrateThreadGoal = async (
    threadId: string,
    detail: ThreadDetail | null,
  ): Promise<ThreadDetail | null> => {
    if (!detail) return null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutResult = Symbol("thread-goal-read-timeout");
      const result = await Promise.race([
        appServer.threadGoalGet({ threadId }),
        new Promise<typeof timeoutResult>((resolveTimeout) => {
          timeout = setTimeout(
            () => resolveTimeout(timeoutResult),
            THREAD_GOAL_READ_TIMEOUT_MS,
          );
        }),
      ]);
      if (result === timeoutResult) {
        diagnostics.record("warn", "thread-goal", "read-timeout", {
          threadId,
          timeoutMs: THREAD_GOAL_READ_TIMEOUT_MS,
        });
        return detail;
      }
      const goal = normalizeThreadGoal(asRecord(result)?.goal ?? null);
      return { ...detail, goal };
    } catch (error) {
      diagnostics.record("warn", "thread-goal", "read-failed", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return detail;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  };

  const readAppServerThreadDetail = async (
    threadId: string,
    goalOverride?: ThreadGoal | null,
  ): Promise<ThreadDetail | null> => {
    const result = await appServer.threadRead({
      threadId,
      includeTurns: true,
    });
    const detail = hydratePinnedDetail(
      hydrateSideConversations(
        threadId,
        normalizeOfficialThreadDetail({
          thread: asRecord(result)?.thread ?? result,
          owner: ownerFromOfficialState(officialIpc, threadId),
          fallbackThreadId: threadId,
        }),
      ),
      new Set(database.listPinnedThreadIds()),
    );
    if (goalOverride !== undefined) {
      return detail ? { ...detail, goal: goalOverride } : null;
    }
    return await hydrateThreadGoal(threadId, detail);
  };

  let accountStatusCache: {
    response: AccountStatusResponse;
    expiresAtMs: number;
  } | null = null;
  let accountStatusRefresh: Promise<AccountStatusResponse> | null = null;

  const readFreshAccountStatus =
    async (): Promise<AccountStatusResponse> => {
      const warnings: string[] = [];
      let accountResponse: unknown;
      let rateLimitsResponse: unknown;
      let configRequirementsResponse: unknown;

      try {
        accountResponse = await appServer.accountRead({ refreshToken: false });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "account/read failed";
        warnings.push(`account/read: ${message}`);
        diagnostics.record("warn", "app-server", "account-read-failed", {
          error: message,
        });
      }

      try {
        rateLimitsResponse = await appServer.accountRateLimitsRead();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "account/rateLimits/read failed";
        warnings.push(`account/rateLimits/read: ${message}`);
        diagnostics.record(
          "warn",
          "app-server",
          "account-rate-limits-read-failed",
          { error: message },
        );
      }

      try {
        configRequirementsResponse = await appServer.configRequirementsRead();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "configRequirements/read failed";
        warnings.push(`configRequirements/read: ${message}`);
        diagnostics.record(
          "warn",
          "app-server",
          "config-requirements-read-failed",
          { error: message },
        );
      }

      const response = accountStatusResponseSchema.safeParse({
        data: buildPublicAccountStatus({
          accountResponse,
          rateLimitsResponse,
          configRequirementsResponse,
          warnings,
        }),
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "account-status-response-validation-failed",
          { error },
        );
        throw new Error(error);
      }
      return response.data;
    };

  const readCachedAccountStatus =
    async (): Promise<AccountStatusResponse> => {
      const now = Date.now();
      if (accountStatusCache && accountStatusCache.expiresAtMs > now) {
        return accountStatusCache.response;
      }
      if (accountStatusRefresh) return await accountStatusRefresh;
      accountStatusRefresh = readFreshAccountStatus()
        .then((response) => {
          accountStatusCache = {
            response,
            expiresAtMs: Date.now() + ACCOUNT_STATUS_CACHE_TTL_MS,
          };
          return response;
        })
        .finally(() => {
          accountStatusRefresh = null;
        });
      return await accountStatusRefresh;
    };

  const broadcastOwnedAppServerSnapshot = async (
    threadId: string,
    reason: string,
  ): Promise<boolean> => {
    if (
      !officialIpc.isOwnedConversation(threadId) ||
      !officialIpc.canBroadcastOwnedConversation(threadId)
    ) {
      return false;
    }
    try {
      const threadSnapshot = await readAppServerThreadSnapshot(
        appServer,
        threadId,
      );
      if (!threadSnapshot) return false;
      const broadcasted = officialIpc.broadcastConversationSnapshot(
        threadId,
        preserveSideConversationMetadata({
          threadId,
          conversationState: threadSnapshot,
          existingState: officialIpc.getThreadStreamState(threadId),
        }),
      );
      return broadcasted;
    } catch (error) {
      diagnostics.record("warn", "official-ipc", "post-turn-snapshot-failed", {
        threadId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const broadcastPendingLocalTurnSnapshot = async (
    threadId: string,
    params: TurnStartParams,
    reason: string,
  ): Promise<boolean> => {
    if (
      !officialIpc.isOwnedConversation(threadId) ||
      !officialIpc.canBroadcastOwnedConversation(threadId)
    ) {
      return false;
    }
    let baseThread: Record<string, unknown> | null = null;
    try {
      baseThread = await readAppServerThreadSnapshot(appServer, threadId);
    } catch (error) {
      diagnostics.record(
        isTransientEmptyRolloutReadError(error) ? "info" : "warn",
        "official-ipc",
        "pending-turn-base-read-failed",
        {
          threadId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const snapshot = buildPendingLocalTurnSnapshot({
      threadId,
      params,
      baseThread,
      fallbackDetail: null,
      fallbackCwd: config.projectRoot,
    });
    const broadcasted = officialIpc.broadcastConversationSnapshot(
      threadId,
      preserveSideConversationMetadata({
        threadId,
        conversationState: snapshot,
        existingState: officialIpc.getThreadStreamState(threadId),
      }),
    );
    if (broadcasted) {
      diagnostics.record("info", "official-ipc", "pending-turn-snapshot", {
        threadId,
        reason,
      });
    }
    return broadcasted;
  };

  const claimIdleAppServerConversation = (
    threadId: string,
    detail: ThreadDetail | null,
    reason: string,
    conversationState?: unknown,
  ): boolean => {
    if (!detail || detail.thread.inProgress) return false;
    if (!officialIpc.canOwnConversations()) return false;
    const state = officialIpc.getThreadStreamState(threadId);
    const staleOfficialActiveRetired = state
      ? shouldRetireStaleOfficialActiveState(
          conversationState ?? detail,
          state,
        )
      : false;
    if (
      (state?.isInProgress ||
        conversationStateAlreadyActive(state?.conversationState)) &&
      !staleOfficialActiveRetired
    ) {
      return false;
    }
    if (officialIpc.isExternallyOwnedConversation(threadId)) {
      const discarded = officialIpc.discardConversationFromCache(
        threadId,
        `${reason}-idle-external-owner-retired`,
      );
      diagnostics.record(
        discarded ? "info" : "warn",
        "official-ipc",
        discarded
          ? "idle-external-owner-retired"
          : "idle-external-owner-retire-skipped",
        {
          threadId,
          reason,
          previousOwnerClientId: state?.ownerClientId ?? null,
          cacheVersion: state?.cacheVersion ?? null,
          staleOfficialActiveRetired,
        },
      );
      if (!discarded && officialIpc.isExternallyOwnedConversation(threadId)) {
        return false;
      }
    }
    const claimed = officialIpc.claimLocalOnlyConversation(threadId);
    diagnostics.record(
      claimed ? "info" : "warn",
      "official-ipc",
      claimed
        ? "idle-app-server-thread-claimed"
        : "idle-app-server-thread-claim-skipped",
      { threadId, reason },
    );
    return claimed;
  };

  const promoteLocalOwnerConversation = (
    threadId: string,
    reason: string,
  ): boolean => {
    if (!officialIpc.isOwnedConversation(threadId)) return false;
    if (officialIpc.canBroadcastOwnedConversation(threadId)) return true;
    const promoted = officialIpc.promoteLocalOnlyConversation(threadId, reason);
    diagnostics.record(
      promoted ? "info" : "warn",
      "official-ipc",
      promoted
        ? "local-owner-promoted"
        : "local-owner-promotion-skipped",
      { threadId, reason },
    );
    return promoted;
  };

  const buildOfficialRealtimeThreadDetailEvent = (threadId: string) => {
    const state = officialIpc.getThreadStreamState(threadId);
    if (!state) return null;
    const detail = hydratePinnedDetail(
      hydrateSideConversations(
        threadId,
        normalizeOfficialConversationState({
          threadId,
          ownerClientId: state.ownerClientId,
          cacheVersion: state.cacheVersion,
          updatedAtIso: state.updatedAtIso,
          isInProgress: state.isInProgress,
          activeTurnId: state.activeTurnId,
          conversationState: state.conversationState,
        }),
      ),
      new Set(database.listPinnedThreadIds()),
    );
    if (!detail) return null;
    return {
      type: "domain.threadDetailUpdated" as const,
      threadId: detail.thread.id || threadId,
      detail,
      source: state.isInProgress ? "official-ipc-live" : "official-ipc",
      cacheVersion: state.cacheVersion,
      isInProgress: state.isInProgress,
      activeTurnId: state.activeTurnId,
    };
  };

  const localLiveThreads = new LocalLiveThreadStore({
    isLocalOwner: (threadId) => officialIpc.isOwnedConversation(threadId),
    readOwner: (threadId) => ownerFromOfficialState(officialIpc, threadId),
    readInitialDetail: (threadId) => {
      const state = officialIpc.getThreadStreamState(threadId);
      if (state) {
        const detail = hydratePinnedDetail(
          hydrateSideConversations(
            threadId,
            normalizeOfficialConversationState({
              threadId,
              ownerClientId: state.ownerClientId,
              cacheVersion: state.cacheVersion,
              updatedAtIso: state.updatedAtIso,
              isInProgress: state.isInProgress,
              activeTurnId: state.activeTurnId,
              conversationState: state.conversationState,
            }),
          ),
          new Set(database.listPinnedThreadIds()),
        );
        if (detail) return detail;
      }
      return null;
    },
  });

  const claimIdleAppServerConversationByRead = async (
    threadId: string,
    reason: string,
  ): Promise<boolean> => {
    try {
      const result = await readAppServerThreadSnapshot(appServer, threadId);
      if (!result) return false;
      const detail = normalizeOfficialThreadDetail({
        thread: result,
        owner: null,
        fallbackThreadId: threadId,
      });
      return claimIdleAppServerConversation(threadId, detail, reason, result);
    } catch (error) {
      diagnostics.record("warn", "official-ipc", "idle-thread-claim-failed", {
        threadId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  await app.register(fastifyCookie, { secret: auth.service.cookieSecret });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: 50 * 1024 * 1024 },
  });
  installAuth(app, auth.service);

  if (auth.generatedPassword) {
    app.log.warn(
      {
        dataDir: config.dataDir,
      },
      `codex_web LAN temporary password: ${auth.generatedPassword}`,
    );
    diagnostics.record("warn", "auth", "temporary-password-generated", {
      message:
        "A temporary LAN password was generated and stored as a hash in data/config.local.json.",
    });
  }

  officialIpc.onNotification((notification: OfficialIpcNotification) => {
    if (notification.method === OFFICIAL_THREAD_STREAM_CHANGED_METHOD) {
      const params = asRecord(notification.params);
      const changeType = readString(params?.changeType);
      const threadId =
        readString(params?.threadId) || readString(params?.conversationId);
      if (threadId) {
        const detailEvent = buildOfficialRealtimeThreadDetailEvent(threadId);
        if (detailEvent) bus.publish(detailEvent);
      }
      bus.publish({
        type: "official.threadStreamStateChanged",
        payload: notification.params,
      });
      if (
        changeType === "patches-without-snapshot" &&
        threadId &&
        !pendingPatchHydrations.has(threadId)
      ) {
        pendingPatchHydrations.add(threadId);
        void (async () => {
          try {
            const thread = await appServer.threadRead({
              threadId,
              includeTurns: true,
            });
            const threadSnapshot = asRecord(thread)?.thread ?? thread;
            const hydrated = officialIpc.hydrateThreadStreamState({
              threadId,
              conversationState: threadSnapshot,
              hostId:
                readString(params?.hostId) ||
                readString(params?.host_id) ||
                "local",
              ownerClientId: readString(params?.ownerClientId) || null,
              sourceClientId: readString(params?.sourceClientId) || null,
            });
            diagnostics.record(
              hydrated ? "info" : "warn",
              "official-ipc",
              hydrated
                ? "patches-without-snapshot-hydrated"
                : "patches-without-snapshot-hydrate-skipped",
              { threadId },
            );
            if (hydrated) {
              diagnostics.record("info", "official-ipc", "readonly-hydrate-memory-only", {
                threadId,
              });
            }
          } catch (error) {
            diagnostics.record(
              "warn",
              "official-ipc",
              "patches-without-snapshot-hydrate-failed",
              {
                threadId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          } finally {
            pendingPatchHydrations.delete(threadId);
          }
        })();
      }
    }
    if (notification.method === OFFICIAL_THREAD_ARCHIVED_METHOD) {
      bus.publish({
        type: "official.threadArchived",
        payload: notification.params,
      });
      const threadId = readString(asRecord(notification.params)?.threadId);
      if (threadId) database.deleteOfficialStreamState(threadId);
    }
    if (notification.method === OFFICIAL_THREAD_UNARCHIVED_METHOD) {
      bus.publish({
        type: "official.threadUnarchived",
        payload: notification.params,
      });
    }
  });
  officialIpc.start();

  appServer.onNotification((notification) => {
    const classification = classifyAppServerNotification(notification.method);
    bus.publish({
      type: "appServer.notification",
      method: notification.method,
      params: notification.params,
      atIso: notification.atIso,
      importance: classification.importance,
      shouldDriveRealtime: classification.shouldDriveRealtime,
    });
    const liveUpdate = localLiveThreads.handle(notification);
    if (
      liveUpdate &&
      !APP_SERVER_LIVE_DELTA_METHODS.has(notification.method)
    ) {
      bus.publish({
        type: "domain.threadDetailUpdated",
        threadId: liveUpdate.threadId,
        detail: liveUpdate.detail,
        source: liveUpdate.source,
        cacheVersion: liveUpdate.cacheVersion,
        isInProgress: liveUpdate.isInProgress,
        activeTurnId: liveUpdate.activeTurnId,
      });
      void broadcastOwnedAppServerSnapshot(
        liveUpdate.threadId,
        notification.method,
      );
    }
  });
  appServer.registerServerRequestHandler(
    "item/commandExecution/requestApproval",
    {
      handle: (params) =>
        approvals.request("item/commandExecution/requestApproval", params),
    },
  );
  appServer.registerServerRequestHandler("item/fileChange/requestApproval", {
    handle: (params) =>
      approvals.request("item/fileChange/requestApproval", params),
  });
  appServer.registerServerRequestHandler("item/permissions/requestApproval", {
    handle: (params) =>
      approvals.request("item/permissions/requestApproval", params),
  });
  const disposeLocalOwnerSnapshotSync = installLocalOwnerSnapshotSync({
    appServer,
    officialIpc,
    diagnostics,
    events: bus,
  });
  void appServer
    .warmUp()
    .then(() => {
      diagnostics.record(
        "info",
        "app-server",
        "warmup-completed",
        appServer.getStatus(),
      );
    })
    .catch((error) => {
      const message =
        error instanceof Error ? error.message : "app-server warmup failed";
      diagnostics.record("warn", "app-server", "warmup-failed", {
        error: message,
      });
    });

  const resolveAllowedProjectRoot = (rawRoot: string): string => {
    const root =
      normalizeProjectPath(rawRoot) || normalizeProjectPath(config.projectRoot);
    const configuredFavorites = readFavoriteProjectPaths(config);
    const knownProjectPaths = database
      .listProjects()
      .map((project) => project.path)
      .filter((path): path is string => Boolean(path));
    const allowedRoots = [
      config.projectRoot,
      ...configuredFavorites,
      ...knownProjectPaths,
    ];
    if (
      !allowedRoots.some((allowedRoot) => sameProjectPath(allowedRoot, root))
    ) {
      throw new FileBrowserError(
        "Project root is not available to codex_web",
        403,
      );
    }
    return root;
  };

  const allowedFilePreviewRoots = (extraRoot?: string | null): string[] => {
    const configuredFavorites = readFavoriteProjectPaths(config);
    const knownProjectPaths = database
      .listProjects()
      .map((project) => project.path)
      .filter((path): path is string => Boolean(path));
    return [
      config.dataDir,
      config.projectRoot,
      ...(extraRoot ? [extraRoot] : []),
      ...configuredFavorites,
      ...knownProjectPaths,
    ];
  };

  const healthPayload = () => ({
    ok: true,
    atIso: new Date().toISOString(),
  });

  app.get("/health", async () => healthPayload());
  app.get("/api/health", async () => healthPayload());

  app.get("/api/config", async () => ({
    data: buildPublicConfig(config),
  }));

  app.get("/api/network/lan-access", async (_request, reply) => {
    const response = lanAccessResponseSchema.safeParse({
      data: buildLanAccess(config.server),
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "lan-access-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/native-dictation/status", async (_request, reply) => {
    const response = nativeDictationStatusResponseSchema.safeParse({
      data: getNativeDictationStatus(),
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "native-dictation-status-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post("/api/native-dictation/start", async (_request, reply) => {
    try {
      const result = await triggerNativeDictation();
      diagnostics.record("info", "native-dictation", "triggered", {
        source: result.source,
        commandId: result.commandId,
        hasWarning: Boolean(result.warning),
      });
      const response = nativeDictationStartResponseSchema.safeParse({
        data: result,
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "native-dictation-start-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (unknownError) {
      if (unknownError instanceof NativeDictationError) {
        diagnostics.record("warn", "native-dictation", "not-ready", {
          warning: unknownError.status.warning,
          source: unknownError.status.source,
          commandId: unknownError.status.commandId,
        });
        await reply
          .code(unknownError.statusCode)
          .send({ error: unknownError.message, data: unknownError.status });
        return;
      }
      const error =
        unknownError instanceof Error
          ? unknownError.message
          : "native dictation failed";
      diagnostics.record("error", "native-dictation", "trigger-failed", {
        error,
      });
      await reply.code(500).send({ error });
    }
  });

  app.post("/api/native-dictation/transcribe", async (request, reply) => {
    let file: Awaited<ReturnType<typeof request.file>>;
    try {
      file = await request.file();
    } catch (error) {
      diagnostics.record(
        "warn",
        "native-dictation",
        "invalid-transcribe-upload",
        { error: error instanceof Error ? error.message : String(error) },
      );
      await reply.code(400).send({ error: "Invalid audio upload" });
      return;
    }
    if (!file) {
      await reply.code(400).send({ error: "Missing audio file" });
      return;
    }
    let audioSize = 0;
    try {
      const audio = await file.toBuffer();
      audioSize = audio.length;
      const text = await transcribeNativeAudio({
        appServer,
        audio,
        filename: file.filename || null,
        contentType: file.mimetype || null,
        // Desktop's Composer dictation does not send a language field. Passing
        // browser locale such as en-US currently makes the official ASR route
        // return a generic 500, so keep this bridge aligned with Desktop.
        language: null,
      });
      diagnostics.record("info", "native-dictation", "transcribed", {
        mimeType: file.mimetype,
        size: audioSize,
        hasText: text.trim().length > 0,
      });
      const response = nativeDictationTranscribeResponseSchema.safeParse({
        data: { text },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "native-dictation-transcribe-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (unknownError) {
      const statusCode =
        unknownError instanceof NativeTranscriptionError
          ? unknownError.statusCode
          : 502;
      const error =
        unknownError instanceof Error
          ? unknownError.message
          : "native transcription failed";
      diagnostics.record("warn", "native-dictation", "transcribe-failed", {
        statusCode,
        error,
        mimeType: file.mimetype,
        filename: file.filename,
        size: audioSize,
      });
      await reply.code(statusCode).send({ error });
    }
  });

  app.post("/api/settings", async (request, reply) => {
    const parsed = settingsUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const nextLocalConfig = updateLocalConfigFile(
      config.projectRoot,
      (current) => mergeSettingsPatch(current, parsed.data),
    );
    const rawFrameLogging =
      nextLocalConfig.diagnostics?.rawFrameLogging ??
      config.diagnostics.rawFrameLogging;
    officialIpc.setRawFrameLogging(rawFrameLogging);
    diagnostics.record("info", "settings", "runtime-settings-updated", {
      rawFrameLogging,
      restartRequired: buildPublicConfig(config).restartRequired,
    });
    const payload = {
      data: buildPublicConfig(config),
    };
    const response = settingsResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "settings-response-validation-failed",
        {
          error,
        },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post("/api/settings/password", async (request, reply) => {
    const parsed = lanPasswordUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { password } = parsed.data;
    auth.service.updatePassword(password);
    diagnostics.record("info", "auth", "lan-password-updated");
    await reply.send(authOkResponseSchema.parse({ data: { ok: true } }));
  });

  app.get("/api/projects/favorites", async (_request, reply) => {
    const payload = { data: readFavoriteProjects(config) };
    const response = favoriteProjectsResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "favorite-projects-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post("/api/projects/favorites", async (request, reply) => {
    const parsed = favoriteProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    try {
      const path = validateProjectDirectory(parsed.data.path);
      const nextLocalConfig = updateLocalConfigFile(
        config.projectRoot,
        (current) => {
          const currentFavorites = current.projects?.favorites ?? [];
          const favorites = favoriteProjectExists(currentFavorites, path)
            ? currentFavorites.map((entry) =>
                normalizeProjectPath(entry).toLocaleLowerCase() ===
                path.toLocaleLowerCase()
                  ? path
                  : entry,
              )
            : [...currentFavorites, path];
          return {
            ...current,
            projects: {
              ...current.projects,
              favorites,
            },
          };
        },
      );
      const projects = (nextLocalConfig.projects?.favorites ?? [])
        .map((entry) => projectFromPath(entry, "web-favorite"))
        .filter((project): project is Project => Boolean(project));
      const desktopSync = syncDesktopWorkspaceRoot(path);
      diagnostics.record(
        desktopSync.status === "failed" ? "warn" : "info",
        "projects",
        "desktop-workspace-root-sync",
        {
          status: desktopSync.status,
          path: desktopSync.path,
          globalStatePath: desktopSync.globalStatePath,
          ...(desktopSync.error ? { error: desktopSync.error } : {}),
        },
      );
      diagnostics.record("info", "projects", "favorite-project-added", {
        path,
      });
      const response = favoriteProjectsResponseSchema.safeParse({
        data: projects,
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "favorite-projects-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(400).send({
        error: error instanceof Error ? error.message : "Failed to add project",
      });
    }
  });

  app.post("/api/projects/favorites/remove", async (request, reply) => {
    const parsed = favoriteProjectRemoveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const path = normalizeProjectPath(parsed.data.path);
    if (!path) {
      await reply.code(400).send({ error: "Project path is required" });
      return;
    }
    const key = path.toLocaleLowerCase();
    const nextLocalConfig = updateLocalConfigFile(
      config.projectRoot,
      (current) => ({
        ...current,
        projects: {
          ...current.projects,
          favorites: (current.projects?.favorites ?? []).filter(
            (entry) => normalizeProjectPath(entry).toLocaleLowerCase() !== key,
          ),
        },
      }),
    );
    const projects = (nextLocalConfig.projects?.favorites ?? [])
      .map((entry) => projectFromPath(entry, "web-favorite"))
      .filter((project): project is Project => Boolean(project));
    diagnostics.record("info", "projects", "favorite-project-removed", {
      path,
    });
    const response = favoriteProjectsResponseSchema.safeParse({
      data: projects,
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "favorite-projects-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/files/list", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    try {
      const root = resolveAllowedProjectRoot(
        readString(query.root) || config.projectRoot,
      );
      const limitValue = Number(query.limit ?? 300);
      const listing = await listProjectDirectory({
        root,
        relativePath: readString(query.path) || readString(query.relativePath),
        limit: Number.isFinite(limitValue) ? limitValue : undefined,
      });
      const response = fileBrowserListingResponseSchema.safeParse({
        data: listing,
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "file-browser-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return undefined;
      }
      await reply.send(response.data);
      return undefined;
    } catch (error) {
      const statusCode =
        error instanceof FileBrowserError ? error.statusCode : 500;
      await reply.code(statusCode).send({
        error: error instanceof Error ? error.message : "Failed to list files",
      });
      return undefined;
    }
  });

  app.get("/api/files/preview", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    try {
      const requestedRoot = readString(query.root);
      const root = requestedRoot
        ? resolveAllowedProjectRoot(requestedRoot)
        : null;
      const maxBytes = Number(query.maxBytes ?? 0);
      const preview = await readFilePreview({
        filePath: readString(query.path),
        root,
        allowedRoots: allowedFilePreviewRoots(root),
        allowAbsolutePath: !requestedRoot,
        maxBytes:
          Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : undefined,
      });
      const response = filePreviewResponseSchema.safeParse({ data: preview });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "file-preview-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return undefined;
      }
      await reply.send(response.data);
      return undefined;
    } catch (error) {
      const statusCode =
        error instanceof FileBrowserError ? error.statusCode : 500;
      await reply.code(statusCode).send({
        error:
          error instanceof Error ? error.message : "Failed to preview file",
      });
      return undefined;
    }
  });

  const sendFileContent = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<undefined> => {
    const query = request.query as Record<string, unknown>;
    try {
      const requestedRoot = readString(query.root);
      const root = requestedRoot
        ? resolveAllowedProjectRoot(requestedRoot)
        : null;
      const filePath = resolveFilePreviewPath({
        filePath: readString(query.path),
        root,
        allowedRoots: allowedFilePreviewRoots(root),
        allowAbsolutePath: !requestedRoot,
      });
      let size = 0;
      try {
        const stats = statSync(filePath);
        if (!stats.isFile()) {
          await reply.code(404).send({ error: "File not found" });
          return undefined;
        }
        size = stats.size;
      } catch {
        await reply.code(404).send({ error: "File not found" });
        return undefined;
      }
      const rangeHeader = Array.isArray(request.headers.range)
        ? request.headers.range[0]
        : request.headers.range;
      const range = parseByteRangeHeader(rangeHeader, size);
      const mimeType = detectFileMimeType(filePath);
      const sendBody = request.method !== "HEAD";
      if (range.kind === "invalid") {
        await reply
          .code(416)
          .type("text/plain")
          .header("Accept-Ranges", "bytes")
          .header("Content-Range", `bytes */${size}`)
          .send(sendBody ? "Requested range not satisfiable" : undefined);
        return undefined;
      }
      const response = reply
        .code(range.kind === "partial" ? 206 : 200)
        .type(mimeType)
        .header("Accept-Ranges", "bytes")
        .header(
          "Content-Length",
          String(range.kind === "partial" ? range.length : size),
        )
        .header(
          "Content-Disposition",
          contentDispositionFilename(basename(filePath)),
        );
      if (range.kind === "partial") {
        response.header(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${size}`,
        );
      }
      if (!sendBody) {
        await response.send();
        return undefined;
      }
      const stream =
        range.kind === "partial"
          ? createReadStream(filePath, { start: range.start, end: range.end })
          : createFilePreviewStream(filePath);
      await response.send(stream);
      return undefined;
    } catch (error) {
      const statusCode =
        error instanceof FileBrowserError ? error.statusCode : 500;
      await reply.code(statusCode).send({
        error: error instanceof Error ? error.message : "Failed to read file",
      });
      return undefined;
    }
  };

  app.get("/api/files/content", sendFileContent);

  app.get("/api/workspace/status", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    try {
      const cwd = resolveAllowedProjectRoot(
        readString(query.cwd) || readString(query.root) || config.projectRoot,
      );
      const status = await readWorkspaceStatus(cwd);
      const response = workspaceStatusResponseSchema.safeParse({
        data: status,
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "workspace-status-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return undefined;
      }
      await reply.send(response.data);
      return undefined;
    } catch (error) {
      const statusCode =
        error instanceof FileBrowserError ? error.statusCode : 500;
      await reply.code(statusCode).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to read workspace status",
      });
      return undefined;
    }
  });

  app.get("/api/diagnostics", async (_request, reply) => {
    const response = diagnosticsResponseSchema.safeParse({
      data: diagnostics.list(),
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "diagnostics-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/diagnostics/export", async (_request, reply) => {
    const workspaceStatus = await readWorkspaceStatus(config.projectRoot).catch(
      (error: unknown) => {
        diagnostics.record("warn", "diagnostics", "workspace-status-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      },
    );
    const response = diagnosticsExportResponseSchema.safeParse({
      data: buildSafeDiagnosticsExport({
        config,
        officialIpcStatus: officialIpc.getStatus(),
        appServerStatus: appServer.getStatus(),
        workspaceStatus,
        cacheStatus: database.status(),
        diagnosticEvents: diagnostics.list(),
      }),
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "diagnostics-export-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/official-ipc/status", async (_request, reply) => {
    const payload = { data: officialIpc.getStatus() };
    const response = officialIpcStatusResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "official-ipc-status-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/protocol/compatibility", async (_request, reply) => {
    const payload = {
      data: buildProtocolCompatibility({
        officialIpc: officialIpc.getStatus(),
        appServer: appServer.getStatus(),
      }),
    };
    const response = protocolCompatibilityResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "protocol-compatibility-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/sync/readiness", async (request, reply) => {
    const query = asRecord(request.query) ?? {};
    const officialIpcStatus = officialIpc.getStatus();
    const compatibility = buildProtocolCompatibility({
      officialIpc: officialIpcStatus,
      appServer: appServer.getStatus(),
    });
    const payload = {
      data: buildSyncReadiness({
        compatibility,
        officialIpcStatus,
        threadId: readString(query.threadId),
        officialIpc,
      }),
    };
    const response = syncReadinessResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "sync-readiness-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/app-server/status", async (_request, reply) => {
    const payload = { data: appServer.getStatus() };
    const response = appServerStatusResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "app-server-status-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/account/status", async (_request, reply) => {
    try {
      await reply.send(await readCachedAccountStatus());
    } catch (error) {
      await reply.code(500).send({
        error: error instanceof Error ? error.message : "account/status failed",
      });
    }
  });

  app.get("/api/runtime-options", async (_request, reply) => {
    const warnings: string[] = [];
    let modelListResponse: unknown;
    let collaborationModeListResponse: unknown;

    try {
      modelListResponse = await appServer.modelList({
        includeHidden: false,
        limit: 100,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "model/list failed";
      warnings.push(`model/list: ${message}`);
      diagnostics.record("warn", "app-server", "model-list-failed", {
        error: message,
      });
    }

    try {
      collaborationModeListResponse = await appServer.collaborationModeList();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "collaborationMode/list failed";
      warnings.push(`collaborationMode/list: ${message}`);
      diagnostics.record(
        "warn",
        "app-server",
        "collaboration-mode-list-failed",
        { error: message },
      );
    }

    const response = runtimeOptionsResponseSchema.safeParse({
      data: normalizeRuntimeOptions({
        modelListResponse,
        collaborationModeListResponse,
        warnings,
      }),
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "runtime-options-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/skills", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const cwd = readString(query.cwd);
    const forceReload = readOptionalBoolean(query.forceReload) ?? false;
    const warnings: string[] = [];

    try {
      const result = await appServer.skillsList({
        cwds: cwd ? [cwd] : [],
        forceReload,
      });
      const response = skillsResponseSchema.safeParse({
        data: normalizeSkillsListResponse(result),
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "skills-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "skills/list failed";
      warnings.push(`skills/list: ${message}`);
      diagnostics.record("warn", "app-server", "skills-list-failed", {
        cwd: cwd || null,
        error: message,
      });
      const response = skillsResponseSchema.safeParse({
        data: normalizeSkillsListResponse(null, warnings),
      });
      if (!response.success) {
        const validationError = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "skills-response-validation-failed",
          { error: validationError },
        );
        await reply.code(500).send({ error: validationError });
        return;
      }
      await reply.send(response.data);
    }
  });

  app.get("/api/cache/status", async (_request, reply) => {
    const response = cacheStatusResponseSchema.safeParse({
      data: database.status(),
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "cache-status-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/attachments/storage", async (_request, reply) => {
    const payload = { data: database.attachmentStorageStatus() };
    const response = attachmentStorageResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "attachment-storage-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post("/api/attachments/cleanup", async (_request, reply) => {
    const result = await cleanupUnassociatedAttachments({
      database,
      attachmentsRoot: resolve(config.dataDir, "attachments"),
      onSkip: (attachment, reason) => {
        diagnostics.record(
          "warn",
          "attachments",
          "attachment-cleanup-skipped",
          {
            id: attachment.id,
            filename: attachment.filename,
            reason,
          },
        );
      },
    });
    diagnostics.record("info", "attachments", "attachment-cleanup-completed", {
      candidateCount: result.candidateCount,
      deletedCount: result.deletedCount,
      deletedBytes: result.deletedBytes,
      skippedCount: result.skippedCount,
    });
    const response = attachmentCleanupResponseSchema.safeParse({
      data: result,
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "attachment-cleanup-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/approvals", async (_request, reply) => {
    const response = approvalsResponseSchema.safeParse({
      data: approvals.list(),
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "approvals-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post("/api/approvals/decision", async (request, reply) => {
    const parsed = approvalDecisionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { id, decision } = parsed.data;
    try {
      const approval = approvals.decide(id, decision);
      const response = approvalDecisionResponseSchema.safeParse({
        data: { ok: true, approval },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "approval-decision-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to decide approval";
      await reply
        .code(message === "approval-not-found" ? 404 : 500)
        .send({ error: message });
    }
  });

  app.get("/api/attachments", async (request, reply) => {
    const threadId = readString(
      (request.query as Record<string, unknown>).threadId,
    );
    const payload = {
      data: database.listAttachments(threadId || null),
    };
    const response = attachmentsResponseSchema.safeParse(payload);
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "attachments-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.get("/api/attachments/:id/content", async (request, reply) => {
    const id = readString((request.params as Record<string, unknown>).id);
    const attachment = database.readAttachmentById(id);
    if (!attachment) {
      await reply.code(404).send({ error: "Attachment not found" });
      return;
    }
    const attachmentsRoot = resolve(config.dataDir, "attachments");
    const storedPath = resolve(attachment.path);
    if (!isPathInside(attachmentsRoot, storedPath)) {
      await reply.code(403).send({
        error: "Attachment path is outside the attachments directory",
      });
      return;
    }
    let size = attachment.size;
    try {
      size = statSync(storedPath).size;
    } catch {
      await reply.code(404).send({ error: "Attachment file not found" });
      return;
    }
    await reply
      .type(attachment.mimeType || "application/octet-stream")
      .header("Content-Length", String(size))
      .header(
        "Content-Disposition",
        contentDispositionFilename(attachment.filename),
      )
      .send(createReadStream(storedPath));
  });

  app.post("/api/attachments", async (request, reply) => {
    const threadId = readString(
      (request.query as Record<string, unknown>).threadId,
    );
    const file = await request.file();
    if (!file) {
      await reply.code(400).send({ error: "Missing attachment file" });
      return;
    }
    try {
      const attachment = await persistMultipartAttachment({
        config,
        file,
        threadId: threadId || null,
      });
      database.insertAttachment(attachment);
      diagnostics.record("info", "attachments", "attachment-uploaded", {
        id: attachment.id,
        filename: attachment.filename,
        size: attachment.size,
        threadId: attachment.threadId,
      });
      const response = attachmentResponseSchema.safeParse({ data: attachment });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "attachment-upload-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload attachment",
      });
    }
  });

  app.post("/api/rpc", async (request, reply) => {
    const body = asRecord(request.body);
    const method = readString(body?.method);
    if (!method) {
      await reply.code(400).send({ error: "Missing method" });
      return;
    }
    try {
      const result = await appServer.rpc(method, body?.params);
      await reply.send({ result });
    } catch (error) {
      await reply.code(502).send({
        error: error instanceof Error ? error.message : `RPC failed: ${method}`,
      });
    }
  });

  app.get("/api/threads", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const limitValue = Number(query.limit ?? 50);
    const limit = Number.isFinite(limitValue)
      ? Math.max(1, Math.min(100, Math.trunc(limitValue)))
      : 50;
    const cursor = readString(query.cursor) || null;
    try {
      const result = await appServer.threadList({
        archived: false,
        limit,
        cursor,
        sortKey: "updated_at",
        modelProviders: [],
      });
      await reply.send({ data: result });
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to list threads",
      });
    }
  });

  app.get("/api/domain/threads", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const limitValue = Number(query.limit ?? 50);
    const limit = Number.isFinite(limitValue)
      ? Math.max(1, Math.min(100, Math.trunc(limitValue)))
      : 50;
    const archived = readOptionalBoolean(query.archived) ?? false;
    const cursor = readString(query.cursor) || null;
    try {
      const result = await appServer.threadList({
        archived,
        limit,
        cursor,
        sortKey: "updated_at",
        modelProviders: [],
      });
      const rawThreads = Array.isArray(asRecord(result)?.data)
        ? (asRecord(result)?.data as unknown[])
        : [];
      const ownerByThreadId = Object.fromEntries(
        rawThreads
          .map((entry) => {
            const record = asRecord(entry);
            const threadId =
              readString(record?.id) || readString(record?.sessionId);
            return threadId
              ? [threadId, ownerFromOfficialState(officialIpc, threadId)]
              : null;
          })
          .filter((entry): entry is [string, Owner | null] => Boolean(entry)),
      );
      const list = overlayPinnedThreads(
        overlayLiveStreamStateOnThreadList(
          mergeThreadListProjects(
            normalizeOfficialThreadList(result, ownerByThreadId),
            readFavoriteProjectPaths(config),
          ),
          officialIpc,
        ),
        new Set(database.listPinnedThreadIds()),
      );
      const response = threadListResponseSchema.safeParse({ data: list });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "domain-threads-response-validation-failed",
          { error },
        );
        await reply
          .code(500)
          .send({ error: `Invalid domain threads response: ${error}` });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to list domain threads",
      });
    }
  });

  app.get("/api/thread-read", async (request, reply) => {
    const threadId = readString(
      (request.query as Record<string, unknown>).threadId,
    );
    if (!threadId) {
      await reply.code(400).send({ error: "Missing threadId" });
      return;
    }
    const officialState = officialIpc.getThreadStreamState(threadId);
    if (officialState) {
      await reply.send({ data: officialState, source: "official-ipc" });
      return;
    }
    try {
      const result = await appServer.threadRead({
        threadId,
        includeTurns: true,
      });
      await reply.send({ data: result, source: "app-server" });
    } catch (error) {
      await reply.code(502).send({
        error: error instanceof Error ? error.message : "Failed to read thread",
      });
    }
  });

  app.get("/api/official-thread-stream-state", async (request, reply) => {
    const threadId = readString(
      (request.query as Record<string, unknown>).threadId,
    );
    if (!threadId) {
      await reply.code(400).send({ error: "Missing threadId" });
      return;
    }
    await reply.send({ data: officialIpc.getThreadStreamState(threadId) });
  });

  app.get("/api/domain/thread-detail", async (request, reply) => {
    const threadId = readString(
      (request.query as Record<string, unknown>).threadId,
    );
    if (!threadId) {
      await reply.code(400).send({ error: "Missing threadId" });
      return;
    }
    let officialFallbackDetail: ThreadDetail | null = null;
    const pinnedThreadIds = new Set(database.listPinnedThreadIds());
    const state = officialIpc.getThreadStreamState(threadId);
    const hasExternalOfficialState =
      state !== null && officialIpc.isExternallyOwnedConversation(threadId);
    if (state) {
      const detail = await hydrateThreadGoal(
        threadId,
        hydratePinnedDetail(
          hydrateSideConversations(
            threadId,
            normalizeOfficialConversationState({
              threadId,
              ownerClientId: state.ownerClientId,
              cacheVersion: state.cacheVersion,
              updatedAtIso: state.updatedAtIso,
              isInProgress: state.isInProgress,
              activeTurnId: state.activeTurnId,
              conversationState: state.conversationState,
            }),
          ),
          pinnedThreadIds,
        ),
      );
      const hasUsableOfficialDetail =
        detail && detail.turns.length > 0 && !detailHasEmptyActiveTurn(detail);
      if (hasUsableOfficialDetail) {
        const responseSource = state.isInProgress
          ? "official-ipc-live"
          : "official-ipc";
        const response = threadDetailResponseSchema.safeParse({
          data: detail,
          source: responseSource,
        });
        if (!response.success) {
          const error = formatZodError(response.error);
          diagnostics.record(
            "error",
            "api",
            "domain-thread-detail-response-validation-failed",
            { threadId, source: responseSource, error },
          );
          await reply
            .code(500)
            .send({ error: `Invalid domain thread detail response: ${error}` });
          return;
        }
        await reply.send(response.data);
        return;
      }
      officialFallbackDetail = detail;
      diagnostics.record("warn", "domain", "official-thread-detail-fallback", {
        threadId,
        cacheVersion: state.cacheVersion,
        hasDetail: Boolean(detail),
        isInProgress: state.isInProgress,
        activeTurnId: state.activeTurnId,
        reason: state.isInProgress
          ? "verify-active-state"
          : detailHasEmptyActiveTurn(detail)
            ? "empty-active-turn"
            : "empty-detail",
      });
    }

    try {
      const result = await appServer.threadRead({
        threadId,
        includeTurns: true,
      });
      const rawThread = asRecord(result)?.thread ?? result;
      const mergedThread =
        hasExternalOfficialState && state
          ? preserveRicherOfficialStreamItems(rawThread, state.conversationState)
          : rawThread;
      const retiredStaleOfficialActive =
        hasExternalOfficialState &&
        state !== null &&
        shouldRetireStaleOfficialActiveState(mergedThread, state);
      const threadSnapshot =
        hasExternalOfficialState && state && !retiredStaleOfficialActive
          ? preserveOfficialLiveState(mergedThread, state)
          : mergedThread;
      const detail = await hydrateThreadGoal(
        threadId,
        hydratePinnedDetail(
          hydrateSideConversations(
            threadId,
            normalizeOfficialThreadDetail({
              thread: threadSnapshot,
              owner: ownerFromOfficialState(officialIpc, threadId),
              fallbackThreadId: threadId,
            }),
          ),
          pinnedThreadIds,
        ),
      );
      const responseSource = hasExternalOfficialState
        ? retiredStaleOfficialActive
          ? "app-server-readonly-stale-official-retired"
          : "app-server-readonly"
        : "app-server";
      if (detail && hasExternalOfficialState && state) {
        const hydrated = officialIpc.hydrateThreadStreamState({
          threadId,
          conversationState: threadSnapshot,
          hostId: state.hostId,
          ownerClientId: state.ownerClientId,
          sourceClientId: state.sourceClientId,
        });
        diagnostics.record(
          hydrated ? "info" : "warn",
          "domain",
          retiredStaleOfficialActive && hydrated
            ? "official-thread-detail-stale-active-retired"
            : retiredStaleOfficialActive
              ? "official-thread-detail-stale-active-retire-skipped"
              : hydrated
                ? "official-thread-detail-readonly-hydrated"
                : "official-thread-detail-readonly-hydrate-skipped",
          {
            threadId,
            cacheVersion: state.cacheVersion,
          },
        );
      }
      if (detail && !hasExternalOfficialState) {
        claimIdleAppServerConversation(
          threadId,
          detail as ThreadDetail,
          "thread-detail-app-server",
        );
      }
      const response = threadDetailResponseSchema.safeParse({
        data: detail,
        source: responseSource,
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "domain-thread-detail-response-validation-failed",
          { threadId, source: responseSource, error },
        );
        await reply
          .code(500)
          .send({ error: `Invalid domain thread detail response: ${error}` });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      if (officialFallbackDetail) {
        const response = threadDetailResponseSchema.safeParse({
          data: officialFallbackDetail,
          source: "official-ipc-empty",
        });
        if (!response.success) {
          const validationError = formatZodError(response.error);
          diagnostics.record(
            "error",
            "api",
            "domain-thread-detail-response-validation-failed",
            {
              threadId,
              source: "official-ipc-empty",
              error: validationError,
            },
          );
          await reply.code(500).send({
            error: `Invalid domain thread detail response: ${validationError}`,
          });
          return;
        }
        await reply.send(response.data);
        return;
      }
      await reply.code(502).send({
        error: errorMessage(error) || "Failed to read domain thread",
      });
    }
  });

  app.post("/api/domain/turn-start", async (request, reply) => {
    const parsed = turnStartRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const body = parsed.data;
    const threadId = body.threadId;
    const text = body.text;
    const attachmentIds = [...new Set(readStringArray(body?.attachmentIds))];
    const storedAttachments = database.readAttachmentsByIds(attachmentIds);
    const foundAttachmentIds = new Set(
      storedAttachments.map((attachment) => attachment.id),
    );
    const missingAttachmentIds = attachmentIds.filter(
      (id) => !foundAttachmentIds.has(id),
    );
    if (missingAttachmentIds.length > 0) {
      await reply.code(400).send({
        error: `Attachment not found: ${missingAttachmentIds.join(", ")}`,
      });
      return;
    }
    const foreignAttachment = storedAttachments.find(
      (attachment) =>
        attachment.threadId !== null && attachment.threadId !== threadId,
    );
    if (foreignAttachment) {
      await reply.code(400).send({
        error: `Attachment ${foreignAttachment.id} belongs to another thread`,
      });
      return;
    }

    const associateSentAttachments = (): void => {
      if (attachmentIds.length === 0) return;
      try {
        const associated = database.associateAttachmentsWithThread(
          attachmentIds,
          threadId,
        );
        diagnostics.record(
          "info",
          "attachments",
          "turn-attachments-associated",
          {
            threadId,
            attachmentCount: attachmentIds.length,
            associated,
          },
        );
      } catch (error) {
        diagnostics.record(
          "error",
          "attachments",
          "turn-attachments-association-failed",
          {
            threadId,
            attachmentCount: attachmentIds.length,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    };

    const streamStateRecord = asRecord(
      officialIpc.getThreadStreamState(threadId)?.conversationState,
    );
    const params = await buildTurnStartParams({
      threadId,
      text,
      cwd:
        body?.cwd ??
        (readString(streamStateRecord?.cwd) ||
          readString(streamStateRecord?.projectId) ||
          undefined),
      model: body?.model,
      effort: body?.effort,
      attachments: storedAttachments,
      skills: body?.skills,
      collaborationMode: body?.collaborationMode,
      permissionMode: body?.permissionMode,
    });
    diagnostics.record("info", "turn-start", "runtime-options-selected", {
      threadId,
      permissionMode: readString(body?.permissionMode) || null,
      ...summarizeRuntimeSelection({
        model: body?.model,
        effort: body?.effort,
        skills: body?.skills,
        attachmentCount: params.attachments?.length ?? 0,
        collaborationMode: body?.collaborationMode,
      }),
    });

    try {
      const result = await officialIpc.sendThreadFollowerStartTurn(
        threadId,
        params,
      );
      associateSentAttachments();
      await reply.send({ data: { mode: "official-follower", result } });
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "official follower failed";
      let fallback = decideLocalTurnFallback({
        action: "start",
        threadId,
        errorMessage: message,
        officialIpc,
      });
      if (
        !fallback.allow &&
        (fallback.reason === "official-owner-required" ||
          fallback.reason === "official-owner-unavailable") &&
        (await claimIdleAppServerConversationByRead(
          threadId,
          "turn-start-fallback",
        ))
      ) {
        fallback = { allow: true, reason: "web-owned" };
      }
      if (!fallback.allow) {
        diagnostics.record(
          "warn",
          "turn-start",
          "official-follower-fallback-denied",
          {
            threadId,
            error: message,
            reason: fallback.reason,
          },
        );
        await reply.code(fallback.statusCode).send({ error: fallback.error });
        return;
      }
      diagnostics.record("warn", "turn-start", "official-follower-fallback", {
        threadId,
        error: message,
        reason: fallback.reason,
      });
    }

    try {
      if (!promoteLocalOwnerConversation(threadId, "turn-start")) {
        await reply
          .code(503)
          .send({ error: "official-ipc-owner-not-broadcastable" });
        return;
      }
      const pendingSnapshotBroadcasted =
        await broadcastPendingLocalTurnSnapshot(
          threadId,
          params,
          "local-turn-start",
        );
      if (!pendingSnapshotBroadcasted) {
        diagnostics.record(
          "warn",
          "turn-start",
          "pending-turn-snapshot-failed",
          { threadId },
        );
        await reply
          .code(503)
          .send({ error: "official-ipc-owner-not-broadcastable" });
        return;
      }
      const result = await startLocalTurn(appServer, params);
      associateSentAttachments();
      void broadcastOwnedAppServerSnapshot(threadId, "local-turn-start");
      await reply.send({ data: { mode: "app-server", result } });
    } catch (error) {
      await reply.code(502).send({
        error: error instanceof Error ? error.message : "Failed to start turn",
      });
    }
  });

  app.post("/api/domain/turn-steer", async (request, reply) => {
    const parsed = turnSteerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const body = parsed.data;
    const threadId = body.threadId;
    const expectedTurnId = body.expectedTurnId;
    const text = body.text;
    const attachmentIds = [...new Set(readStringArray(body?.attachmentIds))];
    const storedAttachments = database.readAttachmentsByIds(attachmentIds);
    const foundAttachmentIds = new Set(
      storedAttachments.map((attachment) => attachment.id),
    );
    const missingAttachmentIds = attachmentIds.filter(
      (id) => !foundAttachmentIds.has(id),
    );
    if (missingAttachmentIds.length > 0) {
      await reply.code(400).send({
        error: `Attachment not found: ${missingAttachmentIds.join(", ")}`,
      });
      return;
    }
    const foreignAttachment = storedAttachments.find(
      (attachment) =>
        attachment.threadId !== null && attachment.threadId !== threadId,
    );
    if (foreignAttachment) {
      await reply.code(400).send({
        error: `Attachment ${foreignAttachment.id} belongs to another thread`,
      });
      return;
    }

    const associateSentAttachments = (): void => {
      if (attachmentIds.length === 0) return;
      try {
        const associated = database.associateAttachmentsWithThread(
          attachmentIds,
          threadId,
        );
        diagnostics.record(
          "info",
          "attachments",
          "steer-attachments-associated",
          {
            threadId,
            expectedTurnId,
            attachmentCount: attachmentIds.length,
            associated,
          },
        );
      } catch (error) {
        diagnostics.record(
          "error",
          "attachments",
          "steer-attachments-association-failed",
          {
            threadId,
            expectedTurnId,
            attachmentCount: attachmentIds.length,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    };

    const params = await buildTurnSteerParams({
      threadId,
      expectedTurnId,
      text: text.trim(),
      cwd: body?.cwd,
      attachments: storedAttachments,
      skills: body?.skills,
    });
    diagnostics.record("info", "turn-steer", "runtime-options-selected", {
      threadId,
      expectedTurnId,
      permissionMode: readString(body?.permissionMode) || null,
      ...summarizeRuntimeSelection({
        skills: body?.skills,
        attachmentCount: params.attachments?.length ?? 0,
      }),
    });

    try {
      const result = await officialIpc.sendThreadFollowerSteerTurn(
        threadId,
        params,
      );
      associateSentAttachments();
      await reply.send({ data: { mode: "official-follower", result } });
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "official steer failed";
      const fallback = decideLocalTurnFallback({
        action: "steer",
        threadId,
        errorMessage: message,
        officialIpc,
      });
      if (!fallback.allow) {
        diagnostics.record(
          "warn",
          "turn-steer",
          "official-follower-fallback-denied",
          {
            threadId,
            expectedTurnId,
            error: message,
            reason: fallback.reason,
          },
        );
        await reply.code(fallback.statusCode).send({ error: fallback.error });
        return;
      }
      diagnostics.record("warn", "turn-steer", "official-follower-fallback", {
        threadId,
        expectedTurnId,
        error: message,
        reason: fallback.reason,
      });
    }

    try {
      const result = await appServer.turnSteer(
        buildLocalTurnSteerParams(params),
      );
      associateSentAttachments();
      await reply.send({ data: { mode: "app-server", result } });
    } catch (error) {
      await reply.code(502).send({
        error: error instanceof Error ? error.message : "Failed to steer turn",
      });
    }
  });

  app.post("/api/domain/thread-create", async (request, reply) => {
    const parsed = threadCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const cwd = readString(parsed.data.cwd) || config.projectRoot;

    try {
      if (!officialIpc.canOwnConversations()) {
        diagnostics.record(
          "warn",
          "thread-create",
          "official-ipc-owner-not-ready",
        );
        await reply.code(503).send({ error: "official-ipc-owner-not-ready" });
        return;
      }
      const result = await appServer.threadStart({
        cwd,
        threadSource: "user",
      });
      const threadRecord =
        asRecord(asRecord(result)?.thread) ?? asRecord(result);
      const threadId =
        readString(threadRecord?.id) || readString(threadRecord?.sessionId);
      const detail = threadId
        ? normalizeOfficialThreadDetail({
            thread: threadRecord,
            owner: null,
            fallbackThreadId: threadId,
          })
        : null;
      if (!detail) throw new Error("Failed to normalize created thread");
      const idleSnapshot = buildIdleLocalThreadSnapshot({
        threadId: detail.thread.id,
        thread: threadRecord,
        detail,
        fallbackCwd: cwd,
      });
      const broadcasted = officialIpc.broadcastConversationSnapshot(
        detail.thread.id,
        idleSnapshot,
      );
      if (!broadcasted || !officialIpc.isOwnedConversation(detail.thread.id)) {
        diagnostics.record(
          "warn",
          "thread-create",
          "official-ipc-owner-not-established",
          { threadId: detail.thread.id },
        );
        await reply
          .code(503)
          .send({ error: "official-ipc-owner-not-established" });
        return;
      }
      diagnostics.record("info", "thread-create", "idle-snapshot-broadcast", {
        threadId: detail.thread.id,
      });
      const refreshBroadcasted = officialIpc.broadcastThreadUnarchived(
        detail.thread.id,
      );
      diagnostics.record(
        refreshBroadcasted ? "info" : "warn",
        "thread-create",
        "recent-refresh-broadcast",
        { threadId: detail.thread.id, broadcasted: refreshBroadcasted },
      );
      const response = threadCreateResponseSchema.safeParse({
        data: { thread: detail.thread, raw: result },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-create-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to create thread",
      });
    }
  });

  app.post("/api/domain/side-conversation-create", async (request, reply) => {
    const parsed = sideConversationCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const parentThreadId = parsed.data.threadId;
    const parentState = officialIpc.getThreadStreamState(parentThreadId);
    const parentRecord = asRecord(parentState?.conversationState);
    if (parentRecord?.sideConversation === true) {
      await reply
        .code(400)
        .send({ error: "side-conversation-parent-required" });
      return;
    }
    const cwd =
      readString(parsed.data.cwd) ||
      readString(parentRecord?.cwd) ||
      config.projectRoot;

    try {
      if (!officialIpc.canOwnConversations()) {
        diagnostics.record(
          "warn",
          "side-conversation-create",
          "official-ipc-owner-not-ready",
          { parentThreadId },
        );
        await reply.code(503).send({ error: "official-ipc-owner-not-ready" });
        return;
      }

      const forkResult = await appServer.threadFork({
        threadId: parentThreadId,
        path: null,
        cwd,
        threadSource: "user",
        developerInstructions: SIDE_CONVERSATION_BOUNDARY_TEXT,
        excludeTurns: true,
        ephemeral: true,
        persistExtendedHistory: false,
      });
      const forkThread =
        asRecord(asRecord(forkResult)?.thread) ?? asRecord(forkResult);
      const sideThreadId =
        readString(forkThread?.id) ||
        readString(forkThread?.threadId) ||
        readString(forkThread?.conversationId);
      if (!forkThread || !sideThreadId) {
        throw new Error("Failed to normalize side conversation fork");
      }

      await appServer.threadInjectItems({
        threadId: sideThreadId,
        items: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: SIDE_CONVERSATION_BOUNDARY_TEXT,
              },
            ],
          },
        ],
      });

      const snapshot = buildSideConversationSnapshot({
        sideThreadId,
        parentThreadId,
        cwd,
        forkThread,
      });
      const broadcasted = officialIpc.broadcastConversationSnapshot(
        sideThreadId,
        snapshot,
      );
      if (!broadcasted || !officialIpc.isOwnedConversation(sideThreadId)) {
        diagnostics.record(
          "warn",
          "side-conversation-create",
          "official-ipc-owner-not-established",
          { parentThreadId, sideThreadId },
        );
        await reply
          .code(503)
          .send({ error: "official-ipc-owner-not-established" });
        return;
      }

      const response = sideConversationCreateResponseSchema.safeParse({
        data: {
          sideConversation: sideConversationFromFork({
            threadId: sideThreadId,
            forkThread,
            title: sideConversationTitle(),
          }),
          raw: forkResult,
        },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "side-conversation-create-response-validation-failed",
          { parentThreadId, sideThreadId, error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to create side conversation",
      });
    }
  });

  app.post("/api/domain/side-conversation-close", async (request, reply) => {
    const parsed = sideConversationCloseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const sideConversationId = parsed.data.sideConversationId;
    const state = officialIpc.getThreadStreamState(sideConversationId);
    const record = asRecord(state?.conversationState);
    if (record && record.sideConversation !== true) {
      await reply
        .code(400)
        .send({ error: "side-conversation-required" });
      return;
    }

    let interrupted = false;
    const activeTurnId = readActiveTurnIdFromStreamState(state);
    if (state?.isInProgress && activeTurnId) {
      try {
        if (officialIpc.isOwnedConversation(sideConversationId)) {
          await appServer.turnInterrupt({
            threadId: sideConversationId,
            turnId: activeTurnId,
          });
        } else {
          await officialIpc.sendThreadFollowerInterruptTurn(
            sideConversationId,
            activeTurnId,
          );
        }
        interrupted = true;
      } catch (error) {
        diagnostics.record("warn", "side-conversation-close", "interrupt-failed", {
          sideConversationId,
          activeTurnId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const discarded = officialIpc.discardConversationFromCache(
      sideConversationId,
      "side-conversation-closed",
    );
    const response = sideConversationCloseResponseSchema.safeParse({
      data: {
        ok: true,
        sideConversationId,
        discarded,
        interrupted,
      },
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "side-conversation-close-response-validation-failed",
        { sideConversationId, error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post("/api/domain/thread-rename", async (request, reply) => {
    const parsed = threadRenameRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId, title } = parsed.data;

    try {
      const externalStateBeforeRename =
        officialIpc.isExternallyOwnedConversation(threadId)
          ? officialIpc.getThreadStreamState(threadId)
          : null;
      const result = await appServer.threadRename({ threadId, name: title });
      const detailResult = await appServer
        .threadRead({ threadId, includeTurns: true })
        .catch(() => null);
      const externalStateAfterRefresh =
        officialIpc.isExternallyOwnedConversation(threadId)
          ? officialIpc.getThreadStreamState(threadId)
          : null;
      const externalState =
        externalStateBeforeRename && externalStateAfterRefresh
          ? externalStateAfterRefresh
          : null;
      const wasExternallyOwnedBeforeRename =
        externalStateBeforeRename !== null;
      const rawThread = asRecord(detailResult)?.thread ?? detailResult;
      const mergedThread =
        externalState !== null
          ? preserveRicherOfficialStreamItems(
              rawThread,
              externalState.conversationState,
            )
          : rawThread;
      const retiredStaleOfficialActive =
        externalState !== null &&
        shouldRetireStaleOfficialActiveState(mergedThread, externalState);
      const threadSnapshot =
        externalState !== null && !retiredStaleOfficialActive
          ? preserveOfficialLiveState(mergedThread, externalState)
          : mergedThread;
      const detail = detailResult
        ? normalizeOfficialThreadDetail({
            thread: threadSnapshot,
            owner: ownerFromOfficialState(officialIpc, threadId),
            fallbackThreadId: threadId,
          })
        : null;
      if (detail) {
        if (externalState) {
          const hydrated = officialIpc.hydrateThreadStreamState({
            threadId,
            conversationState: threadSnapshot,
            hostId: externalState.hostId,
            ownerClientId: externalState.ownerClientId,
            sourceClientId: externalState.sourceClientId,
          });
          diagnostics.record(
            hydrated ? "info" : "warn",
            "thread-rename",
            hydrated
              ? "external-owner-app-server-rename-hydrated"
              : "external-owner-app-server-rename-hydrate-skipped",
            { threadId },
          );
        } else if (wasExternallyOwnedBeforeRename) {
          diagnostics.record(
            "warn",
            "thread-rename",
            "external-owner-app-server-rename-detail-cache-skipped",
            { threadId },
          );
        }
        if (officialIpc.isOwnedConversation(threadId)) {
          officialIpc.broadcastConversationSnapshot(
            threadId,
            rawThread ?? detail,
          );
        }
      }
      const response = threadRenameResponseSchema.safeParse({
        data: { ok: true, result, thread: detail?.thread ?? null },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-rename-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to rename thread",
      });
    }
  });

  app.post("/api/domain/thread-goal-set", async (request, reply) => {
    const parsed = threadGoalSetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId, objective, status } = parsed.data;

    try {
      const params: {
        threadId: string;
        objective?: string;
        status?: "active" | "paused";
      } = { threadId };
      if (objective) params.objective = objective;
      if (status) params.status = status;
      const result = await appServer.threadGoalSet(params);
      const goal = normalizeThreadGoal(asRecord(result)?.goal ?? null);
      const detail = await readAppServerThreadDetail(threadId, goal).catch(
        () => null,
      );
      if (detail) {
        if (officialIpc.isOwnedConversation(threadId)) {
          officialIpc.broadcastConversationSnapshot(threadId, {
            ...detail,
            id: detail.thread.id,
            title: detail.thread.title,
            name: detail.thread.title,
            cwd: detail.thread.path ?? detail.thread.projectId ?? undefined,
          });
        }
      }
      const response = threadGoalResponseSchema.safeParse({
        data: {
          ok: true,
          mode: "app-server",
          result,
          goal,
          thread: detail?.thread ?? null,
        },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-goal-set-response-validation-failed",
          { threadId, error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to update thread goal",
      });
    }
  });

  app.post("/api/domain/thread-goal-clear", async (request, reply) => {
    const parsed = threadGoalClearRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId } = parsed.data;

    try {
      const result = await appServer.threadGoalClear({ threadId });
      const detail = await readAppServerThreadDetail(threadId, null).catch(
        () => null,
      );
      if (detail) {
        if (officialIpc.isOwnedConversation(threadId)) {
          officialIpc.broadcastConversationSnapshot(threadId, {
            ...detail,
            id: detail.thread.id,
            title: detail.thread.title,
            name: detail.thread.title,
            cwd: detail.thread.path ?? detail.thread.projectId ?? undefined,
          });
        }
      }
      const response = threadGoalResponseSchema.safeParse({
        data: {
          ok: true,
          mode: "app-server",
          result,
          goal: null,
          thread: detail?.thread ?? null,
        },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-goal-clear-response-validation-failed",
          { threadId, error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to clear thread goal",
      });
    }
  });

  app.post("/api/domain/thread-pin", async (request, reply) => {
    const parsed = threadPinRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId, pinned } = parsed.data;
    database.setThreadPinned(threadId, pinned);
    diagnostics.record("info", "thread-pin", "local-pin-updated", {
      threadId,
      pinned,
    });
    const response = threadPinResponseSchema.safeParse({
      data: {
        ok: true,
        threadId,
        pinned,
        result: { source: "web-local" },
      },
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "thread-pin-response-validation-failed",
        {
          error,
        },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post("/api/domain/thread-archive", async (request, reply) => {
    const parsed = threadArchiveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId } = parsed.data;

    try {
      if (officialIpc.isExternallyOwnedConversation(threadId)) {
        diagnostics.record(
          "warn",
          "thread-archive",
          "external-owner-action-denied",
          { threadId },
        );
        await reply
          .code(409)
          .send({ error: "official-owner-action-required:thread-archive" });
        return;
      }
      const wasWebOwned = officialIpc.isOwnedConversation(threadId);
      const result = await archiveThreadWithRecovery(appServer, threadId);
      database.deleteThread(threadId);
      if (wasWebOwned) {
        officialIpc.releaseOwnedConversation(threadId, "thread-archived");
      }
      const response = threadArchiveResponseSchema.safeParse({
        data: { ok: true, result },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-archive-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to archive thread",
      });
    }
  });

  app.post("/api/domain/thread-unarchive", async (request, reply) => {
    const parsed = threadUnarchiveRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId } = parsed.data;

    try {
      if (officialIpc.isExternallyOwnedConversation(threadId)) {
        diagnostics.record(
          "warn",
          "thread-unarchive",
          "external-owner-action-denied",
          { threadId },
        );
        await reply
          .code(409)
          .send({ error: "official-owner-action-required:thread-unarchive" });
        return;
      }
      const result = await appServer.threadUnarchive({ threadId });
      const detailResult = await appServer
        .threadRead({ threadId, includeTurns: true })
        .catch(() => null);
      const detail = detailResult
        ? normalizeOfficialThreadDetail({
            thread: asRecord(detailResult)?.thread ?? detailResult,
            owner: ownerFromOfficialState(officialIpc, threadId),
            fallbackThreadId: threadId,
          })
        : null;
      const response = threadUnarchiveResponseSchema.safeParse({
        data: { ok: true, result, thread: detail?.thread ?? null },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-unarchive-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to unarchive thread",
      });
    }
  });

  app.post("/api/domain/thread-compact", async (request, reply) => {
    const parsed = threadCompactRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId } = parsed.data;

    try {
      const result =
        await officialIpc.sendThreadFollowerCompactThread(threadId);
      const response = threadCompactResponseSchema.safeParse({
        data: {
          mode: "official-follower",
          result,
          thread: null,
        },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-compact-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "official compact failed";
      const fallback = decideLocalTurnFallback({
        action: "compact",
        threadId,
        errorMessage: message,
        officialIpc,
      });
      if (!fallback.allow) {
        diagnostics.record(
          "warn",
          "thread-compact",
          "official-follower-fallback-denied",
          {
            threadId,
            error: message,
            reason: fallback.reason,
          },
        );
        await reply.code(fallback.statusCode).send({ error: fallback.error });
        return;
      }
      diagnostics.record(
        "warn",
        "thread-compact",
        "official-follower-fallback",
        {
          threadId,
          error: message,
          reason: fallback.reason,
        },
      );
    }

    try {
      const result = await appServer.threadCompactStart({ threadId });
      const detailResult = await appServer
        .threadRead({ threadId, includeTurns: true })
        .catch(() => null);
      const detail = detailResult
        ? normalizeOfficialThreadDetail({
            thread: asRecord(detailResult)?.thread ?? detailResult,
            owner: ownerFromOfficialState(officialIpc, threadId),
            fallbackThreadId: threadId,
          })
        : null;
      if (detail) {
        if (officialIpc.isOwnedConversation(threadId)) {
          officialIpc.broadcastConversationSnapshot(
            threadId,
            asRecord(detailResult)?.thread ?? detail,
          );
        }
      }
      const response = threadCompactResponseSchema.safeParse({
        data: {
          mode: "app-server",
          result,
          thread: detail?.thread ?? null,
        },
      });
      if (!response.success) {
        const error = formatZodError(response.error);
        diagnostics.record(
          "error",
          "api",
          "thread-compact-response-validation-failed",
          { error },
        );
        await reply.code(500).send({ error });
        return;
      }
      await reply.send(response.data);
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to compact thread",
      });
    }
  });

  app.post("/api/domain/turn-interrupt", async (request, reply) => {
    const parsed = turnInterruptRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const body = parsed.data;
    const threadId = body.threadId;
    const turnId = body.turnId;

    try {
      const result = await officialIpc.sendThreadFollowerInterruptTurn(
        threadId,
        turnId,
      );
      await reply.send({ data: { mode: "official-follower", result } });
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "official interrupt failed";
      const fallback = decideLocalTurnFallback({
        action: "interrupt",
        threadId,
        errorMessage: message,
        officialIpc,
      });
      if (!fallback.allow) {
        diagnostics.record(
          "warn",
          "turn-interrupt",
          "official-follower-fallback-denied",
          {
            threadId,
            turnId,
            error: message,
            reason: fallback.reason,
          },
        );
        await reply.code(fallback.statusCode).send({ error: fallback.error });
        return;
      }
      diagnostics.record(
        "warn",
        "turn-interrupt",
        "official-follower-fallback",
        {
          threadId,
          turnId,
          error: message,
          reason: fallback.reason,
        },
      );
    }

    try {
      const result = await appServer.turnInterrupt({ threadId, turnId });
      await reply.send({ data: { mode: "app-server", result } });
    } catch (error) {
      await reply.code(502).send({
        error:
          error instanceof Error ? error.message : "Failed to interrupt turn",
      });
    }
  });

  app.post("/api/domain/thread-stop-background", async (request, reply) => {
    const parsed = threadStopBackgroundRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: formatZodError(parsed.error) });
      return;
    }
    const { threadId } = parsed.data;
    const turnIds = collectActiveTurnIds(threadId, officialIpc);
    const results: Array<Record<string, unknown>> = [];

    for (const turnId of turnIds) {
      try {
        const result = await officialIpc.sendThreadFollowerInterruptTurn(
          threadId,
          turnId,
        );
        results.push({ turnId, mode: "official-follower", result });
        continue;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "official interrupt failed";
        const fallback = decideLocalTurnFallback({
          action: "interrupt",
          threadId,
          errorMessage: message,
          officialIpc,
        });
        if (!fallback.allow) {
          results.push({
            turnId,
            mode: "denied",
            error: fallback.error,
            reason: fallback.reason,
          });
          continue;
        }
      }

      try {
        const result = await appServer.turnInterrupt({ threadId, turnId });
        results.push({ turnId, mode: "app-server", result });
      } catch (error) {
        results.push({
          turnId,
          mode: "error",
          error: error instanceof Error ? error.message : "interrupt failed",
        });
      }
    }

    const interrupted = results.filter(
      (result) =>
        result.mode === "official-follower" || result.mode === "app-server",
    ).length;
    const response = threadStopBackgroundResponseSchema.safeParse({
      data: { ok: true, interrupted, results },
    });
    if (!response.success) {
      const error = formatZodError(response.error);
      diagnostics.record(
        "error",
        "api",
        "thread-stop-background-response-validation-failed",
        { error },
      );
      await reply.code(500).send({ error });
      return;
    }
    await reply.send(response.data);
  });

  app.post(
    "/api/official-ipc/thread-follower-start-turn",
    async (request, reply) => {
      const body = asRecord(request.body);
      const threadId =
        readString(body?.threadId) || readString(body?.conversationId);
      if (!threadId) {
        await reply.code(400).send({ error: "Missing threadId" });
        return;
      }
      const turnStartParams = body?.turnStartParams ?? body?.params ?? null;
      try {
        const result = await officialIpc.sendThreadFollowerStartTurn(
          threadId,
          turnStartParams,
        );
        await reply.send({ result });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to forward follower start turn";
        const status =
          message.includes("no-official-owner") ||
          message.includes("no-client-found")
            ? 409
            : message.includes("official-ipc-not-connected") ||
                message.includes("official-ipc-not-supported")
              ? 503
              : 502;
        await reply.code(status).send({ error: message });
      }
    },
  );

  app.post(
    "/api/official-ipc/thread-follower-interrupt-turn",
    async (request, reply) => {
      const body = asRecord(request.body);
      const threadId =
        readString(body?.threadId) || readString(body?.conversationId);
      const turnId = readString(body?.turnId) || readString(body?.turn_id);
      if (!threadId || !turnId) {
        await reply.code(400).send({ error: "Missing threadId or turnId" });
        return;
      }
      try {
        const result = await officialIpc.sendThreadFollowerInterruptTurn(
          threadId,
          turnId,
        );
        await reply.send({ result });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to forward follower interrupt turn";
        const status =
          message.includes("no-official-owner") ||
          message.includes("no-client-found")
            ? 409
            : message.includes("official-ipc-not-connected") ||
                message.includes("official-ipc-not-supported")
              ? 503
              : 502;
        await reply.code(status).send({ error: message });
      }
    },
  );

  app.post(
    "/api/official-ipc/thread-follower-steer-turn",
    async (request, reply) => {
      const body = asRecord(request.body);
      const threadId =
        readString(body?.threadId) || readString(body?.conversationId);
      if (!threadId) {
        await reply.code(400).send({ error: "Missing threadId" });
        return;
      }
      const turnSteerParams =
        body?.turnSteerParams ??
        body?.params ??
        (Array.isArray(body?.input) ? body : null);
      try {
        const result = await officialIpc.sendThreadFollowerSteerTurn(
          threadId,
          turnSteerParams,
        );
        await reply.send({ result });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to forward follower steer turn";
        const status =
          message.includes("no-official-owner") ||
          message.includes("no-client-found")
            ? 409
            : message.includes("official-ipc-not-connected") ||
                message.includes("official-ipc-not-supported")
              ? 503
              : 502;
        await reply.code(status).send({ error: message });
      }
    },
  );

  app.get("/api/realtime", { websocket: true }, (socket) => {
    const unsubscribe = bus.subscribe((event) => {
      socket.send(JSON.stringify(event));
    });
    socket.on("close", unsubscribe);
    socket.send(
      JSON.stringify({
        type: "connected",
        atIso: new Date().toISOString(),
        serverInstanceId,
        serverStartedAtIso,
      }),
    );
  });

  const webDist = resolve(projectRoot, "apps/web/dist");
  const webIndex = resolve(webDist, "index.html");
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    decorateReply: false,
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      await reply.code(404).send({ error: "Not found" });
      return;
    }
    await reply
      .type("text/html; charset=utf-8")
      .send(await readFile(webIndex, "utf8"));
  });

  app.addHook("onClose", async () => {
    disposeLocalOwnerSnapshotSync();
    approvals.rejectAll("server-closing");
    officialIpc.dispose();
    appServer.dispose();
    database.close();
  });

  diagnostics.record("info", "server", "server-created", {
    host: config.server.host,
    port: config.server.port,
    logPath,
  });

  return {
    app,
    config,
    bus,
    diagnostics,
    officialIpc,
    appServer,
    database,
    approvals,
  };
}
