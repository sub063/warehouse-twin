/**
 * The event bus: stamps envelopes on adapter drafts, keeps the event log
 * (loaded from and appended to the store), and fans events out to
 * subscribers (the WebSocket layer).
 */

import { randomUUID } from "node:crypto";
import type { ArcadeEvent, DraftEvent } from "../../shared/src";
import { EVENT_SCHEMA_VERSION } from "../../shared/src";
import type { EventStore } from "./db";

export class EventBus {
  private seq: number;
  private log: ArcadeEvent[];
  private listeners = new Set<(e: ArcadeEvent) => void>();

  constructor(private store?: EventStore) {
    this.log = store?.loadEvents() ?? [];
    this.seq = (this.log.at(-1)?.seq ?? -1) + 1;
  }

  publish(draft: DraftEvent): ArcadeEvent {
    const event = {
      v: EVENT_SCHEMA_VERSION,
      id: randomUUID(),
      seq: this.seq++,
      ts: Date.now(),
      ...draft,
    } as ArcadeEvent;
    this.log.push(event);
    this.store?.append(event);
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
