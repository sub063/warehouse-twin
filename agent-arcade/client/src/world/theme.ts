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
  /** The theme's color palette (pixel themes keep it tiny, smooth themes don't). */
  palette: readonly string[];
  /**
   * "integer": render at base resolution, blit at integer scale with
   * nearest-neighbor (crisp pixel art). "smooth": vector drawing at any
   * fractional scale with antialiasing (smooth mobile-game look).
   */
  scaling: "integer" | "smooth";
  /** Logical canvas size the theme draws in. */
  width: number;
  height: number;
  /** Agent walk speed in logical px/s (worlds differ in size). */
  walkSpeed: number;
  /**
   * How far above an agent's feet (logical px) speech bubbles start —
   * high enough to clear the sprite and any overhead state badges.
   */
  bubbleClearance: number;
  stations: StationDef[];
  station(id: StationId): StationDef;
  stationFor(category: ToolCategory): StationId;
  /**
   * Draw the world (ground, decorations, stations, labels). Integer
   * themes are drawn once and cached; smooth themes are drawn every
   * frame and may animate with timeMs.
   */
  drawWorld(ctx: CanvasRenderingContext2D, timeMs: number): void;
  /** Draw one agent (sprite + state overlays) with feet at (x, y). */
  drawAgent(ctx: CanvasRenderingContext2D, x: number, y: number, v: AgentVisual): void;
  /** Speech bubble above a head at (x, y = top of sprite). */
  drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void;
  /** Small floating label, centered on x. */
  drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void;
}
