import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeProjectPath } from "@codex-web/domain";

const GLOBAL_STATE_FILE = ".codex-global-state.json";
const DESKTOP_SAVED_ROOTS_KEY = "electron-saved-workspace-roots";
const DESKTOP_PROJECT_ORDER_KEY = "project-order";

export type DesktopWorkspaceRootSyncStatus =
  | "synced"
  | "already-present"
  | "skipped"
  | "failed";

export type DesktopWorkspaceRootSyncResult = {
  status: DesktopWorkspaceRootSyncStatus;
  path: string;
  globalStatePath: string | null;
  error?: string;
};

type DesktopGlobalState = Record<string, unknown>;

export function resolveCodexHome(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.CODEX_HOME?.trim();
  if (explicit) return explicit;
  const home = env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
  return home ? join(home, ".codex") : null;
}

function pathKey(path: string): string {
  return normalizeProjectPath(path).toLocaleLowerCase();
}

function readGlobalState(path: string): DesktopGlobalState {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Desktop global state must be a JSON object");
  }
  return raw as DesktopGlobalState;
}

function appendPathIfMissing(values: unknown, path: string): {
  values: unknown[];
  changed: boolean;
} {
  const normalizedPath = normalizeProjectPath(path);
  const current = Array.isArray(values) ? values : [];
  const key = pathKey(normalizedPath);
  const existingIndex = current.findIndex(
    (entry) => typeof entry === "string" && pathKey(entry) === key,
  );
  if (existingIndex >= 0) {
    if (current[existingIndex] === normalizedPath) {
      return { values: current, changed: false };
    }
    const next = [...current];
    next[existingIndex] = normalizedPath;
    return { values: next, changed: true };
  }
  return { values: [...current, normalizedPath], changed: true };
}

function readPathList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const path = normalizeProjectPath(value);
    if (!path) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

export function readDesktopWorkspaceRoots(
  options: {
    codexHome?: string | null;
  } = {},
): string[] {
  const codexHome =
    "codexHome" in options ? options.codexHome : resolveCodexHome();
  const globalStatePath = codexHome ? join(codexHome, GLOBAL_STATE_FILE) : null;
  if (!globalStatePath || !existsSync(globalStatePath)) return [];

  const state = readGlobalState(globalStatePath);
  const savedRoots = readPathList(state[DESKTOP_SAVED_ROOTS_KEY]);
  const savedKeys = new Set(savedRoots.map(pathKey));
  const orderedRoots = readPathList(state[DESKTOP_PROJECT_ORDER_KEY]).filter(
    (path) => savedKeys.has(pathKey(path)),
  );
  const orderedKeys = new Set(orderedRoots.map(pathKey));
  return [
    ...orderedRoots,
    ...savedRoots.filter((path) => !orderedKeys.has(pathKey(path))),
  ];
}

function writeGlobalStateAtomically(path: string, state: DesktopGlobalState): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.codex-web-sync-${timestamp}.bak`;
  const tempPath = join(dirname(path), `${GLOBAL_STATE_FILE}.codex-web-sync.tmp`);
  copyFileSync(path, backupPath);
  writeFileSync(tempPath, JSON.stringify(state), "utf8");
  try {
    renameSync(tempPath, path);
  } catch {
    copyFileSync(tempPath, path);
    try {
      unlinkSync(tempPath);
    } catch {
      // Best effort cleanup only; the backup is the important recovery path.
    }
  }
}

export function syncDesktopWorkspaceRoot(
  projectPath: string,
  options: {
    codexHome?: string | null;
  } = {},
): DesktopWorkspaceRootSyncResult {
  const normalizedPath = normalizeProjectPath(projectPath);
  const codexHome =
    "codexHome" in options ? options.codexHome : resolveCodexHome();
  const globalStatePath = codexHome ? join(codexHome, GLOBAL_STATE_FILE) : null;
  if (!normalizedPath) {
    return {
      status: "skipped",
      path: normalizedPath,
      globalStatePath,
      error: "Project path is required",
    };
  }
  if (!globalStatePath || !existsSync(globalStatePath)) {
    return {
      status: "skipped",
      path: normalizedPath,
      globalStatePath,
      error: "Desktop global state file was not found",
    };
  }

  try {
    const state = readGlobalState(globalStatePath);
    const savedRoots = appendPathIfMissing(
      state[DESKTOP_SAVED_ROOTS_KEY],
      normalizedPath,
    );
    state[DESKTOP_SAVED_ROOTS_KEY] = savedRoots.values;

    const projectOrder = appendPathIfMissing(
      state[DESKTOP_PROJECT_ORDER_KEY],
      normalizedPath,
    );
    state[DESKTOP_PROJECT_ORDER_KEY] = projectOrder.values;

    if (!savedRoots.changed && !projectOrder.changed) {
      return {
        status: "already-present",
        path: normalizedPath,
        globalStatePath,
      };
    }

    writeGlobalStateAtomically(globalStatePath, state);
    return {
      status: "synced",
      path: normalizedPath,
      globalStatePath,
    };
  } catch (error) {
    return {
      status: "failed",
      path: normalizedPath,
      globalStatePath,
      error:
        error instanceof Error
          ? error.message
          : "Failed to sync Desktop workspace roots",
    };
  }
}
