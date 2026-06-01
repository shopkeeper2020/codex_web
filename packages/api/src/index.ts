import { z } from "zod";
import type {
  Attachment,
  DiagnosticEvent as DomainDiagnosticEvent,
  FileBrowserEntry as DomainFileBrowserEntry,
  FileBrowserListing as DomainFileBrowserListing,
  MessageItem,
  Owner,
  Project,
  Thread,
  ThreadDetail,
  ThreadGoal,
  ThreadList,
  ThreadSideConversation,
  ThreadSubAgent,
  Turn,
} from "@codex-web/domain";

const nonEmptyString = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1));

const portSchema = z.number().int().min(1).max(65535);

export const skillInputSchema = z.object({
  name: nonEmptyString,
  path: nonEmptyString,
});

export const permissionModeSchema = z.enum([
  "default",
  "auto-review",
  "full-access",
  "custom",
]);

export const turnStartRequestSchema = z
  .object({
    threadId: z.string().optional(),
    conversationId: z.string().optional(),
    text: z.string(),
    cwd: z.string().nullable().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
    skills: z.array(skillInputSchema).optional(),
    collaborationMode: z.record(z.string(), z.unknown()).optional(),
    permissionMode: permissionModeSchema.optional(),
  })
  .strict()
  .transform((value, context) => {
    const threadId = (value.threadId ?? value.conversationId ?? "").trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    const hasText = value.text.trim().length > 0;
    const hasAttachments =
      value.attachmentIds?.some((id) => id.trim().length > 0) ?? false;
    const hasSkills = (value.skills?.length ?? 0) > 0;
    if (!hasText && !hasAttachments && !hasSkills) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Missing text, attachmentIds, or skills",
      });
    }
    return {
      ...value,
      threadId,
      conversationId: value.conversationId?.trim(),
    };
  });

export const turnSteerRequestSchema = z
  .object({
    threadId: z.string().optional(),
    conversationId: z.string().optional(),
    expectedTurnId: z.string().optional(),
    turnId: z.string().optional(),
    turn_id: z.string().optional(),
    text: z.string(),
    cwd: z.string().nullable().optional(),
    attachmentIds: z.array(z.string()).optional(),
    skills: z.array(skillInputSchema).optional(),
    permissionMode: permissionModeSchema.optional(),
  })
  .transform((value, context) => {
    const threadId = (value.threadId ?? value.conversationId ?? "").trim();
    const expectedTurnId = (
      value.expectedTurnId ??
      value.turnId ??
      value.turn_id ??
      ""
    ).trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    if (!expectedTurnId) {
      context.addIssue({
        code: "custom",
        path: ["expectedTurnId"],
        message: "Missing expectedTurnId",
      });
    }
    const hasText = value.text.trim().length > 0;
    const hasAttachments =
      value.attachmentIds?.some((id) => id.trim().length > 0) ?? false;
    const hasSkills = (value.skills?.length ?? 0) > 0;
    if (!hasText && !hasAttachments && !hasSkills) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Missing text, attachmentIds, or skills",
      });
    }
    return {
      ...value,
      threadId,
      conversationId: value.conversationId?.trim(),
      expectedTurnId,
    };
  });

export const turnInterruptRequestSchema = z
  .object({
    threadId: z.string().optional(),
    conversationId: z.string().optional(),
    turnId: z.string().optional(),
    turn_id: z.string().optional(),
  })
  .transform((value, context) => {
    const threadId = (value.threadId ?? value.conversationId ?? "").trim();
    const turnId = (value.turnId ?? value.turn_id ?? "").trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    if (!turnId) {
      context.addIssue({
        code: "custom",
        path: ["turnId"],
        message: "Missing turnId",
      });
    }
    return {
      ...value,
      threadId,
      conversationId: value.conversationId?.trim(),
      turnId,
    };
  });

export const ownerSchema: z.ZodType<Owner> = z.object({
  clientId: z.string(),
  kind: z.enum(["desktop", "vscode", "web", "unknown"]),
  source: z.enum(["official-ipc", "web-app-server", "unknown"]),
});

export const projectSchema: z.ZodType<Project> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string().nullable(),
  source: z.enum(["official", "web-favorite"]),
});

export const threadSchema: z.ZodType<Thread> = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  path: z.string().nullable(),
  updatedAtIso: z.string().nullable(),
  inProgress: z.boolean(),
  pinned: z.boolean().default(false),
  owner: ownerSchema.nullable(),
});

export const threadListSchema: z.ZodType<ThreadList> = z.object({
  projects: z.array(projectSchema),
  threads: z.array(threadSchema),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable(),
});

const messageImageContentSchema = z.object({
  url: z.string().nullable(),
  path: z.string().nullable(),
  mimeType: z.string().nullable(),
  alt: z.string().nullable(),
});

const planStepSchema = z.object({
  text: z.string(),
  status: z.string().nullable(),
});

const agentTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().nullable(),
  prompt: z.string(),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
});

const textMessageItemFields = {
  id: z.string(),
  text: z.string(),
  images: z.array(messageImageContentSchema).optional(),
};

