import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type SyncDoctorCheckStatus = "pass" | "warn" | "fail";

export type SyncDoctorCheck = {
  id: string;
  status: SyncDoctorCheckStatus;
  label: string;
  detail: string;
};

export type SyncDoctorAction = "diagnose" | "start" | "steer" | "interrupt";

export type SyncDoctorOptions = {
  baseUrl: string;
  threadId: string | null;
  action: SyncDoctorAction;
  send: boolean;
  turnId: string | null;
  text: string;
  expectMode: string;
  timeoutMs: number;
  pollIntervalMs: number;
  json: boolean;
  reportPath: string | null;
  attachmentPath: string | null;
};

export type SyncDoctorParseResult =
  | { kind: "options"; options: SyncDoctorOptions }
  | { kind: "help" }
  | { kind: "error"; error: string };

export type SyncDoctorResult = {
  ok: boolean;
  baseUrl: string;
  threadId: string | null;
  action: SyncDoctorAction;
  marker: string | null;
  turnId: string | null;
  actionMode: string | null;
  turnStartMode: string | null;
  followerRequestFound: boolean | null;
  markerOccurrences: number | null;
  attachmentUpload: SyncDoctorAttachmentUpload | null;
  checks: SyncDoctorCheck[];
  manualSteps: string[];
  evidence: SyncDoctorEvidence;
};

export type SyncDoctorAttachmentUpload = {
  count: number;
  totalBytes: number;
  ids: string[];
};

export type SyncDoctorReportAttachment = {
  count: number;
  totalBytes: number;
  idsRedacted: boolean;
};

export type SyncDoctorReport = Omit<
  SyncDoctorResult,
  "marker" | "attachmentUpload"
> & {
  markerRedacted: boolean;
  attachmentUpload: SyncDoctorReportAttachment | null;
};

export type SyncDoctorEvidence = {
  generatedAtIso: string;
  compatibility: Record<string, unknown> | null;
  readiness: Record<string, unknown> | null;
  officialIpc: Record<string, unknown> | null;
  markerOccurrences: number | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type JsonResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
  error: string | null;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:18930";
const DEFAULT_EXPECT_MODE = "official-follower";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export function parseSyncDoctorArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): SyncDoctorParseResult {
  const options: SyncDoctorOptions = {
    baseUrl: env.CODEX_WEB_BASE_URL ?? DEFAULT_BASE_URL,
    threadId: env.LIVE_SYNC_THREAD_ID?.trim() || null,
    action: "diagnose",
    send: false,
    turnId: env.LIVE_SYNC_TURN_ID?.trim() || null,
    text: env.LIVE_SYNC_TEXT ?? `codex_web sync doctor ${now.toISOString()}`,
    expectMode: env.LIVE_SYNC_EXPECT_MODE ?? DEFAULT_EXPECT_MODE,
    timeoutMs: readPositiveInteger(
      env.LIVE_SYNC_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
    pollIntervalMs: readPositiveInteger(
      env.LIVE_SYNC_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    json: false,
    reportPath: env.CODEX_WEB_SYNC_REPORT?.trim() || null,
    attachmentPath: env.LIVE_SYNC_ATTACHMENT_PATH?.trim() || null,
  };

  let requestedAction: SyncDoctorAction = "diagnose";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--send" || arg === "--steer" || arg === "--interrupt") {
      const action =
        arg === "--send" ? "start" : arg === "--steer" ? "steer" : "interrupt";
      if (requestedAction !== "diagnose" && requestedAction !== action) {
        return {
          kind: "error",
          error: "Choose only one of --send, --steer, or --interrupt",
        };
      }
      requestedAction = action;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const next = args[index + 1];
    if (arg === "--url") {
      if (!next) return { kind: "error", error: "Missing value for --url" };
      options.baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--thread" || arg === "--thread-id") {
      if (!next) return { kind: "error", error: `Missing value for ${arg}` };
      options.threadId = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--turn" || arg === "--turn-id") {
      if (!next) return { kind: "error", error: `Missing value for ${arg}` };
      options.turnId = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--text") {
      if (!next) return { kind: "error", error: "Missing value for --text" };
      options.text = next;
      index += 1;
      continue;
    }
    if (arg === "--expect-mode") {
      if (!next) {
        return { kind: "error", error: "Missing value for --expect-mode" };
      }
      options.expectMode = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      if (!next) {
        return { kind: "error", error: "Missing value for --timeout-ms" };
      }
      const timeoutMs = Number(next);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        return {
          kind: "error",
          error: "--timeout-ms must be a positive integer",
        };
      }
      options.timeoutMs = timeoutMs;
      index += 1;
      continue;
    }
    if (arg === "--poll-ms") {
      if (!next) return { kind: "error", error: "Missing value for --poll-ms" };
      const pollIntervalMs = Number(next);
      if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
        return { kind: "error", error: "--poll-ms must be a positive integer" };
      }
      options.pollIntervalMs = pollIntervalMs;
      index += 1;
      continue;
    }
    if (arg === "--report") {
      if (!next) return { kind: "error", error: "Missing value for --report" };
      options.reportPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--attachment") {
      if (!next) {
        return { kind: "error", error: "Missing value for --attachment" };
      }
      options.attachmentPath = next.trim();
      index += 1;
      continue;
    }

    return { kind: "error", error: `Unknown argument: ${arg}` };
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  options.threadId = options.threadId?.trim() || null;
  options.turnId = options.turnId?.trim() || null;
  options.reportPath = options.reportPath?.trim() || null;
  options.attachmentPath = options.attachmentPath?.trim() || null;
  options.action = requestedAction;
  options.send = requestedAction === "start";
  if (options.attachmentPath && options.action !== "start") {
    return {
      kind: "error",
      error: "--attachment can only be used with --send",
    };
  }
  if (options.action !== "diagnose" && !options.threadId) {
    return {
      kind: "error",
      error:
        "--send, --steer, and --interrupt require --thread <thread-id> or LIVE_SYNC_THREAD_ID",
    };
  }
  if (
    (options.action === "start" || options.action === "steer") &&
    !options.text.trim()
  ) {
    return {
      kind: "error",
      error: "--send and --steer require non-empty --text",
    };
  }

  return { kind: "options", options };
}

