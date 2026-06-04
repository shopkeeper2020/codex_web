import { describe, expect, it } from "vitest";
import { appendThreadListPage, EMPTY_THREAD_LIST } from "./threadListPages";

describe("thread list pagination helpers", () => {
  it("appends new thread pages while preserving existing rows", () => {
    const merged = appendThreadListPage(
      {
        ...EMPTY_THREAD_LIST,
        projects: [
          {
            id: "project-a",
            name: "A",
            path: "A",
            source: "official",
          },
        ],
        threads: [
          {
            id: "thread-a",
            title: "A",
            projectId: "project-a",
            path: "A",
            updatedAtIso: null,
            inProgress: false,
            pinned: false,
            gitInfo: null,
            owner: null,
          },
        ],
        nextCursor: "cursor-1",
      },
      {
        ...EMPTY_THREAD_LIST,
        projects: [
          {
            id: "project-b",
            name: "B",
            path: "B",
            source: "official",
          },
        ],
        threads: [
          {
            id: "thread-b",
            title: "B",
            projectId: "project-b",
            path: "B",
            updatedAtIso: null,
            inProgress: false,
            pinned: false,
            gitInfo: null,
            owner: null,
          },
        ],
        nextCursor: "cursor-2",
      },
    );

    expect(merged.projects.map((project) => project.id)).toEqual([
      "project-a",
      "project-b",
    ]);
    expect(merged.threads.map((thread) => thread.id)).toEqual([
      "thread-a",
      "thread-b",
    ]);
    expect(merged.nextCursor).toBe("cursor-2");
  });

  it("deduplicates repeated rows from overlapping pages", () => {
    const merged = appendThreadListPage(
      {
        ...EMPTY_THREAD_LIST,
        threads: [
          {
            id: "thread-a",
            title: "A",
            projectId: null,
            path: null,
            updatedAtIso: null,
            inProgress: false,
            pinned: false,
            gitInfo: null,
            owner: null,
          },
        ],
      },
      {
        ...EMPTY_THREAD_LIST,
        threads: [
          {
            id: "thread-a",
            title: "A newer duplicate",
            projectId: null,
            path: null,
            updatedAtIso: null,
            inProgress: false,
            pinned: false,
            gitInfo: null,
            owner: null,
          },
          {
            id: "thread-b",
            title: "B",
            projectId: null,
            path: null,
            updatedAtIso: null,
            inProgress: false,
            pinned: false,
            gitInfo: null,
            owner: null,
          },
        ],
      },
    );

    expect(merged.threads).toHaveLength(2);
    expect(merged.threads[0]?.title).toBe("A");
    expect(merged.threads[1]?.id).toBe("thread-b");
  });
});
