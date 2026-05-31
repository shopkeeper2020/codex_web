import { randomUUID } from 'node:crypto'
import type { DiagnosticEvent } from '@codex-web/domain'
import type { EventBus } from './events.js'

export class Diagnostics {
  private readonly events: DiagnosticEvent[] = []

  constructor(private readonly bus: EventBus) {}

  record(level: DiagnosticEvent['level'], source: string, message: string, data?: Record<string, unknown>): void {
    const event: DiagnosticEvent = {
      id: randomUUID(),
      atIso: new Date().toISOString(),
      level,
      source,
      message,
      ...(data ? { data } : {}),
    }
    this.events.push(event)
    if (this.events.length > 200) {
      this.events.splice(0, this.events.length - 200)
    }
    this.bus.publish({ type: 'diagnostic.event', event })
  }

  list(): DiagnosticEvent[] {
    return [...this.events]
  }
}
