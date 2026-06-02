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
