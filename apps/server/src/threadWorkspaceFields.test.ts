import { describe, expect, it } from "vitest";
import {
  preserveOwnedSnapshotWorkspaceFields,
  resolveProjectCwdForConversation,
} from "./threadWorkspaceFields.js";

describe("thread workspace broadcast fields", () => {
  it("keeps projectless workspace semantics when app-server returns a managed cwd", () => {
    expect(
      preserveOwnedSnapshotWorkspaceFields({
        conversationState: {
          id: "thread-projectless",
          cwd: "C:\\Users\\user\\.codex\\threads",
          turns: [],
        },
        existingState: {
          conversationState: {
            id: "thread-projectless",
            workspaceKind: "projectless",
            projectlessOutputDirectory:
              "C:\\Users\\user\\.codex\\projectless-output",
          },
        },
      }),
    ).toMatchObject({
      id: "thread-projectless",
      workspaceKind: "projectless",
      projectlessOutputDirectory: "C:\\Users\\user\\.codex\\projectless-output",
      turns: [],
    });
    expect(
      preserveOwnedSnapshotWorkspaceFields({
        conversationState: {
          id: "thread-projectless",
          cwd: "C:\\Users\\user\\.codex\\threads",
          turns: [],
        },
        existingState: {
          conversationState: {
            id: "thread-projectless",
            workspaceKind: "projectless",
          },
        },
      }),
    ).not.toHaveProperty("cwd");
  });

  it("resolves cwd only for explicit project conversations", () => {
    expect(
      resolveProjectCwdForConversation({
        explicitCwd: "C:\\workspace\\codex_web",
        conversationState: {
          workspaceKind: "project",
          cwd: "C:\\workspace\\fallback",
        },
      }),
    ).toBe("C:\\workspace\\codex_web");
    expect(
      resolveProjectCwdForConversation({
        conversationState: {
          workspaceKind: "project",
          cwd: "C:\\workspace\\codex_web",
        },
      }),
    ).toBe("C:\\workspace\\codex_web");
    expect(
      resolveProjectCwdForConversation({
        explicitCwd: "C:\\Users\\user\\.codex\\threads",
        conversationState: {
          workspaceKind: "projectless",
          cwd: "C:\\Users\\user\\.codex\\threads",
        },
      }),
    ).toBeUndefined();
    expect(
      resolveProjectCwdForConversation({
        conversationState: {
          workspaceKind: "unknown",
          cwd: "C:\\Users\\user\\.codex\\threads",
        },
      }),
    ).toBeUndefined();
  });
});
