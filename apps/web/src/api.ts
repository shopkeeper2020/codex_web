import {
  accountStatusResponseSchema,
  approvalDecisionResponseSchema,
  approvalsResponseSchema,
  appServerStatusResponseSchema,
  authOkResponseSchema,
  authSessionRevokeResponseSchema,
  authSessionsResponseSchema,
  authSessionsRevokeCountResponseSchema,
  authStatusResponseSchema,
  attachmentCleanupResponseSchema,
  attachmentResponseSchema,
  attachmentStorageResponseSchema,
  cacheStatusResponseSchema,
  diagnosticsExportResponseSchema,
  diagnosticsResponseSchema,
  favoriteProjectsResponseSchema,
  fileBrowserListingResponseSchema,
  filePreviewResponseSchema,
  healthResponseSchema,
  lanAccessResponseSchema,
  nativeDictationStartResponseSchema,
  nativeDictationStatusResponseSchema,
  nativeDictationTranscribeResponseSchema,
  officialIpcStatusResponseSchema,
  protocolCompatibilityResponseSchema,
  runtimeOptionsResponseSchema,
  settingsResponseSchema,
  sideConversationCloseResponseSchema,
  sideConversationCreateResponseSchema,
  skillsResponseSchema,
  syncReadinessResponseSchema,
  threadArchiveResponseSchema,
  threadCompactResponseSchema,
  turnEditLastUserResponseSchema,
  threadForkResponseSchema,
  threadStartResponseSchema,
  threadDetailResponseSchema,
  threadGoalResponseSchema,
  threadListResponseSchema,
  threadPinResponseSchema,
  threadRenameResponseSchema,
  threadSearchResponseSchema,
  threadStopBackgroundResponseSchema,
  threadUnarchiveResponseSchema,
  workspaceBranchCheckoutResponseSchema,
  workspaceStatusResponseSchema,
  type AccountStatus,
  type AppConfig,
  type AppServerStatus,
  type ApprovalDecision,
  type AttachmentCleanupResult,
  type AttachmentStorageStatus,
  type AuthSession,
  type AuthStatus,
  type CacheStatus,
  type DiagnosticEvent,
  type DiagnosticsExport,
  type FilePreview,
  type LanAccess,
  type NativeDictationStatus,
  type OfficialIpcStatus,
  type PendingApproval,
  type PermissionMode,
  type ProtocolCompatibility,
  type RuntimeCollaborationModeOption,
  type RuntimeModelOption,
  type RuntimeOptions,
  type RuntimeReasoningEffortOption,
  type SkillList,
  type SkillOption,
  type SyncReadiness,
  type ThreadSearchResult,
  type TurnInterruptRequest,
  type TurnEditLastUserRequest,
  type TurnStartRequest,
  type TurnSteerRequest,
  type WorkspaceStatus,
} from "@codex-web/api";
import type {
  Attachment,
  FileBrowserListing,
  MessageItem,
  Owner,
  Project,
  Thread,
  ThreadDetail,
  ThreadGoal,
  ThreadList,
  Turn,
} from "@codex-web/domain";

export type {
  AccountStatus,
  AppConfig,
  AppServerStatus,
  ApprovalDecision,
  AttachmentCleanupResult,
  AttachmentStorageStatus,
  AuthSession,
  AuthStatus,
  CacheStatus,
  DiagnosticEvent,
  DiagnosticsExport,
  FilePreview,
  LanAccess,
  NativeDictationStatus,
  OfficialIpcStatus,
  PendingApproval,
  PermissionMode,
  ProtocolCompatibility,
  RuntimeCollaborationModeOption,
  RuntimeModelOption,
  RuntimeOptions,
  RuntimeReasoningEffortOption,
  SkillList,
  SkillOption,
  SyncReadiness,
  ThreadSearchResult,
  WorkspaceStatus,
} from "@codex-web/api";

export type {
  Attachment,
  FileBrowserListing,
  MessageItem,
  Owner,
  Project,
  Thread,
  ThreadDetail,
  ThreadGoal,
  ThreadList,
  Turn,
} from "@codex-web/domain";

function responseSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

function errorMessageFromText(
  text: string,
  fallback: string,
  contentType = "",
): string {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    const snippet = responseSnippet(text);
    if (
      contentType.toLowerCase().includes("text/html") ||
      /^<!doctype html/i.test(snippet) ||
      /^<html/i.test(snippet)
    ) {
      return `${fallback}: 后端返回了 HTML 而不是 JSON，请检查 API 代理或后端路由。`;
    }
    if (snippet) return snippet;
  }
  return fallback;
}

