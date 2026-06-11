import { normalizeOfficialConversationState } from "@codex-web/domain";
import type { OfficialThreadStreamState } from "@codex-web/protocol";
import { describe, expect, it } from "vitest";
import { attachOfficialSideConversations } from "./sideConversations.js";

function streamState(input: {
  id: string;
  cacheVersion: number;
  updatedAtIso: string;
  sideConversation?: boolean;
  parentConversationId?: string | null;
  title?: string | null;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
  source?: string;
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
    revision: input.cacheVersion,
    lastBaseRevision: null,
    conversationState: {
      id: input.id,
      title: input.title ?? null,
      sideConversation: input.sideConversation,
      parentConversationId: input.parentConversationId ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      cwd: input.cwd ?? "C:\\workspace\\local-agent",
      source: input.source ?? "vscode",
      turns: input.turns ?? [],
    },
  };
}

describe("attachOfficialSideConversations", () => {
  it("projects explicitly linked official side conversations onto the main thread detail", () => {
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
      parentConversationId: "thread-main",
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
      parentConversationId: "thread-main",
      title: null,
      createdAt: 1780213627000,
      updatedAt: 1780213627000,
    });
    const staleSide = streamState({
      id: "side-stale",
      cacheVersion: 7_000,
      updatedAtIso: "2026-05-31T07:11:00.000Z",
      sideConversation: true,
      parentConversationId: "other-thread",
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
    ]);
    expect(hydrated?.sideConversations.map((side) => side.title)).toEqual([
      "ui和ux有什么区别？",
    ]);
    expect(hydrated?.sideConversations[0]?.turns[0]?.items).toMatchObject([
      { type: "userMessage" },
      { type: "agentMessage", text: "UI 是界面，UX 是体验。" },
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

  it("hides the injected side conversation boundary from empty side chats", () => {
    const main = streamState({
      id: "thread-main",
      cacheVersion: 10,
      updatedAtIso: "2026-05-31T08:53:00.000Z",
      createdAt: 1780208803000,
      updatedAt: 1780215746000,
    });
    const boundaryOnlySide = streamState({
      id: "side-boundary-only",
      cacheVersion: 11,
      updatedAtIso: "2026-05-31T08:54:00.000Z",
      sideConversation: true,
      parentConversationId: "thread-main",
      createdAt: 1780215965000,
      updatedAt: 1780215991661,
      turns: [
        {
          id: "turn-boundary",
          status: "completed",
          items: [
            {
              type: "userMessage",
              content: "Side conversation boundary.\n\nInherited context only.",
            },
          ],
        },
      ],
    });
    const detail = normalizeOfficialConversationState({
      threadId: main.threadId,
      ownerClientId: main.ownerClientId,
      cacheVersion: main.cacheVersion,
      updatedAtIso: main.updatedAtIso,
      isInProgress: false,
      activeTurnId: "",
      conversationState: main.conversationState,
    });

    const hydrated = attachOfficialSideConversations({
      detail,
      threadId: main.threadId,
      streamStates: [main, boundaryOnlySide],
    });

    expect(hydrated?.sideConversations).toEqual([]);
  });

  it("projects unlinked side conversations from the active main thread lifecycle", () => {
    const main = streamState({
      id: "thread-main",
      cacheVersion: 10_000,
      updatedAtIso: "2026-05-31T08:53:00.000Z",
      createdAt: 1780208803000,
      updatedAt: 1780215746000,
      turns: [
        {
          id: "turn-main",
          status: "completed",
          items: [
            {
              type: "userMessage",
              content: "修复 codex_web desktop 同步和 Windows 兼容问题",
            },
            {
              type: "agentMessage",
              text: "codex_web 的 desktop 同步、Windows 兼容和 app-server 路径已经检查。",
            },
          ],
        },
      ],
    });
    const currentSide = streamState({
      id: "side-current",
      cacheVersion: 9_970,
      updatedAtIso: "2026-05-31T08:52:00.000Z",
      sideConversation: true,
      title: null,
      createdAt: 1780215600000,
      updatedAt: 1780215700000,
      turns: [
        {
          id: "turn-side",
          status: "completed",
          items: [
            {
              type: "userMessage",
              content:
                "codex_web desktop 同步和 Windows 兼容路径在 Mac 上运行吗？",
            },
            {
              type: "agentMessage",
              text:
                "codex_web 依赖 Node、pnpm 和 desktop app-server，Windows 兼容路径与同步问题在 Mac 都可以运行。",
            },
          ],
        },
      ],
    });
    const detail = normalizeOfficialConversationState({
      threadId: main.threadId,
      ownerClientId: main.ownerClientId,
      cacheVersion: main.cacheVersion,
      updatedAtIso: main.updatedAtIso,
      isInProgress: false,
      activeTurnId: "",
      conversationState: main.conversationState,
    });

    const hydrated = attachOfficialSideConversations({
      detail,
      threadId: main.threadId,
      streamStates: [main, currentSide],
    });

    expect(hydrated?.sideConversations.map((side) => side.id)).toEqual([
      "side-current",
    ]);
    expect(hydrated?.sideConversations[0]?.title).toBe(
      "codex_web desktop 同步和 Windows 兼容路径在 Mac ...",
    );
  });

  it("assigns unlinked side conversations to the best matching main thread only", () => {
    const codingMain = streamState({
      id: "thread-coding",
      cacheVersion: 10_000,
      updatedAtIso: "2026-05-31T15:56:00.000Z",
      createdAt: 1780236490000,
      updatedAt: 1780242719189,
      turns: [
        {
          id: "turn-coding",
          status: "completed",
          items: [
            {
              type: "userMessage",
              content: "修复 codex_web 在 desktop 新会话同步时报错的问题",
            },
            {
              type: "agentMessage",
              text: "已经检查 official IPC、app-server、side conversation 和前端 Composer。",
            },
          ],
        },
      ],
    });
    const weatherMain = streamState({
      id: "thread-weather",
      cacheVersion: 9_990,
      updatedAtIso: "2026-05-31T15:52:00.000Z",
      createdAt: 1780237585000,
      updatedAt: 1780237596000,
      turns: [
        {
          id: "turn-weather",
          status: "completed",
          items: [
            { type: "userMessage", content: "广州天气怎么样" },
            {
              type: "agentMessage",
              text: "广州今天多云间晴，最高约 32°C，后面几天闷热，注意防晒补水。",
            },
          ],
        },
      ],
    });
    const weatherSide = streamState({
      id: "side-weather",
      cacheVersion: 9_980,
      updatedAtIso: "2026-05-31T15:47:00.000Z",
      sideConversation: true,
      title: null,
      createdAt: 1780242346000,
      updatedAt: 1780242354560,
      turns: [
        {
          id: "turn-side-weather",
          status: "completed",
          items: [
            { type: "userMessage", content: "江苏呢？" },
            {
              type: "agentMessage",
              text: "江苏今天多云到晴，南京、苏州最高约 31-32°C，也要防晒补水。",
            },
          ],
        },
      ],
    });
    const codingDetail = normalizeOfficialConversationState({
      threadId: codingMain.threadId,
      ownerClientId: codingMain.ownerClientId,
      cacheVersion: codingMain.cacheVersion,
      updatedAtIso: codingMain.updatedAtIso,
      isInProgress: false,
      activeTurnId: "",
      conversationState: codingMain.conversationState,
    });
    const weatherDetail = normalizeOfficialConversationState({
      threadId: weatherMain.threadId,
      ownerClientId: weatherMain.ownerClientId,
      cacheVersion: weatherMain.cacheVersion,
      updatedAtIso: weatherMain.updatedAtIso,
      isInProgress: false,
      activeTurnId: "",
      conversationState: weatherMain.conversationState,
    });

    const codingHydrated = attachOfficialSideConversations({
      detail: codingDetail,
      threadId: codingMain.threadId,
      streamStates: [codingMain, weatherMain, weatherSide],
    });
    const weatherHydrated = attachOfficialSideConversations({
      detail: weatherDetail,
      threadId: weatherMain.threadId,
      streamStates: [codingMain, weatherMain, weatherSide],
    });

    expect(codingHydrated?.sideConversations).toEqual([]);
    expect(weatherHydrated?.sideConversations.map((side) => side.id)).toEqual([
      "side-weather",
    ]);
  });

  it("does not infer side conversation ownership from cwd alone", () => {
    const main = streamState({
      id: "thread-main",
      cacheVersion: 10_000,
      updatedAtIso: "2026-05-31T08:53:00.000Z",
      createdAt: 1780208803000,
      updatedAt: 1780215746000,
    });
    const sameProjectSide = streamState({
      id: "side-same-project",
      cacheVersion: 8_000,
      updatedAtIso: "2026-05-31T08:54:00.000Z",
      sideConversation: true,
      title: "belongs elsewhere",
      createdAt: 1780215965000,
      updatedAt: 1780215991661,
      turns: [
        {
          id: "turn-side",
          status: "completed",
          items: [{ type: "userMessage", content: "wrong side" }],
        },
      ],
    });
    const detail = normalizeOfficialConversationState({
      threadId: main.threadId,
      ownerClientId: main.ownerClientId,
      cacheVersion: main.cacheVersion,
      updatedAtIso: main.updatedAtIso,
      isInProgress: false,
      activeTurnId: "",
      conversationState: main.conversationState,
    });

    const hydrated = attachOfficialSideConversations({
      detail,
      threadId: main.threadId,
      streamStates: [main, sameProjectSide],
    });

    expect(hydrated?.sideConversations).toEqual([]);
  });
});