export function printSyncDoctorUsage(): string {
  return [
    "Usage:",
    "  codex-web auth reset",
    "  codex-web sync doctor [--url <base-url>] [--thread <thread-id>]",
    "  codex-web sync doctor --thread <thread-id> --send [--text <marker>]",
    "  codex-web sync doctor --thread <thread-id> --steer [--turn <turn-id>] [--text <guidance>]",
    "  codex-web sync doctor --thread <thread-id> --interrupt [--turn <turn-id>]",
    "",
    "Options:",
    "  --url <base-url>       codex_web server URL. Default: http://127.0.0.1:18930",
    "  --thread <thread-id>   Thread to diagnose.",
    "  --send                 Send the marker through /api/domain/turn-start.",
    "  --steer                Send guidance through /api/domain/turn-steer.",
    "  --interrupt            Interrupt the active turn through /api/domain/turn-interrupt.",
    "  --turn <turn-id>       Turn id for steer/interrupt. Defaults to sync readiness activeTurnId.",
    "  --text <marker>        Marker or guidance text. Defaults to a timestamped marker.",
    "  --attachment <path>    Upload one local file and include it with --send.",
    "  --expect-mode <mode>   Expected action mode. Default: official-follower. Use any to skip.",
    "  --timeout-ms <n>       Poll timeout. Default: 60000.",
    "  --poll-ms <n>          Poll interval. Default: 1000.",
    "  --report <path>        Write a sanitized JSON evidence report.",
    "  --json                 Print JSON result.",
  ].join("\n");
}

