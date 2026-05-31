import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

class FakeAppServer {
  readonly calls: Array<{ method: string; params?: unknown }> = [];

  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}

  async threadGoalSet(params: {
    threadId: string;
    objective?: string;
    status?: "active" | "paused";
  }): Promise<unknown> {
    this.calls.push({ method: "thread/goal/set", params });
    return {
      goal: {
        threadId: params.threadId,
        objective: params.objective ?? "Existing objective",
        status: params.status ?? "active",
        tokenBudget: null,
        tokensUsed: 42,
        timeUsedSeconds: 90,
      },
    };
  }

  async threadGoalClear(params: { threadId: string }): Promise<unknown> {
    this.calls.push({ method: "thread/goal/clear", params });
    return { ok: true };
  }

  async threadRead(params: {
    threadId: string;
    includeTurns: boolean;
  }): Promise<unknown> {
    this.calls.push({ method: "thread/read", params });
    return {
      thread: {
        id: params.threadId,
        name: "Goal Thread",
        cwd: "C:\\workspace\\codex_web",
        updatedAt: "2026-05-31T00:00:00.000Z",
        turns: [],
      },
    };
  }

  async rpc(): Promise<unknown> {
    return { ok: true };
  }

  async turnStart(): Promise<unknown> {
    return { ok: true };
  }

  async turnSteer(): Promise<unknown> {
    return { ok: true };
  }

  async turnInterrupt(): Promise<unknown> {
    return { ok: true };
  }

  async threadCompactStart(): Promise<unknown> {
    return { ok: true };
  }
}

type Harness = {
  context: ServerContext;
  appServer: FakeAppServer;
  root: string;
};

const harnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-thread-goal-"));
  const officialIpc = new OfficialIpcBridge("");
  (officialIpc as unknown as { clientId: string }).clientId = "web-test";
  const appServer = new FakeAppServer();
  const context = await createServer(root, {
    officialIpc,
    appServer: appServer as unknown as CodexAppServerProcess,
  });
  const harness = { context, appServer, root };
  harnesses.push(harness);
  return harness;
}

async function closeHarness(harness: Harness): Promise<void> {
  await harness.context.app.close();
  rmSync(harness.root, { recursive: true, force: true });
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await closeHarness(harness);
  }
});

describe("thread goal route", () => {
  it("sets a Desktop thread goal through app-server and returns hydrated detail", async () => {
    const { context, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-goal-set",
      payload: {
        threadId: "thread-goal",
        objective: "Keep Web and Desktop goals in sync",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        ok: true,
        mode: "app-server",
        goal: {
          threadId: "thread-goal",
          objective: "Keep Web and Desktop goals in sync",
          status: "active",
          tokensUsed: 42,
          timeUsedSeconds: 90,
        },
        thread: {
          id: "thread-goal",
          title: "Goal Thread",
        },
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/goal/set",
        params: {
          threadId: "thread-goal",
          objective: "Keep Web and Desktop goals in sync",
        },
      },
      {
        method: "thread/read",
        params: { threadId: "thread-goal", includeTurns: true },
      },
    ]);
  });

  it("clears a Desktop thread goal through app-server", async () => {
    const { context, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "POST",
      url: "/api/domain/thread-goal-clear",
      payload: { threadId: "thread-goal" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        ok: true,
        mode: "app-server",
        goal: null,
        thread: {
          id: "thread-goal",
          title: "Goal Thread",
        },
      },
    });
    expect(appServer.calls).toEqual([
      {
        method: "thread/goal/clear",
        params: { threadId: "thread-goal" },
      },
      {
        method: "thread/read",
        params: { threadId: "thread-goal", includeTurns: true },
      },
    ]);
  });
});
