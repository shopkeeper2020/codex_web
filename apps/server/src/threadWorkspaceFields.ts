import type { ThreadDetail } from "@codex-web/domain";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

export function projectCwdForThreadBroadcast(
  thread: ThreadDetail["thread"] | null | undefined,
): string | undefined {
  if (thread?.workspaceKind !== "project") return undefined;
  return thread.projectId ?? thread.path ?? undefined;
}

export function threadBroadcastFieldsFromDetail(detail: ThreadDetail): {
  id: string;
  title: string;
  name: string;
  workspaceKind: ThreadDetail["thread"]["workspaceKind"];
  cwd?: string;
} {
  const cwd = projectCwdForThreadBroadcast(detail.thread);
  return {
    id: detail.thread.id,
    title: detail.thread.title,
    name: detail.thread.title,
    workspaceKind: detail.thread.workspaceKind,
    ...(cwd ? { cwd } : {}),
  };
}

export function workspaceKindFromOfficialState(
  state: { conversationState: unknown } | null | undefined,
): string | null {
  return readString(asRecord(state?.conversationState)?.workspaceKind) || null;
}

export function preserveOwnedSnapshotWorkspaceFields(input: {
  conversationState: unknown;
  existingState: { conversationState: unknown } | null | undefined;
}): unknown {
  const record = asRecord(input.conversationState);
  if (!record) return input.conversationState;
  const previous = asRecord(input.existingState?.conversationState);
  const workspaceKind =
    readString(record.workspaceKind) || readString(previous?.workspaceKind);
  if (!workspaceKind) return input.conversationState;

  const next: Record<string, unknown> = {
    ...record,
    workspaceKind,
  };

  if (workspaceKind === "project") {
    if (!readString(next.cwd)) {
      const previousCwd = readString(previous?.cwd);
      if (previousCwd) next.cwd = previousCwd;
    }
  } else {
    delete next.cwd;
  }

  for (const key of ["workspaceBrowserRoot", "projectlessOutputDirectory"]) {
    if (next[key] !== undefined && next[key] !== null) continue;
    if (previous?.[key] !== undefined && previous[key] !== null) {
      next[key] = previous[key];
    }
  }

  return next;
}

export function resolveProjectCwdForConversation(input: {
  explicitCwd?: unknown;
  conversationState?: unknown;
}): string | undefined {
  const record = asRecord(input.conversationState);
  const explicitCwd = readString(input.explicitCwd);
  const workspaceKind = readString(record?.workspaceKind);

  if (workspaceKind === "projectless" || workspaceKind === "unknown") {
    return undefined;
  }

  if (workspaceKind === "project") {
    return (
      explicitCwd ||
      readString(record?.cwd) ||
      readString(record?.projectId) ||
      undefined
    );
  }

  return explicitCwd || undefined;
}
