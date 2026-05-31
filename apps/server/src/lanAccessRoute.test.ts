import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lanAccessResponseSchema } from "@codex-web/api";
import { OfficialIpcBridge } from "@codex-web/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type ServerContext } from "./app.js";
import type { CodexAppServerProcess } from "./appServerProcess.js";

class FakeAppServer {
  onNotification(): () => void {
    return () => undefined;
  }

  registerServerRequestHandler(): void {}

  async warmUp(): Promise<void> {}

  getStatus(): Record<string, unknown> {
    return { initialized: true, running: true };
  }

  dispose(): void {}
}

type Harness = {
  context: ServerContext;
  root: string;
};

const harnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-lan-route-"));
  const context = await createServer(root, {
    officialIpc: new OfficialIpcBridge(""),
    appServer: new FakeAppServer() as unknown as CodexAppServerProcess,
  });
  const harness = { context, root };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (!harness) continue;
    await harness.context.app.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

describe("LAN access route", () => {
  it("returns current local and LAN access candidates", async () => {
    const { context } = await createHarness();

    const response = await context.app.inject({
      method: "GET",
      url: "/api/network/lan-access",
    });

    expect(response.statusCode, response.body).toBe(200);
    const payload = lanAccessResponseSchema.parse(response.json());
    expect(payload.data.port).toBe(18930);
    expect(payload.data.localUrl).toBe("http://127.0.0.1:18930/");
    for (const entry of payload.data.urls) {
      expect(entry.url).toBe(`http://${entry.address}:18930/`);
    }
  });
});
