/**
 * Presentation-only simulation: turns semantic agent state (from the
 * reducer) into sprite positions and walking animation. Purely visual —
 * nothing here feeds back into events or controls.
 */

import type { AgentView, ToolCategory, WorldState } from "../../../shared/src";
import type { StationDef, Theme } from "./theme";

export interface Sprite {
  agentId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  walking: boolean;
  facing: 1 | -1;
  /** Station the agent is heading to / standing at. */
  stationId: string;
}

const CATEGORY_KIND: Record<ToolCategory, string> = {
  shell: "shell",
  search: "research",
  files: "files",
  human: "mailbox",
  unknown: "files",
};

export class WorldSim {
  private sprites = new Map<string, Sprite>();
  private stations: StationDef[] = [];
  private byId = new Map<string, StationDef>();

  constructor(private theme: Theme) {}

  setStations(stations: StationDef[]): void {
    this.stations = stations;
    this.byId = new Map(stations.map((s) => [s.id, s]));
  }

  private station(id: string): StationDef | undefined {
    return this.byId.get(id);
  }

  /** Stable slot index so agents don't all stack on one tile. */
  private slotFor(st: StationDef, agentIndex: number): { x: number; y: number } {
    return st.slots[agentIndex % st.slots.length] ?? st.slots[0] ?? { x: st.x, y: st.y };
  }

  /**
   * Where a tool call happens: the terminal it was routed to; if that
   * terminal isn't on this map (e.g. the merged "All" overview shows one
   * building per terminal name), one with the same name and kind; else
   * one of the tool's kind; else the first terminal; else the dock.
   */
  private stationForTool(a: AgentView, world: WorldState): StationDef | undefined {
    const run = a.currentTool;
    if (run?.terminalId) {
      const direct = this.byId.get(run.terminalId);
      if (direct) return direct;
      const spec = world.terminals[run.terminalId];
      if (spec) {
        const twin = this.stations.find((s) => s.terminal && s.name === spec.name && s.kind === spec.kind);
        if (twin) return twin;
        const sameKind = this.stations.find((s) => s.terminal && s.kind === spec.kind);
        if (sameKind) return sameKind;
      }
    }
    const kind = CATEGORY_KIND[run?.category ?? "unknown"];
    return (
      this.stations.find((s) => s.kind === kind && s.terminal) ??
      this.stations.find((s) => s.terminal) ??
      this.station("dock")
    );
  }

  private targetStation(a: AgentView, world: WorldState): StationDef | undefined | null {
    switch (a.state) {
      case "using_tool":
        return this.stationForTool(a, world);
      case "awaiting_approval":
        return this.station("mailbox");
      case "idle":
      case "done":
        return this.station("dock");
      case "thinking":
      case "paused":
      case "error":
        return null; // stay where they are
    }
  }

  tick(world: WorldState, dtMs: number, visible?: (a: AgentView) => boolean): Sprite[] {
    const dt = Math.min(dtMs, 100) / 1000;
    const dock = this.station("dock");

    world.order.forEach((id, index) => {
      const a = world.agents[id];
      if (!a || (visible && !visible(a))) return;
      let s = this.sprites.get(id);
      if (!s) {
        const spawn = dock ? this.slotFor(dock, index) : { x: this.theme.width / 2, y: this.theme.height / 2 };
        s = {
          agentId: id,
          x: spawn.x,
          y: spawn.y,
          targetX: spawn.x,
          targetY: spawn.y,
          walking: false,
          facing: 1,
          stationId: "dock",
        };
        this.sprites.set(id, s);
      }

      const station = this.targetStation(a, world);
      if (station) {
        const slot = this.slotFor(station, index);
        s.targetX = slot.x;
        s.targetY = slot.y;
        s.stationId = station.id;
      } else if (station === undefined && dock) {
        // Target vanished (terminal removed): head back to the dock.
        const slot = this.slotFor(dock, index);
        s.targetX = slot.x;
        s.targetY = slot.y;
        s.stationId = "dock";
      }

      // L-shaped walk: horizontal leg first, then vertical.
      const dx = s.targetX - s.x;
      const dy = s.targetY - s.y;
      const step = this.theme.walkSpeed * dt;
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

    // Drop sprites for agents that vanished or were filtered out.
    for (const id of this.sprites.keys()) {
      const a = world.agents[id];
      if (!a || (visible && !visible(a))) this.sprites.delete(id);
    }

    // Draw order: back-to-front by y.
    return [...this.sprites.values()].sort((a, b) => a.y - b.y);
  }

  /** Hit test for click-to-select, in logical px. Agents win over stations. */
  hitTest(x: number, y: number): { agentId?: string; stationId?: string } {
    let best: { id: string; d: number } | undefined;
    for (const s of this.sprites.values()) {
      const d = Math.hypot(x - s.x, y - (s.y - 7));
      if (d <= 12 && (!best || d < best.d)) best = { id: s.agentId, d };
    }
    if (best) return { agentId: best.id };
    for (const st of this.stations) {
      const h = st.hit;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return { stationId: st.id };
    }
    return {};
  }
}
