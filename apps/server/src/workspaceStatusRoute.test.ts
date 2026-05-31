import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceStatusResponseSchema } from "@codex-web/api";
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
  outsideRoot: string;
};

const harnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-workspace-route-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "codex-web-workspace-outside-"));
  const context = await createServer(root, {
    officialIpc: new OfficialIpcBridge(""),
    appServer: new FakeAppServer() as unknown as CodexAppServerProcess,
  });
  const harness = { context, root, outsideRoot };
  harnesses.push(harness);
  return harness;
}

async function closeHarness(harness: Harness): Promise<void> {
  await harness.context.app.close();
  rmSync(harness.root, { recursive: true, force: true });
  rmSync(harness.outsideRoot, { recursive: true, force: true });
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await closeHarness(harness);
  }
});

describe("workspace status route", () => {
  it("returns status only for allowed project roots", async () => {
    const { context, root, outsideRoot } = await createHarness();

    const allowedResponse = await context.app.inject({
      method: "GET",
      url: `/api/workspace/status?cwd=${encodeURIComponent(root)}`,
    });
    expect(allowedResponse.statusCode).toBe(200);
    const payload = workspaceStatusResponseSchema.parse(
      allowedResponse.json(),
    );
    expect(payload.data.cwd).toBe(root);
    expect(payload.data.isGitRepository).toBe(false);

    const deniedResponse = await context.app.inject({
      method: "GET",
      url: `/api/workspace/status?cwd=${encodeURIComponent(outsideRoot)}`,
    });
    expect(deniedResponse.statusCode).toBe(403);
  });
});