const fileChangeContentSchema = z.object({
  path: z.string(),
  diff: z.string(),
  status: z.string().nullable(),
  kind: z.string().nullable(),
});

export const messageItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
    ...textMessageItemFields,
  }),
  z.object({
    type: z.literal("assistant"),
    ...textMessageItemFields,
  }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    text: z.string(),
    collapsed: z.boolean(),
    status: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal("command"),
    id: z.string(),
    command: z.string(),
    status: z.string(),
    output: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    cwd: z.string().nullable(),
    durationMs: z.number().nullable(),
    exitCode: z.number().nullable(),
  }),
  z.object({
    type: z.literal("fileChange"),
    id: z.string(),
    path: z.string(),
    diff: z.string(),
    status: z.string().nullable(),
    changes: z.array(fileChangeContentSchema).optional(),
  }),
  z.object({
    type: z.literal("plan"),
    id: z.string(),
    text: z.string(),
    steps: z.array(planStepSchema),
    status: z.string().nullable(),
  }),
  z.object({
    type: z.literal("agentTask"),
    id: z.string(),
    title: z.string(),
    status: z.string().nullable(),
    prompt: z.string(),
    model: z.string().nullable(),
    reasoningEffort: z.string().nullable(),
    agents: z.array(agentTaskSchema),
    rawType: z.string(),
  }),
  z.object({
    type: z.literal("approval"),
    id: z.string(),
    kind: z.enum(["command", "fileChange", "unknown"]),
    title: z.string(),
    body: z.string(),
    status: z.string().nullable(),
    command: z.string().nullable(),
    cwd: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  z.object({
    type: z.literal("image"),
    id: z.string(),
    image: messageImageContentSchema,
  }),
  z.object({
    type: z.literal("error"),
    id: z.string(),
    message: z.string(),
    code: z.string().nullable(),
    detail: z.string().nullable(),
  }),
  z.object({
    type: z.literal("toolOutput"),
    id: z.string(),
    title: z.string(),
    text: z.string(),
    status: z.string().nullable(),
    rawType: z.string(),
  }),
  z.object({
    type: z.literal("unknown"),
    id: z.string(),
    rawType: z.string(),
    raw: z.unknown(),
  }),
]) satisfies z.ZodType<MessageItem>;

export const turnSchema: z.ZodType<Turn> = z.object({
  id: z.string(),
  status: z.enum([
    "idle",
    "active",
    "completed",
    "failed",
    "interrupted",
    "unknown",
  ]),
  items: z.array(messageItemSchema),
});

export const threadSubAgentSchema: z.ZodType<ThreadSubAgent> = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  status: z.string().nullable(),
  source: z.enum(["official-ipc", "app-server"]),
});

export const threadSideConversationSchema: z.ZodType<ThreadSideConversation> =
  z.object({
    id: z.string(),
    title: z.string(),
    createdAtIso: z.string().nullable(),
    updatedAtIso: z.string().nullable(),
    inProgress: z.boolean(),
    hasUnread: z.boolean(),
    turnCount: z.number().int().nonnegative(),
    turns: z.array(turnSchema),
  });

export const threadGoalSchema: z.ZodType<ThreadGoal> = z.object({
  threadId: z.string().nullable(),
  objective: z.string(),
  status: z.enum(["active", "paused", "completed", "unknown"]),
  tokenBudget: z.number().nullable(),
  tokensUsed: z.number().nullable(),
  timeUsedSeconds: z.number().nullable(),
  createdAtIso: z.string().nullable(),
  updatedAtIso: z.string().nullable(),
});

export const threadDetailSchema = z
  .object({
    thread: threadSchema,
    goal: threadGoalSchema.nullable().optional(),
    turns: z.array(turnSchema),
    subAgents: z.array(threadSubAgentSchema).optional(),
    sideConversations: z.array(threadSideConversationSchema).optional(),
  })
  .transform((value) => ({
    ...value,
    goal: value.goal ?? null,
    subAgents: value.subAgents ?? [],
    sideConversations: value.sideConversations ?? [],
  })) satisfies z.ZodType<ThreadDetail>;

export const attachmentSchema: z.ZodType<Attachment> = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  path: z.string(),
  sha256: z.string(),
  createdAtIso: z.string(),
  threadId: z.string().nullable(),
  turnId: z.string().nullable(),
  officialReferenceId: z.string().nullable(),
});

export const attachmentResponseSchema = z.object({
  data: attachmentSchema,
});

export const attachmentsResponseSchema = z.object({
  data: z.array(attachmentSchema),
});

export const threadListResponseSchema = z.object({
  data: threadListSchema,
});

export const threadDetailResponseSchema = z.object({
  data: threadDetailSchema.nullable(),
  source: z.string().optional(),
});

