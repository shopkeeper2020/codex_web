import { describe, expect, it } from "vitest";
import {
  buildSafeDiagnosticsExport,
  redactSensitiveValue,
} from "./diagnosticsExport.js";
import { diagnosticsExportResponseSchema } from "@codex-web/api";
import type { RuntimeConfig } from "@codex-web/config";

const config: RuntimeConfig = {
  projectRoot: "C:\\workspace\\codex_web",
  dataDir: "C:\\workspace\\codex_web\\data",
  configPath: "C:\\workspace\\codex_web\\data\\config.local.json",
  server: { host: "0.0.0.0", port: 18930 },
  dev: { frontendPort: 18931 },
  ui: { theme: "light" },
  diagnostics: { rawFrameLogging: false },
};

describe("safe diagnostics export", () => {
  it("redacts sensitive keys and token-like string values recursively", () => {
    expect(
      redactSensitiveValue({
        password: "secret-password",
        nested: {
          tokenHash: "token-hash",
          email: "person@example.com",
          message:
            "contact person@example.com with Bearer abcdefghijklmnopqrstuvwxyz",
        },
      }),
    ).toEqual({
      password: "[redacted]",
      nested: {
        tokenHash: "[redacted]",
        email: "[redacted]",
        message: "contact [email-redacted] with [redacted]",
      },
    });
  });

  it("exports only safe status summaries and omits raw IPC frames", () => {
    const exported = buildSafeDiagnosticsExport({
      config,
      generatedAtIso: "2026-05-29T00:00:00.000Z",
      officialIpcStatus: {
        supported: true,
        connected: true,
        clientId: "client-a",
        pipePath: "\\\\.\\pipe\\codex-ipc",
        cachedConversationCount: 2,
        ownedConversationCount: 1,
        registeredRequestHandlers: [
          { method: "thread-follower-start-turn", version: 1 },
        ],
        recentFollowerRequests: [
          { threadId: "thread-a", method: "thread-follower-start-turn" },
        ],
        recentOwnershipHandoffs: [
          { conversationId: "thread-a", sourceClientId: "desktop-client" },
        ],
        rawFrameLogging: true,
        recentRawFrames: [
          { preview: { params: { text: "do not export me" } } },
        ],
        lastError: null,
      },
      appServerStatus: {
        running: true,
        pid: 123,
        initialized: true,
        pendingCallCount: 0,
        lastError: null,
        lastWarning: "minor warning",
        environment: { OPENAI_API_KEY: "openai-api-key-fixture-value" },
      },
      workspaceStatus: {
        cwd: "C:\\workspace\\codex_web",
        isGitRepository: true,
        branch: "feature/diagnostics",
        upstream: "origin/feature/diagnostics",
        ahead: 1,
        behind: 0,
        commit: "abc1234",
        changedFiles: 2,
        additions: 10,
        deletions: 1,
        hasUntracked: true,
        githubCli: {
          available: true,
          authenticated: false,
          status: "not-authenticated",
        },
        warnings: [],
      },
      cacheStatus: {
        path: "C:\\workspace\\codex_web\\data\\codex_web.sqlite",
        projectCount: 1,
        threadCount: 2,
        threadDetailCount: 3,
        attachmentCount: 4,
        officialStreamStateCount: 5,
      },
      diagnosticEvents: [
        {
          id: "event-a",
          atIso: "2026-05-29T00:00:00.000Z",
          level: "warn",
          source: "auth",
          message: "email person@example.com",
          data: { sessionSecret: "secret", detail: "visible" },
        },
      ],
    });

    expect(exported.officialIpc).not.toHaveProperty("recentRawFrames");
    expect(exported.officialIpc.registeredRequestHandlers).toEqual([
      { method: "thread-follower-start-turn", version: 1 },
    ]);
    expect(exported.officialIpc.recentOwnershipHandoffs).toEqual([
      { conversationId: "thread-a", sourceClientId: "desktop-client" },
    ]);
    expect(exported.appServer).not.toHaveProperty("environment");
    expect(exported.appServer.lastWarning).toBe("minor warning");
    expect(exported.workspace).toMatchObject({
      branch: "feature/diagnostics",
      changedFiles: 2,
      githubCli: { status: "not-authenticated" },
    });
    expect(exported.diagnostics[0]?.message).toBe("email [email-redacted]");
    expect(exported.diagnostics[0]?.data).toEqual({
      sessionSecret: "[redacted]",
      detail: "visible",
    });
    expect(
      diagnosticsExportResponseSchema.safeParse({ data: exported }).success,
    ).toBe(true);
  });
});