export async function runSyncDoctor(
  options: SyncDoctorOptions,
  fetchImpl: FetchLike = fetch,
): Promise<SyncDoctorResult> {
  const checks: SyncDoctorCheck[] = [];
  let actionMode: string | null = null;
  let turnStartMode: string | null = null;
  let followerRequestFound: boolean | null = null;
  let markerOccurrences: number | null = null;
  let resolvedTurnId = options.turnId;
  let attachmentUpload: SyncDoctorAttachmentUpload | null = null;
  let readinessPayload: unknown = null;
  let compatibilityPayload: unknown = null;
  let officialIpcPayload: unknown = null;

  const health = await requestJson(fetchImpl, options.baseUrl, "/health");
  checks.push({
    id: "health",
    status: health.ok ? "pass" : "fail",
    label: "Server health",
    detail: health.ok ? "Server responded to /health." : responseError(health),
  });

  const compatibility = await requestJson(
    fetchImpl,
    options.baseUrl,
    "/api/protocol/compatibility",
  );
  if (compatibility.ok) compatibilityPayload = compatibility.payload;
  checks.push(buildCompatibilityCheck(compatibility));

  const readinessPath = options.threadId
    ? `/api/sync/readiness?threadId=${encodeURIComponent(options.threadId)}`
    : "/api/sync/readiness";
  const readiness = await requestJson(
    fetchImpl,
    options.baseUrl,
    readinessPath,
  );
  if (!readiness.ok) {
    checks.push({
      id: "sync-readiness",
      status: "fail",
      label: "Sync readiness",
      detail: responseError(readiness),
    });
  } else {
    readinessPayload = readiness.payload;
    for (const check of readReadinessChecks(readiness.payload)) {
      checks.push(check);
    }
  }

  if (
    options.threadId &&
    (options.action === "steer" || options.action === "interrupt")
  ) {
    resolvedTurnId = resolvedTurnId || readActiveTurnId(readinessPayload);
    checks.push({
      id: "active-turn",
      status: resolvedTurnId ? "pass" : "fail",
      label: "Active turn",
      detail: resolvedTurnId
        ? `Using turn id ${resolvedTurnId}.`
        : "No turn id was provided and sync readiness did not report an active turn.",
    });
  }

  if (options.threadId && options.action !== "diagnose") {
    if (
      (options.action === "steer" || options.action === "interrupt") &&
      !resolvedTurnId
    ) {
      return buildResult({
        options,
        checks,
        actionMode,
        turnStartMode,
        followerRequestFound,
        markerOccurrences,
        resolvedTurnId,
        attachmentUpload,
        evidence: buildEvidence({
          compatibilityPayload,
          readinessPayload,
          officialIpcPayload,
          markerOccurrences,
        }),
      });
    }

    if (options.action === "start" && options.attachmentPath) {
      const upload = await uploadAttachment(fetchImpl, options);
      if (!upload.ok) {
        checks.push({
          id: "attachment-upload",
          status: "fail",
          label: "Attachment upload",
          detail: upload.error,
        });
        return buildResult({
          options,
          checks,
          actionMode,
          turnStartMode,
          followerRequestFound,
          markerOccurrences,
          resolvedTurnId,
          attachmentUpload,
          evidence: buildEvidence({
            compatibilityPayload,
            readinessPayload,
            officialIpcPayload,
            markerOccurrences,
          }),
        });
      }
      attachmentUpload = upload.attachment;
      checks.push({
        id: "attachment-upload",
        status: "pass",
        label: "Attachment upload",
        detail: `Uploaded ${attachmentUpload.count} attachment (${attachmentUpload.totalBytes} bytes).`,
      });
    }

    const actionResponse = await runAction(
      fetchImpl,
      options,
      resolvedTurnId,
      attachmentUpload?.ids ?? [],
    );
    actionMode = readTurnActionMode(actionResponse.payload);
    turnStartMode = options.action === "start" ? actionMode : null;
    checks.push({
      id: `turn-${options.action}`,
      status:
        actionResponse.ok &&
        (options.expectMode === "any" || actionMode === options.expectMode)
          ? "pass"
          : "fail",
      label: turnActionLabel(options.action),
      detail: actionResponse.ok
        ? `Returned mode: ${actionMode ?? "unknown"}.`
        : responseError(actionResponse),
    });

    if (actionResponse.ok && actionMode === "official-follower") {
      const followerRequest = await poll(
        async () => {
          const status = await requestJson(
            fetchImpl,
            options.baseUrl,
            "/api/official-ipc/status",
          );
          if (!status.ok) return null;
          officialIpcPayload = status.payload;
          return findFollowerSuccess(
            status.payload,
            options.threadId ?? "",
            followerMethodForAction(options.action),
          );
        },
        (value) => Boolean(value),
        options,
      );
      followerRequestFound = Boolean(followerRequest);
      checks.push({
        id: `follower-${options.action}-success`,
        status: followerRequestFound ? "pass" : "fail",
        label: `Official follower ${options.action}`,
        detail: followerRequestFound
          ? "recentFollowerRequests contains a success for this thread."
          : "No follower success for this thread appeared before timeout.",
      });
    }

    if (options.action === "start" && actionResponse.ok) {
      markerOccurrences = await poll(
        async () => {
          const detail = await requestJson(
            fetchImpl,
            options.baseUrl,
            `/api/domain/thread-detail?threadId=${encodeURIComponent(
              options.threadId ?? "",
            )}`,
          );
          if (!detail.ok) return 0;
          return countUserMessageOccurrences(detail.payload, options.text);
        },
        (count) => count === 1,
        options,
      );
      checks.push({
        id: "marker-unique",
        status: markerOccurrences === 1 ? "pass" : "fail",
        label: "Marker appears once",
        detail:
          markerOccurrences === 1
            ? "The marker appears exactly once in Web thread detail."
            : `The marker appears ${
                markerOccurrences ?? 0
              } times in Web thread detail.`,
      });
    }
  }

  if (options.reportPath && !officialIpcPayload) {
    const status = await requestJson(
      fetchImpl,
      options.baseUrl,
      "/api/official-ipc/status",
    );
    if (status.ok) officialIpcPayload = status.payload;
  }

  return buildResult({
    options,
    checks,
    actionMode,
    turnStartMode,
    followerRequestFound,
    markerOccurrences,
    resolvedTurnId,
    attachmentUpload,
    evidence: buildEvidence({
      compatibilityPayload,
      readinessPayload,
      officialIpcPayload,
      markerOccurrences,
    }),
  });
}