export const appConfigSchema = z.object({
  server: z.object({
    host: z.string(),
    port: portSchema,
  }),
  dev: z.object({
    frontendPort: portSchema,
  }),
  dataDir: z.string(),
  ui: z.object({
    theme: z.enum(["light"]),
  }),
  diagnostics: z.object({
    rawFrameLogging: z.boolean(),
  }),
  configured: z.object({
    server: z.object({
      host: z.string(),
      port: portSchema,
    }),
    dev: z.object({
      frontendPort: portSchema,
    }),
  }),
  restartRequired: z.boolean(),
});

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  atIso: z.string(),
});

export const authStatusSchema = z.object({
  authenticated: z.boolean(),
  localBypass: z.boolean(),
  sessionExpiresAtIso: z.string().nullable(),
});

export const authStatusResponseSchema = z.object({
  data: authStatusSchema,
});

export const authLoginRequestSchema = z
  .object({
    password: z.string().min(1),
  })
  .strict();

export const authSessionSchema = z.object({
  id: z.string(),
  createdAtIso: z.string(),
  expiresAtIso: z.string(),
  lastSeenAtIso: z.string(),
  lastIp: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});

export const authSessionsResponseSchema = z.object({
  data: z.array(authSessionSchema),
});

export const authSessionRevokeRequestSchema = z
  .object({
    sessionId: nonEmptyString,
  })
  .strict();

export const authSessionRevokeResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
  }),
});

export const authSessionsRevokeCountResponseSchema = z.object({
  data: z.object({
    revoked: z.number().int().nonnegative(),
  }),
});

export const authOkResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
  }),
});

export const nativeDictationSourceSchema = z.enum([
  "codex-keybindings",
  "environment",
  "none",
]);

export const nativeDictationStatusSchema = z.object({
  supported: z.boolean(),
  configured: z.boolean(),
  hotkey: z.string().nullable(),
  commandId: z.string().nullable(),
  source: nativeDictationSourceSchema,
  warning: z.string().nullable(),
});

export const nativeDictationStatusResponseSchema = z.object({
  data: nativeDictationStatusSchema,
});

export const nativeDictationStartResponseSchema = z.object({
  data: nativeDictationStatusSchema.extend({
    ok: z.boolean(),
  }),
});

export const nativeDictationTranscribeResponseSchema = z.object({
  data: z.object({
    text: z.string(),
  }),
});

export const lanPasswordUpdateRequestSchema = z
  .object({
    password: z.string().min(8),
  })
  .strict();

export const fileBrowserEntrySchema: z.ZodType<DomainFileBrowserEntry> =
  z.object({
    name: z.string(),
    kind: z.enum(["directory", "file", "symlink", "other"]),
    path: z.string(),
    relativePath: z.string(),
    size: z.number().nullable(),
    mtimeIso: z.string().nullable(),
    extension: z.string().nullable(),
  });

export const fileBrowserListingSchema: z.ZodType<DomainFileBrowserListing> =
  z.object({
    root: z.string(),
    path: z.string(),
    relativePath: z.string(),
    parentRelativePath: z.string().nullable(),
    entries: z.array(fileBrowserEntrySchema),
    limited: z.boolean(),
  });

export const fileBrowserListingResponseSchema = z.object({
  data: fileBrowserListingSchema,
});

export const filePreviewSchema = z.object({
  path: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  kind: z.enum(["image", "text", "binary"]),
  content: z.string().nullable(),
  truncated: z.boolean(),
});

export const filePreviewResponseSchema = z.object({
  data: filePreviewSchema,
});

export const diagnosticEventSchema: z.ZodType<DomainDiagnosticEvent> = z.object(
  {
    id: z.string(),
    atIso: z.string(),
    level: z.enum(["info", "warn", "error"]),
    source: z.string(),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  },
);

export const diagnosticsResponseSchema = z.object({
  data: z.array(diagnosticEventSchema),
});

const requestHandlerSchema = z.object({
  method: z.string(),
  version: z.number().int().nonnegative(),
});

export const cacheStatusSchema = z.object({
  path: z.string(),
  projectCount: z.number().int().nonnegative(),
  threadCount: z.number().int().nonnegative(),
  threadDetailCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  officialStreamStateCount: z.number().int().nonnegative(),
});

export const cacheStatusResponseSchema = z.object({
  data: cacheStatusSchema,
});

export const settingsUpdateRequestSchema = z.object({
  server: z
    .object({
      host: nonEmptyString.optional(),
      port: portSchema.optional(),
    })
    .optional(),
  dev: z
    .object({
      frontendPort: portSchema.optional(),
    })
    .optional(),
  ui: z
    .object({
      theme: z.enum(["light"]).optional(),
    })
    .optional(),
  diagnostics: z
    .object({
      rawFrameLogging: z.boolean().optional(),
    })
    .optional(),
});

export const settingsResponseSchema = z.object({
  data: appConfigSchema,
});

export const lanAccessUrlSchema = z.object({
  name: z.string(),
  address: z.string(),
  family: z.literal("IPv4"),
  url: z.string(),
});

export const lanAccessSchema = z.object({
  host: z.string(),
  port: portSchema,
  localUrl: z.string(),
  urls: z.array(lanAccessUrlSchema),
  warnings: z.array(z.string()),
});

export const lanAccessResponseSchema = z.object({
  data: lanAccessSchema,
});

