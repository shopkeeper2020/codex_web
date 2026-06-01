import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncDesktopWorkspaceRoot } from "./desktopWorkspaceRoots.js";

const roots: string[] = [];

function createCodexHome(state: Record<string, unknown> | null): string {
  const root = mkdtempSync(join(tmpdir(), "codex-web-desktop-roots-"));
  roots.push(root);
  if (state) {
    writeFileSync(
      join(root, ".codex-global-state.json"),
      JSON.stringify(state),
      "utf8",
    );
  }
  return root;
}

function readState(codexHome: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(codexHome, ".codex-global-state.json"), "utf8"),
  ) as Record<string, unknown>;
}

function backups(codexHome: string): string[] {
  return readdirSync(codexHome).filter(
    (entry) =>
      entry.startsWith(".codex-global-state.json.codex-web-sync-") &&
      entry.endsWith(".bak"),
  );
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("desktop workspace root sync", () => {
  it("adds a Web project to Desktop saved roots without changing the active root", () => {
    const codexHome = createCodexHome({
      "electron-saved-workspace-roots": [
        "C:\\Users\\user\\Desktop\\codex_web",
      ],
      "active-workspace-roots": ["C:\\Users\\user\\Desktop\\codex_web"],
      "project-order": ["C:\\Users\\user\\Desktop\\codex_web"],
      unrelated: { keep: true },
    });

    const result = syncDesktopWorkspaceRoot(
      "C:/Users/user/Desktop/mcp_server",
      { codexHome },
    );

    expect(result).toMatchObject({
      status: "synced",
      path: "C:\\Users\\user\\Desktop\\mcp_server",
    });
    const state = readState(codexHome);
    expect(state["electron-saved-workspace-roots"]).toEqual([
      "C:\\Users\\user\\Desktop\\codex_web",
      "C:\\Users\\user\\Desktop\\mcp_server",
    ]);
    expect(state["project-order"]).toEqual([
      "C:\\Users\\user\\Desktop\\codex_web",
      "C:\\Users\\user\\Desktop\\mcp_server",
    ]);
    expect(state["active-workspace-roots"]).toEqual([
      "C:\\Users\\user\\Desktop\\codex_web",
    ]);
    expect(state.unrelated).toEqual({ keep: true });
    expect(backups(codexHome)).toHaveLength(1);
  });

  it("does not duplicate an existing Desktop saved root", () => {
    const codexHome = createCodexHome({
      "electron-saved-workspace-roots": [
        "C:\\Users\\user\\Desktop\\mcp_server",
      ],
      "project-order": ["C:\\Users\\user\\Desktop\\mcp_server"],
    });

    const result = syncDesktopWorkspaceRoot(
      "C:\\Users\\user\\Desktop\\mcp_server",
      { codexHome },
    );

    expect(result.status).toBe("already-present");
    const state = readState(codexHome);
    expect(state["electron-saved-workspace-roots"]).toEqual([
      "C:\\Users\\user\\Desktop\\mcp_server",
    ]);
    expect(backups(codexHome)).toHaveLength(0);
  });

  it("normalizes path casing in-place instead of appending a duplicate", () => {
    const codexHome = createCodexHome({
      "electron-saved-workspace-roots": [
        "C:\\Users\\user\\Desktop\\MCP_SERVER",
      ],
    });

    const result = syncDesktopWorkspaceRoot(
      "C:\\Users\\user\\Desktop\\mcp_server",
      { codexHome },
    );

    expect(result.status).toBe("synced");
    expect(readState(codexHome)["electron-saved-workspace-roots"]).toEqual([
      "C:\\Users\\user\\Desktop\\mcp_server",
    ]);
  });

  it("skips sync when Desktop global state is unavailable", () => {
    const codexHome = createCodexHome(null);

    const result = syncDesktopWorkspaceRoot(
      "C:\\Users\\user\\Desktop\\mcp_server",
      { codexHome },
    );

    expect(result).toMatchObject({
      status: "skipped",
      path: "C:\\Users\\user\\Desktop\\mcp_server",
      error: "Desktop global state file was not found",
    });
    expect(
      existsSync(join(codexHome, ".codex-global-state.json")),
    ).toBe(false);
  });
});
