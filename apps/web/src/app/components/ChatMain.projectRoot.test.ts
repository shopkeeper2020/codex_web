import { describe, expect, it } from "vitest";
import { resolveThreadProjectRoot } from "./ChatMain";

describe("resolveThreadProjectRoot", () => {
  it("uses project cwd only when the thread is officially a project workspace", () => {
    expect(
      resolveThreadProjectRoot({
        selectedThread: {
          workspaceKind: "project",
          projectId: "C:\\workspace\\codex_web",
          path: "C:\\workspace\\codex_web",
        },
        selectedProject: null,
      }),
    ).toBe("C:\\workspace\\codex_web");
  });

  it("does not expose projectless or unknown cwd/path as a project root", () => {
    for (const workspaceKind of ["projectless", "unknown"] as const) {
      expect(
        resolveThreadProjectRoot({
          selectedThread: {
            workspaceKind,
            projectId: null,
            path: "C:\\Users\\user\\.codex\\threads",
          },
          selectedProject: null,
        }),
      ).toBeNull();
    }
  });
});