export function formatSyncDoctorResult(result: SyncDoctorResult): string {
  const lines = [
    `codex_web sync doctor: ${result.ok ? "PASS" : "FAIL"}`,
    `Server: ${result.baseUrl}`,
    `Thread: ${result.threadId ?? "(not provided)"}`,
    `Action: ${result.action}`,
  ];
  if (result.turnId) lines.push(`Turn: ${result.turnId}`);
  if (result.marker) lines.push(`Marker: ${result.marker}`);
  if (result.actionMode) lines.push(`Action mode: ${result.actionMode}`);
  if (result.turnStartMode)
    lines.push(`Turn start mode: ${result.turnStartMode}`);
  if (result.followerRequestFound !== null) {
    lines.push(
      `Follower ${result.action} success: ${
        result.followerRequestFound ? "yes" : "no"
      }`,
    );
  }
  if (result.markerOccurrences !== null) {
    lines.push(`Marker occurrences in Web detail: ${result.markerOccurrences}`);
  }
  if (result.attachmentUpload) {
    lines.push(
      `Attachments: ${result.attachmentUpload.count} uploaded (${result.attachmentUpload.totalBytes} bytes)`,
    );
  }
  lines.push("");
  lines.push("Checks:");
  for (const check of result.checks) {
    lines.push(
      `  [${check.status.toUpperCase()}] ${check.label}: ${check.detail}`,
    );
  }
  lines.push("");
  lines.push("Manual observations still required:");
  for (const step of result.manualSteps) lines.push(`  - ${step}`);
  return lines.join("\n");
}

export function buildSyncDoctorReport(
  result: SyncDoctorResult,
): SyncDoctorReport {
  const { marker, attachmentUpload, ...withoutMarker } = result;
  return {
    ...withoutMarker,
    attachmentUpload: attachmentUpload
      ? {
          count: attachmentUpload.count,
          totalBytes: attachmentUpload.totalBytes,
          idsRedacted: attachmentUpload.ids.length > 0,
        }
      : null,
    markerRedacted: marker !== null,
  };
}

