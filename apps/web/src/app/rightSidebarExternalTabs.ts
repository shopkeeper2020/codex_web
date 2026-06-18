import type { ThreadDetail } from "@codex-web/domain";

export type SideConversationSnapshot =
  ThreadDetail["sideConversations"][number];

export type ExternalThreadTabSnapshot = {
  type: string;
  title: string;
  sideConversationId?: string | null;
  sideConversation?: SideConversationSnapshot | null;
  threadId?: string | null;
  externalThread?: boolean;
};

export function sideConversationFromThreadDetail(
  detail: ThreadDetail,
  fallbackTitle?: string | null,
): SideConversationSnapshot {
  return {
    id: detail.thread.id,
    title: fallbackTitle || detail.thread.title,
    createdAtIso: detail.thread.createdAtIso ?? null,
    updatedAtIso: detail.thread.updatedAtIso,
    inProgress: detail.thread.inProgress,
    hasUnread: false,
    turnCount: detail.turns.length,
    turns: detail.turns,
  };
}

export function mergeExternalThreadDetailIntoTabs<
  T extends ExternalThreadTabSnapshot,
>(tabs: T[], detail: ThreadDetail): T[] {
  let changed = false;
  const next = tabs.map((tab) => {
    if (
      tab.type !== "chat" ||
      !tab.externalThread ||
      tab.sideConversationId !== detail.thread.id
    ) {
      return tab;
    }
    changed = true;
    const sideConversation = sideConversationFromThreadDetail(
      detail,
      tab.title,
    );
    return {
      ...tab,
      title: sideConversation.title,
      sideConversation,
      threadId: detail.thread.id,
    };
  });
  return changed ? next : tabs;
}