export const favoriteProjectRequestSchema = z.object({
  path: nonEmptyString,
});

export const favoriteProjectRemoveRequestSchema = z
  .object({
    path: z.string().optional(),
    id: z.string().optional(),
  })
  .transform((value, context) => {
    const path = (value.path ?? value.id ?? "").trim();
    if (!path) {
      context.addIssue({
        code: "custom",
        path: ["path"],
        message: "Missing project path",
      });
    }
    return {
      ...value,
      path,
      id: value.id?.trim(),
    };
  });

export const favoriteProjectsResponseSchema = z.object({
  data: z.array(projectSchema),
});

export const attachmentStorageStatusSchema = z.object({
  attachmentCount: z.number().int().nonnegative(),
  attachmentBytes: z.number().int().nonnegative(),
  unassociatedCount: z.number().int().nonnegative(),
  unassociatedBytes: z.number().int().nonnegative(),
});

export const attachmentStorageResponseSchema = z.object({
  data: attachmentStorageStatusSchema,
});

export const attachmentCleanupResultSchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  deletedBytes: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  skippedIds: z.array(z.string()),
});

export const attachmentCleanupResponseSchema = z.object({
  data: attachmentCleanupResultSchema,
});

export const accountStatusSchema = z.object({
  account: z
    .object({
      type: z.string(),
      email: z.string().nullable(),
      planType: z.string().nullable(),
    })
    .nullable(),
  requiresOpenaiAuth: z.boolean().nullable(),
  rateLimits: z
    .object({
      limitId: z.string().nullable(),
      limitName: z.string().nullable(),
      planType: z.string().nullable(),
      primary: z
        .object({
          usedPercent: z.number().nullable(),
          resetsAt: z.number().nullable(),
          windowDurationMins: z.number().nullable(),
        })
        .nullable(),
      secondary: z
        .object({
          usedPercent: z.number().nullable(),
          resetsAt: z.number().nullable(),
          windowDurationMins: z.number().nullable(),
        })
        .nullable(),
      credits: z
        .object({
          hasCredits: z.boolean().nullable(),
          unlimited: z.boolean().nullable(),
          balance: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  requirements: z.record(z.string(), z.unknown()).nullable(),
  source: z.enum(["app-server", "fallback"]),
  warnings: z.array(z.string()),
});

export const accountStatusResponseSchema = z.object({
  data: accountStatusSchema,
});

export const runtimeReasoningEffortOptionSchema = z.object({
  reasoningEffort: z.string(),
  description: z.string(),
});

export const runtimeModelOptionSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  defaultReasoningEffort: z.string(),
  supportedReasoningEfforts: z.array(runtimeReasoningEffortOptionSchema),
  inputModalities: z.array(z.string()),
});

export const runtimeCollaborationModeOptionSchema = z.object({
  name: z.string(),
  mode: z.enum(["default", "plan"]),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  developerInstructions: z.string().nullable(),
});

export const runtimeOptionsSchema = z.object({
  models: z.array(runtimeModelOptionSchema),
  collaborationModes: z.array(runtimeCollaborationModeOptionSchema),
  defaults: z.object({
    model: z.string(),
    reasoningEffort: z.string(),
    collaborationModeName: z.string(),
  }),
  source: z.object({
    models: z.enum(["app-server", "fallback"]),
    collaborationModes: z.enum(["app-server", "fallback"]),
  }),
  warnings: z.array(z.string()),
});

export const runtimeOptionsResponseSchema = z.object({
  data: runtimeOptionsSchema,
});

export const skillOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  shortDescription: z.string(),
  path: z.string(),
  cwd: z.string(),
  scope: z.enum(["user", "repo", "system", "admin", "unknown"]),
  enabled: z.boolean(),
  brandColor: z.string().nullable(),
});

export const skillListSchema = z.object({
  skills: z.array(skillOptionSchema),
  errors: z.array(
    z.object({
      cwd: z.string(),
      message: z.string(),
      path: z.string().nullable(),
    }),
  ),
  source: z.enum(["app-server", "fallback"]),
  warnings: z.array(z.string()),
});

export const skillsResponseSchema = z.object({
  data: skillListSchema,
});

export const workspaceStatusSchema = z.object({
  cwd: z.string(),
  isGitRepository: z.boolean(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  commit: z.string().nullable(),
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  hasUntracked: z.boolean(),
  githubCli: z.object({
    available: z.boolean(),
    authenticated: z.boolean().nullable(),
    status: z.enum([
      "available",
      "not-installed",
      "not-authenticated",
      "error",
    ]),
  }),
  warnings: z.array(z.string()),
});

export const workspaceStatusResponseSchema = z.object({
  data: workspaceStatusSchema,
});

export const approvalDecisionSchema = z.enum([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);

export const pendingApprovalSchema = z.object({
  id: z.string(),
  kind: z.enum(["command", "fileChange"]),
  method: z.string(),
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  title: z.string(),
  body: z.string(),
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  reason: z.string().nullable(),
  grantRoot: z.string().nullable(),
  filePath: z.string().nullable(),
  diff: z.string().nullable(),
  changedFiles: z.array(z.string()).nullable(),
  proposedExecpolicyAmendment: z.array(z.string()).nullable(),
  createdAtIso: z.string(),
  status: z.literal("pending"),
});

export const approvalsResponseSchema = z.object({
  data: z.array(pendingApprovalSchema),
});

export const approvalDecisionRequestSchema = z.object({
  id: nonEmptyString,
  decision: approvalDecisionSchema,
});

export const approvalDecisionResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    approval: pendingApprovalSchema.optional(),
  }),
});

