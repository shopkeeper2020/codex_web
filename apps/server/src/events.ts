import type { DiagnosticEvent } from "@codex-web/domain";
import type { ApprovalDecision, PendingApproval } from "./approvals.js";

export type ServerEvent =
  | { type: "diagnostic.event"; event: DiagnosticEvent }
  | {
      type: "appServer.notification";
      method: string;
      params: unknown;
      atIso: string;
    }
  | { type: "official.threadStreamStateChanged"; payload: unknown }
  | { type: "official.threadArchived"; payload: unknown }
  | { type: "official.threadUnarchived"; payload: unknown }
  | { type: "official.statusChanged"; payload: unknown }
  | { type: "approval.requested"; approval: PendingApproval }
  | {
      type: "approval.resolved";
      approval: PendingApproval;
      decision: ApprovalDecision;
    };

export type PublishedServerEvent = ServerEvent & { sequence: number };

type Listener = (event: PublishedServerEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  private sequence = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: ServerEvent): void {
    this.sequence += 1;
    const payload: PublishedServerEvent = { ...event, sequence: this.sequence };
    for (const listener of this.listeners) {
      listener(payload);
    }
  }
}
