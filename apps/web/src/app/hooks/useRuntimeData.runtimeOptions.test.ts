import { describe, expect, it } from "vitest";
import { resolveRuntimeOptionsCwd } from "./useRuntimeData";
import type { Thread } from "../../api";

const projectThread: Thread = {
  id: "thread-project",
  title: "Project thread",
  projectId: "C:\\workspace\\codex_web",
  path: "C:\\workspace\\codex_web",
  workspaceKind: "project",
  updatedAtIso: null,
  inProgress: false,
  pinned: false,
  gitInfo: null,
  owner: null,
};

describe("runtime options cwd resolution", () => {
  it("uses the selected project thread cwd when there is no draft override", () => {
    expect(
      resolveRuntimeOptionsCwd({
        selectedThread: projectThread,
        override: undefined,
      }),
    ).toBe("C:\\workspace\\codex_web");
  });

  it("uses the draft project cwd over the selected thread cwd", () => {
    expect(
      resolveRuntimeOptionsCwd({
        selectedThread: projectThread,
        override: "D:\\project-a",
      }),
    ).toBe("D:\\project-a");
  });

  it("keeps a projectless draft projectless instead of inheriting the selected thread cwd", () => {
    expect(
      resolveRuntimeOptionsCwd({
        selectedThread: projectThread,
        override: null,
      }),
    ).toBeNull();
  });
});