async function parseJsonResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(errorMessageFromText(text, fallback, contentType));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(errorMessageFromText(text, fallback, contentType));
  }
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return parseJsonResponse<T>(
    response,
    `${url} failed with ${response.status}`,
  );
}

async function writeJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(
    response,
    `${url} failed with ${response.status}`,
  );
}

export async function getHealth(): Promise<{ ok: boolean; atIso: string }> {
  return healthResponseSchema.parse(await readJson<unknown>("/api/health"));
}

export async function getConfig(): Promise<AppConfig> {
  const payload = settingsResponseSchema.parse(
    await readJson<unknown>("/api/config"),
  );
  return payload.data;
}

export async function getLanAccess(): Promise<LanAccess> {
  const payload = lanAccessResponseSchema.parse(
    await readJson<unknown>("/api/network/lan-access"),
  );
  return payload.data;
}

export async function getNativeDictationStatus(): Promise<NativeDictationStatus> {
  const payload = nativeDictationStatusResponseSchema.parse(
    await readJson<unknown>("/api/native-dictation/status"),
  );
  return payload.data;
}

export async function startNativeDictation(): Promise<
  NativeDictationStatus & { ok: boolean }
> {
  const payload = nativeDictationStartResponseSchema.parse(
    await writeJson<unknown>("/api/native-dictation/start", {}),
  );
  return payload.data;
}

export async function transcribeNativeDictation(input: {
  audio: Blob;
  filename?: string;
}): Promise<string> {
  const form = new FormData();
  const filename =
    input.filename ||
    `codex.${input.audio.type.split(/[;/]/)[0]?.split("/")[1] || "webm"}`;
  form.append(
    "file",
    input.audio instanceof File
      ? input.audio
      : new File([input.audio], filename, {
          type: input.audio.type || "audio/webm",
        }),
  );
  const response = await fetch("/api/native-dictation/transcribe", {
    method: "POST",
    body: form,
  });
  const payload = nativeDictationTranscribeResponseSchema.parse(
    await parseJsonResponse<unknown>(
      response,
      `native transcription failed with ${response.status}`,
    ),
  );
  return payload.data.text;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const payload = authStatusResponseSchema.parse(
    await readJson<unknown>("/api/auth/status"),
  );
  return payload.data;
}

export async function login(password: string): Promise<AuthStatus> {
  const payload = authStatusResponseSchema.parse(
    await writeJson<unknown>("/api/auth/login", {
      password,
    }),
  );
  return payload.data;
}

export async function logout(): Promise<void> {
  authOkResponseSchema.parse(await writeJson<unknown>("/api/auth/logout", {}));
}

export async function getAuthSessions(): Promise<AuthSession[]> {
  const payload = authSessionsResponseSchema.parse(
    await readJson<unknown>("/api/auth/sessions"),
  );
  return payload.data;
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  authSessionRevokeResponseSchema.parse(
    await writeJson<unknown>("/api/auth/sessions/revoke", {
      sessionId,
    }),
  );
}

export async function revokeOtherAuthSessions(): Promise<number> {
  const payload = authSessionsRevokeCountResponseSchema.parse(
    await writeJson<unknown>("/api/auth/sessions/revoke-others", {}),
  );
  return payload.data.revoked;
}

export async function revokeAllAuthSessions(): Promise<number> {
  const payload = authSessionsRevokeCountResponseSchema.parse(
    await writeJson<unknown>("/api/auth/sessions/revoke-all", {}),
  );
  return payload.data.revoked;
}

export async function updateSettings(input: {
  server?: { host?: string; port?: number };
  dev?: { frontendPort?: number };
  ui?: { theme?: "light" };
  diagnostics?: { rawFrameLogging?: boolean };
}): Promise<AppConfig> {
  const payload = settingsResponseSchema.parse(
    await writeJson<unknown>("/api/settings", input),
  );
  return payload.data;
}

export async function updateLanPassword(password: string): Promise<void> {
  authOkResponseSchema.parse(
    await writeJson<unknown>("/api/settings/password", {
      password,
    }),
  );
}