const realtimeSequenceSchema = z.number().int().positive().optional();
const realtimeBaseFields = {
  sequence: realtimeSequenceSchema,
  payload: z.unknown().optional(),
};

const officialThreadRealtimePayloadSchema = z
  .object({
    threadId: z.string().optional(),
    conversationId: z.string().optional(),
    cacheVersion: z.union([z.number(), z.string()]).optional(),
    sourceClientId: z.string().nullable().optional(),
  })
  .catchall(z.unknown());

export const realtimeEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("connected"),
      atIso: z.string(),
      serverInstanceId: z.string(),
      serverStartedAtIso: z.string(),
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("unparsed"),
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("websocket.error"),
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("diagnostic.event"),
      event: diagnosticEventSchema,
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("appServer.notification"),
      method: z.string(),
      params: z.unknown(),
      atIso: z.string(),
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("official.threadStreamStateChanged"),
      payload: officialThreadRealtimePayloadSchema,
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("official.threadArchived"),
      payload: officialThreadRealtimePayloadSchema,
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("official.threadUnarchived"),
      payload: officialThreadRealtimePayloadSchema,
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("official.statusChanged"),
      payload: z.unknown(),
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("approval.requested"),
      approval: pendingApprovalSchema,
    })
    .catchall(z.unknown()),
  z
    .object({
      ...realtimeBaseFields,
      type: z.literal("approval.resolved"),
      approval: pendingApprovalSchema,
      decision: approvalDecisionSchema,
    })
    .catchall(z.unknown()),
]);

export const threadCreateRequestSchema = z.object({
  cwd: z.string().nullable().optional(),
});

export const threadCreateResponseSchema = z.object({
  data: z.object({
    thread: threadSchema,
    raw: z.unknown().optional(),
  }),
});

export const sideConversationCreateRequestSchema = z
  .object({
    threadId: z.string().optional(),
    conversationId: z.string().optional(),
    cwd: z.string().nullable().optional(),
  })
  .strict()
  .transform((value, context) => {
    const threadId = (value.threadId ?? value.conversationId ?? "").trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    return {
      ...value,
      threadId,
      conversationId: value.conversationId?.trim(),
      cwd: value.cwd?.trim() || null,
    };
  });

export const sideConversationCreateResponseSchema = z.object({
  data: z.object({
    sideConversation: threadSideConversationSchema,
    raw: z.unknown().optional(),
  }),
});

export const sideConversationCloseRequestSchema = z
  .object({
    threadId: z.string().optional(),
    sideConversationId: z.string().optional(),
    conversationId: z.string().optional(),
  })
  .strict()
  .transform((value, context) => {
    const sideConversationId = (
      value.sideConversationId ??
      value.conversationId ??
      ""
    ).trim();
    if (!sideConversationId) {
      context.addIssue({
        code: "custom",
        path: ["sideConversationId"],
        message: "Missing sideConversationId",
      });
    }
    return {
      ...value,
      threadId: value.threadId?.trim(),
      sideConversationId,
      conversationId: value.conversationId?.trim(),
    };
  });

export const sideConversationCloseResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    sideConversationId: z.string(),
    discarded: z.boolean(),
    interrupted: z.boolean(),
  }),
});

export const threadRenameRequestSchema = z
  .object({
    threadId: z.string().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
  })
  .transform((value, context) => {
    const threadId = (value.threadId ?? "").trim();
    const title = (value.title ?? value.name ?? "").trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    if (!title) {
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: "Missing title",
      });
    }
    return {
      ...value,
      threadId,
      title,
      name: value.name?.trim(),
    };
  });

export const threadRenameResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    thread: threadSchema.nullable(),
  }),
});

export const threadArchiveRequestSchema = z
  .object({
    threadId: z.string().optional(),
  })
  .transform((value, context) => {
    const threadId = (value.threadId ?? "").trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    return {
      ...value,
      threadId,
    };
  });

export const threadArchiveResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    result: z.unknown().optional(),
  }),
});

export const threadCompactRequestSchema = threadArchiveRequestSchema;

export const threadCompactResponseSchema = z.object({
  data: z.object({
    mode: z.enum(["official-follower", "app-server"]),
    result: z.unknown().optional(),
    thread: threadSchema.nullable().optional(),
  }),
});

