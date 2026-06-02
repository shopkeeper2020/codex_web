import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

class FakeAppServer {
  readonly calls: string[] = [];

  constructor(private readonly delayMs = 0) {}

  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}

  async accountRead(): Promise<unknown> {
    this.calls.push("account/read");
    if (this.delayMs > 0) await delay(this.delayMs);
    return {
      account: {
        type: "chatgpt",
        email: "user@example.test",
        planType: "plus",
      },
      requiresOpenaiAuth: false,
    };
  }

  async accountRateLimitsRead(): Promise<unknown> {
    this.calls.push("account/rateLimits/read");
    if (this.delayMs > 0) await delay(this.delayMs);
    return {
      rateLimits: {
        limitId: "primary",
        limitName: "Primary",
        planType: "plus",
        primary: {
          usedPercent: 12,
          resetsAt: 1_780_000_000,
          windowDurationMins: 300,
        },
        secondary: null,
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: "10",
        },
      },
    };
  }

  async configRequirementsRead(): Promise<unknown> {
    this.calls.push("configRequirements/read");
    if (this.delayMs > 0) await delay(this.delayMs);
    return { requirements: { openaiAuth: false } };
  }
}

type Harness = {
  context: ServerContext;
  appServer: FakeAppServer;
  root: string;
};

const harnesses: Harness[] = [];

async function createHarness(delayMs = 0): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-account-status-"));
  const officialIpc = new OfficialIpcBridge("");
  const appServer = new FakeAppServer(delayMs);
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

describe("account status route", () => {
  it("deduplicates concurrent official account reads and reuses the TTL cache", async () => {
    const { context, appServer } = await createHarness(10);

    const [firstResponse, secondResponse] = await Promise.all([
      context.app.inject({ method: "GET", url: "/api/account/status" }),
      context.app.inject({ method: "GET", url: "/api/account/status" }),
    ]);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toMatchObject({
      data: {
        account: {
          email: "user@example.test",
          planType: "plus",
        },
        source: "app-server",
      },
    });
    expect(appServer.calls).toEqual([
      "account/read",
      "account/rateLimits/read",
      "configRequirements/read",
    ]);

    const cachedResponse = await context.app.inject({
      method: "GET",
      url: "/api/account/status",
    });

    expect(cachedResponse.statusCode).toBe(200);
    expect(appServer.calls).toEqual([
      "account/read",
      "account/rateLimits/read",
      "configRequirements/read",
    ]);
  });
});
