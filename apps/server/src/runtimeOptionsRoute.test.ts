import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  async modelList(params: unknown): Promise<unknown> {
    this.calls.push({ method: "model/list", params });
    return { data: [] };
  }

  async collaborationModeList(): Promise<unknown> {
    this.calls.push({ method: "collaborationMode/list" });
    return { data: [] };
  }

  async permissionProfileList(params: unknown): Promise<unknown> {
    this.calls.push({ method: "permissionProfile/list", params });
    return {
      data: [
        { id: ":read-only", description: null },
        { id: ":workspace", description: null },
        { id: ":danger-full-access", description: "Full access" },
      ],
    };
  }

  async configRequirementsRead(): Promise<unknown> {
    this.calls.push({ method: "configRequirements/read" });
    return { requirements: null };
  }
}

type Harness = {
  context: ServerContext;
  appServer: FakeAppServer;
  root: string;
};

const harnesses: Harness[] = [];
const originalCodexHome = process.env.CODEX_HOME;

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-runtime-options-"));
  const appServer = new FakeAppServer();
  const context = await createServer(root, {
    officialIpc: new OfficialIpcBridge(""),
    appServer: appServer as unknown as CodexAppServerProcess,
  });
  const harness = { context, appServer, root };
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
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
});

describe("runtime options route", () => {
  it("passes cwd to official permissionProfile/list for project-local profiles", async () => {
    const { context, appServer } = await createHarness();

    const response = await context.app.inject({
      method: "GET",
      url: "/api/runtime-options?cwd=C%3A%5Cworkspace%5Ccodex_web",
    });

    expect(response.statusCode).toBe(200);
    expect(appServer.calls).toContainEqual({
      method: "permissionProfile/list",
      params: { cwd: "C:\\workspace\\codex_web", limit: 100 },
    });
  });

  it("uses the local Codex config permission default instead of guessing from the list", async () => {
    const { context, appServer, root } = await createHarness();
    const codexHome = join(root, "codex-home");
    mkdirSync(codexHome);
    writeFileSync(
      join(codexHome, "config.toml"),
      [
        'sandbox_mode = "danger-full-access"',
        'approval_policy = "never"',
        "",
      ].join("\n"),
    );
    process.env.CODEX_HOME = codexHome;

    const response = await context.app.inject({
      method: "GET",
      url: "/api/runtime-options",
    });
    const body = JSON.parse(response.body) as {
      data: { defaults: { permissionProfile: string | null } };
    };

    expect(response.statusCode).toBe(200);
    expect(body.data.defaults.permissionProfile).toBe(":danger-full-access");
    expect(appServer.calls).toContainEqual({
      method: "configRequirements/read",
    });
  });
});
