import { normalizeOfficialConversationState } from "@codex-web/domain";
import type { OfficialThreadStreamState } from "@codex-web/protocol";
import { describe, expect, it } from "vitest";
import { attachOfficialSideConversations } from "./sideConversations.js";

function streamState(input: {
  id: string;
  cacheVersion: number;
  updatedAtIso: string;
  sideConversation?: boolean;
  title?: string | null;
  createdAt: number;
  updatedAt: number;
  turns?: unknown[];
}): OfficialThreadStreamState {
  return {
    threadId: input.id,
    conversationId: input.id,
    hostId: "local",
    ownerClientId: "desktop-client",
    sourceClientId: "desktop-client",
    cacheVersion: input.cacheVersion,
    updatedAtIso: input.updatedAtIso,
    isInProgress: false,
    activeTurnId: "",
    changeType: "snapshot",
    conversationState: {
      id: input.id,
      title: input.title ?? null,
      sideConversation: input.sideConversation,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      cwd: "C:\\workspace\\local-agent",
      source: "vscode",
      turns: input.turns ?? [],
    },
  };
}

describe("attachOfficialSideConversations", () => {
  it("projects recent official side conversations onto the main thread detail", () => {
    const main = streamState({
      id: "thread-main",
      cacheVersion: 10_000,
      updatedAtIso: "2026-05-31T08:53:00.000Z",
      createdAt: 1780208803000,
      updatedAt: 1780215746000,
      turns: [{ id: "turn-main", status: "active", items: [] }],
    });
    const namedSide = streamState({
      id: "side-named",
      cacheVersion: 9_900,
      updatedAtIso: "2026-05-31T08:30:00.000Z",
      sideConversation: true,
      title: null,
      createdAt: 1780215965000,
      updatedAt: 1780215991661,
      turns: [
        {
          id: "turn-side",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "side-user",
              content: [{ type: "text", text: "ui和ux有什么区别？\n" }],
            },
            {
              type: "agentMessage",
              id: "side-assistant",
              text: "UI 是界面，UX 是体验。",
            },
          ],
        },
      ],
    });
    const blankSide = streamState({
      id: "side-blank",
      cacheVersion: 9_850,
      updatedAtIso: "2026-05-31T08:21:00.000Z",
      sideConversation: true,
      title: null,
      createdAt: 1780213627000,
      updatedAt: 1780213627000,
    });
    const staleSide = streamState({
      id: "side-stale",
      cacheVersion: 7_000,
      updatedAtIso: "2026-05-31T07:11:00.000Z",
      sideConversation: true,
      title: null,
      createdAt: 1780209113000,
      updatedAt: 1780209122634,
      turns: [
        {
          id: "turn-stale",
          status: "completed",
          items: [{ type: "userMessage", content: "old side" }],
        },
      ],
    });
    const detail = normalizeOfficialConversationState({
      threadId: main.threadId,
      ownerClientId: main.ownerClientId,
      cacheVersion: main.cacheVersion,
      updatedAtIso: main.updatedAtIso,
      isInProgress: true,
      activeTurnId: "turn-main",
      conversationState: main.conversationState,
    });

    const hydrated = attachOfficialSideConversations({
      detail,
      threadId: main.threadId,
      streamStates: [main, namedSide, blankSide, staleSide],
    });

    expect(hydrated?.sideConversations.map((side) => side.id)).toEqual([
      "side-named",
      "side-blank",
    ]);
    expect(hydrated?.sideConversations.map((side) => side.title)).toEqual([
      "ui和ux有什么区别？",
      "侧边聊天 2",
    ]);
    expect(hydrated?.sideConversations[0]?.turns[0]?.items).toMatchObject([
      { type: "user", text: "ui和ux有什么区别？" },
      { type: "assistant", text: "UI 是界面，UX 是体验。" },
    ]);
  });

  it("does not attach nested side conversations when reading a side conversation itself", () => {
    const side = streamState({
      id: "side-current",
      cacheVersion: 1,
      updatedAtIso: "2026-05-31T08:00:00.000Z",
      sideConversation: true,
      title: null,
      createdAt: 1780213627000,
      updatedAt: 1780213627000,
    });
    const detail = normalizeOfficialConversationState({
      threadId: side.threadId,
      ownerClientId: side.ownerClientId,
      cacheVersion: side.cacheVersion,
      updatedAtIso: side.updatedAtIso,
      isInProgress: false,
      activeTurnId: "",
      conversationState: side.conversationState,
    });

    const hydrated = attachOfficialSideConversations({
      detail,
      threadId: side.threadId,
      streamStates: [side],
    });

    expect(hydrated?.sideConversations).toEqual([]);
  });
});