export const threadGoalSetRequestSchema = z
  .object({
    threadId: z.string().optional(),
    objective: z.string().nullable().optional(),
    status: z.enum(["active", "paused"]).optional(),
  })
  .transform((value, context) => {
    const threadId = (value.threadId ?? "").trim();
    const objective =
      typeof value.objective === "string" ? value.objective.trim() : undefined;
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    if (!objective && !value.status) {
      context.addIssue({
        code: "custom",
        path: ["objective"],
        message: "Missing objective or status",
      });
    }
    return {
      threadId,
      objective,
      status: value.status,
    };
  });

export const threadGoalClearRequestSchema = threadArchiveRequestSchema;

export const threadGoalResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    mode: z.enum(["app-server"]),
    result: z.unknown().optional(),
    goal: threadGoalSchema.nullable(),
    thread: threadSchema.nullable().optional(),
  }),
});

export const threadPinRequestSchema = z
  .object({
    threadId: z.string().optional(),
    pinned: z.boolean(),
  })
  .transform((value, context) => {
    const threadId = (value.threadId ?? "").trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    return {
      ...value,
      threadId,
    };
  });

export const threadPinResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    threadId: z.string(),
    pinned: z.boolean(),
    result: z.unknown().optional(),
  }),
});

export const threadStopBackgroundRequestSchema = z
  .object({
    threadId: z.string().optional(),
  })
  .transform((value, context) => {
    const threadId = (value.threadId ?? "").trim();
    if (!threadId) {
      context.addIssue({
        code: "custom",
        path: ["threadId"],
        message: "Missing threadId",
      });
    }
    return {
      ...value,
      threadId,
    };
  });

export const threadStopBackgroundResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    interrupted: z.number().int().nonnegative(),
    results: z.array(z.unknown()).optional(),
  }),
});

export const threadUnarchiveRequestSchema = threadArchiveRequestSchema;

export const threadUnarchiveResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    thread: threadSchema.nullable(),
  }),
});

export const officialIpcStatusSchema = z
  .object({
    supported: z.boolean(),
    connected: z.boolean(),
    clientId: z.string().nullable(),
    pipePath: z.string().nullable(),
    cachedConversationCount: z.number(),
    ownedConversationCount: z.number(),
    registeredRequestHandlers: z.array(requestHandlerSchema),
    recentFollowerRequests: z.array(z.unknown()),
    recentOwnershipHandoffs: z.array(z.unknown()),
    rawFrameLogging: z.boolean(),
    recentRawFrames: z.array(z.unknown()),
    lastError: z.string().nullable(),
  })
  .catchall(z.unknown());

export const appServerStatusSchema = z
  .object({
    running: z.boolean(),
    pid: z.number().nullable(),
    initialized: z.boolean(),
    pendingCallCount: z.number(),
    lastError: z.string().nullable(),
    lastWarning: z.string().nullable(),
  })
  .catchall(z.unknown());

export const officialIpcStatusResponseSchema = z.object({
  data: officialIpcStatusSchema,
});

export const appServerStatusResponseSchema = z.object({
  data: appServerStatusSchema,
});

export const diagnosticsExportSchema = z.object({
  schemaVersion: z.number().int().positive(),
  generatedAtIso: z.string(),
  app: z.object({
    name: z.string(),
    version: z.string(),
    projectRoot: z.string(),
    dataDir: z.string(),
    configPath: z.string(),
    logPath: z.string(),
    server: appConfigSchema.shape.server,
    dev: appConfigSchema.shape.dev,
    ui: appConfigSchema.shape.ui,
    diagnostics: appConfigSchema.shape.diagnostics,
  }),
  officialIpc: z
    .object({
      supported: z.boolean(),
      connected: z.boolean(),
      clientId: z.string().nullable(),
      pipePath: z.string().nullable(),
      cachedConversationCount: z.number(),
      ownedConversationCount: z.number(),
      registeredRequestHandlers: z.array(requestHandlerSchema),
      recentFollowerRequests: z.array(z.unknown()),
      recentOwnershipHandoffs: z.array(z.unknown()),
      rawFrameLogging: z.boolean(),
      lastError: z.string().nullable(),
    })
    .catchall(z.unknown()),
  protocol: z.object({
    ipcMethodVersions: z.record(z.string(), z.number()),
  }),
  appServer: appServerStatusSchema,
  workspace: workspaceStatusSchema.nullable().optional(),
  cache: cacheStatusSchema,
  diagnostics: z.array(diagnosticEventSchema),
  safety: z.object({
    redaction: z.string(),
    omitted: z.array(z.string()),
  }),
});

export const diagnosticsExportResponseSchema = z.object({
  data: diagnosticsExportSchema,
});

export const protocolCompatibilityStateSchema = z.enum([
  "compatible",
  "warning",
  "offline",
  "error",
]);

export const followerMethodCapabilitySchema = z.object({
  method: z.string(),
  version: z.number().int(),
  protocolKnown: z.boolean(),
  localHandlerRegistered: z.boolean(),
  requiredForRealtimeSync: z.boolean(),
  officialForHostCommandFound: z.boolean(),
  officialForHostCommand: z.string().nullable(),
  ownerBehavior: z.string(),
  appServerRpcMapping: z.string().nullable(),
  supportLevel: z.enum([
    "implemented",
    "candidate",
    "research-required",
    "risky",
  ]),
  safeToImplement: z.boolean(),
  note: z.string(),
});

