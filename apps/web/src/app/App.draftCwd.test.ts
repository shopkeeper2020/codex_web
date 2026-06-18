import { describe, expect, it } from "vitest";
import {
  resolveFallbackDraftCwd,
  resolveThreadProjectCwd,
} from "./draftThreadCwd";

describe("draft thread cwd resolution", () => {
  it("uses cwd only for confirmed project threads", () => {
    expect(
      resolveThreadProjectCwd({
        workspaceKind: "project",
        projectId: "C:\\workspace\\codex_web",
        path: "C:\\workspace\\codex_web",
      }),
    ).toBe("C:\\workspace\\codex_web");

    expect(
      resolveThreadProjectCwd({
        workspaceKind: "projectless",
        projectId: null,
        path: "C:\\Users\\user\\.codex\\threads",
      }),
    ).toBeNull();

    expect(
      resolveThreadProjectCwd({
        workspaceKind: "unknown",
        projectId: null,
        path: "C:\\Users\\user\\.codex\\threads",
      }),
    ).toBeNull();
  });

  it("does not inherit projectless or unknown thread paths for new drafts", () => {
    expect(
      resolveFallbackDraftCwd({
        selectedProjectCwd: null,
        selectedThread: {
          workspaceKind: "projectless",
          projectId: null,
          path: "C:\\Users\\user\\.codex\\threads",
        },
        defaultProjectCwd: "C:\\workspace\\codex_web",
      }),
    ).toBeNull();

    expect(
      resolveFallbackDraftCwd({
        selectedProjectCwd: null,
        selectedThread: {
          workspaceKind: "unknown",
          projectId: null,
          path: "C:\\Users\\user\\.codex\\threads",
        },
        defaultProjectCwd: "C:\\workspace\\codex_web",
      }),
    ).toBeNull();
  });

  it("keeps explicit project selection as the draft default", () => {
    expect(
      resolveFallbackDraftCwd({
        selectedProjectCwd: "D:\\repo",
        selectedThread: {
          workspaceKind: "projectless",
          projectId: null,
          path: "C:\\Users\\user\\.codex\\threads",
        },
        defaultProjectCwd: "C:\\workspace\\codex_web",
      }),
    ).toBe("D:\\repo");
  });
});