export async function getOfficialIpcStatus(): Promise<OfficialIpcStatus> {
  const payload = officialIpcStatusResponseSchema.parse(
    await readJson<unknown>("/api/official-ipc/status"),
  );
  return payload.data;
}

export async function getAppServerStatus(): Promise<AppServerStatus> {
  const payload = appServerStatusResponseSchema.parse(
    await readJson<unknown>("/api/app-server/status"),
  );
  return payload.data;
}

export async function getAccountStatus(): Promise<AccountStatus> {
  const payload = accountStatusResponseSchema.parse(
    await readJson<unknown>("/api/account/status"),
  );
  return payload.data;
}

export async function getDiagnosticsExport(): Promise<DiagnosticsExport> {
  const payload = diagnosticsExportResponseSchema.parse(
    await readJson<unknown>("/api/diagnostics/export"),
  );
  return payload.data;
}

export async function getDiagnostics(): Promise<DiagnosticEvent[]> {
  const payload = diagnosticsResponseSchema.parse(
    await readJson<unknown>("/api/diagnostics"),
  );
  return payload.data;
}

export async function getCacheStatus(): Promise<CacheStatus> {
  const payload = cacheStatusResponseSchema.parse(
    await readJson<unknown>("/api/cache/status"),
  );
  return payload.data;
}

export async function getAttachmentStorageStatus(): Promise<AttachmentStorageStatus> {
  const payload = attachmentStorageResponseSchema.parse(
    await readJson<unknown>("/api/attachments/storage"),
  );
  return payload.data;
}

export async function cleanupUnassociatedAttachments(): Promise<AttachmentCleanupResult> {
  const payload = attachmentCleanupResponseSchema.parse(
    await writeJson<unknown>("/api/attachments/cleanup", {}),
  );
  return payload.data;
}

export async function getProtocolCompatibility(): Promise<ProtocolCompatibility> {
  const payload = protocolCompatibilityResponseSchema.parse(
    await readJson<unknown>("/api/protocol/compatibility"),
  );
  return payload.data;
}

export async function getSyncReadiness(
  input: {
    threadId?: string | null;
  } = {},
): Promise<SyncReadiness> {
  const params = new URLSearchParams();
  if (input.threadId) params.set("threadId", input.threadId);
  const query = params.toString();
  const payload = syncReadinessResponseSchema.parse(
    await readJson<unknown>(`/api/sync/readiness${query ? `?${query}` : ""}`),
  );
  return payload.data;
}

export async function getRuntimeOptions(
  input: { cwd?: string | null } = {},
): Promise<RuntimeOptions> {
  const params = new URLSearchParams();
  if (input.cwd) params.set("cwd", input.cwd);
  const query = params.toString();
  const payload = runtimeOptionsResponseSchema.parse(
    await readJson<unknown>(`/api/runtime-options${query ? `?${query}` : ""}`),
  );
  return payload.data;
}

export async function getSkills(
  input: { cwd?: string | null; forceReload?: boolean } = {},
): Promise<SkillList> {
  const params = new URLSearchParams();
  if (input.cwd) params.set("cwd", input.cwd);
  if (input.forceReload) params.set("forceReload", "true");
  const query = params.toString();
  const payload = skillsResponseSchema.parse(
    await readJson<unknown>(`/api/skills${query ? `?${query}` : ""}`),
  );
  return payload.data;
}

export async function getApprovals(): Promise<PendingApproval[]> {
  const payload = approvalsResponseSchema.parse(
    await readJson<unknown>("/api/approvals"),
  );
  return payload.data;
}

export async function getFavoriteProjects(): Promise<Project[]> {
  const payload = favoriteProjectsResponseSchema.parse(
    await readJson<unknown>("/api/projects/favorites"),
  );
  return payload.data;
}

export async function addFavoriteProject(path: string): Promise<Project[]> {
  const payload = favoriteProjectsResponseSchema.parse(
    await writeJson<unknown>("/api/projects/favorites", { path }),
  );
  return payload.data;
}

export async function removeFavoriteProject(path: string): Promise<Project[]> {
  const payload = favoriteProjectsResponseSchema.parse(
    await writeJson<unknown>("/api/projects/favorites/remove", { path }),
  );
  return payload.data;
}

