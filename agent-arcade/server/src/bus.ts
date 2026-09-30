/**
 * The event bus: stamps envelopes on adapter drafts, keeps the in-memory
 * event log (SQLite persistence arrives in milestone 4), and fans events
 * out to subscribers (the WebSocket layer).
 */

import { randomUUID } from "node:crypto";
import type { ArcadeEvent, DraftEvent } from "../../shared/src";
import { EVENT_SCHEMA_VERSION } from "../../shared/src";

export class EventBus {
  private seq = 0;
  private log: ArcadeEvent[] = [];
  private listeners = new Set<(e: ArcadeEvent) => void>();

  publish(draft: DraftEvent): ArcadeEvent {
    const event = {
      v: EVENT_SCHEMA_VERSION,
      id: randomUUID(),
      seq: this.seq++,
      ts: Date.now(),
      ...draft,
    } as ArcadeEvent;
    this.log.push(event);
    for (const l of this.listeners) l(event);
    return event;
  }

  snapshot(): ArcadeEvent[] {
    return this.log.slice();
  }

  subscribe(listener: (e: ArcadeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
