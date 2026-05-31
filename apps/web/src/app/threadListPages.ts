import type { Project, Thread, ThreadList } from "../api";

export const EMPTY_THREAD_LIST: ThreadList = {
  projects: [],
  threads: [],
  nextCursor: null,
  backwardsCursor: null,
};

function mergeById<T extends { id: string }>(current: T[], next: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of current) merged.set(item.id, item);
  for (const item of next) {
    if (!merged.has(item.id)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

export function appendThreadListPage(
  current: ThreadList,
  next: ThreadList,
): ThreadList {
  return {
    projects: mergeById<Project>(current.projects, next.projects),
    threads: mergeById<Thread>(current.threads, next.threads),
    nextCursor: next.nextCursor,
    backwardsCursor: current.backwardsCursor ?? next.backwardsCursor,
  };
}
