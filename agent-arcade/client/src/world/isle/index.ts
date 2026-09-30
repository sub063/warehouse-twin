/**
 * The "Isle" theme: a smooth, mobile-game style island — soft gradients,
 * rounded 3/4-view buildings, cute round agent bots. Everything is
 * vector-drawn in code (no image assets), so it stays sharp at any
 * scale. Terminals are laid out on a ring around the central plaza,
 * with the Dock (pier) fixed on the south shore.
 */

import type { TerminalKind, TerminalSpec } from "../../../../shared/src";
import type { AgentVisual, StationDef, Theme } from "../theme";

const W = 1600;
const H = 1200;

// iOS-ish system colors for agent variants.
const AGENT_COLORS = ["#3E8BFF", "#FF9F0A", "#FF5E7A", "#34C77B", "#AF6BF5", "#5AC8FA"];

const COLORS = {
  waterDeep: "#2E7CD6",
  waterShallow: "#46A0E8",
  sand: "#EFD9A7",
  sandEdge: "#E3C486",
  grassLight: "#93DA70",
  grassDark: "#63B944",
  path: "#EAD9AE",
  pathEdge: "#D9C089",
  ink: "#233042",
  badgeOrange: "#FF9F0A",
  badgeRed: "#FF453A",
  badgeGreen: "#30C758",
  badgeGray: "#8E8E93",
};

const FONT = (px: number, weight = 600) =>
  `${weight} ${px}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif`;

