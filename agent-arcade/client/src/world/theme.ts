/**
 * The Theme interface: everything look-and-feel lives behind it — palette,
 * tileset, station layout, sprites, overlays, text. The renderer
 * (WorldCanvas + sim) only computes positions/animation timing and calls
 * these hooks, so a second theme (e.g. a space map where agents are ships
 * and stations are planets) can be added without touching event or
 * control code.
 */

import type { AgentState, ToolCategory } from "../../../shared/src";

export type StationId = "terminal" | "library" | "workshop" | "mailbox" | "dock";

export interface StationDef {
  id: StationId;
  name: string;
  /** Points (base-resolution px, feet anchor) where agents stand to work. */
  slots: Array<{ x: number; y: number }>;
  /** Anchor for floating labels (e.g. unknown tool name), base px. */
  labelAnchor: { x: number; y: number };
}

/** Everything the theme needs to draw one agent this frame. */
export interface AgentVisual {
  /** Stable per-agent sprite variant. */
  variant: number;
  state: AgentState;
  walking: boolean;
  facing: 1 | -1;
  /** Milliseconds since page load; themes derive animation phases from it. */
  timeMs: number;
  selected: boolean;
}

export interface Theme {
  id: string;
  name: string;
  /** Exactly four CSS colors, darkest to lightest. */
  palette: readonly [string, string, string, string];
  tileSize: number;
  cols: number;
  rows: number;
  /** Base-resolution canvas size in px (cols*tileSize x rows*tileSize). */
  width: number;
  height: number;
  stations: StationDef[];
  station(id: StationId): StationDef;
  stationFor(category: ToolCategory): StationId;
  /** Draw the static world (ground, decorations, stations, labels). */
  drawWorld(ctx: CanvasRenderingContext2D): void;
  /** Draw one agent (sprite + state overlays) with feet at (x, y). */
  drawAgent(ctx: CanvasRenderingContext2D, x: number, y: number, v: AgentVisual): void;
  /** Speech bubble above a head at (x, y = top of sprite). */
  drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void;
  /** Small floating label, centered on x. */
  drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void;
}