export async function listProjectFiles(input: {
  root: string;
  path?: string | null;
  limit?: number;
}): Promise<FileBrowserListing> {
  const params = new URLSearchParams();
  params.set("root", input.root);
  if (input.path) params.set("path", input.path);
  if (input.limit) params.set("limit", String(input.limit));
  const payload = fileBrowserListingResponseSchema.parse(
    await readJson<unknown>(`/api/files/list?${params.toString()}`),
  );
  return payload.data;
}

export async function getFilePreview(input: {
  path: string;
  root?: string | null;
  maxBytes?: number;
}): Promise<FilePreview> {
  const params = new URLSearchParams();
  params.set("path", input.path);
  if (input.root) params.set("root", input.root);
  if (input.maxBytes) params.set("maxBytes", String(input.maxBytes));
  const payload = filePreviewResponseSchema.parse(
    await readJson<unknown>(`/api/files/preview?${params.toString()}`),
  );
  return payload.data;
}

export function fileContentUrl(input: {
  path: string;
  root?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("path", input.path);
  if (input.root) params.set("root", input.root);
  return `/api/files/content?${params.toString()}`;
}

export async function getWorkspaceStatus(
  input: { cwd?: string | null } = {},
): Promise<WorkspaceStatus> {
  const params = new URLSearchParams();
  if (input.cwd) params.set("cwd", input.cwd);
  const query = params.toString();
  const payload = workspaceStatusResponseSchema.parse(
    await readJson<unknown>(`/api/workspace/status${query ? `?${query}` : ""}`),
  );
  return payload.data;
}

export async function checkoutWorkspaceBranch(input: {
  cwd: string;
  branch: string;
}): Promise<WorkspaceStatus> {
  const payload = workspaceBranchCheckoutResponseSchema.parse(
    await writeJson<unknown>("/api/workspace/branch", input),
  );
  return payload.data;
}

export async function decideApproval(input: {
  id: string;
  decision: ApprovalDecision;
}): Promise<void> {
  approvalDecisionResponseSchema.parse(
    await writeJson<unknown>("/api/approvals/decision", input),
  );
}

export async function getThreads(): Promise<unknown> {
  const payload = await readJson<{ data: unknown }>("/api/threads?limit=30");
  return payload.data;
}

export async function getDomainThreads(
  limit = 50,
  archived = false,
  cursor?: string | null,
): Promise<ThreadList> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("archived", archived ? "true" : "false");
  if (cursor) params.set("cursor", cursor);
  const payload = threadListResponseSchema.parse(
    await readJson<unknown>(`/api/domain/thread/list?${params.toString()}`),
  );
  return payload.data;
}

