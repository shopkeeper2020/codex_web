import { Buffer } from "node:buffer";
import { expect, test, type APIRequestContext } from "@playwright/test";

const liveThreadId = process.env.LIVE_SYNC_THREAD_ID;
const liveText =
  process.env.LIVE_SYNC_TEXT ??
  `codex_web live sync smoke ${new Date().toISOString()}`;
const liveSteerText = process.env.LIVE_SYNC_STEER_TEXT;
const liveInterrupt = process.env.LIVE_SYNC_INTERRUPT === "1";
const liveAttachment = process.env.LIVE_SYNC_ATTACHMENT === "1";
const liveAttachmentText =
  process.env.LIVE_SYNC_ATTACHMENT_TEXT ??
  `codex_web live attachment ${new Date().toISOString()}`;
const liveTurnId = process.env.LIVE_SYNC_TURN_ID;
const expectedMode = process.env.LIVE_SYNC_EXPECT_MODE ?? "official-follower";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function countUserMessageOccurrences(payload: unknown, needle: string): number {
  const detail = asRecord(asRecord(payload)?.data);
  const turns = Array.isArray(detail?.turns) ? detail.turns : [];
  let count = 0;
  for (const turn of turns) {
    const turnRecord = asRecord(turn);
    const items = Array.isArray(turnRecord?.items) ? turnRecord.items : [];
    for (const item of items) {
      const itemRecord = asRecord(item);
      if (itemRecord?.type !== "user") continue;
      if (
        typeof itemRecord.text === "string" &&
        itemRecord.text.includes(needle)
      )
        count += 1;
    }
  }
  return count;
}

async function expectCompatibilityReady(request: APIRequestContext) {
  const compatibilityResponse = await request.get(
    "/api/protocol/compatibility",
  );
  expect(compatibilityResponse.ok()).toBeTruthy();
  const compatibility = (await compatibilityResponse.json()) as {
    data?: {
      officialIpc?: { connected?: boolean; clientId?: string | null };
      appServer?: { initialized?: boolean };
    };
  };
  expect(compatibility.data?.officialIpc?.connected).toBe(true);
  expect(compatibility.data?.officialIpc?.clientId).toBeTruthy();
  expect(compatibility.data?.appServer?.initialized).toBe(true);
}

async function readActiveTurnId(
  request: APIRequestContext,
  threadId: string,
): Promise<string> {
  if (liveTurnId) return liveTurnId;
  const readinessResponse = await request.get(
    `/api/sync/readiness?threadId=${encodeURIComponent(threadId)}`,
  );
  expect(readinessResponse.ok()).toBeTruthy();
  const readiness = (await readinessResponse.json()) as {
    data?: { thread?: { activeTurnId?: string | null } | null };
  };
  const activeTurnId = readiness.data?.thread?.activeTurnId;
  expect(
    activeTurnId,
    "expected sync readiness to expose an active turn id",
  ).toBeTruthy();
  return activeTurnId ?? "";
}

async function expectRecentFollowerSuccess(
  request: APIRequestContext,
  input: { method: string; threadId: string },
) {
  await expect
    .poll(
      async () => {
        const statusResponse = await request.get("/api/official-ipc/status");
        if (!statusResponse.ok()) return false;
        const status = (await statusResponse.json()) as {
          data?: {
            recentFollowerRequests?: Array<{
              method?: string;
              threadId?: string;
              result?: string;
            }>;
          };
        };
        return (
          status.data?.recentFollowerRequests?.some(
            (entry) =>
              entry.method === input.method &&
              entry.threadId === input.threadId &&
              entry.result === "success",
          ) ?? false
        );
      },
      {
        timeout: 15_000,
        message: `expected official IPC ${input.method} success for the live thread`,
      },
    )
    .toBe(true);
}

