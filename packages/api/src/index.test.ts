import { describe, expect, it } from "vitest";
import {
  accountStatusResponseSchema,
  approvalDecisionRequestSchema,
  approvalDecisionResponseSchema,
  approvalsResponseSchema,
  authLoginRequestSchema,
  authOkResponseSchema,
  authSessionRevokeRequestSchema,
  authSessionRevokeResponseSchema,
  authSessionsResponseSchema,
  authSessionsRevokeCountResponseSchema,
  authStatusResponseSchema,
  attachmentCleanupResponseSchema,
  attachmentResponseSchema,
  attachmentStorageResponseSchema,
  attachmentsResponseSchema,
  appServerStatusResponseSchema,
  cacheStatusResponseSchema,
  diagnosticsExportResponseSchema,
  diagnosticsResponseSchema,
  favoriteProjectRemoveRequestSchema,
  favoriteProjectRequestSchema,
  favoriteProjectsResponseSchema,
  fileBrowserListingResponseSchema,
  filePreviewResponseSchema,
  formatZodError,
  healthResponseSchema,
  lanAccessResponseSchema,
  lanPasswordUpdateRequestSchema,
  officialIpcStatusResponseSchema,
  messageItemSchema,
  protocolCompatibilityResponseSchema,
  syncReadinessResponseSchema,
  realtimeEventSchema,
  runtimeOptionsResponseSchema,
  settingsResponseSchema,
  settingsUpdateRequestSchema,
  sideConversationCloseRequestSchema,
  sideConversationCloseResponseSchema,
  sideConversationCreateRequestSchema,
  sideConversationCreateResponseSchema,
  skillsResponseSchema,
  threadArchiveRequestSchema,
  threadArchiveResponseSchema,
  threadCreateRequestSchema,
  threadCreateResponseSchema,
  threadDetailResponseSchema,
  threadListResponseSchema,
  threadRenameRequestSchema,
  threadRenameResponseSchema,
  threadUnarchiveRequestSchema,
  threadUnarchiveResponseSchema,
  turnInterruptRequestSchema,
  turnStartRequestSchema,
  turnSteerRequestSchema,
  workspaceStatusResponseSchema,
} from "./index";

