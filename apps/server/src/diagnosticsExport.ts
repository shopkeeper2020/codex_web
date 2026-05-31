import { resolve } from "node:path";
import type { WorkspaceStatus } from "@codex-web/api";
import type { RuntimeConfig } from "@codex-web/config";
import type { DiagnosticEvent } from "@codex-web/domain";
import { IPC_METHOD_VERSIONS } from "@codex-web/protocol";
import type { DatabaseStoreStatus } from "./db/index.js";

const SCHEMA_VERSION = 1;
const APP_VERSION = "0.1.0";
const REDACTED = "[redacted]";
const REDACTED_EMAIL = "[email-redacted]";
const MAX_EXPORT_ARRAY_ITEMS = 80;

const SENSITIVE_KEY_PATTERN =
  /(?:password|passcode|secret|token|cookie|authorization|sessionsecret|session_secret|hash|api[_-]?key|credential|email)/i;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const TOKEN_VALUE_PATTERN =
  /\b(?:Bearer\s+|sk-|sess-|ghp_|gho_)[A-Za-z0-9._=-]{12,}/i;

export type DiagnosticsExportInput = {
  config: RuntimeConfig;
  officialIpcStatus: Record<string, unknown>;
  appServerStatus: Record<string, unknown>;
  workspaceStatus?: WorkspaceStatus | null;
  cacheStatus: DatabaseStoreStatus;
  diagnosticEvents: DiagnosticEvent[];
  generatedAtIso?: string;
};

export type SafeDiagnosticsExport = {
  schemaVersion: number;
  generatedAtIso: string;
  app: {
    name: string;
    version: string;
    projectRoot: string;
    dataDir: string;
    configPath: string;
    logPath: string;
    server: RuntimeConfig["server"];
    dev: RuntimeConfig["dev"];
    ui: RuntimeConfig["ui"];
    diagnostics: RuntimeConfig["diagnostics"];
  };
  officialIpc: Record<string, unknown>;
  protocol: {
    ipcMethodVersions: Record<string, number>;
  };
  appServer: Record<string, unknown>;
  workspace?: WorkspaceStatus | null;
  cache: DatabaseStoreStatus;
  diagnostics: DiagnosticEvent[];
  safety: {
    redaction: string;
    omitted: string[];
  };
};

export function buildSafeDiagnosticsExport(
  input: DiagnosticsExportInput,
): SafeDiagnosticsExport {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    app: {
      name: "codex_web",
      version: APP_VERSION,
      projectRoot: input.config.projectRoot,
      dataDir: input.config.dataDir,
      configPath: input.config.configPath,
      logPath: resolve(input.config.dataDir, "logs", "server.log"),
      server: input.config.server,
      dev: input.config.dev,
      ui: input.config.ui,
      diagnostics: input.config.diagnostics,
    },
    officialIpc: sanitizeOfficialIpcStatus(input.officialIpcStatus),
    protocol: {
      ipcMethodVersions: IPC_METHOD_VERSIONS,
    },
    appServer: sanitizeAppServerStatus(input.appServerStatus),
    workspace: input.workspaceStatus ?? null,
    cache: input.cacheStatus,
    diagnostics: input.diagnosticEvents.map(redactDiagnosticEvent),
    safety: {
      redaction:
        "Sensitive keys, email-like strings, and token-like strings are redacted recursively.",
      omitted: [
        "auth password hash",
        "auth session secret",
        "auth session token hashes",
        "account email",
        "raw IPC frame payloads",
        "thread message bodies",
        "attachment file contents",
      ],
    },
  };
}

export function redactDiagnosticEvent(event: DiagnosticEvent): DiagnosticEvent {
  return {
    ...event,
    message: String(redactSensitiveValue(event.message) ?? event.message),
    ...(event.data
      ? { data: redactSensitiveValue(event.data) as Record<string, unknown> }
      : {}),
  };
}

export function redactSensitiveValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;

  if (typeof value === "string") {
    return value
      .replace(EMAIL_VALUE_PATTERN, REDACTED_EMAIL)
      .replace(TOKEN_VALUE_PATTERN, REDACTED);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_EXPORT_ARRAY_ITEMS)
      .map((entry) => redactSensitiveValue(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([entryKey, entryValue]) => [
          entryKey,
          redactSensitiveValue(entryValue, entryKey),
        ],
      ),
    );
  }

  return value;
}

function sanitizeOfficialIpcStatus(
  status: Record<string, unknown>,
): Record<string, unknown> {
  return redactSensitiveValue({
    supported: status.supported,
    connected: status.connected,
    clientId: status.clientId,
    pipePath: status.pipePath,
    cachedConversationCount: status.cachedConversationCount,
    ownedConversationCount: status.ownedConversationCount,
    registeredRequestHandlers: status.registeredRequestHandlers,
    recentFollowerRequests: status.recentFollowerRequests,
    recentOwnershipHandoffs: status.recentOwnershipHandoffs,
    rawFrameLogging: status.rawFrameLogging,
    lastError: status.lastError,
  }) as Record<string, unknown>;
}

function sanitizeAppServerStatus(
  status: Record<string, unknown>,
): Record<string, unknown> {
  return redactSensitiveValue({
    running: status.running,
    pid: status.pid,
    initialized: status.initialized,
    pendingCallCount: status.pendingCallCount,
    lastError: status.lastError,
    lastWarning: status.lastWarning,
  }) as Record<string, unknown>;
}
