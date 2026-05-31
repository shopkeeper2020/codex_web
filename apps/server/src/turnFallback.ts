type FallbackAction = "start" | "steer" | "interrupt" | "compact";

type IpcOwnershipReader = {
  isOwnedConversation: (threadId: string) => boolean;
  getThreadStreamState: (threadId: string) => unknown | null;
};

export type LocalTurnFallbackDecision =
  | { allow: true; reason: "web-owned" }
  | {
      allow: false;
      reason:
        | "not-recoverable"
        | "official-owner-unavailable"
        | "official-owner-required";
      statusCode: number;
      error: string;
    };

function isRecoverableFollowerError(message: string): boolean {
  return (
    message.includes("no-official-owner") ||
    message.includes("no-client-found") ||
    message.includes("official-ipc-request-failed:thread-follower-") ||
    message.includes("official-ipc-not-connected") ||
    message.includes("official-ipc-not-supported")
  );
}

function unavailableStatusCode(message: string): number {
  return message.includes("official-ipc-not-connected") ||
    message.includes("official-ipc-not-supported")
    ? 503
    : 409;
}

export function decideLocalTurnFallback(input: {
  action: FallbackAction;
  threadId: string;
  errorMessage: string;
  officialIpc: IpcOwnershipReader;
}): LocalTurnFallbackDecision {
  if (!isRecoverableFollowerError(input.errorMessage)) {
    return {
      allow: false,
      reason: "not-recoverable",
      statusCode: 502,
      error: input.errorMessage,
    };
  }

  if (input.officialIpc.isOwnedConversation(input.threadId)) {
    return { allow: true, reason: "web-owned" };
  }

  if (input.officialIpc.getThreadStreamState(input.threadId)) {
    return {
      allow: false,
      reason: "official-owner-unavailable",
      statusCode: unavailableStatusCode(input.errorMessage),
      error: `official-owner-unavailable:${input.errorMessage}`,
    };
  }

  return {
    allow: false,
    reason: "official-owner-required",
    statusCode: unavailableStatusCode(input.errorMessage),
    error: `official-owner-required:${input.errorMessage}`,
  };
}
