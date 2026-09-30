/**
 * The "Isle" theme: a smooth, mobile-game style island — soft gradients,
 * rounded 3/4-view buildings, cute round agent bots. Everything is
 * vector-drawn in code (no image assets), so it stays sharp at any
 * scale. Same Theme interface as the pixel Handheld theme; the event
 * and control code never changes.
 */

import type { ToolCategory } from "../../../../shared/src";
import type { AgentVisual, StationDef, StationId, Theme } from "../theme";

const W = 480;
const H = 360;

// iOS-ish system colors for agent variants.
const AGENT_COLORS = ["#3E8BFF", "#FF9F0A", "#FF5E7A", "#34C77B", "#AF6BF5", "#5AC8FA"];

const COLORS = {
  waterDeep: "#2E7CD6",
  waterShallow: "#46A0E8",
  sand: "#EFD9A7",
  sandEdge: "#E3C486",
  grass: "#7ECC5B",
  grassLight: "#93DA70",
  grassDark: "#63B944",
  path: "#EAD9AE",
  pathEdge: "#D9C089",
  ink: "#233042",
  white: "#FFFFFF",
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

function islandPath(ctx: CanvasRenderingContext2D, grow = 0): void {
  // Organic rounded island blob, centered on (240, 185).
  const cx = 240;
  const cy = 185;
  const rx = 168 + grow;
  const ry = 126 + grow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

// ---------------------------------------------------------- buildings

interface BuildingOpts {
  x: number; // center x
  y: number; // ground line (front bottom)
  w: number;
  faceH: number;
  wall0: string;
  wall1: string;
}

/** Front face + ground shadow shared by all buildings; returns face rect. */
function buildingBase(ctx: CanvasRenderingContext2D, o: BuildingOpts): { fx: number; fy: number } {
  const fx = o.x - o.w / 2;
  const fy = o.y - o.faceH;
  softShadow(ctx, o.x, o.y + 3, o.w * 0.62, 8);
  ctx.fillStyle = vGrad(ctx, fy, o.y, o.wall0, o.wall1);
  rr(ctx, fx, fy, o.w, o.faceH, 7);
  ctx.fill();
  return { fx, fy };
}

function gableRoof(ctx: CanvasRenderingContext2D, x: number, roofY: number, w: number, depth: number, c0: string, c1: string): void {
  // Simple 3/4 gable: a trapezoid top + overhanging eave.
  ctx.fillStyle = vGrad(ctx, roofY - depth, roofY, c0, c1);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 6, roofY);
  ctx.lineTo(x - w / 2 + 10, roofY - depth);
  ctx.lineTo(x + w / 2 - 10, roofY - depth);
  ctx.lineTo(x + w / 2 + 6, roofY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  rr(ctx, x - w / 2 - 6, roofY - 2, w + 12, 4, 2);
  ctx.fill();
}

function drawTerminalStatic(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 62;
  const { fy } = buildingBase(ctx, { x, y, w, faceH: 34, wall0: "#3D4A63", wall1: "#2C3750" });
  gableRoof(ctx, x, fy, w, 14, "#5A6B8C", "#46536F");
  // Antenna mast (the blinking light is dynamic).
  ctx.strokeStyle = "#8A97B0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 18, fy - 13);
  ctx.lineTo(x + 18, fy - 30);
  ctx.stroke();
  // Glowing terminal screen.
  rr(ctx, x - 22, fy + 7, 32, 20, 4);
  ctx.fillStyle = "#101826";
  ctx.fill();
  rr(ctx, x - 19, fy + 10, 26, 14, 2.5);
  ctx.fillStyle = "#28E0A5";
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  // Door.
  rr(ctx, x + 12, y - 13, 10, 13, 3);
  ctx.fillStyle = "#1E2839";
  ctx.fill();
}

function drawTerminalDynamic(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const fy = y - 34;
  // Blinking antenna light.
  ctx.fillStyle = Math.floor(t / 600) % 2 ? "#FF453A" : "#7A2E28";
  ctx.beginPath();
  ctx.arc(x + 18, fy - 32, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // Flickering text lines on the screen.
  ctx.fillStyle = "#0F2A20";
  const lines = [12, 10, 15, 8];
  lines.forEach((lw, i) => {
    ctx.globalAlpha = Math.floor(t / 400 + i) % 4 !== i % 4 ? 1 : 0.35;
    ctx.fillRect(x - 16, fy + 12.5 + i * 3, lw, 1.6);
  });
  ctx.globalAlpha = 1;
}

function drawLibrary(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 64;
  const { fy } = buildingBase(ctx, { x, y, w, faceH: 34, wall0: "#F7EBD3", wall1: "#E8D6B4" });
  gableRoof(ctx, x, fy, w, 16, "#C96F4A", "#B25A38");
  // Arched window with book spines.
  rr(ctx, x - 24, fy + 7, 26, 20, 5);
  ctx.fillStyle = "#6B4B33";
  ctx.fill();
  const spines = ["#E2574C", "#4A90D9", "#57B86A", "#E8B84B", "#9B6BD3"];
  spines.forEach((c, i) => {
    ctx.fillStyle = c;
    rr(ctx, x - 21 + i * 4.2, fy + 11 + (i % 2), 3.2, 13 - (i % 2) * 2, 1);
    ctx.fill();
  });
  // Door.
  rr(ctx, x + 10, y - 15, 12, 15, 4);
  ctx.fillStyle = "#7C5940";
  ctx.fill();
  ctx.fillStyle = "#E8D6B4";
  ctx.beginPath();
  ctx.arc(x + 19, y - 8, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawWorkshop(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 62;
  const { fy } = buildingBase(ctx, { x, y, w, faceH: 32, wall0: "#B98A5C", wall1: "#9E6F44" });
  gableRoof(ctx, x, fy, w, 14, "#8A6A4C", "#74563B");
  // Striped awning.
  const aw = 34;
  ctx.fillStyle = "#F0F0EE";
  ctx.beginPath();
  ctx.moveTo(x - 26, fy + 8);
  ctx.lineTo(x - 26 + aw, fy + 8);
  ctx.lineTo(x - 28 + aw, fy + 16);
  ctx.lineTo(x - 28, fy + 16);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#FF8A3D";
  for (let i = 0; i < 5; i += 2) ctx.fillRect(x - 27 + i * 7, fy + 6, 7, 12);
  ctx.restore();
  // Workbench under awning.
  rr(ctx, x - 24, fy + 18, 30, 9, 2);
  ctx.fillStyle = "#6E4F35";
  ctx.fill();
  // Hammer sign.
  ctx.save();
  ctx.translate(x + 16, fy + 12);
  ctx.rotate(-0.5);
  ctx.fillStyle = "#5C4530";
  rr(ctx, -1.5, -2, 3, 14, 1.5);
  ctx.fill();
  ctx.fillStyle = "#98A2AE";
  rr(ctx, -6, -6, 12, 6, 2);
  ctx.fill();
  ctx.restore();
}

function drawMailbox(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 50;
  const { fy } = buildingBase(ctx, { x, y, w, faceH: 30, wall0: "#FDFDFB", wall1: "#E8EAEE" });
  // Rounded blue roof.
  ctx.fillStyle = vGrad(ctx, fy - 14, fy, "#4E9BFF", "#3578E5");
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 5, fy);
  ctx.quadraticCurveTo(x, fy - 20, x + w / 2 + 5, fy);
  ctx.closePath();
  ctx.fill();
  // Envelope sign.
  rr(ctx, x - 12, fy + 7, 24, 16, 3);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.strokeStyle = "#3578E5";
  ctx.lineWidth = 1.6;
  rr(ctx, x - 12, fy + 7, 24, 16, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 12, fy + 8.5);
  ctx.lineTo(x, fy + 17);
  ctx.lineTo(x + 12, fy + 8.5);
  ctx.stroke();
  // Slot post.
  ctx.fillStyle = "#3578E5";
  rr(ctx, x - 3, y - 7, 6, 7, 2);
  ctx.fill();
}

function drawDockStatic(ctx: CanvasRenderingContext2D): void {
  // Wooden pier reaching from the south shore into the water.
  const px = 240;
  softShadow(ctx, px, 352, 40, 7, 0.12);
  ctx.fillStyle = vGrad(ctx, 306, 354, "#C89B66", "#A87C4C");
  rr(ctx, px - 34, 306, 68, 46, 6);
  ctx.fill();
  // Plank seams.
  ctx.strokeStyle = "rgba(90, 60, 30, 0.35)";
  ctx.lineWidth = 1.2;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(px - 32, 306 + i * 9);
    ctx.lineTo(px + 32, 306 + i * 9);
    ctx.stroke();
  }
  // Posts.
  for (const [dx, dy] of [[-30, 310], [30, 310], [-30, 344], [30, 344]] as const) {
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
  // A little moored rowboat, bobbing on the water.
  const px = 240;
  const bob = Math.sin(t / 900) * 1.6;
  ctx.save();
  ctx.translate(px + 58, 330 + bob);
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
  // Rope to the pier.
  ctx.strokeStyle = "rgba(120, 90, 55, 0.7)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(px + 32, 336);
  ctx.quadraticCurveTo(px + 46, 340 + bob / 2, px + 48, 332 + bob);
  ctx.stroke();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1): void {
  softShadow(ctx, x, y + 2, 11 * s, 4 * s);
  ctx.fillStyle = "#7C5A38";
  rr(ctx, x - 2 * s, y - 8 * s, 4 * s, 9 * s, 2 * s);
  ctx.fill();
  const puffs: Array<[number, number, number]> = [
    [0, -18, 11],
    [-8, -12, 8.5],
    [8, -12, 8.5],
    [0, -10, 9],
  ];
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

// ------------------------------------------------------------ layout

const STATIONS: StationDef[] = [
  {
    id: "terminal",
    name: "Terminal",
    slots: [
      { x: 106, y: 138 },
      { x: 130, y: 138 },
      { x: 154, y: 138 },
    ],
    labelAnchor: { x: 130, y: 146 },
  },
  {
    id: "library",
    name: "Library",
    slots: [
      { x: 328, y: 138 },
      { x: 352, y: 138 },
      { x: 376, y: 138 },
    ],
    labelAnchor: { x: 352, y: 146 },
  },
  {
    id: "workshop",
    name: "Workshop",
    slots: [
      { x: 106, y: 282 },
      { x: 130, y: 282 },
      { x: 154, y: 282 },
    ],
    labelAnchor: { x: 130, y: 290 },
  },
  {
    id: "mailbox",
    name: "Mailbox",
    slots: [
      { x: 330, y: 286 },
      { x: 352, y: 286 },
      { x: 374, y: 286 },
    ],
    labelAnchor: { x: 352, y: 292 },
  },
  {
    id: "dock",
    name: "Dock",
    slots: [
      { x: 222, y: 322 },
      { x: 246, y: 322 },
      { x: 258, y: 340 },
      { x: 234, y: 344 },
      { x: 212, y: 338 },
    ],
    labelAnchor: { x: 240, y: 354 },
  },
];

const CATEGORY_STATION: Record<ToolCategory, StationId> = {
  shell: "terminal",
  search: "library",
  files: "workshop",
  human: "mailbox",
  unknown: "workshop",
};

const BUILDING_POS = {
  terminal: { x: 130, y: 122 },
  library: { x: 352, y: 122 },
  workshop: { x: 130, y: 266 },
  mailbox: { x: 352, y: 266 },
} as const;

function drawPathTo(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(240, 192);
  ctx.quadraticCurveTo((240 + x) / 2, (192 + y) / 2 + 12, x, y);
  ctx.stroke();
}

// ---------------------------------------------------- static scene

let staticCache: { canvas: HTMLCanvasElement; w: number; h: number; a: number; e: number; f: number } | null = null;

function drawStaticScene(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  vw: number,
  vh: number,
  vx: number,
  vy: number,
): void {
  // Water, covering the whole visible viewport (in logical coords).
  const wg = ctx.createLinearGradient(0, vy, 0, vy + vh);
  wg.addColorStop(0, COLORS.waterShallow);
  wg.addColorStop(1, COLORS.waterDeep);
  ctx.fillStyle = wg;
  ctx.fillRect(vx - 2, vy - 2, vw + 4, vh + 4);

  // Foam ring + sand + grass plateau.
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

  // Grass texture: sparse light flecks.
  ctx.save();
  islandPath(ctx, -8);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 40; i++) {
    const gx = 90 + ((i * 83) % 300);
    const gy = 75 + ((i * 53) % 220);
    ctx.fillRect(gx, gy, 3, 1.4);
  }
  ctx.restore();

  // Paths from the central plaza to each station.
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = COLORS.pathEdge;
  ctx.lineWidth = 13;
  for (const s of [STATIONS[0]!, STATIONS[1]!, STATIONS[2]!, STATIONS[3]!]) {
    const mid = s.slots[1]!;
    drawPathTo(ctx, mid.x, mid.y - 2);
  }
  drawPathTo(ctx, 240, 300);
  ctx.strokeStyle = COLORS.path;
  ctx.lineWidth = 9;
  for (const s of [STATIONS[0]!, STATIONS[1]!, STATIONS[2]!, STATIONS[3]!]) {
    const mid = s.slots[1]!;
    drawPathTo(ctx, mid.x, mid.y - 2);
  }
  drawPathTo(ctx, 240, 300);
  ctx.restore();

  // Central plaza.
  softShadow(ctx, 240, 196, 26, 9, 0.1);
  ctx.fillStyle = COLORS.path;
  ctx.beginPath();
  ctx.ellipse(240, 192, 26, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.pathEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(240, 192, 19, 11.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Decorations.
  drawTree(ctx, 196, 78, 0.9);
  drawTree(ctx, 286, 84, 1.05);
  drawTree(ctx, 86, 196, 1);
  drawTree(ctx, 396, 200, 0.9);
  drawBush(ctx, 174, 232);
  drawBush(ctx, 308, 236);
  drawBush(ctx, 240, 120);

  // Dock + buildings (static parts).
  drawDockStatic(ctx);
  drawTerminalStatic(ctx, BUILDING_POS.terminal.x, BUILDING_POS.terminal.y);
  drawLibrary(ctx, BUILDING_POS.library.x, BUILDING_POS.library.y);
  drawWorkshop(ctx, BUILDING_POS.workshop.x, BUILDING_POS.workshop.y);
  drawMailbox(ctx, BUILDING_POS.mailbox.x, BUILDING_POS.mailbox.y);

  // Station name labels (map-style pills).
  for (const s of STATIONS) {
    theme.drawLabel(ctx, s.labelAnchor.x, s.labelAnchor.y, s.name);
  }
}

// ------------------------------------------------------------- theme

export const isleTheme: Theme = {
  id: "isle",
  name: "Isle",
  palette: Object.values(COLORS),
  scaling: "smooth",
  width: W,
  height: H,
  walkSpeed: 85,
  bubbleClearance: 34,
  stations: STATIONS,

  station(id: StationId): StationDef {
    const s = STATIONS.find((st) => st.id === id);
    if (!s) throw new Error(`no station ${id}`);
    return s;
  },

  stationFor(category: ToolCategory): StationId {
    return CATEGORY_STATION[category] ?? "workshop";
  },

  drawWorld(ctx: CanvasRenderingContext2D, t: number): void {
    // The static scene (water, island, paths, buildings, labels) is
    // cached in an offscreen canvas at the current resolution; each
    // frame only blits it and draws the few animated bits on top.
    const m = ctx.getTransform();
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if (
      !staticCache ||
      staticCache.w !== cw ||
      staticCache.h !== ch ||
      staticCache.a !== m.a ||
      staticCache.e !== m.e ||
      staticCache.f !== m.f
    ) {
      const layer = document.createElement("canvas");
      layer.width = cw;
      layer.height = ch;
      const c = layer.getContext("2d")!;
      c.setTransform(m);
      drawStaticScene(c, this, cw / m.a, ch / m.d, -m.e / m.a, -m.f / m.d);
      staticCache = { canvas: layer, w: cw, h: ch, a: m.a, e: m.e, f: m.f };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticCache.canvas, 0, 0);
    ctx.restore();

    // Drifting water highlights (skipped where the island sits).
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    for (let i = 0; i < 14; i++) {
      const px = ((i * 137 + t * 0.012 + i * i * 31) % (W + 160)) - 80;
      const py = ((i * 97) % (H + 120)) - 60 + Math.sin(t / 1400 + i) * 4;
      const nx = (px - 240) / 186;
      const ny = (py - 185) / 144;
      if (nx * nx + ny * ny < 1) continue; // over the island
      ctx.beginPath();
      ctx.ellipse(px, py, 16 + (i % 3) * 7, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    drawBoat(ctx, t);
    drawTerminalDynamic(ctx, BUILDING_POS.terminal.x, BUILDING_POS.terminal.y, t);
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

    // Selection ring.
    if (v.selected) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(255,255,255,0.8)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.ellipse(x, y + 1, 11, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    softShadow(ctx, x, y + 1, 7 + bob * 0.5, 2.8, 0.22);

    ctx.translate(x, y + bob);
    if (v.facing === -1) ctx.scale(-1, 1);

    // Feet.
    const step = v.walking ? Math.sin(t / 110) * 2.4 : 0;
    ctx.fillStyle = err ? "#9AA0A8" : color;
    ctx.beginPath();
    ctx.ellipse(-3.4, -1.4 + (v.walking ? step : 0) * 0.35, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(3.4, -1.4 - (v.walking ? step : 0) * 0.35, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body: rounded capsule with a soft top highlight.
    const bodyC = err ? "#B0B6BE" : color;
    const g = ctx.createLinearGradient(0, -17, 0, -1);
    g.addColorStop(0, bodyC);
    g.addColorStop(1, shade(bodyC, -18));
    ctx.fillStyle = g;
    rr(ctx, -7, -17, 14, 15, 6.5);
    ctx.fill();
    // Belly.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(0.5, -6.5, 4.6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Top glint.
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-2.5, -14.5, 3, 1.6, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Eyes (blink every few seconds).
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

    // Working: swinging a little wrench.
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

    ctx.restore(); // un-mirror + alpha

    // ---- badges above the head (drawn unmirrored) ----
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
      // Tiny victory flag planted beside the agent.
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
    let bx = x - bw / 2;
    bx = Math.max(4, Math.min(W - bw - 4, bx));
    const by = Math.max(4, y - bh - 10);

    ctx.shadowColor = "rgba(30, 50, 80, 0.25)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    rr(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    // Tail.
    ctx.beginPath();
    ctx.moveTo(x - 4, by + bh - 1);
    ctx.lineTo(x, by + bh + 6);
    ctx.lineTo(x + 4, by + bh - 1);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 5 + i * 12));
    ctx.restore();
  },

  drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    ctx.save();
    ctx.font = FONT(8, 700);
    const tw = ctx.measureText(text.toUpperCase()).width;
    const bw = tw + 12;
    const bx = Math.max(2, Math.min(W - bw - 2, x - bw / 2));
    ctx.fillStyle = "rgba(28, 38, 52, 0.72)";
    rr(ctx, bx, y, bw, 11, 5.5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.toUpperCase(), bx + bw / 2, y + 5.8);
    ctx.restore();
  },
};

// Shared badge helpers.
function badge(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.shadowColor = "rgba(20, 30, 45, 0.3)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = color;
  rr(ctx, x - r, y - r, r * 2, r * 2, r * 0.62);
  ctx.fill();
  ctx.restore();
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

/** Lighten/darken a hex color by pct (-100..100). */
function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}
