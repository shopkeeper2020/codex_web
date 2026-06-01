import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalConfigFile } from "@codex-web/config";
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
  codexHome: string;
};

const harnesses: Harness[] = [];
const originalCodexHome = process.env.CODEX_HOME;

function readDesktopState(codexHome: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(codexHome, ".codex-global-state.json"), "utf8"),
  ) as Record<string, unknown>;
}

async function createHarness(): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "codex-web-project-favorites-"));
  const codexHome = mkdtempSync(join(tmpdir(), "codex-web-project-state-"));
  writeFileSync(
    join(codexHome, ".codex-global-state.json"),
    JSON.stringify({
      "electron-saved-workspace-roots": ["C:\\Users\\user\\Desktop\\codex_web"],
      "active-workspace-roots": ["C:\\Users\\user\\Desktop\\codex_web"],
      "project-order": ["C:\\Users\\user\\Desktop\\codex_web"],
    }),
    "utf8",
  );
  process.env.CODEX_HOME = codexHome;
  const context = await createServer(root, {
    officialIpc: new OfficialIpcBridge(""),
    appServer: new FakeAppServer() as unknown as CodexAppServerProcess,
  });
  const harness = { context, root, codexHome };
  harnesses.push(harness);
  return harness;
}

async function closeHarness(harness: Harness): Promise<void> {
  await harness.context.app.close();
  rmSync(harness.root, { recursive: true, force: true });
  rmSync(harness.codexHome, { recursive: true, force: true });
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await closeHarness(harness);
  }
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
});

describe("project favorites route", () => {
  it("syncs added Web favorite projects to Desktop saved workspace roots", async () => {
    const { context, codexHome, root } = await createHarness();
    const projectPath = join(root, "mcp_server");
    mkdirSync(projectPath);

    const response = await context.app.inject({
      method: "POST",
      url: "/api/projects/favorites",
      payload: { path: projectPath },
    });

    expect(response.statusCode).toBe(200);
    expect(readLocalConfigFile(root).projects?.favorites).toEqual([
      projectPath,
    ]);
    const desktopState = readDesktopState(codexHome);
    expect(desktopState["electron-saved-workspace-roots"]).toEqual([
      "C:\\Users\\user\\Desktop\\codex_web",
      projectPath,
    ]);
    expect(desktopState["project-order"]).toEqual([
      "C:\\Users\\user\\Desktop\\codex_web",
      projectPath,
    ]);
    expect(desktopState["active-workspace-roots"]).toEqual([
      "C:\\Users\\user\\Desktop\\codex_web",
    ]);
    expect(
      context.diagnostics
        .list()
        .some(
          (event) =>
            event.source === "projects" &&
            event.message === "desktop-workspace-root-sync" &&
            event.data?.status === "synced",
        ),
    ).toBe(true);
  });
});
