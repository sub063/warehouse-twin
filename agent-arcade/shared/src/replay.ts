/**
 * Replay: rebuild an agent's world at any moment of its run using the
 * same reducer the live view uses. Seeking forward applies only the
 * events between the old and new cursor; seeking backward rebuilds
 * from the start (runs are short, so this stays cheap).
 */

import type { ArcadeEvent } from "./events";
import type { AgentView, WorldState } from "./reducer";
import { initialState, reduce } from "./reducer";

export interface ReplayRange {
  startTs: number;
  endTs: number;
}

/** The time span of an agent's run (creation to last event). */
export function runRange(agent: AgentView): ReplayRange {
  const last = agent.timeline.at(-1)?.ts ?? agent.createdTs;
  return { startTs: agent.createdTs, endTs: Math.max(agent.finishedTs ?? last, last) };
}

export class ReplayPlayer {
  private state: WorldState = initialState();
  private index = 0;
  private cursor = -Infinity;
  private events: ArcadeEvent[];

  constructor(events: ArcadeEvent[]) {
    this.events = [...events].sort((a, b) => a.seq - b.seq);
  }

  /** World state after every event with ts <= cursorTs. */
  seek(cursorTs: number): WorldState {
    if (cursorTs < this.cursor) {
      this.state = initialState();
      this.index = 0;
    }
    this.cursor = cursorTs;
    while (this.index < this.events.length && this.events[this.index]!.ts <= cursorTs) {
      this.state = reduce(this.state, this.events[this.index]);
      this.index += 1;
    }
    return this.state;
  }
}
