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

    expect(second?.turns[0]?.items).toEqual([
      { type: "assistant", id: "assistant-a", text: "清晨的車站" },
    ]);
  });

  it("preserves markdown whitespace while streaming assistant deltas", () => {
    let detail: ThreadDetail | null = createDetail();
    for (const delta of ["清单：", "\n\n", "- **stream-bold**\n", "- `inline-code`\n"]) {
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

    expect(detail?.turns[0]?.items).toEqual([
      {
        type: "assistant",
        id: "assistant-a",
        text: "清单：\n\n- **stream-bold**\n- `inline-code`\n",
      },
    ]);
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

    expect(detail?.turns[0]?.items).toEqual([
      {
        type: "assistant",
        id: "assistant-a",
        text: "| 日期 | 北京 |\n| --- | --- |\n| 6月4日 | 多云 |",
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

    expect(completed?.turns[0]?.items).toEqual([
      { type: "assistant", id: "assistant-a", text: "final" },
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
    const second = applyAppServerRealtimeNotification(
      first,
      "item/completed",
      {
        threadId: "thread-a",
        turnId: "turn-a",
        item: {
          type: "webSearch",
          id: "search-a",
          query: "南京天气",
          results: [{ text: "未来一周有雨" }],
          status: "completed",
        },
      },
    );

    expect(second?.turns[0]?.items).toEqual([
      {
        type: "toolOutput",
        id: "tool-a",
        title: "weather.lookup",
        text: "南京 29C",
        status: "active",
        rawType: "mcpToolOutput",
      },
      {
        type: "toolOutput",
        id: "search-a",
        title: "Web search: 南京天气",
        text: "未来一周有雨",
        status: "completed",
        rawType: "webSearch",
      },
    ]);
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

    expect(detail?.turns[0]?.items).toEqual([
      {
        type: "toolOutput",
        id: "search-a",
        title: "Web search: https://m.nmc.cn/publish/forecast/AGD/shenzhen.html",
        text: "",
        status: "active",
        rawType: "webSearch",
      },
    ]);
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
    expect(userStarted?.turns).toEqual([
      {
        id: "turn-official",
        status: "active",
        items: [
          { type: "user", id: "official-user-1", text: "再整理北京的。" },
        ],
      },
    ]);
  });

  it("ignores notifications for other threads", () => {
    const detail = createDetail("thread-a");

    expect(
      applyAppServerRealtimeNotification(
        detail,
        "item/agentMessage/delta",
        {
          threadId: "thread-b",
          turnId: "turn-a",
          itemId: "assistant-a",
          delta: "ignored",
        },
      ),
    ).toBeNull();
  });
});
