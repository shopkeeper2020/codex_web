import type { ThreadDetail } from "@codex-web/domain";
import { describe, expect, it } from "vitest";
import { mergeExternalThreadDetailIntoTabs } from "./rightSidebarExternalTabs";

function detail(id: string, inProgress: boolean): ThreadDetail {
  return {
    thread: {
      id,
      title: "Heisenberg",
      projectId: null,
      path: null,
      workspaceKind: "projectless",
      updatedAtIso: "2026-06-11T12:00:00.000Z",
      inProgress,
      pinned: false,
      gitInfo: null,
      owner: null,
    },
    goal: null,
    tokenUsage: null,
    turns: [{ id: "turn-1", status: "active", items: [] }],
    subAgents: [],
    sideConversations: [],
  };
}

describe("external right sidebar tabs", () => {
  it("merges fresh child thread detail into open external chat tabs", () => {
    const tabs = [
      {
        id: "tab-child",
        type: "chat",
        title: "Child",
        sideConversationId: "thread-child",
        sideConversation: null,
        externalThread: true,
      },
      {
        id: "tab-local",
        type: "chat",
        title: "Local side chat",
        sideConversationId: "side-local",
        sideConversation: null,
        externalThread: false,
      },
    ];

    const next = mergeExternalThreadDetailIntoTabs(
      tabs,
      detail("thread-child", true),
    );

    expect(next[0]).toMatchObject({
      id: "tab-child",
      title: "Child",
      threadId: "thread-child",
      sideConversation: {
        id: "thread-child",
        title: "Child",
        inProgress: true,
        turnCount: 1,
        turns: [{ id: "turn-1" }],
      },
    });
    expect(next[1]).toBe(tabs[1]);
  });
});