// ------------------------------------------------------------ helpers

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function softShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha = 0.18): void {
  ctx.save();
  ctx.fillStyle = `rgba(20, 40, 30, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function vGrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, c0: string, c1: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  return g;
}

const ISLAND = { cx: 800, cy: 590, rx: 700, ry: 500 };

function islandPath(ctx: CanvasRenderingContext2D, grow = 0): void {
  ctx.beginPath();
  ctx.ellipse(ISLAND.cx, ISLAND.cy, ISLAND.rx + grow, ISLAND.ry + grow, 0, 0, Math.PI * 2);
}

function insideIsland(x: number, y: number, margin = 0): boolean {
  const nx = (x - ISLAND.cx) / (ISLAND.rx - margin);
  const ny = (y - ISLAND.cy) / (ISLAND.ry - margin);
  return nx * nx + ny * ny < 1;
}

/** Small deterministic PRNG so scenery is stable across renders. */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lighten/darken a hex color by pct (-100..100). */
function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * 255)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ------------------------------------------------------------- layout

const PLAZA = { x: 800, y: 600 };
const RING = { cx: 800, cy: 610, rx: 470, ry: 300 };

/** Buildings shrink a little on crowded rings so they don't overlap. */
function crowdScale(ringCount: number): number {
  return Math.min(1, 14 / Math.max(1, ringCount));
}

const PIER = { x: 800, top: 1084, w: 84, h: 62 };

const DOCK: StationDef = {
  id: "dock",
  name: "Dock",
  kind: "dock",
  x: PIER.x,
  y: PIER.top + PIER.h,
  slots: [
    { x: PIER.x - 22, y: PIER.top + 18 },
    { x: PIER.x + 6, y: PIER.top + 18 },
    { x: PIER.x + 22, y: PIER.top + 38 },
    { x: PIER.x - 6, y: PIER.top + 42 },
    { x: PIER.x - 30, y: PIER.top + 38 },
  ],
  labelAnchor: { x: PIER.x, y: PIER.top + PIER.h + 4 },
  hit: { x: PIER.x - PIER.w / 2, y: PIER.top, w: PIER.w, h: PIER.h },
};

function ringStation(id: string, name: string, kind: StationDef["kind"], i: number, n: number, terminal?: TerminalSpec): StationDef {
  // Sweep the ring clockwise from lower-left, skipping the south sector
  // where the dock sits. Screen angles: 0 = right, 90 = down.
  const start = 130;
  const sweep = 280;
  const deg = start + (sweep * (i + 0.5)) / n;
  const rad = (deg * Math.PI) / 180;
  const x = Math.round(RING.cx + RING.rx * Math.cos(rad));
  const y = Math.round(RING.cy + RING.ry * Math.sin(rad));
  const s = crowdScale(n);
  const slotY = Math.round(y + 14 * s + 2);
  // Stagger every other label on crowded rings so neighbors don't collide.
  const stagger = n > 12 && i % 2 === 1 ? 9 : 0;
  return {
    id,
    name,
    kind,
    x,
    y,
    slots: [
      { x: Math.round(x - 24 * s), y: slotY },
      { x, y: slotY },
      { x: Math.round(x + 24 * s), y: slotY },
    ],
    labelAnchor: { x, y: slotY + 8 + stagger },
    hit: { x: x - 34 * s, y: y - 64 * s, w: 68 * s, h: 70 * s },
    terminal,
  };
}

/** Draw a station's building scaled around its ground anchor. */
function drawScaledBuilding(ctx: CanvasRenderingContext2D, st: StationDef, s: number): void {
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.scale(s, s);
  ctx.translate(-st.x, -st.y);
  drawBuilding(ctx, st);
  ctx.restore();
}

function layoutStations(terminals: TerminalSpec[]): StationDef[] {
  const ring: Array<{ id: string; name: string; kind: StationDef["kind"]; terminal?: TerminalSpec }> = [
    ...terminals.map((t) => ({ id: t.id, name: t.name, kind: t.kind, terminal: t })),
    { id: "mailbox", name: "Mailbox", kind: "mailbox" },
  ];
  const n = ring.length;
  return [...ring.map((r, i) => ringStation(r.id, r.name, r.kind, i, n, r.terminal)), DOCK];
}

// ---------------------------------------------------------- buildings

interface KindStyle {
  wall0: string;
  wall1: string;
  roof0: string;
  roof1: string;
  roof: "gable" | "round" | "flat";
  w: number;
  faceH: number;
}

const KIND_STYLE: Record<StationDef["kind"], KindStyle> = {
  shell: { wall0: "#3D4A63", wall1: "#2C3750", roof0: "#5A6B8C", roof1: "#46536F", roof: "gable", w: 62, faceH: 34 },
  research: { wall0: "#F7EBD3", wall1: "#E8D6B4", roof0: "#C96F4A", roof1: "#B25A38", roof: "gable", w: 64, faceH: 34 },
  files: { wall0: "#B98A5C", wall1: "#9E6F44", roof0: "#8A6A4C", roof1: "#74563B", roof: "gable", w: 62, faceH: 32 },
  image: { wall0: "#FBFBFD", wall1: "#E9EAF2", roof0: "#B77CF6", roof1: "#9558E0", roof: "round", w: 58, faceH: 32 },
  model3d: { wall0: "#EEF2F5", wall1: "#D6DEE6", roof0: "#3FB9B0", roof1: "#2C948C", roof: "gable", w: 60, faceH: 34 },
  store: { wall0: "#E6F7EA", wall1: "#CDEBD4", roof0: "#3AAE5C", roof1: "#2D8E49", roof: "flat", w: 62, faceH: 32 },
  marketing: { wall0: "#FFEAF0", wall1: "#F8D2DE", roof0: "#F0508A", roof1: "#CF3A70", roof: "round", w: 58, faceH: 32 },
  data: { wall0: "#DCE6F2", wall1: "#C3D2E4", roof0: "#5474A6", roof1: "#3F5A87", roof: "flat", w: 60, faceH: 34 },
  chat: { wall0: "#FFF4D6", wall1: "#F6E4B0", roof0: "#F5A623", roof1: "#D98A12", roof: "round", w: 56, faceH: 30 },
  custom: { wall0: "#ECE8F8", wall1: "#D8D0F0", roof0: "#8A8FA8", roof1: "#6F7590", roof: "gable", w: 58, faceH: 32 },
  mailbox: { wall0: "#FDFDFB", wall1: "#E8EAEE", roof0: "#4E9BFF", roof1: "#3578E5", roof: "round", w: 50, faceH: 30 },
  dock: { wall0: "#C89B66", wall1: "#A87C4C", roof0: "", roof1: "", roof: "flat", w: 68, faceH: 46 },
};

function drawRoof(ctx: CanvasRenderingContext2D, x: number, fy: number, s: KindStyle): void {
  if (s.roof === "gable") {
    const depth = 15;
    ctx.fillStyle = vGrad(ctx, fy - depth, fy, s.roof0, s.roof1);
    ctx.beginPath();
    ctx.moveTo(x - s.w / 2 - 6, fy);
    ctx.lineTo(x - s.w / 2 + 10, fy - depth);
    ctx.lineTo(x + s.w / 2 - 10, fy - depth);
    ctx.lineTo(x + s.w / 2 + 6, fy);
    ctx.closePath();
    ctx.fill();
  } else if (s.roof === "round") {
    ctx.fillStyle = vGrad(ctx, fy - 16, fy, s.roof0, s.roof1);
    ctx.beginPath();
    ctx.moveTo(x - s.w / 2 - 5, fy);
    ctx.quadraticCurveTo(x, fy - 22, x + s.w / 2 + 5, fy);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = vGrad(ctx, fy - 9, fy, s.roof0, s.roof1);
    rr(ctx, x - s.w / 2 - 5, fy - 9, s.w + 10, 10, 3);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  rr(ctx, x - s.w / 2 - 6, fy - 2, s.w + 12, 4, 2);
  ctx.fill();
}

/** Front face + ground shadow + roof; returns the face's top y. */
function buildingShell(ctx: CanvasRenderingContext2D, x: number, y: number, s: KindStyle): number {
  const fx = x - s.w / 2;
  const fy = y - s.faceH;
  softShadow(ctx, x, y + 3, s.w * 0.62, 8);
  ctx.fillStyle = vGrad(ctx, fy, y, s.wall0, s.wall1);
  rr(ctx, fx, fy, s.w, s.faceH, 7);
  ctx.fill();
  drawRoof(ctx, x, fy, s);
  return fy;
}

function door(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  rr(ctx, x - 5, y - 14, 10, 14, 3.5);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Signboard on the front face, then the kind's icon inside it. */
function sign(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: string): void {
  rr(ctx, x - w / 2, y - h / 2, w, h, 4);
  ctx.fillStyle = bg;
  ctx.fill();
}

const ICONS: Record<TerminalKind, (ctx: CanvasRenderingContext2D, x: number, y: number) => void> = {
  shell(ctx, x, y) {
    sign(ctx, x, y, 32, 20, "#101826");
    rr(ctx, x - 13, y - 7, 26, 14, 2.5);
    ctx.fillStyle = "#28E0A5";
    ctx.fill();
  },
  research(ctx, x, y) {
    sign(ctx, x, y, 28, 20, "#6B4B33");
    const spines = ["#E2574C", "#4A90D9", "#57B86A", "#E8B84B", "#9B6BD3"];
    spines.forEach((c, i) => {
      ctx.fillStyle = c;
      rr(ctx, x - 11 + i * 4.4, y - 6 + (i % 2), 3.2, 12 - (i % 2) * 2, 1);
      ctx.fill();
    });
  },
  files(ctx, x, y) {
    // Striped awning + hammer.
    ctx.fillStyle = "#F0F0EE";
    ctx.beginPath();
    ctx.moveTo(x - 17, y - 8);
    ctx.lineTo(x + 17, y - 8);
    ctx.lineTo(x + 15, y);
    ctx.lineTo(x - 15, y);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#FF8A3D";
    for (let i = 0; i < 5; i += 2) ctx.fillRect(x - 17 + i * 7, y - 10, 7, 12);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y + 7);
    ctx.rotate(-0.55);
    ctx.fillStyle = "#5C4530";
    rr(ctx, -1.4, -3, 2.8, 12, 1.4);
    ctx.fill();
    ctx.fillStyle = "#98A2AE";
    rr(ctx, -6, -7, 12, 5.5, 2);
    ctx.fill();
    ctx.restore();
  },
  image(ctx, x, y) {
    sign(ctx, x, y, 28, 20, "#FFFFFF");
    ctx.strokeStyle = "#9558E0";
    ctx.lineWidth = 1.6;
    rr(ctx, x - 14, y - 10, 28, 20, 4);
    ctx.stroke();
    // Mountains + sun.
    ctx.fillStyle = "#B77CF6";
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 7);
    ctx.lineTo(x - 4, y - 3);
    ctx.lineTo(x + 1, y + 3);
    ctx.lineTo(x + 5, y - 1);
    ctx.lineTo(x + 11, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#F5A623";
    ctx.beginPath();
    ctx.arc(x + 7, y - 5, 2.6, 0, Math.PI * 2);
    ctx.fill();
  },
  model3d(ctx, x, y) {
    sign(ctx, x, y, 26, 22, "#FFFFFF");
    // Isometric cube.
    const s = 7;
    ctx.fillStyle = "#3FB9B0";
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.2);
    ctx.lineTo(x + s, y - s * 0.6);
    ctx.lineTo(x, y);
    ctx.lineTo(x - s, y - s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2C948C";
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.6);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + s * 1.1);
    ctx.lineTo(x - s, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1F736D";
    ctx.beginPath();
    ctx.moveTo(x + s, y - s * 0.6);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + s * 1.1);
    ctx.lineTo(x + s, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  store(ctx, x, y) {
    // Green/white awning + price tag.
    ctx.fillStyle = "#F0F0EE";
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 9);
    ctx.lineTo(x + 18, y - 9);
    ctx.lineTo(x + 16, y - 1);
    ctx.lineTo(x - 16, y - 1);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#3AAE5C";
    for (let i = 0; i < 5; i += 2) ctx.fillRect(x - 18 + i * 7.2, y - 11, 7.2, 12);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y + 7);
    ctx.rotate(-0.4);
    ctx.fillStyle = "#F5A623";
    ctx.beginPath();
    ctx.moveTo(-8, -4);
    ctx.lineTo(4, -4);
    ctx.lineTo(9, 0);
    ctx.lineTo(4, 4);
    ctx.lineTo(-8, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(-4.5, 0, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  marketing(ctx, x, y) {
    sign(ctx, x, y, 28, 20, "#FFFFFF");
    // Megaphone.
    ctx.fillStyle = "#F0508A";
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 3);
    ctx.lineTo(x - 2, y - 3);
    ctx.lineTo(x + 8, y - 8);
    ctx.lineTo(x + 8, y + 8);
    ctx.lineTo(x - 2, y + 3);
    ctx.lineTo(x - 10, y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#F0508A";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + 9, y, 4.5, -0.9, 0.9);
    ctx.stroke();
  },
  data(ctx, x, y) {
    sign(ctx, x, y, 28, 20, "#FFFFFF");
    const bars = [5, 11, 8, 14];
    bars.forEach((h, i) => {
      ctx.fillStyle = i % 2 ? "#5474A6" : "#8FB3E8";
      rr(ctx, x - 11 + i * 6, y + 7 - h, 4.5, h, 1);
      ctx.fill();
    });
  },
  chat(ctx, x, y) {
    ctx.fillStyle = "#FFFFFF";
    rr(ctx, x - 13, y - 9, 26, 15, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 5);
    ctx.lineTo(x - 8, y + 10);
    ctx.lineTo(x - 1, y + 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#F5A623";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x - 6 + i * 6, y - 1.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  custom(ctx, x, y) {
    sign(ctx, x, y, 26, 20, "#FFFFFF");
    // Star.
    ctx.fillStyle = "#8A8FA8";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 3.5 : 8;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  },
};

function drawMailboxIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rr(ctx, x - 12, y - 8, 24, 16, 3);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.strokeStyle = "#3578E5";
  ctx.lineWidth = 1.6;
  rr(ctx, x - 12, y - 8, 24, 16, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 12, y - 6.5);
  ctx.lineTo(x, y + 2);
  ctx.lineTo(x + 12, y - 6.5);
  ctx.stroke();
}

function drawBuilding(ctx: CanvasRenderingContext2D, st: StationDef): void {
  const s = KIND_STYLE[st.kind];
  const fy = buildingShell(ctx, st.x, st.y, s);
  const iconY = fy + s.faceH * 0.5 - 1;
  if (st.kind === "mailbox") {
    drawMailboxIcon(ctx, st.x, iconY);
    ctx.fillStyle = "#3578E5";
    rr(ctx, st.x - 3, st.y - 7, 6, 7, 2);
    ctx.fill();
    return;
  }
  if (st.kind === "dock") return;
  const icon = ICONS[st.kind];
  const iconX = st.kind === "files" || st.kind === "store" ? st.x - 9 : st.x - 8;
  icon(ctx, iconX, iconY);
  door(ctx, st.x + s.w / 2 - 12, st.y, shade(s.wall1, -22));
  if (st.kind === "shell") {
    // Antenna mast (its light blinks in the dynamic pass).
    ctx.strokeStyle = "#8A97B0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(st.x + 18, fy - 13);
    ctx.lineTo(st.x + 18, fy - 30);
    ctx.stroke();
  }
}

function drawDockStatic(ctx: CanvasRenderingContext2D): void {
  const px = PIER.x;
  const top = PIER.top;
  softShadow(ctx, px, top + PIER.h, PIER.w / 2 + 6, 8, 0.12);
  ctx.fillStyle = vGrad(ctx, top, top + PIER.h, "#C89B66", "#A87C4C");
  rr(ctx, px - PIER.w / 2, top, PIER.w, PIER.h, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(90, 60, 30, 0.35)";
  ctx.lineWidth = 1.2;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(px - PIER.w / 2 + 2, top + i * 10);
    ctx.lineTo(px + PIER.w / 2 - 2, top + i * 10);
    ctx.stroke();
  }
  for (const [dx, dy] of [[-38, top + 4], [38, top + 4], [-38, top + PIER.h - 6], [38, top + PIER.h - 6]] as const) {
    ctx.fillStyle = "#7C5A38";
    ctx.beginPath();
    ctx.arc(px + dx, dy, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(px + dx - 1, dy - 1, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBoat(ctx: CanvasRenderingContext2D, t: number): void {
  const px = PIER.x;
  const bob = Math.sin(t / 900) * 1.6;
  ctx.save();
  ctx.translate(px + 70, PIER.top + 30 + bob);
  softShadow(ctx, 0, 8, 16, 4, 0.12);
  ctx.fillStyle = "#E2574C";
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.quadraticCurveTo(0, 10, 16, 0);
  ctx.quadraticCurveTo(0, 3, -16, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#F0EBD8";
  rr(ctx, -10, -3, 20, 4, 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(120, 90, 55, 0.7)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(px + PIER.w / 2 - 2, PIER.top + 36);
  ctx.quadraticCurveTo(px + 58, PIER.top + 40 + bob / 2, px + 60, PIER.top + 32 + bob);
  ctx.stroke();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1): void {
  softShadow(ctx, x, y + 2, 11 * s, 4 * s);
  ctx.fillStyle = "#7C5A38";
  rr(ctx, x - 2 * s, y - 8 * s, 4 * s, 9 * s, 2 * s);
  ctx.fill();
  const puffs: Array<[number, number, number]> = [[0, -18, 11], [-8, -12, 8.5], [8, -12, 8.5], [0, -10, 9]];
  for (const [dx, dy, r] of puffs) {
    ctx.fillStyle = "#4FA93E";
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(x - 3 * s, y - 19 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  softShadow(ctx, x, y + 1, 7, 2.5);
  ctx.fillStyle = "#58B348";
  ctx.beginPath();
  ctx.arc(x - 4, y - 3, 4.5, 0, Math.PI * 2);
  ctx.arc(x + 3, y - 4, 5, 0, Math.PI * 2);
  ctx.arc(x, y - 2, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawPathTo(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(PLAZA.x, PLAZA.y);
  ctx.quadraticCurveTo((PLAZA.x + x) / 2, (PLAZA.y + y) / 2 + 24, x, y);
  ctx.stroke();
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  softShadow(ctx, x, y + 2, 9 * s, 3 * s, 0.14);
  ctx.fillStyle = "#9AA5B1";
  ctx.beginPath();
  ctx.moveTo(x - 9 * s, y);
  ctx.quadraticCurveTo(x - 8 * s, y - 9 * s, x - 1 * s, y - 9 * s);
  ctx.quadraticCurveTo(x + 9 * s, y - 8 * s, x + 9 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.ellipse(x - 3 * s, y - 6 * s, 3 * s, 1.5 * s, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlowers(ctx: CanvasRenderingContext2D, x: number, y: number, r: () => number): void {
  const colors = ["#FF6B8A", "#FFD166", "#FFFFFF", "#B98CFF"];
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)]!;
    ctx.beginPath();
    ctx.arc(x + (r() - 0.5) * 26, y + (r() - 0.5) * 16, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPond(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = COLORS.sand;
  ctx.beginPath();
  ctx.ellipse(x, y, rx + 8, ry + 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.waterShallow;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.3, y - ry * 0.35, rx * 0.35, ry * 0.2, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** Distance from a point to the plaza->station path (approximated as a segment). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------------------------------------------------- static scene

function drawStaticScene(ctx: CanvasRenderingContext2D, theme: Theme, stations: StationDef[]): void {
  const m = ctx.getTransform();
  const vx = -m.e / m.a;
  const vy = -m.f / m.d;
  const vw = ctx.canvas.width / m.a;
  const vh = ctx.canvas.height / m.d;
  const wg = ctx.createLinearGradient(0, vy, 0, vy + vh);
  wg.addColorStop(0, COLORS.waterShallow);
  wg.addColorStop(1, COLORS.waterDeep);
  ctx.fillStyle = wg;
  ctx.fillRect(vx - 2, vy - 2, vw + 4, vh + 4);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 5;
  islandPath(ctx, 8);
  ctx.stroke();
  ctx.restore();

  islandPath(ctx, 6);
  ctx.fillStyle = COLORS.sandEdge;
  ctx.fill();
  islandPath(ctx, 1);
  ctx.fillStyle = COLORS.sand;
  ctx.fill();
  islandPath(ctx, -8);
  ctx.fillStyle = vGrad(ctx, 60, 320, COLORS.grassLight, COLORS.grassDark);
  ctx.fill();

  ctx.save();
  islandPath(ctx, -8);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 420; i++) {
    ctx.fillRect(ISLAND.cx - ISLAND.rx + ((i * 83) % (ISLAND.rx * 2)), ISLAND.cy - ISLAND.ry + ((i * 53) % (ISLAND.ry * 2)), 3, 1.4);
  }
  ctx.restore();

  const ring = stations.filter((s) => s.kind !== "dock");

  // Ponds and the ring road that links every terminal.
  drawPond(ctx, 470, 930, 70, 42);
  drawPond(ctx, 1180, 300, 62, 36);
  ctx.save();
  ctx.lineCap = "round";
  for (const [color, width] of [[COLORS.pathEdge, 15], [COLORS.path, 11]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(RING.cx, RING.cy + 18, RING.rx, RING.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Paths from the plaza to each ring station and to the dock.
  for (const [color, width] of [[COLORS.pathEdge, 13], [COLORS.path, 9]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const s of ring) drawPathTo(ctx, s.slots[1]!.x, s.slots[1]!.y - 2);
    drawPathTo(ctx, PIER.x, PIER.top - 6);
  }
  ctx.restore();

  // Scenery: seeded so it never moves, kept off buildings, paths and water.
  const r = rng(1337);
  const clear = (x: number, y: number, pad: number) => {
    if (!insideIsland(x, y, 40)) return false;
    if (Math.hypot(x - PLAZA.x, y - PLAZA.y) < 60 + pad) return false;
    if (Math.hypot(x - 470, y - 930) < 95 + pad || Math.hypot(x - 1180, y - 300) < 85 + pad) return false;
    if (Math.abs(x - PIER.x) < 60 && y > PIER.top - 90) return false;
    for (const s of ring) {
      if (Math.hypot(x - s.x, y - s.y + 20) < 70 + pad) return false;
      if (distToSegment(x, y, PLAZA.x, PLAZA.y, s.slots[1]!.x, s.slots[1]!.y) < 22 + pad) return false;
      // Ring road.
      const nx = (x - RING.cx) / RING.rx;
      const ny = (y - RING.cy - 18) / RING.ry;
      const d = Math.abs(Math.sqrt(nx * nx + ny * ny) - 1);
      if (d < 0.05 + pad / 300) return false;
    }
    if (distToSegment(x, y, PLAZA.x, PLAZA.y, PIER.x, PIER.top) < 22 + pad) return false;
    return true;
  };
  const scenery: Array<{ x: number; y: number; kind: "tree" | "bush" | "rock" | "flowers"; s: number }> = [];
  let tries = 0;
  while (scenery.length < 150 && tries < 4000) {
    tries += 1;
    const x = ISLAND.cx + (r() * 2 - 1) * ISLAND.rx;
    const y = ISLAND.cy + (r() * 2 - 1) * ISLAND.ry;
    const roll = r();
    const kind = roll < 0.5 ? "tree" : roll < 0.75 ? "bush" : roll < 0.88 ? "rock" : "flowers";
    const pad = kind === "tree" ? 10 : 0;
    if (!clear(x, y, pad)) continue;
    if (scenery.some((o) => Math.hypot(o.x - x, o.y - y) < (kind === "tree" ? 34 : 22))) continue;
    scenery.push({ x, y, kind, s: 0.8 + r() * 0.5 });
  }
  scenery.sort((a, b) => a.y - b.y);
  for (const o of scenery) {
    if (o.kind === "tree") drawTree(ctx, o.x, o.y, o.s);
    else if (o.kind === "bush") drawBush(ctx, o.x, o.y);
    else if (o.kind === "rock") drawRock(ctx, o.x, o.y, o.s);
    else drawFlowers(ctx, o.x, o.y, r);
  }

  // Central plaza.
  softShadow(ctx, PLAZA.x, PLAZA.y + 4, 26, 9, 0.1);
  ctx.fillStyle = COLORS.path;
  ctx.beginPath();
  ctx.ellipse(PLAZA.x, PLAZA.y, 26, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.pathEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(PLAZA.x, PLAZA.y, 19, 11.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Buildings back-to-front, then the dock.
  const cs = crowdScale(ring.length);
  for (const s of [...ring].sort((a, b) => a.y - b.y)) drawScaledBuilding(ctx, s, cs);
  drawDockStatic(ctx);

  for (const s of stations) theme.drawLabel(ctx, s.labelAnchor.x, s.labelAnchor.y, s.name);
}

// ------------------------------------------------------------- theme

export const isleTheme: Theme = {
  id: "isle",
  name: "Isle",
  palette: Object.values(COLORS),
  scaling: "smooth",
  width: W,
  height: H,
  home: { x: PLAZA.x, y: PLAZA.y + 20 },
  homeZoom: 1.2,
  backdrop: COLORS.waterDeep,
  walkSpeed: 120,
  bubbleClearance: 34,

  layoutStations,

  drawWorldStatic(ctx: CanvasRenderingContext2D, stations: StationDef[]): void {
    drawStaticScene(ctx, this, stations);
  },

  drawWorldDynamic(ctx: CanvasRenderingContext2D, stations: StationDef[], t: number): void {
    // Drifting water highlights (skipped where the island sits).
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 70; i++) {
      const px = ((i * 137 + t * 0.012 + i * i * 31) % (W + 160)) - 80;
      const py = ((i * 97) % (H + 120)) - 60 + Math.sin(t / 1400 + i) * 4;
      if (insideIsland(px, py, -20)) continue;
      ctx.beginPath();
      ctx.ellipse(px, py, 16 + (i % 3) * 7, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    drawBoat(ctx, t);

    // Blinking antenna lights on shell terminals; flickering screens.
    const cs = crowdScale(stations.filter((s) => s.kind !== "dock").length);
    for (const s of stations) {
      if (s.kind !== "shell") continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(cs, cs);
      ctx.translate(-s.x, -s.y);
      const fy = s.y - KIND_STYLE.shell.faceH;
      ctx.fillStyle = Math.floor(t / 600) % 2 ? "#FF453A" : "#7A2E28";
      ctx.beginPath();
      ctx.arc(s.x + 18, fy - 32, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0F2A20";
      const iconY = fy + KIND_STYLE.shell.faceH * 0.5 - 1;
      [12, 10, 15, 8].forEach((lw, i) => {
        ctx.globalAlpha = Math.floor(t / 400 + i) % 4 !== i % 4 ? 1 : 0.35;
        ctx.fillRect(s.x - 18, iconY - 5 + i * 3, lw, 1.6);
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  },

  drawStationSelection(ctx: CanvasRenderingContext2D, st: StationDef, t: number): void {
    const pulse = 1 + Math.sin(t / 350) * 0.05;
    const w = (st.hit.w / 2) * pulse;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(st.x, st.y + 4, w, w * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(st.x, st.y + 4, w, w * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  drawAgent(ctx: CanvasRenderingContext2D, x: number, y: number, v: AgentVisual): void {
    const t = v.timeMs;
    const color = AGENT_COLORS[v.variant % AGENT_COLORS.length] ?? AGENT_COLORS[0]!;
    const working = v.state === "using_tool" && !v.walking;
    const bobSpeed = v.walking ? 130 : working ? 210 : 900;
    const bobAmp = v.walking ? 1.6 : working ? 1.3 : 0.8;
    const bob = Math.abs(Math.sin(t / bobSpeed)) * -bobAmp;
    const err = v.state === "error";
    const flicker = err ? 0.55 + 0.35 * Math.abs(Math.sin(t / 140)) : 1;

    ctx.save();
    ctx.globalAlpha = flicker;

    if (v.selected) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 11, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 11, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    softShadow(ctx, x, y + 1, 7 + bob * 0.5, 2.8, 0.22);

    ctx.translate(x, y + bob);
    if (v.facing === -1) ctx.scale(-1, 1);

    const step = v.walking ? Math.sin(t / 110) * 2.4 : 0;
    ctx.fillStyle = err ? "#9AA0A8" : color;
    ctx.beginPath();
    ctx.ellipse(-3.4, -1.4 + step * 0.35, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(3.4, -1.4 - step * 0.35, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyC = err ? "#B0B6BE" : color;
    const g = ctx.createLinearGradient(0, -17, 0, -1);
    g.addColorStop(0, bodyC);
    g.addColorStop(1, shade(bodyC, -18));
    ctx.fillStyle = g;
    rr(ctx, -7, -17, 14, 15, 6.5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(0.5, -6.5, 4.6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-2.5, -14.5, 3, 1.6, -0.4, 0, Math.PI * 2);
    ctx.fill();

    const blink = Math.floor(t / 2900 + v.variant) % 7 === 0 && t % 2900 < 140;
    ctx.fillStyle = COLORS.ink;
    if (blink) {
      ctx.fillRect(0.2, -12.4, 3, 1);
      ctx.fillRect(4.2, -12.4, 3, 1);
    } else {
      ctx.beginPath();
      ctx.arc(1.8, -12, 1.5, 0, Math.PI * 2);
      ctx.arc(5.6, -12, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(2.3, -12.5, 0.5, 0, Math.PI * 2);
      ctx.arc(6.1, -12.5, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (working) {
      ctx.save();
      ctx.translate(7.5, -9);
      ctx.rotate(Math.sin(t / 210) * 0.9 - 0.4);
      ctx.fillStyle = "#6B7684";
      rr(ctx, -1, -8, 2.2, 9, 1);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -8.5, 2.2, 0.6, Math.PI * 2 - 0.6);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    const topY = y - 20 + bob;
    if (v.state === "awaiting_approval") {
      const pulse = 1 + Math.sin(t / 300) * 0.08;
      badge(ctx, x, topY - 5, 6.5 * pulse, COLORS.badgeOrange);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = FONT(9, 800);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", x, topY - 4.6);
    } else if (v.state === "done") {
      badge(ctx, x, topY - 5, 6.5, COLORS.badgeGreen);
      check(ctx, x, topY - 5);
      ctx.strokeStyle = "#7C5A38";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 11, y);
      ctx.lineTo(x + 11, y - 13);
      ctx.stroke();
      ctx.fillStyle = COLORS.badgeGreen;
      ctx.beginPath();
      ctx.moveTo(x + 11.8, y - 13);
      ctx.lineTo(x + 19, y - 10.5);
      ctx.lineTo(x + 11.8, y - 8);
      ctx.closePath();
      ctx.fill();
    } else if (v.state === "paused") {
      badge(ctx, x, topY - 5, 6.5, COLORS.badgeGray);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(x - 2.4, topY - 7.6, 1.8, 5.2);
      ctx.fillRect(x + 0.7, topY - 7.6, 1.8, 5.2);
    } else if (err) {
      badge(ctx, x, topY - 5, 6.5, COLORS.badgeRed);
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x - 2.2, topY - 7.2);
      ctx.lineTo(x + 2.2, topY - 2.8);
      ctx.moveTo(x + 2.2, topY - 7.2);
      ctx.lineTo(x - 2.2, topY - 2.8);
      ctx.stroke();
    } else if (v.state === "thinking") {
      const dots = (Math.floor(t / 350) % 3) + 1;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      rr(ctx, x - 9, topY - 8, 18, 8, 4);
      ctx.fill();
      ctx.fillStyle = COLORS.ink;
      for (let i = 0; i < dots; i++) {
        ctx.beginPath();
        ctx.arc(x - 4 + i * 4, topY - 4, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    ctx.save();
    ctx.font = FONT(9.5, 600);
    const maxW = 120;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const trial = (cur + " " + w).trim();
      if (ctx.measureText(trial).width <= maxW - 14) {
        cur = trial;
      } else {
        if (cur) lines.push(cur);
        cur = w;
        if (lines.length === 2) break;
      }
    }
    if (cur && lines.length < 2) lines.push(cur);
    if (lines.length === 0) {
      ctx.restore();
      return;
    }
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bw = tw + 14;
    const bh = lines.length * 12 + 8;
    const bx = Math.max(4, Math.min(W - bw - 4, x - bw / 2));
    const by = Math.max(4, y - bh - 10);

    ctx.fillStyle = "rgba(30, 50, 80, 0.16)";
    rr(ctx, bx + 1, by + 2.5, bw, bh, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    rr(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 4, by + bh - 1);
    ctx.lineTo(x, by + bh + 6);
    ctx.lineTo(x + 4, by + bh - 1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 5 + i * 12));
    ctx.restore();
  },

  drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    ctx.save();
    ctx.font = FONT(8, 700);
    const label = text.toUpperCase().slice(0, 22);
    const tw = ctx.measureText(label).width;
    const bw = tw + 12;
    const bx = Math.max(2, Math.min(W - bw - 2, x - bw / 2));
    ctx.fillStyle = "rgba(28, 38, 52, 0.72)";
    rr(ctx, bx, y, bw, 11, 5.5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + bw / 2, y + 5.8);
    ctx.restore();
  },
};

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = "rgba(20, 30, 45, 0.22)";
  rr(ctx, x - r + 0.5, y - r + 1.5, r * 2, r * 2, r * 0.62);
  ctx.fill();
  ctx.fillStyle = color;
  rr(ctx, x - r, y - r, r * 2, r * 2, r * 0.62);
  ctx.fill();
}

function check(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 2.8, y + 0.2);
  ctx.lineTo(x - 0.8, y + 2.4);
  ctx.lineTo(x + 3, y - 2.4);
  ctx.stroke();
}
