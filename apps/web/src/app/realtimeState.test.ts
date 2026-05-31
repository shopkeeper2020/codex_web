import { describe, expect, it } from "vitest";
import {
  acceptRealtimeThreadEvent,
  readRealtimeCacheVersion,
  readRealtimeServerInstance,
  readRealtimeThreadId,
  updateRealtimeServerInstance,
} from "./realtimeState";

describe("realtime state helpers", () => {
  it("reads thread ids and cache versions from official realtime payloads", () => {
    const event = {
      type: "official.threadStreamStateChanged",
      payload: {
        threadId: "thread-a",
        cacheVersion: 4,
      },
    };

    expect(readRealtimeThreadId(event)).toBe("thread-a");
    expect(readRealtimeCacheVersion(event)).toBe(4);
  });

  it("accepts newer cache versions and rejects stale realtime events", () => {
    const versions = new Map<string, number>();

    expect(
      acceptRealtimeThreadEvent(versions, {
        payload: { threadId: "thread-a", cacheVersion: 3 },
      }),
    ).toMatchObject({ accepted: true, threadId: "thread-a", cacheVersion: 3 });

    expect(
      acceptRealtimeThreadEvent(versions, {
        payload: { threadId: "thread-a", cacheVersion: 2 },
      }),
    ).toMatchObject({ accepted: false, threadId: "thread-a", cacheVersion: 2 });

    expect(
      acceptRealtimeThreadEvent(versions, {
        payload: { threadId: "thread-a", cacheVersion: 4 },
      }),
    ).toMatchObject({ accepted: true, threadId: "thread-a", cacheVersion: 4 });
  });

  it("accepts unversioned events because they cannot be ordered safely", () => {
    const versions = new Map<string, number>([["thread-a", 5]]);
    expect(
      acceptRealtimeThreadEvent(versions, {
        payload: { threadId: "thread-a" },
      }),
    ).toMatchObject({
      accepted: true,
      threadId: "thread-a",
      cacheVersion: null,
    });
  });

  it("accepts official archive events keyed by conversationId", () => {
    const versions = new Map<string, number>();

    expect(
      acceptRealtimeThreadEvent(versions, {
        type: "official.threadArchived",
        payload: { conversationId: "thread-archived" },
      }),
    ).toMatchObject({
      accepted: true,
      threadId: "thread-archived",
      cacheVersion: null,
    });

    expect(
      acceptRealtimeThreadEvent(versions, {
        type: "official.threadUnarchived",
        payload: { conversationId: "thread-archived" },
      }),
    ).toMatchObject({
      accepted: true,
      threadId: "thread-archived",
      cacheVersion: null,
    });
  });

  it("clears cached cacheVersions when a new backend websocket instance connects", () => {
    const versions = new Map<string, number>([["thread-a", 12]]);
    const firstConnection = {
      type: "connected",
      atIso: "2026-05-29T00:00:00.000Z",
      serverInstanceId: "server-a",
      serverStartedAtIso: "2026-05-29T00:00:00.000Z",
    };
    const secondConnection = {
      type: "connected",
      atIso: "2026-05-29T00:01:00.000Z",
      serverInstanceId: "server-b",
      serverStartedAtIso: "2026-05-29T00:01:00.000Z",
    };

    expect(readRealtimeServerInstance(firstConnection)).toBe("server-a");
    let currentServer = updateRealtimeServerInstance(
      versions,
      "",
      firstConnection,
    );
    expect(currentServer).toBe("server-a");
    expect(versions.get("thread-a")).toBe(12);

    currentServer = updateRealtimeServerInstance(
      versions,
      currentServer,
      secondConnection,
    );
    expect(currentServer).toBe("server-b");
    expect(versions.size).toBe(0);
    expect(
      acceptRealtimeThreadEvent(versions, {
        payload: { threadId: "thread-a", cacheVersion: 1 },
      }),
    ).toMatchObject({ accepted: true, cacheVersion: 1 });
  });
});
