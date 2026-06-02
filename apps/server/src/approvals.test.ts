import { describe, expect, it } from "vitest";
import {
  approvalDecisionResponseSchema,
  approvalsResponseSchema,
} from "@codex-web/api";
import { ApprovalCoordinator } from "./approvals.js";
import { EventBus, type ServerEvent } from "./events.js";

describe("ApprovalCoordinator", () => {
  it("turns command approval requests into pending approvals and resolves decisions", async () => {
    const approvals = new ApprovalCoordinator(new EventBus());
    const responsePromise = approvals.request(
      "item/commandExecution/requestApproval",
      {
        itemId: "item-a",
        threadId: "thread-a",
        turnId: "turn-a",
        command: "pnpm test",
        cwd: "C:\\workspace\\codex_web",
        proposedExecpolicyAmendment: ["pnpm test"],
      },
    );

    const pending = approvals.list()[0];
    expect(pending).toMatchObject({
      kind: "command",
      threadId: "thread-a",
      command: "pnpm test",
    });

    approvals.decide(pending?.id ?? "", "acceptForSession");
    await expect(responsePromise).resolves.toEqual({
      decision: {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ["pnpm test"],
        },
      },
    });
    expect(approvals.list()).toHaveLength(0);
  });

  it("turns file change declines into a decline response", async () => {
    const approvals = new ApprovalCoordinator(new EventBus());
    const responsePromise = approvals.request(
      "item/fileChange/requestApproval",
      {
        itemId: "item-b",
        threadId: "thread-b",
        turnId: "turn-b",
        grantRoot: "C:\\workspace\\codex_web",
        filePath: "apps/web/src/app/App.tsx",
        diff: "--- old\n+++ new",
        changedFiles: ["apps/web/src/app/App.tsx"],
      },
    );

    const pending = approvals.list()[0];
    expect(pending?.kind).toBe("fileChange");
    expect(pending).toMatchObject({
      filePath: "apps/web/src/app/App.tsx",
      diff: "--- old\n+++ new",
      changedFiles: ["apps/web/src/app/App.tsx"],
    });
    approvals.decide(pending?.id ?? "", "decline");
    await expect(responsePromise).resolves.toEqual({ decision: "decline" });
  });

  it("turns permissions approvals into official granted-permissions responses", async () => {
    const approvals = new ApprovalCoordinator(new EventBus());
    const requestedPermissions = {
      fileSystem: { write: ["C:\\workspace\\codex_web"] },
      networkAccess: true,
    };
    const responsePromise = approvals.request(
      "item/permissions/requestApproval",
      {
        itemId: "item-perm",
        threadId: "thread-perm",
        turnId: "turn-perm",
        cwd: "C:\\workspace\\codex_web",
        reason: "Need workspace write access",
        permissions: requestedPermissions,
      },
    );

    const pending = approvals.list()[0];
    expect(pending).toMatchObject({
      kind: "permissions",
      threadId: "thread-perm",
      permissions: requestedPermissions,
    });

    approvals.decide(pending?.id ?? "", "acceptForSession");
    await expect(responsePromise).resolves.toEqual({
      scope: "session",
      permissions: requestedPermissions,
    });
  });

  it("publishes requested and resolved events with API-safe approval payloads", async () => {
    const bus = new EventBus();
    const events: ServerEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const approvals = new ApprovalCoordinator(bus);
    const responsePromise = approvals.request(
      "item/commandExecution/requestApproval",
      {
        itemId: "item-c",
        threadId: "thread-c",
        turnId: "turn-c",
        command: "Get-ChildItem",
        cwd: "C:\\workspace\\codex_web",
        reason: "Need to inspect workspace files",
      },
    );

    const pending = approvals.list()[0];
    expect(
      approvalsResponseSchema.parse({ data: approvals.list() }).data[0],
    ).toMatchObject({
      id: pending?.id,
      kind: "command",
      status: "pending",
    });
    expect(events[0]).toMatchObject({
      type: "approval.requested",
      approval: { id: pending?.id, threadId: "thread-c" },
    });

    const decided = approvals.decide(pending?.id ?? "", "accept");
    expect(
      approvalDecisionResponseSchema.parse({
        data: { ok: true, approval: decided },
      }).data.approval?.id,
    ).toBe(pending?.id);
    await expect(responsePromise).resolves.toEqual({ decision: "accept" });
    expect(approvals.list()).toHaveLength(0);
    expect(events[1]).toMatchObject({
      type: "approval.resolved",
      approval: { id: pending?.id, threadId: "thread-c" },
      decision: "accept",
    });
    expect(() => approvals.decide(pending?.id ?? "", "decline")).toThrow(
      "approval-not-found",
    );
  });

  it("cancels pending approvals on rejectAll and emits resolved events", async () => {
    const bus = new EventBus();
    const events: ServerEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const approvals = new ApprovalCoordinator(bus);
    const responsePromise = approvals.request(
      "item/fileChange/requestApproval",
      {
        itemId: "item-d",
        threadId: "thread-d",
        turnId: "turn-d",
        filePath: "README.md",
      },
    );

    approvals.rejectAll("app-server-stopped");
    await expect(responsePromise).rejects.toThrow("app-server-stopped");
    expect(approvals.list()).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({
        type: "approval.requested",
        approval: expect.objectContaining({ threadId: "thread-d" }),
      }),
      expect.objectContaining({
        type: "approval.resolved",
        approval: expect.objectContaining({ threadId: "thread-d" }),
        decision: "cancel",
      }),
    ]);
  });
});
