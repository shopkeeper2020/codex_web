import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceStatus } from "@codex-web/api";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const GH_TIMEOUT_MS = 3_000;

type CommandResult =
  | { ok: true; stdout: string }
  | { ok: false; message: string };

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return { ok: true, stdout: String(result.stdout).trim() };
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "command failed";
    return { ok: false, message };
  }
}

async function runGit(cwd: string, args: string[]): Promise<CommandResult> {
  return runCommand("git", args, cwd, GIT_TIMEOUT_MS);
}

export async function checkoutWorkspaceBranch(
  cwd: string,
  branch: string,
): Promise<void> {
  const result = await runGit(cwd, ["switch", branch]);
  if (!result.ok) throw new Error(result.message);
}

function parseAheadBehind(value: string): {
  ahead: number | null;
  behind: number | null;
} {
  const [aheadRaw, behindRaw] = value.trim().split(/\s+/);
  const ahead = Number(aheadRaw);
  const behind = Number(behindRaw);
  return {
    ahead: Number.isInteger(ahead) && ahead >= 0 ? ahead : null,
    behind: Number.isInteger(behind) && behind >= 0 ? behind : null,
  };
}

function parseShortStat(value: string): {
  additions: number | null;
  deletions: number | null;
} {
  const insertions = /(\d+)\s+insertion/.exec(value);
  const deletions = /(\d+)\s+deletion/.exec(value);
  return {
    additions: insertions ? Number(insertions[1]) : 0,
    deletions: deletions ? Number(deletions[1]) : 0,
  };
}

function parseBranches(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRemoteDefaultBranch(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.replace(/^origin\//, "") || null;
}

function orderBranches(branches: string[], defaultBranch: string | null): string[] {
  if (!defaultBranch || !branches.includes(defaultBranch)) return branches;
  return [
    defaultBranch,
    ...branches.filter((branch) => branch !== defaultBranch),
  ];
}

function defaultGithubCli(): WorkspaceStatus["githubCli"] {
  return {
    available: false,
    authenticated: null,
    status: "not-installed",
  };
}

async function readGithubCliStatus(cwd: string): Promise<{
  githubCli: WorkspaceStatus["githubCli"];
  warnings: string[];
}> {
  const version = await runCommand("gh", ["--version"], cwd, GH_TIMEOUT_MS);
  if (!version.ok) {
    return {
      githubCli: defaultGithubCli(),
      warnings: ["GitHub CLI is not installed or not on PATH."],
    };
  }

  const auth = await runCommand("gh", ["auth", "status"], cwd, GH_TIMEOUT_MS);
  if (auth.ok) {
    return {
      githubCli: {
        available: true,
        authenticated: true,
        status: "available",
      },
      warnings: [],
    };
  }

  return {
    githubCli: {
      available: true,
      authenticated: false,
      status: auth.message.toLowerCase().includes("timeout")
        ? "error"
        : "not-authenticated",
    },
    warnings: ["GitHub CLI is installed but not authenticated for this workspace."],
  };
}

export async function readWorkspaceStatus(
  cwd: string,
): Promise<WorkspaceStatus> {
  const warnings: string[] = [];
  const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const github = await readGithubCliStatus(cwd);
  warnings.push(...github.warnings);

  if (!root.ok) {
    warnings.push("Workspace is not a Git repository.");
    return {
      cwd,
      isGitRepository: false,
      branch: null,
      branches: [],
      upstream: null,
      ahead: null,
      behind: null,
      commit: null,
      changedFiles: 0,
      additions: null,
      deletions: null,
      hasUntracked: false,
      githubCli: github.githubCli,
      warnings,
    };
  }

  const [
    branch,
    branches,
    defaultBranch,
    commit,
    upstream,
    aheadBehind,
    porcelain,
    shortStat,
  ] =
    await Promise.all([
      runGit(cwd, ["branch", "--show-current"]),
      runGit(cwd, ["branch", "--format=%(refname:short)"]),
      runGit(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
      runGit(cwd, ["rev-parse", "--short", "HEAD"]),
      runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
      runGit(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]),
      runGit(cwd, ["status", "--porcelain=v1"]),
      runGit(cwd, ["diff", "--shortstat", "HEAD"]),
    ]);

  if (!branch.ok) warnings.push("Unable to read current Git branch.");
  if (!branches.ok) warnings.push("Unable to read Git branches.");
  if (!commit.ok) warnings.push("Unable to read current Git commit.");
  if (!upstream.ok) warnings.push("No upstream branch is configured.");
  if (!aheadBehind.ok && upstream.ok) {
    warnings.push("Unable to read Git ahead/behind counts.");
  }
  if (!porcelain.ok) warnings.push("Unable to read Git working tree status.");
  if (!shortStat.ok) warnings.push("Unable to read Git diff statistics.");

  const statusLines = porcelain.ok
    ? porcelain.stdout.split(/\r?\n/).filter(Boolean)
    : [];
  const counts = aheadBehind.ok
    ? parseAheadBehind(aheadBehind.stdout)
    : { ahead: null, behind: null };
  const diff = shortStat.ok
    ? parseShortStat(shortStat.stdout)
    : { additions: null, deletions: null };

  return {
    cwd,
    isGitRepository: true,
    branch: branch.ok && branch.stdout ? branch.stdout : "detached",
    branches: branches.ok
      ? orderBranches(
          parseBranches(branches.stdout),
          defaultBranch.ok ? parseRemoteDefaultBranch(defaultBranch.stdout) : null,
        )
      : [],
    upstream: upstream.ok && upstream.stdout ? upstream.stdout : null,
    ahead: counts.ahead,
    behind: counts.behind,
    commit: commit.ok && commit.stdout ? commit.stdout : null,
    changedFiles: statusLines.length,
    additions: diff.additions,
    deletions: diff.deletions,
    hasUntracked: statusLines.some((line) => line.startsWith("??")),
    githubCli: github.githubCli,
    warnings,
  };
}
