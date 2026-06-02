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
