import { describe, expect, it } from "vitest";
import type { ThreadDetail } from "@codex-web/domain";
import { LocalLiveThreadStore } from "./localLiveThreadStore.js";

const initialDetail: ThreadDetail = {
  thread: {
    id: "thread-1",
    title: "Untitled",
    projectId: "C:\\workspace\\codex_web",
    path: "C:\\workspace\\codex_web",
    updatedAtIso: null,
    inProgress: false,
    pinned: false,
    gitInfo: null,
    owner: null,
  },
  goal: null,
  turns: [],
  subAgents: [],
  sideConversations: [],
};

describe("LocalLiveThreadStore", () => {
  it("reduces app-server assistant deltas into realtime domain detail", () => {
    const store = new LocalLiveThreadStore({
      isLocalOwner: (threadId) => threadId === "thread-1",
      readInitialDetail: () => initialDetail,
      readOwner: () => ({
        clientId: "web-client",
        kind: "web",
        source: "official-ipc",
      }),
    });

    const started = store.handle({
      method: "turn/started",
      atIso: "2026-06-02T00:00:00.000Z",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "inProgress" },
      },
    });
    const itemStarted = store.handle({
      method: "item/started",
      atIso: "2026-06-02T00:00:01.000Z",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", id: "assistant-1", text: "" },
      },
    });
    const delta = store.handle({
      method: "item/agentMessage/delta",
      atIso: "2026-06-02T00:00:02.000Z",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "你好",
      },
    });

    expect(started).toMatchObject({
      threadId: "thread-1",
      isInProgress: true,
      activeTurnId: "turn-1",
    });
    expect(itemStarted?.detail.turns[0]?.items).toEqual([
      { type: "assistant", id: "assistant-1", text: "" },
    ]);
    expect(delta?.detail.turns[0]?.items).toEqual([
      { type: "assistant", id: "assistant-1", text: "你好" },
    ]);
    expect(delta?.source).toBe("app-server-live");
  });

  it("preserves markdown whitespace in app-server assistant deltas", () => {
    const store = new LocalLiveThreadStore({
      isLocalOwner: (threadId) => threadId === "thread-1",
      readInitialDetail: () => initialDetail,
      readOwner: () => null,
    });

    store.handle({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "inProgress" },
      },
    });
    for (const delta of ["清单：", "\n\n", "- **stream-bold**\n", "- `inline-code`\n"]) {
      store.handle({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta,
        },
      });
    }
    const finalDelta = store.handle({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "结尾",
      },
    });

    expect(finalDelta?.detail.turns[0]?.items).toEqual([
      {
        type: "assistant",
        id: "assistant-1",
        text: "清单：\n\n- **stream-bold**\n- `inline-code`\n结尾",
      },
    ]);
  });

  it("normalizes live web search items instead of unknown placeholders", () => {
    const store = new LocalLiveThreadStore({
      isLocalOwner: (threadId) => threadId === "thread-1",
      readInitialDetail: () => initialDetail,
      readOwner: () => null,
    });

    const itemStarted = store.handle({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "webSearch",
          id: "search-1",
          action: {
            type: "openPage",
            url: "https://m.nmc.cn/publish/forecast/AGD/shenzhen.html",
          },
        },
      },
    });

    expect(itemStarted?.detail.turns[0]?.items).toEqual([
      {
        type: "toolOutput",
        id: "search-1",
        title: "Web search: https://m.nmc.cn/publish/forecast/AGD/shenzhen.html",
        text: "",
        status: null,
        rawType: "webSearch",
      },
    ]);
  });

  it("waits for the official user item instead of adopting pending turns", () => {
    const pendingDetail: ThreadDetail = {
      ...initialDetail,
      thread: { ...initialDetail.thread, inProgress: true },
      turns: [
        {
          id: "pending-client-user-1",
          status: "active",
          items: [
            { type: "user", id: "client-user-1", text: "再整理北京的。" },
          ],
        },
      ],
    };
    const store = new LocalLiveThreadStore({
      isLocalOwner: (threadId) => threadId === "thread-1",
      readInitialDetail: () => pendingDetail,
      readOwner: () => null,
    });

    const started = store.handle({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-official", status: "inProgress" },
      },
    });
    const userStarted = store.handle({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-official",
        item: {
          type: "userMessage",
          id: "official-user-1",
          content: [{ type: "text", text: "再整理北京的。" }],
        },
      },
    });

    expect(started?.detail.turns).toEqual([
      {
        id: "turn-official",
        status: "active",
        items: [],
      },
    ]);
    expect(userStarted?.detail.turns).toEqual([
      {
        id: "turn-official",
        status: "active",
        items: [
          { type: "user", id: "official-user-1", text: "再整理北京的。" },
        ],
      },
    ]);
  });

  it("does not track non-owned app-server notifications", () => {
    const store = new LocalLiveThreadStore({
      isLocalOwner: () => false,
      readInitialDetail: () => initialDetail,
      readOwner: () => null,
    });

    expect(
      store.handle({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "ignored",
        },
      }),
    ).toBeNull();
  });
});
