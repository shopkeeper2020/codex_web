import { describe, expect, it } from "vitest";
import {
  buildSyncDoctorReport,
  countUserMessageOccurrences,
  formatSyncDoctorResult,
  parseSyncDoctorArgs,
  runSyncDoctor,
} from "./syncDoctor.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sync doctor", () => {
  it("parses default options from environment and explicit CLI args", () => {
    const parsed = parseSyncDoctorArgs(
      [
        "--url",
        "http://127.0.0.1:18930/",
        "--thread",
        "thread-1",
        "--send",
        "--text",
        "marker",
        "--timeout-ms",
        "10",
        "--poll-ms",
        "1",
      ],
      {},
      new Date("2026-05-29T00:00:00.000Z"),
    );

    expect(parsed).toEqual({
      kind: "options",
      options: {
        baseUrl: "http://127.0.0.1:18930",
        threadId: "thread-1",
        action: "start",
        send: true,
        turnId: null,
        text: "marker",
        expectMode: "official-follower",
        timeoutMs: 10,
        pollIntervalMs: 1,
        json: false,
        reportPath: null,
        attachmentPath: null,
      },
    });
  });

  it("parses an optional sanitized report path", () => {
    const parsed = parseSyncDoctorArgs(
      ["--thread", "thread-1", "--report", "data\\sync-report.json"],
      {},
      new Date("2026-05-29T00:00:00.000Z"),
    );

    expect(parsed).toMatchObject({
      kind: "options",
      options: {
        action: "diagnose",
        reportPath: "data\\sync-report.json",
      },
    });
  });

  it("keeps --json diagnose mode read-only and does not send a turn", async () => {
    const parsed = parseSyncDoctorArgs(
      ["--thread", "thread-1", "--json"],
      {},
      new Date("2026-05-29T00:00:00.000Z"),
    );
    expect(parsed).toMatchObject({
      kind: "options",
      options: { action: "diagnose", json: true, send: false },
    });
    if (parsed.kind !== "options") throw new Error("expected options");

    const calls: Array<{ path: string; method: string }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ path: url.pathname, method: init?.method ?? "GET" });

      if (url.pathname === "/health") return jsonResponse({ ok: true });
      if (url.pathname === "/api/protocol/compatibility") {
        return jsonResponse({
          data: {
            summary: { state: "compatible", reason: null },
            officialIpc: { connected: true },
            appServer: { initialized: true },
          },
        });
      }
      if (url.pathname === "/api/sync/readiness") {
        expect(url.searchParams.get("threadId")).toBe("thread-1");
        return jsonResponse({
          data: {
            checks: [
              {
                id: "official-ipc",
                status: "pass",
                label: "Official IPC",
                detail: "connected",
              },
            ],
          },
        });
      }
      return jsonResponse({ error: "unexpected call" }, 500);
    };

    const result = await runSyncDoctor(parsed.options, fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.action).toBe("diagnose");
    expect(result.marker).toBeNull();
    expect(result.followerRequestFound).toBeNull();
    expect(result.markerOccurrences).toBeNull();
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      ok: true,
      action: "diagnose",
      threadId: "thread-1",
      marker: null,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /health",
      "GET /api/protocol/compatibility",
      "GET /api/sync/readiness",
    ]);
  });

  it("counts matching user message occurrences in domain detail", () => {
    expect(
      countUserMessageOccurrences(
        {
          data: {
            turns: [
              {
                items: [
                  { id: "u1", type: "user", text: "hello marker" },
                  { id: "a1", type: "assistant", text: "marker" },
                ],
              },
              { items: [{ id: "u2", type: "user", text: "marker again" }] },
            ],
          },
        },
        "marker",
      ),
    ).toBe(2);
  });

  it("reports turn-start failure without polling follower status or thread detail", async () => {
    const calls: Array<{ path: string; method: string }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ path: url.pathname, method: init?.method ?? "GET" });

      if (url.pathname === "/health") return jsonResponse({ ok: true });
      if (url.pathname === "/api/protocol/compatibility") {
        return jsonResponse({
          data: {
            summary: { state: "compatible", reason: null },
            officialIpc: { connected: true },
            appServer: { initialized: true },
          },
        });
      }
      if (url.pathname === "/api/sync/readiness") {
        return jsonResponse({
          data: {
            checks: [
              {
                id: "official-ipc",
                status: "pass",
                label: "Official IPC",
                detail: "connected",
              },
            ],
          },
        });
      }
      if (url.pathname === "/api/domain/turn-start") {
        return jsonResponse({ error: "official-owner-unavailable" }, 409);
      }
      return jsonResponse({ error: "unexpected poll" }, 500);
    };

    const result = await runSyncDoctor(
      {
        baseUrl: "http://127.0.0.1:18930",
        threadId: "thread-1",
        action: "start",
        send: true,
        turnId: null,
        text: "marker",
        expectMode: "official-follower",
        timeoutMs: 10,
        pollIntervalMs: 1,
        json: true,
        reportPath: null,
        attachmentPath: null,
      },
      fetchImpl,
    );

    expect(result.ok).toBe(false);
    expect(result.turnStartMode).toBeNull();
    expect(result.followerRequestFound).toBeNull();
    expect(result.markerOccurrences).toBeNull();
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "turn-start",
        status: "fail",
        detail: "HTTP 409: official-owner-unavailable",
      }),
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /health",
      "GET /api/protocol/compatibility",
      "GET /api/sync/readiness",
      "POST /api/domain/turn-start",
    ]);
  });

  it("runs a successful official-follower smoke against mocked APIs", async () => {
    const calls: Array<{ path: string; method: string }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ path: url.pathname, method: init?.method ?? "GET" });

      if (url.pathname === "/health") return jsonResponse({ ok: true });
      if (url.pathname === "/api/protocol/compatibility") {
        return jsonResponse({
          data: {
            summary: { state: "compatible", reason: null },
            officialIpc: { connected: true },
            appServer: { initialized: true },
          },
        });
      }
      if (url.pathname === "/api/sync/readiness") {
        return jsonResponse({
          data: {
            checks: [
              {
                id: "official-ipc",
                status: "pass",
                label: "Official IPC",
                detail: "connected",
              },
            ],
          },
        });
      }
      if (url.pathname === "/api/domain/turn-start") {
        return jsonResponse({ data: { mode: "official-follower" } });
      }
      if (url.pathname === "/api/official-ipc/status") {
        return jsonResponse({
          data: {
            recentFollowerRequests: [
              {
                method: "thread-follower-start-turn",
                threadId: "thread-1",
                result: "success",
              },
            ],
          },
        });
      }
      if (url.pathname === "/api/domain/thread-detail") {
        return jsonResponse({
          data: {
            turns: [{ items: [{ id: "u1", type: "user", text: "marker" }] }],
          },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    };

    const result = await runSyncDoctor(
      {
        baseUrl: "http://127.0.0.1:18930",
        threadId: "thread-1",
        action: "start",
        send: true,
        turnId: null,
        text: "marker",
        expectMode: "official-follower",
        timeoutMs: 10,
        pollIntervalMs: 1,
        json: false,
        reportPath: null,
        attachmentPath: null,
      },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(result.followerRequestFound).toBe(true);
    expect(result.markerOccurrences).toBe(1);
    expect(formatSyncDoctorResult(result)).toContain(
      "codex_web sync doctor: PASS",
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain(
      "POST /api/domain/turn-start",
    );
  });

  it("redacts marker text from sanitized sync doctor reports", async () => {
    const result = await runSyncDoctor(
      {
        baseUrl: "http://127.0.0.1:18930",
        threadId: "thread-1",
        action: "start",
        send: true,
        turnId: null,
        text: "SECRET marker body should not be written to report",
        expectMode: "official-follower",
        timeoutMs: 10,
        pollIntervalMs: 1,
        json: false,
        reportPath: "data\\tmp\\sync-report.json",
        attachmentPath: null,
      },
      async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        if (url.pathname === "/health") return jsonResponse({ ok: true });
        if (url.pathname === "/api/protocol/compatibility") {
          return jsonResponse({
            data: {
              summary: { state: "compatible", reason: null },
              officialIpc: { connected: true },
              appServer: { initialized: true },
            },
          });
        }
        if (url.pathname === "/api/sync/readiness") {
          return jsonResponse({
            data: {
              checks: [
                {
                  id: "official-ipc",
                  status: "pass",
                  label: "Official IPC",
                  detail: "connected",
                },
              ],
            },
          });
        }
        if (url.pathname === "/api/domain/turn-start") {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            text: "SECRET marker body should not be written to report",
          });
          return jsonResponse({ data: { mode: "official-follower" } });
        }
        if (url.pathname === "/api/official-ipc/status") {
          return jsonResponse({
            data: {
              recentFollowerRequests: [
                {
                  method: "thread-follower-start-turn",
                  threadId: "thread-1",
                  result: "success",
                },
              ],
            },
          });
        }
        if (url.pathname === "/api/domain/thread-detail") {
          return jsonResponse({
            data: {
              turns: [
                {
                  items: [
                    {
                      id: "u1",
                      type: "user",
                      text: "SECRET marker body should not be written to report",
                    },
                  ],
                },
              ],
            },
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      },
    );

    const report = buildSyncDoctorReport(result);
    const reportText = JSON.stringify({ result: report });
    expect(report.markerRedacted).toBe(true);
    expect(reportText).not.toContain("SECRET marker body");
    expect(report).not.toHaveProperty("marker");
    expect(report.markerOccurrences).toBe(1);
  });

  it("uses readiness activeTurnId for a successful steer check", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown);

      if (url.pathname === "/health") return jsonResponse({ ok: true });
      if (url.pathname === "/api/protocol/compatibility") {
        return jsonResponse({
          data: {
            summary: { state: "compatible", reason: null },
            officialIpc: { connected: true },
            appServer: { initialized: true },
          },
        });
      }
      if (url.pathname === "/api/sync/readiness") {
        return jsonResponse({
          data: {
            thread: { activeTurnId: "turn-active" },
            checks: [
              {
                id: "official-ipc",
                status: "pass",
                label: "Official IPC",
                detail: "connected",
              },
            ],
          },
        });
      }
      if (url.pathname === "/api/domain/turn-steer") {
        return jsonResponse({ data: { mode: "official-follower" } });
      }
      if (url.pathname === "/api/official-ipc/status") {
        return jsonResponse({
          data: {
            recentFollowerRequests: [
              {
                method: "thread-follower-steer-turn",
                threadId: "thread-1",
                result: "success",
              },
            ],
          },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    };

    const result = await runSyncDoctor(
      {
        baseUrl: "http://127.0.0.1:18930",
        threadId: "thread-1",
        action: "steer",
        send: false,
        turnId: null,
        text: "guide",
        expectMode: "official-follower",
        timeoutMs: 10,
        pollIntervalMs: 1,
        json: false,
        reportPath: null,
        attachmentPath: null,
      },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(result.turnId).toBe("turn-active");
    expect(result.actionMode).toBe("official-follower");
    expect(result.followerRequestFound).toBe(true);
    expect(bodies).toContainEqual({
      threadId: "thread-1",
      expectedTurnId: "turn-active",
      text: "guide",
    });
  });
});
