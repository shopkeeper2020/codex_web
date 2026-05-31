import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceStatus } from "./workspaceStatus.js";

const roots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace status", () => {
  it("returns a safe non-git status for ordinary folders", async () => {
    const root = makeTempRoot("codex-web-workspace-nongit-");
    const status = await readWorkspaceStatus(root);

    expect(status.isGitRepository).toBe(false);
    expect(status.changedFiles).toBe(0);
    expect(status.hasUntracked).toBe(false);
    expect(status.branch).toBeNull();
  });

  (hasGit() ? it : it.skip)(
    "reads branch, commit, and working tree counts from git",
    async () => {
      const root = makeTempRoot("codex-web-workspace-git-");
      git(root, ["init"]);
      git(root, ["config", "user.email", "codex-web@example.local"]);
      git(root, ["config", "user.name", "codex_web test"]);

      const trackedFile = join(root, "tracked.txt");
      writeFileSync(trackedFile, "one\n", "utf8");
      git(root, ["add", "tracked.txt"]);
      git(root, ["commit", "-m", "initial"]);

      writeFileSync(trackedFile, "one\ntwo\n", "utf8");
      writeFileSync(join(root, "untracked.txt"), "new\n", "utf8");

      const status = await readWorkspaceStatus(root);

      expect(status.isGitRepository).toBe(true);
      expect(status.branch).toBeTruthy();
      expect(status.commit).toMatch(/^[0-9a-f]{7,}$/);
      expect(status.changedFiles).toBeGreaterThanOrEqual(2);
      expect(status.hasUntracked).toBe(true);
      expect(status.additions).toBeGreaterThanOrEqual(1);
      expect(status.deletions).toBeGreaterThanOrEqual(0);
    },
  );
});
