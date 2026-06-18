import { describe, expect, it } from "vitest";
import type { ThreadDetail } from "../api";
import {
  applyAppServerRealtimeNotification,
  readAppServerNotificationThreadId,
} from "./appServerRealtimeReducer";

function createDetail(threadId = "thread-a"): ThreadDetail {
  return {
    thread: {
      id: threadId,
      title: "Thread A",
      projectId: null,
      path: null,
      updatedAtIso: null,
      inProgress: false,
      pinned: false,
      gitInfo: null,
      owner: null,
    },
    goal: null,
    turns: [{ id: "turn-a", status: "active", items: [] }],
    subAgents: [],
    sideConversations: [],
  };
}

describe("app-server realtime reducer", () => {
  it("reads thread ids from direct and nested app-server params", () => {
    expect(
      readAppServerNotificationThreadId({ threadId: "thread-direct" }),
    ).toBe("thread-direct");
    expect(
      readAppServerNotificationThreadId({
        thread: { id: "thread-nested" },
      }),
    ).toBe("thread-nested");
  });

  it("streams assistant deltas into the active turn before completion", () => {
    const first = applyAppServerRealtimeNotification(
      createDetail(),
      "item/agentMessage/delta",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        itemId: "assistant-a",
        delta: "清晨",
      },
    );
    const second = applyAppServerRealtimeNotification(
      first,
      "item/agentMessage/delta",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        itemId: "assistant-a",
        delta: "的車站",
      },
    );

    expect(second?.turns[0]?.items).toMatchObject([
      {
        type: "agentMessage",
        id: "assistant-a",
        text: "清晨的車站",
        phase: null,
        memoryCitation: null,
      },
    ]);
  });

  it("keeps Desktop editing-like statuses active in realtime state", () => {
    const started = applyAppServerRealtimeNotification(
      createDetail(),
      "turn/started",
      {
        threadId: "thread-a",
        turn: { id: "turn-editing", status: { type: "editing" } },
      },
    );
    const statusChanged = applyAppServerRealtimeNotification(
      started,
      "thread/status/changed",
      {
        threadId: "thread-a",
        status: { type: "editing" },
      },
    );

    expect(started?.thread.inProgress).toBe(true);
    expect(
      started?.turns.find((turn) => turn.id === "turn-editing"),
    ).toMatchObject({
      status: "active",
    });
    expect(statusChanged?.thread.inProgress).toBe(true);
    expect(
      statusChanged?.turns.find((turn) => turn.id === "turn-editing"),
    ).toMatchObject({
      status: "active",
    });
  });

  it("preserves markdown whitespace while streaming assistant deltas", () => {
    let detail: ThreadDetail | null = createDetail();
    for (const delta of [
      "清单：",
      "\n\n",
      "- **stream-bold**\n",
      "- `inline-code`\n",
    ]) {
      detail = applyAppServerRealtimeNotification(
        detail,
        "item/agentMessage/delta",
        {
          threadId: "thread-a",
          turnId: "turn-a",
          itemId: "assistant-a",
          delta,
        },
      );
    }

    expect(detail?.turns[0]?.items).toMatchObject([
      {
        type: "agentMessage",
        id: "assistant-a",
        text: "清单：\n\n- **stream-bold**\n- `inline-code`\n",
        phase: null,
        memoryCitation: null,
      },
    ]);
    expect(detail?.turns[0]?.items[0]).not.toHaveProperty("status");
  });

  it("preserves markdown table line breaks from live assistant content arrays", () => {
    const detail = applyAppServerRealtimeNotification(
      createDetail(),
      "item/completed",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "agentMessage",
          id: "assistant-a",
          content: [
            { type: "text", text: "| 日期 | 北京 |" },
            { type: "text", text: "| --- | --- |" },
            { type: "text", text: "| 6月4日 | 多云 |" },
          ],
        },
      },
    );

    expect(detail?.turns[0]?.items).toMatchObject([
      {
        type: "agentMessage",
        id: "assistant-a",
        text: "| 日期 | 北京 |\n| --- | --- |\n| 6月4日 | 多云 |",
        phase: null,
        memoryCitation: null,
      },
    ]);
  });

  it("uses completed assistant items as the authoritative final text", () => {
    const streamed = applyAppServerRealtimeNotification(
      createDetail(),
      "item/agentMessage/delta",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        itemId: "assistant-a",
        delta: "partial",
      },
    );
    const completed = applyAppServerRealtimeNotification(
      streamed,
      "item/completed",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: { type: "agentMessage", id: "assistant-a", text: "final" },
      },
    );

    expect(completed?.turns[0]?.items).toMatchObject([
      {
        type: "agentMessage",
        id: "assistant-a",
        text: "final",
        phase: null,
        memoryCitation: null,
      },
    ]);
  });

  it("keeps richer official fields across same-id item updates", () => {
    const agentStarted = applyAppServerRealtimeNotification(
      createDetail(),
      "item/started",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "agentMessage",
          id: "assistant-a",
          text: "",
          phase: "final_answer",
          memoryCitation: { title: "live citation" },
        },
      },
    );
    const agentCompleted = applyAppServerRealtimeNotification(
      agentStarted,
      "item/completed",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "agentMessage",
          id: "assistant-a",
          text: "final",
          phase: null,
          memoryCitation: null,
        },
      },
    );
    const searchStarted = applyAppServerRealtimeNotification(
      agentCompleted,
      "item/started",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "webSearch",
          id: "search-a",
          query: "codex desktop ipc",
          action: { type: "search", query: "codex desktop ipc" },
        },
      },
    );
    const searchCompleted = applyAppServerRealtimeNotification(
      searchStarted,
      "item/completed",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "webSearch",
          id: "search-a",
          query: "codex desktop ipc",
          action: null,
        },
      },
    );

    expect(searchCompleted?.turns[0]?.items).toMatchObject([
      {
        type: "agentMessage",
        id: "assistant-a",
        text: "final",
        phase: "final_answer",
        memoryCitation: { title: "live citation" },
      },
      {
        type: "webSearch",
        id: "search-a",
        query: "codex desktop ipc",
        action: { type: "search", query: "codex desktop ipc" },
      },
    ]);
  });

  it("normalizes live tool items before polling refreshes thread detail", () => {
    const first = applyAppServerRealtimeNotification(
      createDetail(),
      "item/started",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "mcpToolOutput",
          id: "tool-a",
          name: "weather.lookup",
          output: "南京 29C",
        },
      },
    );
    const second = applyAppServerRealtimeNotification(first, "item/completed", {
      threadId: "thread-a",
      turnId: "turn-a",
      item: {
        type: "webSearch",
        id: "search-a",
        query: "南京天气",
        results: [{ text: "未来一周有雨" }],
        status: "completed",
      },
    });

    expect(second?.turns[0]?.items).toMatchObject([
      {
        type: "mcpToolCall",
        id: "tool-a",
        server: "weather.lookup",
        tool: "mcpToolOutput",
        result: "南京 29C",
        status: "inProgress",
      },
      {
        type: "webSearch",
        id: "search-a",
        query: "南京天气",
        results: [{ text: "未来一周有雨" }],
        status: "completed",
        action: null,
      },
    ]);
    expect(second?.turns[0]?.items[1]).toHaveProperty("status", "completed");
  });

  it("does not synthesize status for statusless completed web search items", () => {
    const detail = applyAppServerRealtimeNotification(
      createDetail(),
      "item/completed",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "webSearch",
          id: "search-a",
          query: "南京天气",
          action: null,
        },
      },
    );

    expect(detail?.turns[0]?.items).toMatchObject([
      {
        type: "webSearch",
        id: "search-a",
        query: "南京天气",
        action: null,
      },
    ]);
    expect(detail?.turns[0]?.items[0]).not.toHaveProperty("status");
  });

  it("normalizes started web search items before completion", () => {
    const detail = applyAppServerRealtimeNotification(
      createDetail(),
      "item/started",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "webSearch",
          id: "search-a",
          action: {
            type: "openPage",
            url: "https://m.nmc.cn/publish/forecast/AGD/shenzhen.html",
          },
        },
      },
    );

    expect(detail?.turns[0]?.items).toMatchObject([
      {
        type: "webSearch",
        id: "search-a",
        query: "https://m.nmc.cn/publish/forecast/AGD/shenzhen.html",
        action: {
          type: "openPage",
          url: "https://m.nmc.cn/publish/forecast/AGD/shenzhen.html",
        },
      },
    ]);
    expect(detail?.turns[0]?.items[0]).not.toHaveProperty("status");
  });

  it("waits for official user items instead of adopting pending turns", () => {
    const pendingDetail: ThreadDetail = {
      ...createDetail(),
      thread: { ...createDetail().thread, inProgress: true },
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
    const started = applyAppServerRealtimeNotification(
      pendingDetail,
      "turn/started",
      {
        threadId: "thread-a",
        turn: { id: "turn-official", status: "inProgress" },
      },
    );
    const userStarted = applyAppServerRealtimeNotification(
      started,
      "item/started",
      {
        threadId: "thread-a",
        turnId: "turn-official",
        item: {
          type: "userMessage",
          id: "official-user-1",
          content: [{ type: "text", text: "再整理北京的。" }],
        },
      },
    );

    expect(started?.turns).toEqual([
      {
        id: "turn-official",
        status: "active",
        items: [],
      },
    ]);
    expect(userStarted?.turns).toMatchObject([
      {
        id: "turn-official",
        status: "active",
        items: [
          {
            type: "userMessage",
            id: "official-user-1",
            clientId: null,
            content: [{ type: "text", text: "再整理北京的。" }],
          },
        ],
      },
    ]);
  });

  it("keeps a context compaction item active until thread compaction completes", () => {
    const started = applyAppServerRealtimeNotification(
      {
        ...createDetail(),
        thread: { ...createDetail().thread, inProgress: true },
        turns: [],
      },
      "item/started",
      {
        threadId: "thread-a",
        turnId: "turn-compact",
        item: {
          type: "contextCompaction",
          id: "compact-1",
        },
      },
    );
    const completed = applyAppServerRealtimeNotification(
      started,
      "item/completed",
      {
        threadId: "thread-a",
        turnId: "turn-compact",
        item: {
          type: "contextCompaction",
          id: "compact-1",
        },
      },
    );

    expect(started?.thread.inProgress).toBe(true);
    expect(started?.turns.at(-1)).toMatchObject({
      id: "turn-compact",
      status: "active",
      items: [{ type: "contextCompaction", id: "compact-1" }],
    });
    expect(completed?.thread.inProgress).toBe(true);
    expect(completed?.turns.at(-1)).toMatchObject({
      id: "turn-compact",
      status: "active",
      items: [{ type: "contextCompaction", id: "compact-1" }],
    });
  });

  it("settles the active turn when thread compaction completes", () => {
    const detail = applyAppServerRealtimeNotification(
      {
        ...createDetail(),
        thread: { ...createDetail().thread, inProgress: true },
        turns: [{ id: "turn-compact", status: "active", items: [] }],
      },
      "thread/compacted",
      {
        threadId: "thread-a",
        turnId: "turn-compact",
      },
    );

    expect(detail?.thread.inProgress).toBe(false);
    expect(detail?.turns).toEqual([
      {
        id: "turn-compact",
        status: "completed",
        items: [
          {
            type: "contextCompaction",
            id: "context-compaction-turn-compact",
          },
        ],
      },
    ]);
  });

  it("ignores notifications for other threads", () => {
    const detail = createDetail("thread-a");

    expect(
      applyAppServerRealtimeNotification(detail, "item/agentMessage/delta", {
        threadId: "thread-b",
        turnId: "turn-a",
        itemId: "assistant-a",
        delta: "ignored",
      }),
    ).toBeNull();
  });
});