export async function searchThreads(input: {
  searchTerm: string;
  archived: boolean;
  limit: number;
}): Promise<{
  results: ThreadSearchResult[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}> {
  const params = new URLSearchParams();
  params.set("searchTerm", input.searchTerm);
  params.set("archived", input.archived ? "true" : "false");
  params.set("limit", String(input.limit));
  const payload = threadSearchResponseSchema.parse(
    await readJson<unknown>(`/api/domain/thread/search?${params.toString()}`),
  );
  return payload.data;
}

export async function getThreadDetail(
  threadId: string,
): Promise<ThreadDetail | null> {
  const payload = threadDetailResponseSchema.parse(
    await readJson<unknown>(
      `/api/domain/thread/read?threadId=${encodeURIComponent(threadId)}`,
    ),
  );
  return payload.data;
}

export async function startTurn(
  input: Pick<
    TurnStartRequest,
    | "threadId"
    | "text"
    | "cwd"
    | "model"
    | "effort"
    | "attachmentIds"
    | "skills"
    | "collaborationMode"
    | "permissionMode"
    | "permissionProfile"
  >,
): Promise<{ mode: string; result: unknown }> {
  const payload = await writeJson<{ data: { mode: string; result: unknown } }>(
    "/api/domain/turn/start",
    input,
  );
  return payload.data;
}

export async function interruptTurn(
  input: Pick<TurnInterruptRequest, "threadId" | "turnId">,
): Promise<{ mode: string; result: unknown }> {
  const payload = await writeJson<{ data: { mode: string; result: unknown } }>(
    "/api/domain/turn/interrupt",
    input,
  );
  return payload.data;
}

export async function steerTurn(
  input: Pick<
    TurnSteerRequest,
    | "threadId"
    | "expectedTurnId"
    | "text"
    | "cwd"
    | "attachmentIds"
    | "skills"
    | "permissionMode"
  >,
): Promise<{ mode: string; result: unknown }> {
  const payload = await writeJson<{ data: { mode: string; result: unknown } }>(
    "/api/domain/turn/steer",
    input,
  );
  return payload.data;
}

export async function editLastUserTurn(
  input: Pick<
    TurnEditLastUserRequest,
    | "threadId"
    | "expectedTurnId"
    | "text"
    | "cwd"
    | "model"
    | "effort"
    | "skills"
    | "collaborationMode"
    | "permissionMode"
    | "permissionProfile"
  >,
): Promise<{ mode: string; result: unknown }> {
  const payload = turnEditLastUserResponseSchema.parse(
    await writeJson<unknown>("/api/domain/turn/edit-last-user", input),
  );
  return { mode: payload.data.mode, result: payload.data.result };
}

export async function uploadAttachment(input: {
  file: File;
  threadId?: string | null;
}): Promise<Attachment> {
  const form = new FormData();
  form.append("file", input.file);
  const threadId =
    input.threadId && !input.threadId.startsWith("draft:")
      ? input.threadId
      : null;
  const query = threadId
    ? `?threadId=${encodeURIComponent(threadId)}`
    : "";
  const response = await fetch(`/api/attachments${query}`, {
    method: "POST",
    body: form,
  });
  const payload = attachmentResponseSchema.parse(
    await parseJsonResponse<unknown>(
      response,
      `upload failed with ${response.status}`,
    ),
  );
  return payload.data;
}

export function attachmentContentUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}/content`;
}

export async function startThread(
  input: { cwd?: string | null } = {},
): Promise<Thread> {
  const payload = threadStartResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/start", input),
  );
  return payload.data.thread;
}

export async function forkThread(input: {
  threadId: string;
  cwd?: string | null;
  afterTurnId?: string | null;
}): Promise<Thread> {
  const payload = threadForkResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/fork", input),
  );
  return payload.data.thread;
}

export async function createSideConversation(input: {
  threadId: string;
  cwd?: string | null;
}): Promise<ThreadDetail["sideConversations"][number]> {
  const payload = sideConversationCreateResponseSchema.parse(
    await writeJson<unknown>("/api/domain/side-conversation-create", input),
  );
  return payload.data.sideConversation;
}

export async function closeSideConversation(input: {
  threadId?: string | null;
  sideConversationId: string;
}): Promise<void> {
  sideConversationCloseResponseSchema.parse(
    await writeJson<unknown>("/api/domain/side-conversation-close", input),
  );
}

export async function renameThread(input: {
  threadId: string;
  title: string;
}): Promise<Thread | null> {
  const payload = threadRenameResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/rename", input),
  );
  return payload.data.thread;
}

export async function archiveThread(threadId: string): Promise<void> {
  threadArchiveResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/archive", { threadId }),
  );
}

export async function compactThread(
  threadId: string,
): Promise<{ mode: string; result: unknown }> {
  const payload = threadCompactResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/compact/start", { threadId }),
  );
  return {
    mode: payload.data.mode,
    result: payload.data.result,
  };
}

export async function setThreadGoal(input: {
  threadId: string;
  objective?: string;
  status?: "active" | "paused";
}): Promise<{ goal: ThreadGoal | null; thread: Thread | null }> {
  const payload = threadGoalResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/goal/set", input),
  );
  return {
    goal: payload.data.goal,
    thread: payload.data.thread ?? null,
  };
}

export async function clearThreadGoal(
  threadId: string,
): Promise<{ goal: ThreadGoal | null; thread: Thread | null }> {
  const payload = threadGoalResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/goal/clear", { threadId }),
  );
  return {
    goal: payload.data.goal,
    thread: payload.data.thread ?? null,
  };
}

export async function pinThread(input: {
  threadId: string;
  pinned: boolean;
}): Promise<boolean> {
  const payload = threadPinResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread-pin", input),
  );
  return payload.data.pinned;
}

export async function stopThreadBackground(threadId: string): Promise<number> {
  const payload = threadStopBackgroundResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread-stop-background", {
      threadId,
    }),
  );
  return payload.data.interrupted;
}

export async function unarchiveThread(
  threadId: string,
): Promise<Thread | null> {
  const payload = threadUnarchiveResponseSchema.parse(
    await writeJson<unknown>("/api/domain/thread/unarchive", { threadId }),
  );
  return payload.data.thread;
}