export function countUserMessageOccurrences(
  payload: unknown,
  needle: string,
): number {
  const detail = asRecord(asRecord(payload)?.data);
  const turns = Array.isArray(detail?.turns) ? detail.turns : [];
  let count = 0;
  for (const turn of turns) {
    const turnRecord = asRecord(turn);
    const items = Array.isArray(turnRecord?.items) ? turnRecord.items : [];
    for (const item of items) {
      const itemRecord = asRecord(item);
      if (itemRecord?.type !== "user") continue;
      if (
        typeof itemRecord.text === "string" &&
        itemRecord.text.includes(needle)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function buildCompatibilityCheck(response: JsonResponse): SyncDoctorCheck {
  if (!response.ok) {
    return {
      id: "protocol-compatibility",
      status: "fail",
      label: "Protocol compatibility",
      detail: responseError(response),
    };
  }
  const data = asRecord(asRecord(response.payload)?.data);
  const summary = asRecord(data?.summary);
  const officialIpc = asRecord(data?.officialIpc);
  const appServer = asRecord(data?.appServer);
  const state = readString(summary?.state) || "unknown";
  const reason = readString(summary?.reason);
  const connected = officialIpc?.connected === true;
  const initialized = appServer?.initialized === true;
  const status: SyncDoctorCheckStatus =
    state === "compatible" && connected && initialized
      ? "pass"
      : state === "warning" && connected && initialized
        ? "warn"
        : "fail";
  const detail = [
    `state=${state}`,
    `officialIpc.connected=${String(connected)}`,
    `appServer.initialized=${String(initialized)}`,
    reason ? `reason=${reason}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    id: "protocol-compatibility",
    status,
    label: "Protocol compatibility",
    detail,
  };
}

function readReadinessChecks(payload: unknown): SyncDoctorCheck[] {
  const data = asRecord(asRecord(payload)?.data);
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  if (checks.length === 0) {
    return [
      {
        id: "sync-readiness",
        status: "warn",
        label: "Sync readiness",
        detail: "No readiness checks were returned.",
      },
    ];
  }
  return checks.map((item) => {
    const record = asRecord(item);
    const status = readCheckStatus(record?.status);
    return {
      id: `readiness:${readString(record?.id) || "unknown"}`,
      status,
      label: readString(record?.label) || "Sync readiness",
      detail: readString(record?.detail) || "No detail.",
    };
  });
}

function readTurnActionMode(payload: unknown): string | null {
  return readString(asRecord(asRecord(payload)?.data)?.mode) || null;
}

function readActiveTurnId(payload: unknown): string | null {
  const thread = asRecord(asRecord(asRecord(payload)?.data)?.thread);
  return readString(thread?.activeTurnId) || null;
}

function findFollowerSuccess(
  payload: unknown,
  threadId: string,
  method: string,
): unknown {
  const data = asRecord(asRecord(payload)?.data);
  const requests = Array.isArray(data?.recentFollowerRequests)
    ? data.recentFollowerRequests
    : [];
  return (
    requests.find((item) => {
      const record = asRecord(item);
      const requestThreadId =
        readString(record?.threadId) ||
        readString(record?.conversationId) ||
        readString(record?.conversation_id);
      return (
        record?.method === method &&
        record?.result === "success" &&
        requestThreadId === threadId
      );
    }) ?? null
  );
}

async function runAction(
  fetchImpl: FetchLike,
  options: SyncDoctorOptions,
  turnId: string | null,
  attachmentIds: string[] = [],
): Promise<JsonResponse> {
  if (options.action === "start") {
    const body = {
      threadId: options.threadId,
      text: options.text,
      ...(attachmentIds.length ? { attachmentIds } : {}),
    };
    return await requestJson(
      fetchImpl,
      options.baseUrl,
      "/api/domain/turn-start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }
  if (options.action === "steer") {
    return await requestJson(
      fetchImpl,
      options.baseUrl,
      "/api/domain/turn-steer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: options.threadId,
          expectedTurnId: turnId,
          text: options.text,
        }),
      },
    );
  }
  return await requestJson(
    fetchImpl,
    options.baseUrl,
    "/api/domain/turn-interrupt",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: options.threadId,
        turnId,
      }),
    },
  );
}

type AttachmentUploadResult =
  | { ok: true; attachment: SyncDoctorAttachmentUpload }
  | { ok: false; error: string };

async function uploadAttachment(
  fetchImpl: FetchLike,
  options: SyncDoctorOptions,
): Promise<AttachmentUploadResult> {
  if (!options.attachmentPath) {
    return { ok: false, error: "No attachment path was provided." };
  }
  if (!options.threadId) {
    return { ok: false, error: "Attachment upload requires a thread id." };
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(options.attachmentPath);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
    basename(options.attachmentPath),
  );

  const response = await requestJson(
    fetchImpl,
    options.baseUrl,
    `/api/attachments?threadId=${encodeURIComponent(options.threadId)}`,
    {
      method: "POST",
      body: form,
    },
  );
  if (!response.ok) return { ok: false, error: responseError(response) };

  const data = asRecord(asRecord(response.payload)?.data);
  const id = readString(data?.id);
  if (!id) {
    return {
      ok: false,
      error: "Attachment upload response did not include an id.",
    };
  }
  const size = typeof data?.size === "number" && Number.isFinite(data.size)
    ? data.size
    : buffer.byteLength;
  return {
    ok: true,
    attachment: {
      count: 1,
      totalBytes: size,
      ids: [id],
    },
  };
}

function turnActionLabel(action: SyncDoctorAction): string {
  if (action === "start") return "Web turn start";
  if (action === "steer") return "Web turn steer";
  if (action === "interrupt") return "Web turn interrupt";
  return "Sync diagnosis";
}

function followerMethodForAction(action: SyncDoctorAction): string {
  if (action === "steer") return "thread-follower-steer-turn";
  if (action === "interrupt") return "thread-follower-interrupt-turn";
  return "thread-follower-start-turn";
}

function buildResult(input: {
  options: SyncDoctorOptions;
  checks: SyncDoctorCheck[];
  actionMode: string | null;
  turnStartMode: string | null;
  followerRequestFound: boolean | null;
  markerOccurrences: number | null;
  resolvedTurnId: string | null;
  attachmentUpload: SyncDoctorAttachmentUpload | null;
  evidence: SyncDoctorEvidence;
}): SyncDoctorResult {
  const ok = input.checks.every((check) => check.status !== "fail");
  return {
    ok,
    baseUrl: input.options.baseUrl,
    threadId: input.options.threadId,
    action: input.options.action,
    marker:
      input.options.action === "start" || input.options.action === "steer"
        ? input.options.text
        : null,
    turnId: input.resolvedTurnId,
    actionMode: input.actionMode,
    turnStartMode: input.turnStartMode,
    followerRequestFound: input.followerRequestFound,
    markerOccurrences: input.markerOccurrences,
    attachmentUpload: input.attachmentUpload,
    checks: input.checks,
    manualSteps: buildManualSteps(input.options),
    evidence: input.evidence,
  };
}

function buildEvidence(input: {
  compatibilityPayload: unknown;
  readinessPayload: unknown;
  officialIpcPayload: unknown;
  markerOccurrences: number | null;
}): SyncDoctorEvidence {
  return {
    generatedAtIso: new Date().toISOString(),
    compatibility: summarizeCompatibilityEvidence(input.compatibilityPayload),
    readiness: summarizeReadinessEvidence(input.readinessPayload),
    officialIpc: summarizeOfficialIpcEvidence(input.officialIpcPayload),
    markerOccurrences: input.markerOccurrences,
  };
}

function summarizeCompatibilityEvidence(
  payload: unknown,
): Record<string, unknown> | null {
  const data = asRecord(asRecord(payload)?.data);
  if (!data) return null;
  const summary = asRecord(data.summary);
  const officialIpc = asRecord(data.officialIpc);
  const appServer = asRecord(data.appServer);
  return {
    summary: summary
      ? {
          state: readString(summary.state),
          reason: readString(summary.reason) || null,
          methodCount: summary.methodCount,
          registeredHandlerCount: summary.registeredHandlerCount,
        }
      : null,
    officialIpc: officialIpc
      ? {
          connected: officialIpc.connected === true,
          clientId: readString(officialIpc.clientId) || null,
          cachedConversationCount: officialIpc.cachedConversationCount,
          ownedConversationCount: officialIpc.ownedConversationCount,
        }
      : null,
    appServer: appServer
      ? {
          initialized: appServer.initialized === true,
          running: appServer.running === true,
          lastWarning: readString(appServer.lastWarning) || null,
          lastError: readString(appServer.lastError) || null,
        }
      : null,
  };
}

function summarizeReadinessEvidence(
  payload: unknown,
): Record<string, unknown> | null {
  const data = asRecord(asRecord(payload)?.data);
  if (!data) return null;
  return {
    checks: Array.isArray(data.checks) ? data.checks : [],
    thread: asRecord(data.thread) ?? null,
    followerHandlers: asRecord(data.followerHandlers) ?? null,
    recentFollowerRequests: Array.isArray(data.recentFollowerRequests)
      ? data.recentFollowerRequests
      : [],
    recentOwnershipHandoffs: Array.isArray(data.recentOwnershipHandoffs)
      ? data.recentOwnershipHandoffs
      : [],
  };
}

function summarizeOfficialIpcEvidence(
  payload: unknown,
): Record<string, unknown> | null {
  const data = asRecord(asRecord(payload)?.data);
  if (!data) return null;
  return {
    connected: data.connected === true,
    clientId: readString(data.clientId) || null,
    cachedConversationCount: data.cachedConversationCount,
    ownedConversationCount: data.ownedConversationCount,
    recentFollowerRequests: Array.isArray(data.recentFollowerRequests)
      ? data.recentFollowerRequests
      : [],
    recentOwnershipHandoffs: Array.isArray(data.recentOwnershipHandoffs)
      ? data.recentOwnershipHandoffs
      : [],
    lastError: readString(data.lastError) || null,
  };
}

async function requestJson(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<JsonResponse> {
  const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`).toString();
  try {
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
      error: response.ok ? null : readError(payload) || response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function poll<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  options: Pick<SyncDoctorOptions, "timeoutMs" | "pollIntervalMs">,
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let latest = await read();
  while (!done(latest) && Date.now() < deadline) {
    await sleep(options.pollIntervalMs);
    latest = await read();
  }
  return latest;
}

function buildManualSteps(options: SyncDoctorOptions): string[] {
  const steps = [
    "Open the same test thread in official Codex Desktop and the VS Code Codex extension.",
    "If a check fails, copy the sanitized diagnostics export from /api/diagnostics/export.",
  ];
  if (options.action === "start") {
    steps.splice(
      1,
      0,
      "Confirm both official clients show the same marker and stream in real time.",
    );
    if (options.attachmentPath) {
      steps.splice(
        2,
        0,
        "Confirm both official clients can display or explicitly degrade the uploaded attachment without exposing local paths.",
      );
    }
  } else if (options.action === "steer") {
    steps.splice(
      1,
      0,
      "Confirm the official owner continues the same active turn instead of creating a new turn.",
    );
  } else if (options.action === "interrupt") {
    steps.splice(1, 0, "Confirm all three clients stop the same active turn.");
  }
  if (!options.threadId) {
    steps.unshift(
      "Run again with --thread <thread-id> after selecting a non-sensitive test thread.",
    );
  }
  if (options.action === "diagnose") {
    steps.unshift(
      "Add --send, --steer, or --interrupt only when you are ready to act on the test thread.",
    );
  }
  return steps;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "") || DEFAULT_BASE_URL;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readCheckStatus(value: unknown): SyncDoctorCheckStatus {
  return value === "pass" || value === "warn" || value === "fail"
    ? value
    : "warn";
}

function readString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

function readError(payload: unknown): string {
  const record = asRecord(payload);
  return readString(record?.error) || readString(record?.message);
}

function responseError(response: JsonResponse): string {
  const status = response.status ? `HTTP ${response.status}` : "request failed";
  return response.error ? `${status}: ${response.error}` : status;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
