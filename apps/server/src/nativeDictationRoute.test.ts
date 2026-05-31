import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeDictationStatusResponseSchema } from "@codex-web/api";
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
  const root = mkdtempSync(join(tmpdir(), "codex-web-dictation-route-"));
  const context = await createServer(root, {
    officialIpc: new OfficialIpcBridge(""),
    appServer: new FakeAppServer() as unknown as CodexAppServerProcess,
  });
  const harness = { context, root };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  delete process.env.CODEX_WEB_NATIVE_DICTATION_HOTKEY;
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (!harness) continue;
    await harness.context.app.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

describe("native dictation route", () => {
  it("returns native dictation hotkey status", async () => {
    process.env.CODEX_WEB_NATIVE_DICTATION_HOTKEY = "Ctrl+Alt+D";
    const { context } = await createHarness();

    const response = await context.app.inject({
      method: "GET",
      url: "/api/native-dictation/status",
    });

    expect(response.statusCode, response.body).toBe(200);
    const payload = nativeDictationStatusResponseSchema.parse(response.json());
    expect(payload.data).toMatchObject({
      supported: true,
      configured: true,
      hotkey: "Ctrl+Alt+D",
      commandId: "globalDictationToggle",
      source: "environment",
      warning: null,
    });
  });
});
