import type { Page, Route } from "@playwright/test";

export const approvalProjectRoot = "C:\\workspace\\codex_web";
export const approvalThreadId = "thread-approval-card-e2e";
export const approvalId = "approval-card-pending-1";

type JsonBody = Record<string, unknown>;

export const pendingApproval: JsonBody = {
  id: approvalId,
  kind: "fileChange",
  method: "codex/apply_patch",
  threadId: approvalThreadId,
  turnId: "turn-approval-card-e2e",
  itemId: "item-approval-card-e2e",
  title: "Apply guarded file changes",
  body: "Review generated patch before applying.",
  command: "apply_patch --check tests/e2e/approval-card.spec.ts",
  cwd: approvalProjectRoot,
  reason: "Codex wants to apply a focused E2E patch.",
  grantRoot: approvalProjectRoot,
  filePath: "tests/e2e/approval-card.spec.ts",
  diff: [
    "diff --git a/tests/e2e/approval-card.spec.ts b/tests/e2e/approval-card.spec.ts",
    "+expect(decisionBody).toEqual({ id: approvalId, decision: 'accept' });",
  ].join("\n"),
  changedFiles: [
    "tests/e2e/approval-card.spec.ts",
    "apps/web/src/app/components/MessageBlocks.tsx",
  ],
  proposedExecpolicyAmendment: ["allow apply_patch in codex_web"],
  permissions: null,
  createdAtIso: "2026-05-29T08:00:00.000Z",
  status: "pending",
};

async function fulfillJson(route: Route, body: JsonBody): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function clearMockRoutes(page: Page): Promise<void> {
  for (const pattern of [
    "**/api/domain/thread/list**",
    "**/api/domain/thread/read**",
    "**/api/runtime-options",
    "**/api/skills**",
    "**/api/files/list**",
    "**/api/approvals/decision",
    "**/api/approvals",
  ]) {
    await page.unroute(pattern).catch(() => undefined);
  }
}

function approvalThread(): JsonBody {
  return {
    id: approvalThreadId,
    title: "Approval card UI loop",
    projectId: approvalProjectRoot,
    path: approvalProjectRoot,
    updatedAtIso: "2026-05-29T08:00:00.000Z",
    inProgress: true,
    owner: null,
  };
}

export async function installApprovalCardMocks(page: Page): Promise<{
  decisionBodies: JsonBody[];
  releaseDecision: () => void;
}> {
  await clearMockRoutes(page);

  let approvals: JsonBody[] = [pendingApproval];
  let releaseDecision: () => void = () => undefined;
  const decisionGate = new Promise<void>((resolve) => {
    releaseDecision = resolve;
  });
  const decisionBodies: JsonBody[] = [];

  await page.route("**/api/domain/thread/list**", async (route) => {
    const url = new URL(route.request().url());
    const archived = url.searchParams.get("archived") === "true";
    await fulfillJson(route, {
      data: {
        projects: [
          {
            id: approvalProjectRoot,
            name: "codex_web",
            path: approvalProjectRoot,
            source: "official",
          },
        ],
        threads: archived ? [] : [approvalThread()],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });

  await page.route("**/api/domain/thread/read**", async (route) => {
    await fulfillJson(route, {
      data: {
        thread: approvalThread(),
        turns: [],
      },
      source: "e2e-mock",
    });
  });

  await page.route("**/api/runtime-options", async (route) => {
    await fulfillJson(route, {
      data: {
        models: [
          {
            id: "default",
            model: "gpt-default",
            displayName: "GPT Default",
            description: "Default test model.",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
            ],
            inputModalities: ["text"],
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
          model: "gpt-default",
          reasoningEffort: "medium",
          collaborationModeName: "Default",
        },
        source: {
          models: "app-server",
          collaborationModes: "app-server",
        },
        warnings: [],
      },
    });
  });

  await page.route("**/api/skills**", async (route) => {
    await fulfillJson(route, {
      data: {
        skills: [],
        errors: [],
        source: "app-server",
        warnings: [],
      },
    });
  });

  await page.route("**/api/files/list**", async (route) => {
    await fulfillJson(route, {
      data: {
        root: approvalProjectRoot,
        path: approvalProjectRoot,
        relativePath: "",
        parentRelativePath: null,
        entries: [],
        limited: false,
      },
    });
  });

  await page.route("**/api/approvals/decision", async (route) => {
    decisionBodies.push(route.request().postDataJSON() as JsonBody);
    await decisionGate;
    approvals = [];
    await fulfillJson(route, { data: { ok: true } });
  });

  await page.route("**/api/approvals", async (route) => {
    await fulfillJson(route, { data: approvals });
  });

  return { decisionBodies, releaseDecision };
}