export const protocolCompatibilityResponseSchema = z.object({
  data: z.object({
    adapter: z.object({
      name: z.string(),
      version: z.string(),
      ipcMethodVersions: z.record(z.string(), z.number()),
      registeredRequestHandlers: z.array(requestHandlerSchema),
      unregisteredFollowerMethods: z.array(z.string()),
      followerMethodCapabilities: z.array(followerMethodCapabilitySchema),
    }),
    officialIpc: officialIpcStatusSchema,
    appServer: appServerStatusSchema,
    summary: z.object({
      state: protocolCompatibilityStateSchema,
      reason: z.string().nullable(),
      methodCount: z.number().int().nonnegative(),
      registeredHandlerCount: z.number().int().nonnegative(),
    }),
  }),
});

export const syncReadinessCheckSchema = z.object({
  id: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  label: z.string(),
  detail: z.string(),
});

export const syncReadinessResponseSchema = z.object({
  data: z.object({
    generatedAtIso: z.string(),
    compatibility: protocolCompatibilityResponseSchema.shape.data,
    followerHandlers: z.object({
      required: z.array(z.string()),
      registered: z.array(z.string()),
      missingRequired: z.array(z.string()),
      missingOptional: z.array(z.string()),
    }),
    thread: z
      .object({
        threadId: z.string(),
        hasOfficialStreamState: z.boolean(),
        ownerClientId: z.string().nullable(),
        sourceClientId: z.string().nullable(),
        cacheVersion: z.number().nullable(),
        isInProgress: z.boolean(),
        activeTurnId: z.string(),
        hasActiveTurnRecord: z.boolean(),
        activeTurnItemCount: z.number().int().nonnegative().nullable(),
        hasEmptyActiveTurn: z.boolean(),
        isWebOwned: z.boolean(),
        isExternallyOwned: z.boolean(),
      })
      .nullable(),
    recentFollowerRequests: z.array(z.unknown()),
    recentOwnershipHandoffs: z.array(z.unknown()),
    checks: z.array(syncReadinessCheckSchema),
  }),
});

export type SkillInput = z.infer<typeof skillInputSchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type TurnStartRequest = z.infer<typeof turnStartRequestSchema>;
export type TurnSteerRequest = z.infer<typeof turnSteerRequestSchema>;
export type TurnInterruptRequest = z.infer<typeof turnInterruptRequestSchema>;
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
export type AttachmentStorageStatus = z.infer<
  typeof attachmentStorageStatusSchema
>;
export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;
export type AttachmentsResponse = z.infer<typeof attachmentsResponseSchema>;
export type AttachmentStorageResponse = z.infer<
  typeof attachmentStorageResponseSchema
>;
export type AttachmentCleanupResult = z.infer<
  typeof attachmentCleanupResultSchema
>;
export type AttachmentCleanupResponse = z.infer<
  typeof attachmentCleanupResponseSchema
>;
export type AccountStatus = z.infer<typeof accountStatusSchema>;
export type AccountStatusResponse = z.infer<typeof accountStatusResponseSchema>;
export type RuntimeReasoningEffortOption = z.infer<
  typeof runtimeReasoningEffortOptionSchema
>;
export type RuntimeModelOption = z.infer<typeof runtimeModelOptionSchema>;
export type RuntimeCollaborationModeOption = z.infer<
  typeof runtimeCollaborationModeOptionSchema
>;
export type RuntimeOptions = z.infer<typeof runtimeOptionsSchema>;
export type RuntimeOptionsResponse = z.infer<
  typeof runtimeOptionsResponseSchema
>;
export type SkillOption = z.infer<typeof skillOptionSchema>;
export type SkillList = z.infer<typeof skillListSchema>;
export type SkillsResponse = z.infer<typeof skillsResponseSchema>;
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export type WorkspaceStatusResponse = z.infer<
  typeof workspaceStatusResponseSchema
>;
export type LanAccessUrl = z.infer<typeof lanAccessUrlSchema>;
export type LanAccess = z.infer<typeof lanAccessSchema>;
export type LanAccessResponse = z.infer<typeof lanAccessResponseSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type SettingsUpdateRequest = z.infer<typeof settingsUpdateRequestSchema>;
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type AuthStatus = z.infer<typeof authStatusSchema>;
export type AuthStatusResponse = z.infer<typeof authStatusResponseSchema>;
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type AuthSessionsResponse = z.infer<typeof authSessionsResponseSchema>;
export type AuthSessionRevokeRequest = z.infer<
  typeof authSessionRevokeRequestSchema
>;
export type AuthSessionRevokeResponse = z.infer<
  typeof authSessionRevokeResponseSchema
>;
export type AuthSessionsRevokeCountResponse = z.infer<
  typeof authSessionsRevokeCountResponseSchema
