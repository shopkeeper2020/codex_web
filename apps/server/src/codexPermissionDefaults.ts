import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCodexHome } from "./desktopWorkspaceRoots.js";

export type CodexPermissionDefaultSource =
  | "managed-requirements"
  | "user-config"
  | "legacy-sandbox-config";

export type CodexPermissionDefault = {
  permissionProfile: string;
  source: CodexPermissionDefaultSource;
};

type TopLevelTomlStrings = Record<string, string>;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#") return value.slice(0, index).trim();
  }
  return value.trim();
}

function parseTomlStringLiteral(value: string): string | null {
  const trimmed = stripInlineComment(value);
  if (trimmed.length < 2) return null;
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return null;
  const inner = trimmed.slice(1, -1);
  if (quote === "'") return inner;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

export function parseTopLevelTomlStrings(content: string): TopLevelTomlStrings {
  const result: TopLevelTomlStrings = {};
  let inTopLevel = true;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    const value = parseTomlStringLiteral(match[2] ?? "");
    if (value !== null) result[match[1]!] = value;
  }
  return result;
}

function readManagedAllowedProfile(
  requirements: Record<string, unknown>,
  profileId: string,
): boolean {
  const snake = asRecord(requirements.allowed_permission_profiles);
  const camel = asRecord(requirements.allowedPermissionProfiles);
  const allowed = snake ?? camel;
  return allowed?.[profileId] === true;
}

function readAllowedProfileIds(value: unknown): Set<string> | null {
  if (Array.isArray(value)) {
    return new Set(
      value.flatMap((entry) => {
        const id = readString(entry);
        return id ? [id] : [];
      }),
    );
  }
  const record = asRecord(value);
  if (!record) return null;
  return new Set(
    Object.entries(record)
      .filter(([, enabled]) => enabled === true)
      .map(([id]) => id)
      .filter(Boolean),
  );
}

export function permissionProfileAllowListFromRequirements(
  response: unknown,
): Set<string> | null {
  const root = asRecord(response);
  const requirements = asRecord(root?.requirements);
  if (!requirements) return null;
  return (
    readAllowedProfileIds(requirements.allowed_permission_profiles) ??
    readAllowedProfileIds(requirements.allowedPermissionProfiles) ??
    readAllowedProfileIds(requirements.allowed_permissions) ??
    readAllowedProfileIds(requirements.allowedPermissions)
  );
}

export function permissionDefaultFromRequirements(
  response: unknown,
): CodexPermissionDefault | null {
  const root = asRecord(response);
  const requirements = asRecord(root?.requirements);
  if (!requirements) return null;

  const explicit =
    readString(requirements.default_permissions) ??
    readString(requirements.defaultPermissions);
  if (explicit) {
    return { permissionProfile: explicit, source: "managed-requirements" };
  }

  if (
    readManagedAllowedProfile(requirements, ":workspace") &&
    readManagedAllowedProfile(requirements, ":read-only")
  ) {
    return {
      permissionProfile: ":workspace",
      source: "managed-requirements",
    };
  }

  return null;
}

export function permissionDefaultFromConfigText(
  content: string,
): CodexPermissionDefault | null {
  const values = parseTopLevelTomlStrings(content);
  const explicit = readString(values.default_permissions);
  if (explicit) {
    return { permissionProfile: explicit, source: "user-config" };
  }

  const sandboxMode = readString(values.sandbox_mode);
  const approvalPolicy = readString(values.approval_policy);
  if (sandboxMode === "danger-full-access" && approvalPolicy === "never") {
    return {
      permissionProfile: ":danger-full-access",
      source: "legacy-sandbox-config",
    };
  }
  if (sandboxMode === "workspace-write") {
    return { permissionProfile: ":workspace", source: "legacy-sandbox-config" };
  }
  if (sandboxMode === "read-only") {
    return { permissionProfile: ":read-only", source: "legacy-sandbox-config" };
  }
  return null;
}

export function readLocalCodexPermissionDefault(
  env: NodeJS.ProcessEnv = process.env,
): CodexPermissionDefault | null {
  const codexHome = resolveCodexHome(env);
  if (!codexHome) return null;
  const configPath = join(codexHome, "config.toml");
  if (!existsSync(configPath)) return null;
  return permissionDefaultFromConfigText(readFileSync(configPath, "utf8"));
}