test.describe("codex_web live sync smoke", () => {
  test("sends through official follower and sees the new turn in Web detail", async ({
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "live sync smoke only runs once on desktop project",
    );
    test.skip(
      !liveThreadId,
      "Set LIVE_SYNC_THREAD_ID to run the opt-in live sync smoke test",
    );

    await expectCompatibilityReady(request);

    const response = await request.post("/api/domain/turn/start", {
      data: {
        threadId: liveThreadId,
        text: liveText,
      },
    });
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as { data?: { mode?: string } };
    expect(payload.data?.mode).toBe(expectedMode);

    await expectRecentFollowerSuccess(request, {
      method: "thread-follower-start-turn",
      threadId: liveThreadId,
    });

    await expect
      .poll(
        async () => {
          const detailResponse = await request.get(
            `/api/domain/thread/read?threadId=${encodeURIComponent(liveThreadId ?? "")}`,
          );
          if (!detailResponse.ok()) return 0;
          const detail = await detailResponse.json();
          return countUserMessageOccurrences(detail, liveText);
        },
        {
          timeout: 60_000,
          message:
            "expected the live marker text to appear exactly once in Web thread detail",
        },
      )
      .toBe(1);
  });

  test("steers an active turn through official follower", async ({
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "live sync steer only runs once on desktop project",
    );
    test.skip(
      !liveThreadId,
      "Set LIVE_SYNC_THREAD_ID to run the opt-in live sync steer test",
    );
    test.skip(
      !liveSteerText,
      "Set LIVE_SYNC_STEER_TEXT to send opt-in active-turn guidance",
    );

    await expectCompatibilityReady(request);
    const activeTurnId = await readActiveTurnId(request, liveThreadId ?? "");
    const response = await request.post("/api/domain/turn/steer", {
      data: {
        threadId: liveThreadId,
        expectedTurnId: activeTurnId,
        text: liveSteerText,
      },
    });
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as { data?: { mode?: string } };
    expect(payload.data?.mode).toBe(expectedMode);

    await expectRecentFollowerSuccess(request, {
      method: "thread-follower-steer-turn",
      threadId: liveThreadId ?? "",
    });
  });

  test("interrupts an active turn through official follower", async ({
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "live sync interrupt only runs once on desktop project",
    );
    test.skip(
      !liveThreadId,
      "Set LIVE_SYNC_THREAD_ID to run the opt-in live sync interrupt test",
    );
    test.skip(
      !liveInterrupt,
      "Set LIVE_SYNC_INTERRUPT=1 to run the opt-in interrupt test",
    );

    await expectCompatibilityReady(request);
    const activeTurnId = await readActiveTurnId(request, liveThreadId ?? "");
    const response = await request.post("/api/domain/turn/interrupt", {
      data: {
        threadId: liveThreadId,
        turnId: activeTurnId,
      },
    });
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as { data?: { mode?: string } };
    expect(payload.data?.mode).toBe(expectedMode);

    await expectRecentFollowerSuccess(request, {
      method: "thread-follower-interrupt-turn",
      threadId: liveThreadId ?? "",
    });
  });

  test("sends an uploaded attachment through official follower", async ({
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "live sync attachment only runs once on desktop project",
    );
    test.skip(
      !liveThreadId,
      "Set LIVE_SYNC_THREAD_ID to run the opt-in live sync attachment test",
    );
    test.skip(
      !liveAttachment,
      "Set LIVE_SYNC_ATTACHMENT=1 to upload and send an opt-in attachment",
    );

    await expectCompatibilityReady(request);

    const attachmentResponse = await request.post(
      `/api/attachments?threadId=${encodeURIComponent(liveThreadId ?? "")}`,
      {
        multipart: {
          file: {
            name: "codex-web-live-sync.txt",
            mimeType: "text/plain",
            buffer: Buffer.from(
              `codex_web live sync attachment fixture\n${liveAttachmentText}\n`,
              "utf8",
            ),
          },
        },
      },
    );
    expect(attachmentResponse.ok()).toBeTruthy();
    const attachmentPayload = (await attachmentResponse.json()) as {
      data?: { id?: string; filename?: string; threadId?: string | null };
    };
    const attachmentId = attachmentPayload.data?.id;
    expect(attachmentId).toBeTruthy();
    expect(attachmentPayload.data?.threadId).toBe(liveThreadId);

    const contentResponse = await request.get(
      `/api/attachments/${encodeURIComponent(attachmentId ?? "")}/content`,
    );
    expect(contentResponse.ok()).toBeTruthy();

    const response = await request.post("/api/domain/turn/start", {
      data: {
        threadId: liveThreadId,
        text: liveAttachmentText,
        attachmentIds: [attachmentId],
      },
    });
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as { data?: { mode?: string } };
    expect(payload.data?.mode).toBe(expectedMode);

    await expectRecentFollowerSuccess(request, {
      method: "thread-follower-start-turn",
      threadId: liveThreadId ?? "",
    });

    await expect
      .poll(
        async () => {
          const detailResponse = await request.get(
            `/api/domain/thread/read?threadId=${encodeURIComponent(liveThreadId ?? "")}`,
          );
          if (!detailResponse.ok()) return 0;
          const detail = await detailResponse.json();
          return countUserMessageOccurrences(detail, liveAttachmentText);
        },
        {
          timeout: 60_000,
          message:
            "expected the attachment marker text to appear exactly once in Web thread detail",
        },
      )
      .toBe(1);
  });
});