>;
export type AuthOkResponse = z.infer<typeof authOkResponseSchema>;
export type NativeDictationSource = z.infer<typeof nativeDictationSourceSchema>;
export type NativeDictationStatus = z.infer<typeof nativeDictationStatusSchema>;
export type NativeDictationStatusResponse = z.infer<
  typeof nativeDictationStatusResponseSchema
>;
export type NativeDictationStartResponse = z.infer<
  typeof nativeDictationStartResponseSchema
>;
export type NativeDictationTranscribeResponse = z.infer<
  typeof nativeDictationTranscribeResponseSchema
>;
export type LanPasswordUpdateRequest = z.infer<
  typeof lanPasswordUpdateRequestSchema
>;
export type FileBrowserEntry = z.infer<typeof fileBrowserEntrySchema>;
export type FileBrowserListing = z.infer<typeof fileBrowserListingSchema>;
export type FileBrowserListingResponse = z.infer<
  typeof fileBrowserListingResponseSchema
>;
export type FilePreview = z.infer<typeof filePreviewSchema>;
export type FilePreviewResponse = z.infer<typeof filePreviewResponseSchema>;
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;
export type DiagnosticsResponse = z.infer<typeof diagnosticsResponseSchema>;
export type DiagnosticsExport = z.infer<typeof diagnosticsExportSchema>;
export type DiagnosticsExportResponse = z.infer<
  typeof diagnosticsExportResponseSchema
>;
export type CacheStatus = z.infer<typeof cacheStatusSchema>;
export type CacheStatusResponse = z.infer<typeof cacheStatusResponseSchema>;
export type FavoriteProjectRequest = z.infer<
  typeof favoriteProjectRequestSchema
>;
export type FavoriteProjectRemoveRequest = z.infer<
  typeof favoriteProjectRemoveRequestSchema
>;
export type FavoriteProjectsResponse = z.infer<
  typeof favoriteProjectsResponseSchema
>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;
export type ApprovalsResponse = z.infer<typeof approvalsResponseSchema>;
export type ApprovalDecisionRequest = z.infer<
  typeof approvalDecisionRequestSchema
>;
export type ApprovalDecisionResponse = z.infer<
  typeof approvalDecisionResponseSchema
>;
export type ThreadCreateRequest = z.infer<typeof threadCreateRequestSchema>;
export type ThreadCreateResponse = z.infer<typeof threadCreateResponseSchema>;
export type SideConversationCreateRequest = z.infer<
  typeof sideConversationCreateRequestSchema
>;
export type SideConversationCreateResponse = z.infer<
  typeof sideConversationCreateResponseSchema
>;
export type SideConversationCloseRequest = z.infer<
  typeof sideConversationCloseRequestSchema
>;
export type SideConversationCloseResponse = z.infer<
  typeof sideConversationCloseResponseSchema
>;
export type ThreadRenameRequest = z.infer<typeof threadRenameRequestSchema>;
export type ThreadRenameResponse = z.infer<typeof threadRenameResponseSchema>;
export type ThreadArchiveRequest = z.infer<typeof threadArchiveRequestSchema>;
export type ThreadArchiveResponse = z.infer<typeof threadArchiveResponseSchema>;
export type ThreadCompactRequest = z.infer<typeof threadCompactRequestSchema>;
export type ThreadCompactResponse = z.infer<typeof threadCompactResponseSchema>;
export type ThreadGoalSetRequest = z.infer<typeof threadGoalSetRequestSchema>;
export type ThreadGoalClearRequest = z.infer<
  typeof threadGoalClearRequestSchema
>;
export type ThreadGoalResponse = z.infer<typeof threadGoalResponseSchema>;
export type ThreadPinRequest = z.infer<typeof threadPinRequestSchema>;
export type ThreadPinResponse = z.infer<typeof threadPinResponseSchema>;
export type ThreadStopBackgroundRequest = z.infer<
  typeof threadStopBackgroundRequestSchema
>;
export type ThreadStopBackgroundResponse = z.infer<
  typeof threadStopBackgroundResponseSchema
>;
export type ThreadUnarchiveRequest = z.infer<
  typeof threadUnarchiveRequestSchema
>;
export type ThreadUnarchiveResponse = z.infer<
  typeof threadUnarchiveResponseSchema
>;
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;
export type ThreadDetailResponse = z.infer<typeof threadDetailResponseSchema>;
export type OfficialIpcStatus = z.infer<typeof officialIpcStatusSchema>;
export type AppServerStatus = z.infer<typeof appServerStatusSchema>;
export type OfficialIpcStatusResponse = z.infer<
  typeof officialIpcStatusResponseSchema
>;
export type AppServerStatusResponse = z.infer<
  typeof appServerStatusResponseSchema
>;
export type FollowerMethodCapability = z.infer<
  typeof followerMethodCapabilitySchema
>;
export type ProtocolCompatibility = z.infer<
  typeof protocolCompatibilityResponseSchema
>["data"];
export type SyncReadiness = z.infer<typeof syncReadinessResponseSchema>["data"];

export function formatZodError(error: z.ZodError): string {
  return (
    error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join("; ") || "Invalid request"
  );
}