describe("API contract schemas", () => {
  const thread = {
    id: "thread-a",
    title: "Thread A",
    projectId: null,
    path: null,
    updatedAtIso: null,
    inProgress: false,
    owner: null,
  };

  const project = {
    id: "C:\\workspace\\project-a",
    name: "project-a",
    path: "C:\\workspace\\project-a",
    source: "web-favorite" as const,
  };

  const appConfig = {
    server: { host: "0.0.0.0", port: 18930 },
    dev: { frontendPort: 18931 },
    dataDir: "C:\\workspace\\codex_web\\data",
    ui: { theme: "light" as const },
    diagnostics: { rawFrameLogging: false },
    configured: {
      server: { host: "0.0.0.0", port: 18930 },
      dev: { frontendPort: 18931 },
    },
    restartRequired: false,
  };

  const pendingApproval = {
    id: "approval-a",
    kind: "command" as const,
    method: "item/commandExecution/requestApproval",
    threadId: "thread-a",
    turnId: "turn-a",
    itemId: "item-a",
    title: "Approve command",
    body: "pnpm test",
    command: "pnpm test",
    cwd: "C:\\workspace\\codex_web",
    reason: null,
    grantRoot: null,
    filePath: null,
    diff: null,
    changedFiles: null,
    proposedExecpolicyAmendment: ["allow"],
    permissions: null,
    createdAtIso: "2026-05-29T00:00:00.000Z",
    status: "pending" as const,
  };

  const attachment = {
    id: "attachment-a",
    filename: "attachment.txt",
    mimeType: "text/plain",
    size: 12,
    path: "C:\\workspace\\codex_web\\data\\attachments\\attachment.txt",
    sha256: "abc123",
    createdAtIso: "2026-05-29T00:00:00.000Z",
    threadId: null,
    turnId: null,
    officialReferenceId: null,
  };

  const officialIpcStatus = {
    supported: true,
    connected: true,
    clientId: "client-a",
    pipePath: "\\\\.\\pipe\\codex-ipc",
    cachedConversationCount: 2,
    ownedConversationCount: 0,
    registeredRequestHandlers: [
      { method: "thread-follower-start-turn", version: 1 },
    ],
    recentFollowerRequests: [],
    recentOwnershipHandoffs: [],
    rawFrameLogging: false,
    recentRawFrames: [],
    lastError: null,
  };

  const appServerStatus = {
    running: true,
    pid: 1234,
    initialized: true,
    pendingCallCount: 0,
    lastError: null,
    lastWarning: null,
  };

  const followerMethodCapabilities = [
    {
      method: "thread-follower-start-turn",
      version: 1,
      protocolKnown: true,
      localHandlerRegistered: true,
      requiredForRealtimeSync: true,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-start-turn-for-host",
      ownerBehavior: "owner delegates to turn/start for the active thread",
      appServerRpcMapping: "turn/start",
      supportLevel: "implemented" as const,
      safeToImplement: true,
      note: "required follower path",
    },
    {
      method: "thread-follower-compact-thread",
      version: 1,
      protocolKnown: true,
      localHandlerRegistered: false,
      requiredForRealtimeSync: false,
      officialForHostCommandFound: true,
      officialForHostCommand: "thread-follower-compact-thread-for-host",
      ownerBehavior: "owner delegates to thread/compact/start",
      appServerRpcMapping: "thread/compact/start",
      supportLevel: "implemented" as const,
      safeToImplement: true,
      note: "guarded implementation",
    },
  ];

  it("normalizes a valid turn-start request", () => {
    expect(
      turnStartRequestSchema.parse({
        conversationId: " thread-a ",
        text: "hello",
        cwd: "C:\\workspace\\codex_web",
        skills: [{ name: "skill", path: "C:\\skill" }],
        permissionMode: "full-access",
      }),
    ).toMatchObject({
      threadId: "thread-a",
      conversationId: "thread-a",
      text: "hello",
      cwd: "C:\\workspace\\codex_web",
      skills: [{ name: "skill", path: "C:\\skill" }],
      permissionMode: "full-access",
    });
  });

  it("allows attachment-only turn-start requests", () => {
    expect(
      turnStartRequestSchema.parse({
        threadId: "thread-a",
        text: "   ",
        attachmentIds: ["att-a"],
      }),
    ).toMatchObject({
      threadId: "thread-a",
      text: "   ",
      attachmentIds: ["att-a"],
    });
  });

  it("allows skill-only turn-start requests", () => {
    expect(
      turnStartRequestSchema.parse({
        threadId: "thread-a",
        text: "   ",
        skills: [{ name: "docs", path: "C:\\skill\\SKILL.md" }],
      }),
    ).toMatchObject({
      threadId: "thread-a",
      text: "   ",
      skills: [{ name: "docs", path: "C:\\skill\\SKILL.md" }],
    });
  });

  it("rejects missing thread id and empty content", () => {
    const parsed = turnStartRequestSchema.safeParse({ text: "   " });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatZodError(parsed.error)).toContain("Missing threadId");
      expect(formatZodError(parsed.error)).toContain(
        "Missing text, attachmentIds, or skills",
      );
    }
  });

  it("rejects raw turn-start attachments outside the managed attachmentIds flow", () => {
    const parsed = turnStartRequestSchema.safeParse({
      threadId: "thread-a",
      text: "hello",
      attachments: [{ path: "C:\\raw\\secret.txt" }],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatZodError(parsed.error)).toContain("attachments");
    }
  });

  it("normalizes steer and interrupt aliases", () => {
    expect(
      turnSteerRequestSchema.parse({
        conversationId: " thread-a ",
        turn_id: " turn-a ",
        text: "guide",
      }),
    ).toMatchObject({
      threadId: "thread-a",
      expectedTurnId: "turn-a",
      text: "guide",
    });

    expect(
      turnSteerRequestSchema.parse({
        threadId: "thread-a",
        expectedTurnId: "turn-a",
        text: "   ",
        attachmentIds: ["att-a"],
      }),
    ).toMatchObject({
      threadId: "thread-a",
      expectedTurnId: "turn-a",
      attachmentIds: ["att-a"],
    });

    expect(
      turnSteerRequestSchema.parse({
        threadId: "thread-a",
        expectedTurnId: "turn-a",
        text: "",
        skills: [{ name: "docs", path: "C:\\skill\\SKILL.md" }],
      }),
    ).toMatchObject({
      threadId: "thread-a",
      expectedTurnId: "turn-a",
      skills: [{ name: "docs", path: "C:\\skill\\SKILL.md" }],
    });

    expect(
      turnInterruptRequestSchema.parse({
        conversationId: " thread-a ",
        turn_id: " turn-a ",
      }),
    ).toMatchObject({
      threadId: "thread-a",
      turnId: "turn-a",
    });
  });

  it("accepts realtime events with extension fields", () => {
    expect(
      realtimeEventSchema.parse({
        type: "official.threadStreamStateChanged",
        sequence: 7,
        payload: { threadId: "thread-a", cacheVersion: 3 },
        extra: true,
      }),
    ).toMatchObject({
      type: "official.threadStreamStateChanged",
      sequence: 7,
      payload: { threadId: "thread-a", cacheVersion: 3 },
      extra: true,
    });
  });

  it("validates known realtime event shapes", () => {
    expect(
      realtimeEventSchema.parse({
        type: "connected",
        atIso: "2026-05-29T00:00:00.000Z",
        serverInstanceId: "server-a",
        serverStartedAtIso: "2026-05-29T00:00:00.000Z",
      }).type,
    ).toBe("connected");

    expect(
      realtimeEventSchema.parse({
        type: "official.threadArchived",
        sequence: 8,
        payload: { conversationId: "thread-a", sourceClientId: "desktop-a" },
      }).payload,
    ).toMatchObject({ conversationId: "thread-a" });

    expect(
      realtimeEventSchema.parse({
        type: "domain.threadDetailUpdated",
        sequence: 9,
        threadId: "thread-a",
        detail: {
          thread: { ...thread, inProgress: true },
          turns: [],
        },
        source: "official-ipc-live",
        cacheVersion: 12,
        isInProgress: true,
        activeTurnId: "turn-a",
      }),
    ).toMatchObject({
      type: "domain.threadDetailUpdated",
      threadId: "thread-a",
      detail: {
        thread: { id: "thread-a", inProgress: true },
        goal: null,
      },
      cacheVersion: 12,
    });

    expect(
      realtimeEventSchema.parse({
        type: "approval.requested",
        sequence: 9,
        approval: pendingApproval,
      }),
    ).toMatchObject({
      type: "approval.requested",
      approval: { id: "approval-a" },
    });

    expect(
      realtimeEventSchema.safeParse({
        type: "approval.resolved",
        sequence: 10,
        approval: pendingApproval,
      }).success,
    ).toBe(false);

    expect(
      realtimeEventSchema.safeParse({
        type: "official.threadArchived",
        sequence: 0,
        payload: { threadId: "thread-a" },
      }).success,
    ).toBe(false);
  });

  it("validates thread list and thread detail response envelopes", () => {
    expect(
      threadListResponseSchema.parse({
        data: {
          projects: [],
          threads: [thread],
          nextCursor: null,
          backwardsCursor: null,
        },
      }).data.threads[0]?.id,
    ).toBe("thread-a");

    expect(
      threadDetailResponseSchema.parse({
        data: {
          thread,
          turns: [
            {
              id: "turn-a",
              status: "completed",
              items: [{ type: "user", id: "item-a", text: "hello" }],
            },
          ],
        },
        source: "app-server",
      }).data?.subAgents,
    ).toEqual([]);

    expect(
      threadDetailResponseSchema.parse({
        data: {
          thread,
          turns: [],
          subAgents: [
            {
              id: "agent-a",
              name: "Noether",
              role: "explorer",
              status: "active",
              source: "official-ipc",
            },
          ],
        },
        source: "official-ipc",
      }).data?.subAgents[0]?.name,
    ).toBe("Noether");

    expect(
      threadDetailResponseSchema.parse({
        data: {
          thread,
          turns: [
            {
              id: "turn-a",
              status: "completed",
              items: [{ type: "user", id: "item-a", text: "hello" }],
            },
          ],
        },
        source: "app-server",
      }).data?.turns[0]?.items[0]?.type,
    ).toBe("user");

    expect(
      threadDetailResponseSchema.parse({
        data: null,
        source: "app-server",
      }).data,
    ).toBeNull();
  });

  it("rejects malformed thread list response envelopes", () => {
    expect(
      threadListResponseSchema.safeParse({
        data: {
          projects: [],
          threads: [thread],
          nextCursor: null,
        },
      }).success,
    ).toBe(false);

    expect(
      threadListResponseSchema.safeParse({
        data: {
          projects: [],
          threads: [thread],
          backwardsCursor: null,
        },
      }).success,
    ).toBe(false);

    expect(
      threadListResponseSchema.safeParse({
        data: {
          projects: [],
          threads: [
            {
              title: "Thread A",
              projectId: null,
              path: null,
              updatedAtIso: null,
              inProgress: false,
              owner: null,
            },
          ],
          nextCursor: null,
          backwardsCursor: null,
        },
      }).success,
    ).toBe(false);
  });

  it("validates settings request patches and response envelopes", () => {
    expect(
      settingsUpdateRequestSchema.parse({
        server: { host: " 127.0.0.1 ", port: 18930 },
        dev: { frontendPort: 18931 },
        diagnostics: { rawFrameLogging: true },
      }),
    ).toMatchObject({
      server: { host: "127.0.0.1", port: 18930 },
      dev: { frontendPort: 18931 },
      diagnostics: { rawFrameLogging: true },
    });

    expect(
      settingsResponseSchema.parse({ data: appConfig }).data.server.port,
    ).toBe(18930);
    expect(
      settingsUpdateRequestSchema.safeParse({
        server: { port: 70000 },
      }).success,
    ).toBe(false);
  });

  it("validates operational response envelopes", () => {
    expect(
      healthResponseSchema.parse({
        ok: true,
        atIso: "2026-05-29T00:00:00.000Z",
      }).ok,
    ).toBe(true);

    expect(
      diagnosticsResponseSchema.parse({
        data: [
          {
            id: "diag-a",
            atIso: "2026-05-29T00:00:00.000Z",
            level: "warn",
            source: "api",
            message: "response-validation",
            data: { route: "/api/example" },
          },
        ],
      }).data[0]?.level,
    ).toBe("warn");

    expect(
      diagnosticsExportResponseSchema.parse({
        data: {
          schemaVersion: 1,
          generatedAtIso: "2026-05-29T00:00:00.000Z",
          app: {
            name: "codex_web",
            version: "0.1.0",
            projectRoot: "C:\\workspace\\codex_web",
            dataDir: "C:\\workspace\\codex_web\\data",
            configPath:
              "C:\\workspace\\codex_web\\data\\config.local.json",
            logPath: "C:\\workspace\\codex_web\\data\\logs\\server.log",
            server: { host: "0.0.0.0", port: 18930 },
            dev: { frontendPort: 18931 },
            ui: { theme: "light" },
            diagnostics: { rawFrameLogging: false },
          },
          officialIpc: officialIpcStatus,
          protocol: {
            ipcMethodVersions: {
              initialize: 0,
              "thread-follower-start-turn": 1,
            },
          },
          appServer: appServerStatus,
          cache: {
            path: "C:\\workspace\\codex_web\\data\\cache.sqlite",
            projectCount: 1,
            threadCount: 2,
            threadDetailCount: 1,
            attachmentCount: 0,
            officialStreamStateCount: 0,
          },
          diagnostics: [
            {
              id: "diag-a",
              atIso: "2026-05-29T00:00:00.000Z",
              level: "warn",
              source: "api",
              message: "response-validation",
            },
          ],
          safety: {
            redaction: "redacted",
            omitted: ["thread message bodies"],
          },
        },
      }).data.safety.omitted,
    ).toContain("thread message bodies");

    expect(
      diagnosticsExportResponseSchema.safeParse({
        data: {
          schemaVersion: 1,
          generatedAtIso: "2026-05-29T00:00:00.000Z",
          app: {
            name: "codex_web",
          },
        },
      }).success,
    ).toBe(false);

    expect(
      cacheStatusResponseSchema.parse({
        data: {
          path: "C:\\workspace\\codex_web\\data\\cache.sqlite",
          projectCount: 1,
          threadCount: 2,
          threadDetailCount: 1,
          attachmentCount: 0,
          officialStreamStateCount: 0,
        },
      }).data.threadCount,
    ).toBe(2);

    expect(
      fileBrowserListingResponseSchema.parse({
        data: {
          root: "C:\\workspace\\project-a",
          path: "C:\\workspace\\project-a\\src",
          relativePath: "src",
          parentRelativePath: "",
          entries: [
            {
              name: "index.ts",
              kind: "file",
              path: "C:\\workspace\\project-a\\src\\index.ts",
              relativePath: "src/index.ts",
              size: 12,
              mtimeIso: "2026-05-29T00:00:00.000Z",
              extension: "ts",
            },
          ],
          limited: false,
        },
      }).data.entries[0]?.kind,
    ).toBe("file");

    expect(
      filePreviewResponseSchema.parse({
        data: {
          path: "C:\\workspace\\project-a\\src\\index.ts",
          filename: "index.ts",
          mimeType: "text/typescript",
          size: 18,
          kind: "text",
          content: "export const ok = true",
          truncated: false,
        },
      }).data.kind,
    ).toBe("text");

    expect(
      workspaceStatusResponseSchema.parse({
        data: {
          cwd: "C:\\workspace\\codex_web",
          isGitRepository: true,
          branch: "main",
          branches: ["main"],
          upstream: "origin/main",
          ahead: 1,
          behind: 0,
          commit: "abc1234",
          changedFiles: 3,
          additions: 65,
          deletions: 2,
          hasUntracked: true,
          githubCli: {
            available: false,
            authenticated: null,
            status: "not-installed",
          },
          warnings: [],
        },
      }).data.githubCli.status,
    ).toBe("not-installed");

    expect(
      lanAccessResponseSchema.parse({
        data: {
          host: "0.0.0.0",
          port: 18930,
          localUrl: "http://127.0.0.1:18930/",
          urls: [
            {
              name: "Wi-Fi",
              address: "192.168.1.10",
              family: "IPv4",
              url: "http://192.168.1.10:18930/",
            },
          ],
          warnings: [],
        },
      }).data.urls[0]?.url,
    ).toBe("http://192.168.1.10:18930/");

    expect(
      cacheStatusResponseSchema.safeParse({
        data: {
          path: "cache.sqlite",
          projectCount: -1,
          threadCount: 0,
          threadDetailCount: 0,
          attachmentCount: 0,
          officialStreamStateCount: 0,
        },
      }).success,
    ).toBe(false);
  });

  it("validates auth request and response contracts", () => {
    expect(
      authStatusResponseSchema.parse({
        data: {
          authenticated: true,
          localBypass: false,
          sessionExpiresAtIso: "2026-06-05T00:00:00.000Z",
        },
      }).data.authenticated,
    ).toBe(true);

    expect(authLoginRequestSchema.parse({ password: " secret " })).toEqual({
      password: " secret ",
    });
    expect(authLoginRequestSchema.safeParse({ password: "" }).success).toBe(
      false,
    );

    expect(
      authSessionsResponseSchema.parse({
        data: [
          {
            id: "session-a",
            createdAtIso: "2026-05-29T00:00:00.000Z",
            expiresAtIso: "2026-06-05T00:00:00.000Z",
            lastSeenAtIso: "2026-05-29T01:00:00.000Z",
            lastIp: "192.168.1.2",
            userAgent: "Mobile Edge",
            current: true,
          },
        ],
      }).data[0]?.current,
    ).toBe(true);

    expect(
      authSessionRevokeRequestSchema.parse({ sessionId: " session-a " }),
    ).toEqual({ sessionId: "session-a" });
    expect(
      authSessionRevokeResponseSchema.parse({ data: { ok: true } }).data.ok,
    ).toBe(true);
    expect(
      authSessionsRevokeCountResponseSchema.parse({
        data: { revoked: 2 },
      }).data.revoked,
    ).toBe(2);
    expect(authOkResponseSchema.parse({ data: { ok: true } }).data.ok).toBe(
      true,
    );
    expect(
      lanPasswordUpdateRequestSchema.safeParse({
        password: "1234567",
      }).success,
    ).toBe(false);
    expect(
      lanPasswordUpdateRequestSchema.parse({
        password: "12345678",
      }),
    ).toEqual({ password: "12345678" });
  });

  it("validates account, runtime option, and skill envelopes", () => {
    expect(
      accountStatusResponseSchema.parse({
        data: {
          account: {
            type: "chatgpt",
            email: "user@example.com",
            planType: "pro",
          },
          requiresOpenaiAuth: false,
          rateLimits: {
            limitId: "primary",
            limitName: "Primary",
            planType: "pro",
            primary: {
              usedPercent: 12,
              resetsAt: 1780000000,
              windowDurationMins: 300,
            },
            secondary: null,
            credits: {
              hasCredits: true,
              unlimited: false,
              balance: "10",
            },
          },
          requirements: { auth: "ok" },
          source: "app-server",
          warnings: [],
        },
      }).data.account?.email,
    ).toBe("user@example.com");

    expect(
      runtimeOptionsResponseSchema.parse({
        data: {
          models: [
            {
              id: "gpt-5.5",
              model: "gpt-5.5",
              displayName: "GPT-5.5",
              description: "Default",
              isDefault: true,
              defaultReasoningEffort: "xhigh",
              supportedReasoningEfforts: [
                { reasoningEffort: "xhigh", description: "Extra high" },
              ],
              inputModalities: ["text", "image"],
            },
          ],
          collaborationModes: [
            {
              name: "Default",
              mode: "default",
              model: null,
              reasoningEffort: null,
              developerInstructions: null,
            },
          ],
          defaults: {
            model: "gpt-5.5",
            reasoningEffort: "xhigh",
            collaborationModeName: "Default",
          },
          source: {
            models: "app-server",
            collaborationModes: "fallback",
          },
          warnings: [],
        },
      }).data.defaults.model,
    ).toBe("gpt-5.5");

    expect(
      skillsResponseSchema.parse({
        data: {
          skills: [
            {
              id: "skill::C:\\skill",
              name: "skill",
              displayName: "Skill",
              description: "Useful skill",
              shortDescription: "Useful",
              path: "C:\\skill",
              cwd: "C:\\workspace\\project-a",
              scope: "repo",
              enabled: true,
              brandColor: null,
            },
          ],
          errors: [],
          source: "app-server",
          warnings: [],
        },
      }).data.skills[0]?.scope,
    ).toBe("repo");
  });

  it("validates favorite project requests and response envelopes", () => {
    expect(
      favoriteProjectRequestSchema.parse({
        path: " C:\\workspace\\project-a ",
      }),
    ).toEqual({ path: "C:\\workspace\\project-a" });

    expect(
      favoriteProjectRemoveRequestSchema.parse({
        id: " C:\\workspace\\project-a ",
      }),
    ).toMatchObject({
      path: "C:\\workspace\\project-a",
      id: "C:\\workspace\\project-a",
    });

    expect(
      favoriteProjectsResponseSchema.parse({ data: [project] }).data[0]?.name,
    ).toBe("project-a");

    const parsed = favoriteProjectRemoveRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatZodError(parsed.error)).toContain("Missing project path");
    }
  });

  it("validates attachment response, storage and cleanup envelopes", () => {
    expect(
      attachmentResponseSchema.parse({ data: attachment }).data.filename,
    ).toBe("attachment.txt");
    expect(
      attachmentsResponseSchema.parse({ data: [attachment] }).data[0]?.id,
    ).toBe("attachment-a");
    expect(
      attachmentStorageResponseSchema.parse({
        data: {
          attachmentCount: 3,
          attachmentBytes: 512,
          unassociatedCount: 1,
          unassociatedBytes: 128,
        },
      }).data.unassociatedCount,
    ).toBe(1);

    expect(
      attachmentCleanupResponseSchema.parse({
        data: {
          candidateCount: 2,
          deletedCount: 1,
          deletedBytes: 128,
          skippedCount: 1,
          skippedIds: ["outside-root"],
        },
      }).data.skippedIds,
    ).toEqual(["outside-root"]);

    expect(
      attachmentStorageResponseSchema.safeParse({
        data: {
          attachmentCount: -1,
          attachmentBytes: 0,
          unassociatedCount: 0,
          unassociatedBytes: 0,
        },
      }).success,
    ).toBe(false);
  });

  it("validates approvals list and decision contracts", () => {
    expect(
      approvalsResponseSchema.parse({ data: [pendingApproval] }).data[0]?.id,
    ).toBe("approval-a");

    expect(
      approvalDecisionRequestSchema.parse({
        id: " approval-a ",
        decision: "acceptForSession",
      }),
    ).toEqual({
      id: "approval-a",
      decision: "acceptForSession",
    });

    expect(
      approvalDecisionResponseSchema.parse({
        data: { ok: true, approval: pendingApproval },
      }).data.approval?.status,
    ).toBe("pending");

    expect(
      approvalDecisionRequestSchema.safeParse({
        id: "approval-a",
        decision: "maybe",
      }).success,
    ).toBe(false);
  });

  it("validates thread create, rename, archive, and unarchive contracts", () => {
    expect(
      threadCreateRequestSchema.parse({
        cwd: "C:\\workspace\\project-a",
      }),
    ).toEqual({ cwd: "C:\\workspace\\project-a" });

    expect(
      threadCreateResponseSchema.parse({
        data: { thread, raw: { id: "thread-a" } },
      }).data.thread.id,
    ).toBe("thread-a");

    expect(
      sideConversationCreateRequestSchema.parse({
        threadId: " thread-a ",
        cwd: " C:\\workspace\\project-a ",
      }),
    ).toMatchObject({
      threadId: "thread-a",
      cwd: "C:\\workspace\\project-a",
    });

    expect(
      sideConversationCreateResponseSchema.parse({
        data: {
          sideConversation: {
            id: "side-a",
            title: "侧边聊天",
            createdAtIso: null,
            updatedAtIso: null,
            inProgress: false,
            hasUnread: false,
            turnCount: 0,
            turns: [],
          },
          raw: { id: "side-a" },
        },
      }).data.sideConversation.id,
    ).toBe("side-a");

    expect(
      sideConversationCloseRequestSchema.parse({
        threadId: " thread-a ",
        sideConversationId: " side-a ",
      }),
    ).toMatchObject({
      threadId: "thread-a",
      sideConversationId: "side-a",
    });

    expect(
      sideConversationCloseResponseSchema.parse({
        data: {
          ok: true,
          sideConversationId: "side-a",
          discarded: true,
          interrupted: false,
        },
      }).data.discarded,
    ).toBe(true);

    expect(
      threadRenameRequestSchema.parse({
        threadId: " thread-a ",
        name: " New title ",
      }),
    ).toMatchObject({
      threadId: "thread-a",
      title: "New title",
      name: "New title",
    });

    expect(
      threadRenameResponseSchema.parse({
        data: { ok: true, result: {}, thread },
      }).data.thread?.title,
    ).toBe("Thread A");

    expect(
      threadArchiveRequestSchema.parse({ threadId: " thread-a " }),
    ).toEqual({ threadId: "thread-a" });
    expect(
      threadArchiveResponseSchema.parse({
        data: { ok: true, result: null },
      }).data.ok,
    ).toBe(true);

    expect(
      threadUnarchiveRequestSchema.parse({ threadId: " thread-a " }),
    ).toEqual({ threadId: "thread-a" });
    expect(
      threadUnarchiveResponseSchema.parse({
        data: { ok: true, result: {}, thread },
      }).data.thread?.id,
    ).toBe("thread-a");

    const parsed = threadRenameRequestSchema.safeParse({
      threadId: "thread-a",
      title: " ",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatZodError(parsed.error)).toContain("Missing title");
    }
  });

  it("rejects message items without required identity fields", () => {
    expect(
      messageItemSchema.safeParse({
        type: "user",
        text: "hello",
      }).success,
    ).toBe(false);

    expect(
      messageItemSchema.safeParse({
        id: "item-a",
        text: "hello",
      }).success,
    ).toBe(false);
  });

  it("validates concrete message item shapes", () => {
    const image = {
      url: "data:image/png;base64,abc",
      path: null,
      mimeType: "image/png",
      alt: "screenshot",
    };

    const validItems = [
      { type: "user" as const, id: "user-a", text: "hello", images: [image] },
      {
        type: "assistant" as const,
        id: "assistant-a",
        text: "hi",
        images: [image],
      },
      {
        type: "reasoning" as const,
        id: "reasoning-a",
        text: "thinking",
        collapsed: true,
      },
      {
        type: "command" as const,
        id: "command-a",
        command: "pnpm test",
        status: "completed",
        output: "ok",
        stdout: "ok",
        stderr: "",
        cwd: "C:\\workspace\\codex_web",
        durationMs: 123,
        exitCode: 0,
      },
      {
        type: "fileChange" as const,
        id: "file-a",
        path: "src/index.ts",
        diff: "@@",
        status: "applied",
      },
      {
        type: "plan" as const,
        id: "plan-a",
        text: "plan",
        steps: [{ text: "step", status: "completed" }],
        status: null,
      },
      {
        type: "agentTask" as const,
        id: "agent-task-a",
        title: "spawnAgent",
        status: "completed",
        prompt: "输入内容\n\n任务：核对事实",
        model: "gpt-5.5",
        reasoningEffort: "xhigh",
        agents: [
          {
            id: "agent-a",
            name: "Agent a",
            status: "pendingInit",
            prompt: "输入内容\n\n任务：核对事实",
            model: "gpt-5.5",
            reasoningEffort: "xhigh",
          },
        ],
        rawType: "collabAgentToolCall",
      },
      {
        type: "approval" as const,
        id: "approval-item-a",
        kind: "command" as const,
        title: "Approve command",
        body: "pnpm test",
        status: "pending",
        command: "pnpm test",
        cwd: "C:\\workspace\\codex_web",
        reason: null,
      },
      { type: "image" as const, id: "image-a", image },
      {
        type: "error" as const,
        id: "error-a",
        message: "failed",
        code: "ERR",
        detail: null,
      },
      {
        type: "toolOutput" as const,
        id: "tool-a",
        title: "Tool output",
        text: "result",
        status: null,
        rawType: "tool",
      },
      {
        type: "unknown" as const,
        id: "unknown-a",
        rawType: "futureItem",
        raw: { type: "futureItem" },
      },
    ];

    for (const item of validItems) {
      expect(messageItemSchema.parse(item).type).toBe(item.type);
    }
  });

  it("rejects malformed concrete message item shapes", () => {
    expect(
      messageItemSchema.safeParse({
        type: "command",
        id: "command-a",
        command: "pnpm test",
        status: "completed",
        output: "ok",
      }).success,
    ).toBe(false);

    expect(
      messageItemSchema.safeParse({
        type: "futureItem",
        id: "future-a",
        text: "must be normalized to unknown first",
      }).success,
    ).toBe(false);
  });

  it("validates protocol compatibility response envelopes", () => {
    expect(
      officialIpcStatusResponseSchema.parse({ data: officialIpcStatus }).data
        .registeredRequestHandlers[0]?.method,
    ).toBe("thread-follower-start-turn");
    expect(
      appServerStatusResponseSchema.parse({ data: appServerStatus }).data
        .initialized,
    ).toBe(true);

    expect(
      protocolCompatibilityResponseSchema.parse({
        data: {
          adapter: {
            name: "codex_web",
            version: "0.1.0",
            ipcMethodVersions: {
              initialize: 0,
              "thread-follower-start-turn": 1,
            },
            registeredRequestHandlers: [
              { method: "thread-follower-start-turn", version: 1 },
            ],
            unregisteredFollowerMethods: ["thread-follower-steer-turn"],
            followerMethodCapabilities,
          },
          officialIpc: officialIpcStatus,
          appServer: appServerStatus,
          summary: {
            state: "compatible",
            reason: null,
            methodCount: 2,
            registeredHandlerCount: 1,
          },
        },
      }).data.summary.state,
    ).toBe("compatible");
  });

  it("validates sync readiness response envelopes", () => {
    const compatibility = protocolCompatibilityResponseSchema.parse({
      data: {
        adapter: {
          name: "codex_web",
          version: "0.1.0",
          ipcMethodVersions: {
            initialize: 0,
            "thread-follower-start-turn": 1,
          },
          registeredRequestHandlers: [
            { method: "thread-follower-start-turn", version: 1 },
          ],
          unregisteredFollowerMethods: ["thread-follower-steer-turn"],
          followerMethodCapabilities,
        },
        officialIpc: officialIpcStatus,
        appServer: appServerStatus,
        summary: {
          state: "compatible",
          reason: null,
          methodCount: 2,
          registeredHandlerCount: 1,
        },
      },
    }).data;

    expect(
      syncReadinessResponseSchema.parse({
        data: {
          generatedAtIso: "2026-05-29T00:00:00.000Z",
          compatibility,
          followerHandlers: {
            required: [
              "thread-follower-start-turn",
              "thread-follower-steer-turn",
              "thread-follower-interrupt-turn",
            ],
            registered: ["thread-follower-start-turn"],
            missingRequired: ["thread-follower-steer-turn"],
            missingOptional: ["thread-follower-compact-thread"],
          },
          thread: {
            threadId: "thread-a",
            hasOfficialStreamState: true,
            ownerClientId: "desktop-client",
            sourceClientId: "desktop-client",
            cacheVersion: 7,
            isInProgress: false,
            activeTurnId: "",
            hasActiveTurnRecord: false,
            activeTurnItemCount: null,
            hasEmptyActiveTurn: false,
            isWebOwned: false,
            isExternallyOwned: true,
          },
          recentFollowerRequests: [],
          recentOwnershipHandoffs: [],
          checks: [
            {
              id: "official-ipc",
              status: "pass",
              label: "Official IPC",
              detail: "connected",
            },
          ],
        },
      }).data.thread?.ownerClientId,
    ).toBe("desktop-client");
  });

  it("rejects malformed protocol compatibility summaries", () => {
    expect(
      protocolCompatibilityResponseSchema.safeParse({
        data: {
          adapter: {
            name: "codex_web",
            version: "0.1.0",
            ipcMethodVersions: { initialize: 0 },
            registeredRequestHandlers: [],
            unregisteredFollowerMethods: [],
            followerMethodCapabilities: [],
          },
          officialIpc: {
            supported: true,
            connected: true,
            clientId: "client-a",
            pipePath: "\\\\.\\pipe\\codex-ipc",
            cachedConversationCount: 2,
            ownedConversationCount: 0,
            registeredRequestHandlers: [],
            recentFollowerRequests: [],
            recentOwnershipHandoffs: [],
            rawFrameLogging: false,
            recentRawFrames: [],
            lastError: null,
          },
          appServer: {
            running: true,
            pid: 1234,
            initialized: true,
            pendingCallCount: 0,
            lastError: null,
            lastWarning: null,
          },
          summary: {
            state: "maybe",
            reason: null,
            methodCount: 1,
            registeredHandlerCount: 0,
          },
        },
      }).success,
    ).toBe(false);
  });
});
