/**
 * The Theme interface: everything look-and-feel lives behind it — palette,
 * tileset, station layout, sprites, overlays, text. The renderer
 * (WorldCanvas + sim) only computes positions/animation timing and calls
 * these hooks, so a second theme (e.g. a space map where agents are ships
 * and terminals are planets) can be added without touching event or
 * control code.
 *
 * Stations are dynamic: each universe has its own terminals, so the
 * theme lays them out on demand (plus the built-in Dock and Mailbox).
 */

import type { AgentState, TerminalKind, TerminalSpec } from "../../../shared/src";

/** Built-in stations every world has, alongside the universe's terminals. */
export type BuiltinStationId = "dock" | "mailbox";

export interface StationDef {
  /** Terminal id, or a built-in id. */
  id: string;
  name: string;
  kind: TerminalKind | "dock" | "mailbox";
  /** Building anchor (center x, ground y) in logical px. */
  x: number;
  y: number;
  /** Points (logical px, feet anchor) where agents stand to work. */
  slots: Array<{ x: number; y: number }>;
  /** Anchor for the name label / floating labels, logical px. */
  labelAnchor: { x: number; y: number };
  /** Rough hit box for clicking the building (logical px). */
  hit: { x: number; y: number; w: number; h: number };
  /** Set for user terminals (not for built-ins). */
  terminal?: TerminalSpec;
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
  /** Logical world size the theme draws in. */
  width: number;
  height: number;
  /** Where the camera starts (world px) and at what zoom (smooth themes). */
  home: { x: number; y: number };
  homeZoom: number;
  /** CSS color shown beyond the world's edge when panned out (smooth themes). */
  backdrop: string;
  /** Agent walk speed in logical px/s (worlds differ in size). */
  walkSpeed: number;
  /**
   * How far above an agent's feet (logical px) speech bubbles start —
   * high enough to clear the sprite and any overhead state badges.
   */
  bubbleClearance: number;
  /**
   * Place the universe's terminals plus the built-in Dock and Mailbox.
   * Pure: same terminals in, same layout out.
   */
  layoutStations(terminals: TerminalSpec[]): StationDef[];
  /**
   * Draw the static world (ground, decorations, stations, labels).
   * Called once per resize or layout change, never per frame — the
   * renderer caches it.
   */
  drawWorldStatic(ctx: CanvasRenderingContext2D, stations: StationDef[]): void;
  /**
   * Draw the animated world details (ambient motion like water glints
   * or blinking lights). Called every frame, on top of the static
   * layer and under the agents. Keep it cheap.
   */
  drawWorldDynamic(ctx: CanvasRenderingContext2D, stations: StationDef[], timeMs: number): void;
  /** Draw one agent (sprite + state overlays) with feet at (x, y). */
  drawAgent(ctx: CanvasRenderingContext2D, x: number, y: number, v: AgentVisual): void;
  /** Speech bubble above a head at (x, y = top of sprite). */
  drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void;
  /** Small floating label, centered on x. */
  drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void;
  /** Highlight a station (selected terminal). */
  drawStationSelection(ctx: CanvasRenderingContext2D, station: StationDef, timeMs: number): void;
}
