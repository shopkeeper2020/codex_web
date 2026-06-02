import type { TurnStartParams, TurnSteerParams } from "./appServerProcess.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function copyPresent(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[],
): void {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key];
  }
}

const TURN_START_OFFICIAL_OPTIONAL_KEYS = [
  "clientUserMessageId",
  "cwd",
  "approvalPolicy",
  "approvalsReviewer",
  "sandboxPolicy",
  "permissions",
  "runtimeWorkspaceRoots",
  "model",
  "serviceTier",
  "effort",
  "summary",
  "personality",
  "outputSchema",
  "collaborationMode",
  "environments",
];

const TURN_STEER_OFFICIAL_OPTIONAL_KEYS = [
  "clientUserMessageId",
];

export function toOfficialTurnStartParams(
  params: TurnStartParams,
): TurnStartParams {
  const source = asRecord(params) ?? {};
  const next: Record<string, unknown> = {
    threadId: params.threadId,
    input: Array.isArray(params.input) ? params.input : [],
  };
  copyPresent(next, source, TURN_START_OFFICIAL_OPTIONAL_KEYS);
  return next as TurnStartParams;
}

export function toOfficialTurnSteerParams(
  params: TurnSteerParams,
): TurnSteerParams {
  const source = asRecord(params) ?? {};
  const next: Record<string, unknown> = {
    threadId: params.threadId,
    expectedTurnId: params.expectedTurnId,
    input: Array.isArray(params.input) ? params.input : [],
  };
  copyPresent(next, source, TURN_STEER_OFFICIAL_OPTIONAL_KEYS);
  return next as TurnSteerParams;
}
