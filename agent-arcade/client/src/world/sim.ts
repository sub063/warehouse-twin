/**
 * Presentation-only simulation: turns semantic agent state (from the
 * reducer) into sprite positions and walking animation. Purely visual —
 * nothing here feeds back into events or controls.
 */

import type { AgentView, WorldState } from "../../../shared/src";
import type { StationId, Theme } from "./theme";

const WALK_SPEED = 55; // px/s at base resolution

export interface Sprite {
  agentId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  walking: boolean;
  facing: 1 | -1;
  /** Station the agent is heading to / standing at. */
  station: StationId;
}

export class WorldSim {
  private sprites = new Map<string, Sprite>();

  constructor(private theme: Theme) {}

  /** Stable slot index so agents don't all stack on one tile. */
  private slotFor(stationId: StationId, agentIndex: number): { x: number; y: number } {
    const st = this.theme.station(stationId);
    const slot = st.slots[agentIndex % st.slots.length] ?? st.slots[0]!;
    return slot;
  }

  private targetStation(a: AgentView): StationId | null {
    switch (a.state) {
      case "using_tool":
        return this.theme.stationFor(a.currentTool?.category ?? "unknown");
      case "awaiting_approval":
        return "mailbox";
      case "idle":
      case "done":
        return "dock";
      case "thinking":
      case "paused":
      case "error":
        return null; // stay where they are
    }
  }

  tick(world: WorldState, dtMs: number): Sprite[] {
    const dt = Math.min(dtMs, 100) / 1000;

    world.order.forEach((id, index) => {
      const a = world.agents[id];
      if (!a) return;
      let s = this.sprites.get(id);
      if (!s) {
        const spawn = this.slotFor("dock", index);
        s = {
          agentId: id,
          x: spawn.x,
          y: spawn.y,
          targetX: spawn.x,
          targetY: spawn.y,
          walking: false,
          facing: 1,
          station: "dock",
        };
        this.sprites.set(id, s);
      }

      const station = this.targetStation(a);
      if (station !== null) {
        const slot = this.slotFor(station, index);
        s.targetX = slot.x;
        s.targetY = slot.y;
        s.station = station;
      }

      // L-shaped walk: horizontal leg first, then vertical.
      const dx = s.targetX - s.x;
      const dy = s.targetY - s.y;
      const step = WALK_SPEED * dt;
      if (Math.abs(dx) > 0.5) {
        const move = Math.sign(dx) * Math.min(Math.abs(dx), step);
        s.x += move;
        s.facing = dx < 0 ? -1 : 1;
        s.walking = true;
      } else if (Math.abs(dy) > 0.5) {
        s.x = s.targetX;
        s.y += Math.sign(dy) * Math.min(Math.abs(dy), step);
        s.walking = true;
      } else {
        s.x = s.targetX;
        s.y = s.targetY;
        s.walking = false;
      }
    });

    // Drop sprites for agents that vanished (shouldn't happen, but cheap).
    for (const id of this.sprites.keys()) {
      if (!(id in world.agents)) this.sprites.delete(id);
    }

    // Draw order: back-to-front by y.
    return [...this.sprites.values()].sort((a, b) => a.y - b.y);
  }

  /** Hit test for click-to-select, in base-resolution px. */
  hitTest(x: number, y: number): string | undefined {
    let best: { id: string; d: number } | undefined;
    for (const s of this.sprites.values()) {
      const cx = s.x;
      const cy = s.y - 7;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= 12 && (!best || d < best.d)) best = { id: s.agentId, d };
    }
    return best?.id;
  }
}
