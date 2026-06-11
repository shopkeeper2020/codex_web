import type { MessageItem } from "@codex-web/domain";
import {
  asThreadItemRecord,
  isAgentMessageItem,
  isLiveOperationItem,
  isUserMessageItem,
  readCommandOutput,
  readMessageItemStatus,
  readMessageItemText,
  readThreadItemString,
} from "./officialThreadItems";

export type TurnProcessCollapseLayout = {
  beforeItems: MessageItem[];
  processItems: MessageItem[];
  finalAndAfterItems: MessageItem[];
  finalAnswerIndex: number;
  source: "phase" | "fallback";
};

function compactStatus(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[-_\s]/g, "");
}

function isActiveStatus(value?: string | null): boolean {
  const normalized = compactStatus(value);
  return Boolean(
    normalized &&
      [
        "active",
        "editing",
        "inprogress",
        "pending",
        "running",
        "started",
        "streaming",
        "thinking",
        "writing",
      ].includes(normalized),
  );
}

function isTerminalStatus(value?: string | null): boolean {
  const normalized = compactStatus(value);
  return Boolean(
    normalized &&
      [
        "aborted",
        "applied",
        "cancelled",
        "canceled",
        "complete",
        "completed",
        "declined",
        "done",
        "error",
        "failed",
        "interrupted",
        "modified",
        "stopped",
        "success",
        "succeeded",
      ].includes(normalized),
  );
}

function messagePhase(item: MessageItem): string | null {
  const phase = readThreadItemString(asThreadItemRecord(item)?.phase);
  return phase || null;
}

function isFinalAnswerItem(item: MessageItem): boolean {
  return item.type === "agentMessage" && messagePhase(item) === "final_answer";
}

function isFallbackFinalAnswerCandidate(item: MessageItem): boolean {
  if (!isAgentMessageItem(item)) return false;
  if (messagePhase(item) === "commentary") return false;
  return readMessageItemText(item).trim().length > 0;
}

function isProcessLikeItem(item: MessageItem): boolean {
  return !isUserMessageItem(item) && !isFinalAnswerItem(item);
}

function isActiveOperationItem(item: MessageItem, turnStatus: string): boolean {
  if (!isActiveStatus(turnStatus)) return false;
  if (!isLiveOperationItem(item)) return false;
  const status = readMessageItemStatus(item);
  if (isTerminalStatus(status)) return false;
  if (item.type === "webSearch") return isActiveStatus(status);
  const command = readCommandOutput(item);
  if (command) return command.exitCode === null;
  return isActiveStatus(status) || status === null;
}

function findFallbackFinalAnswerIndex(items: MessageItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && isFallbackFinalAnswerCandidate(item)) return index;
  }
  return -1;
}

export function deriveTurnProcessCollapse(
  items: MessageItem[],
  turnStatus: string,
): TurnProcessCollapseLayout | null {
  const phaseFinalIndex = items.findIndex(isFinalAnswerItem);
  const finalAnswerIndex =
    phaseFinalIndex >= 0 ? phaseFinalIndex : findFallbackFinalAnswerIndex(items);
  if (finalAnswerIndex < 0) return null;

  const source = phaseFinalIndex >= 0 ? "phase" : "fallback";
  const beforeFinal = items.slice(0, finalAnswerIndex);
  const afterFinal = items.slice(finalAnswerIndex);
  const processItems = beforeFinal.filter(isProcessLikeItem);
  if (processItems.length === 0) return null;
  if (processItems.some((item) => isActiveOperationItem(item, turnStatus))) {
    return null;
  }
  if (afterFinal.slice(1).some(isProcessLikeItem)) return null;

  return {
    beforeItems: beforeFinal.filter(isUserMessageItem),
    processItems,
    finalAndAfterItems: afterFinal,
    finalAnswerIndex,
    source,
  };
}
