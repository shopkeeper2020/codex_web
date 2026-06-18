import type { Thread } from "../api";

type DraftCwdThread = Pick<Thread, "workspaceKind" | "projectId" | "path">;

export function resolveThreadProjectCwd(
  thread: DraftCwdThread | null | undefined,
): string | null {
  if (thread?.workspaceKind !== "project") return null;
  return thread.projectId ?? thread.path ?? null;
}

export function resolveFallbackDraftCwd(input: {
  selectedProjectCwd: string | null;
  selectedThread: DraftCwdThread | null | undefined;
  defaultProjectCwd: string | null;
}): string | null {
  if (input.selectedProjectCwd !== null) return input.selectedProjectCwd;
  const threadProjectCwd = resolveThreadProjectCwd(input.selectedThread);
  if (threadProjectCwd !== null) return threadProjectCwd;
  if (
    input.selectedThread?.workspaceKind === "projectless" ||
    input.selectedThread?.workspaceKind === "unknown"
  ) {
    return null;
  }
  return input.defaultProjectCwd;
}
