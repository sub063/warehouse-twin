/**
 * The "Handheld" theme: a top-down world in a classic 4-shade green
 * handheld palette. All art is original and drawn in code as pixel
 * arrays (chars '0'..'3' = palette index dark->light, '.' transparent).
 */

import type { ToolCategory } from "../../../../shared/src";
import { GLYPH_H, drawText, textWidth } from "../pixfont";
import type { AgentVisual, StationDef, StationId, Theme } from "../theme";

const PALETTE = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] as const;
const TILE = 16;
const COLS = 20;
const ROWS = 18;

type Pixmap = string[];

function blit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pix: Pixmap,
  remap?: readonly [number, number, number, number],
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  for (let r = 0; r < pix.length; r++) {
    const row = pix[r] ?? "";
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === "." || ch === undefined || ch === " ") continue;
      const idx = (ch.charCodeAt(0) - 48) as 0 | 1 | 2 | 3;
      ctx.fillStyle = PALETTE[remap ? remap[idx] : idx] ?? PALETTE[0];
      ctx.fillRect(px + c, py + r, 1, 1);
    }
  }
}

// ---------------------------------------------------------------- tiles

const T_GRASS: Pixmap = [
  "3333333333333333",
  "3333333233333333",
  "3333333333333333",
  "3333333333333333",
  "3323333333333233",
  "3333333333333333",
  "3333333333333333",
  "3333333332333333",
  "3333333333333333",
  "3233333333333333",
  "3333333333333333",
  "3333333333333323",
  "3333323333333333",
  "3333333333333333",
  "3333333333333333",
  "3333333333333333",
];

const T_TUFT: Pixmap = [
  "3333333333333333",
  "3333333333333333",
  "3333233233333333",
  "3332323233333333",
  "3333333333333333",
  "3333333333333333",
  "3333333333332333",
  "3333333333323233",
  "3333333333333333",
  "3332333333333333",
  "3323233333333333",
  "3333333333333333",
  "3333333333333333",
  "3333333323323333",
  "3333333332333333",
  "3333333333333333",
];

const T_PATH: Pixmap = [
  "2222222222222222",
  "2222222322222222",
  "2222222222222122",
  "2212222222222222",
  "2222222222222222",
  "2222222232222222",
  "2222122222222222",
  "2222222222222222",
  "2222222222212222",
  "2232222222222222",
  "2222222222222222",
  "2222222222222232",
  "2222212222222222",
  "2222222222222222",
  "2222222223222222",
  "2222222222222222",
];

const T_WATER: Pixmap = [
  "1111111111111111",
  "1111111111111111",
  "1112221111111111",
  "1111111111111111",
  "1111111111122211",
  "1111111111111111",
  "1111111111111111",
  "1122111111111111",
  "1111111112221111",
  "1111111111111111",
  "1111111111111111",
  "1111222111111111",
  "1111111111111111",
  "1111111111112211",
  "1111111111111111",
  "1111111111111111",
];

const T_PLANK: Pixmap = [
  "2222222212222222",
  "2222222212222222",
  "2122222212222212",
  "1111111111111111",
  "2222122212222222",
  "2222222212222222",
  "2222222212222122",
  "1111111111111111",
  "2222222212212222",
  "2212222212222222",
  "2222222212222222",
  "1111111111111111",
  "2222222212222222",
  "2222122212222222",
  "2222222212221222",
  "1111111111111111",
];

const T_TREE: Pixmap = [
  "3330000000003333",
  "3301111111100333",
  "3011212211211033",
  "0112122112112103",
  "0121121221121210",
  "0112212112212110",
  "0121122121121210",
  "0112112212211110",
  "3011211121121103",
  "3301122112211033",
  "3330011111100333",
  "3333300110033333",
  "3333330110333333",
  "3333330110333333",
  "3333333333333333",
  "3333333333333333",
];

const TILES: Record<string, Pixmap> = {
  ".": T_GRASS,
  ",": T_TUFT,
  "#": T_PATH,
  "~": T_WATER,
  "=": T_PLANK,
  T: T_TREE,
};

// 20x18 tile layout. Ring path connects the four corner stations; the
// pond + pier (the Dock) sits in the middle.
const MAP: string[] = [
  "TTTTTTTTTTTTTTTTTTTT",
  "T..................T",
  "T........,.........T",
  "T..................T",
  "T...,.........,....T",
  "T..##############..T",
  "T..#............#..T",
  "T..#...~~~~~~...#..T",
  "T..#...~====~...#..T",
  "T..#...~====~...#..T",
  "T..#...~====~...#..T",
  "T..#...~====~...#..T",
  "T..##############..T",
  "T...............,..T",
  "T..,...............T",
  "T..................T",
  "T....,........,....T",
  "TTTTTTTTTTTTTTTTTTTT",
];

// ------------------------------------------------------------- stations

// Terminal: a desk with a glowing terminal screen.
const S_TERMINAL: Pixmap = [
  "......000000000000000000......",
  ".....02222222222222222220.....",
  ".....02000000000000000020.....",
  ".....02033333333333330020.....",
  ".....02030101010111330020.....",
  ".....02033333333333330020.....",
  ".....02030101110333330020.....",
  ".....02033333333333330020.....",
  ".....02030111010101330020.....",
  ".....02033333333333330020.....",
  ".....02000000000000000020.....",
  ".....02222222222222222220.....",
  "......000000000000000000......",
  "........011.........110.......",
  "0000000000000000000000000000..",
  "0222222222222222222222222220..",
  "0211112111121111211112111120..",
  "0222222222222222222222222220..",
  "0111111111111111111111111110..",
  ".00.....................00...",
  ".00.....................00...",
  ".00.....................00...",
];

// Library: a tall bookshelf full of book spines.
const S_LIBRARY: Pixmap = [
  "0000000000000000000000000000",
  "0222222222222222222222222220",
  "0200000000000000000000000020",
  "0203121312131121313121231020",
  "0203121312131121313121231020",
  "0203121312131121313121231020",
  "0200000000000000000000000020",
  "0201213121311213121312132020",
  "0201213121311213121312132020",
  "0201213121311213121312132020",
  "0200000000000000000000000020",
  "0202131213112131213121313020",
  "0202131213112131213121313020",
  "0202131213112131213121313020",
  "0200000000000000000000000020",
  "0222222222222222222222222220",
  "0000000000000000000000000000",
  ".00......................00.",
];

// Workshop: a workbench with a hammer, wrench and gear.
const S_WORKSHOP: Pixmap = [
  "..00.......0.0......000.....",
  "..3300.....0.0.....01110....",
  "..0033....00000....01110....",
  "....00.....0.0......000.....",
  "0000000000000000000000000000",
  "0222222222222222222222222220",
  "0212121212121212121212121120",
  "0222222222222222222222222220",
  "0111111111111111111111111110",
  "0000000000000000000000000000",
  ".00......................00.",
  ".00......................00.",
  ".00......................00.",
];

// Mailbox: a post-mounted box with a flag.
const S_MAILBOX: Pixmap = [
  ".000000000000...0..",
  "02222222222220..0..",
  "02000000000020.00..",
  "02033333333020.30..",
  "02030000003020.30..",
  "02033333333020.00..",
  "02000000000020..0..",
  "02222222222220..0..",
  ".000000000000...0..",
  "......010..........",
  "......010..........",
  "......010..........",
  "......010..........",
  ".....00100.........",
];

// Dock mooring post + rope.
const S_MOORING: Pixmap = [
  ".00.",
  "0110",
  "0110",
  "0110",
  ".00.",
];

// ------------------------------------------------------------- sprites

// 10x14 robot, feet at bottom row. Variants change the "hat" rows.
const BODY: Pixmap = [
  "....00....",
  "....00....",
  "..000000..",
  ".03333330.",
  ".03033030.",
  ".03333330.",
  ".00311300.",
  "..000000..",
  ".00222200.",
  "0122222210",
  ".02222220.",
  ".01222210.",
  "..00.00...",
  "..00.00...",
];

function withRows(base: Pixmap, rows: Record<number, string>): Pixmap {
  const out = base.slice();
  for (const [i, row] of Object.entries(rows)) out[Number(i)] = row;
  return out;
}

// Variant hats (rows 0-1).
const HATS: Array<Record<number, string>> = [
  { 0: "....00....", 1: "....00...." }, // single antenna
  { 0: "..........", 1: "..000000.." }, // flat cap
  { 0: "..00..00..", 1: "..00..00.." }, // twin antennas
];

// Walk frames swap legs (rows 12-13).
const LEGS_A: Record<number, string> = { 12: "..00..0...", 13: "..00......" };
const LEGS_B: Record<number, string> = { 12: "...0..00..", 13: "......00.." };
const LEGS_STAND: Record<number, string> = { 12: "..00.00...", 13: "..00.00..." };

// Work frames raise one arm (rows 8-10).
const ARMS_UP: Record<number, string> = {
  8: ".002222001",
  9: "0122222210",
  10: ".02222220.",
};
const ARMS_DOWN: Record<number, string> = {
  8: ".00222200.",
  9: "0122222210",
  10: ".02222220.",
};

// Small overlays.
const FLAG: Pixmap = ["0...", "022.", "0222", "022.", "0...", "0...", "0..."];
const SHADOW: Pixmap = [".22222222."];

const DIM: readonly [number, number, number, number] = [0, 0, 1, 1];

// ------------------------------------------------------------- layout

const STATIONS: StationDef[] = [
  {
    id: "terminal",
    name: "Terminal",
    slots: [
      { x: 48, y: 92 },
      { x: 64, y: 92 },
      { x: 80, y: 92 },
    ],
    labelAnchor: { x: 64, y: 20 },
  },
  {
    id: "library",
    name: "Library",
    slots: [
      { x: 240, y: 92 },
      { x: 256, y: 92 },
      { x: 272, y: 92 },
    ],
    labelAnchor: { x: 256, y: 20 },
  },
  {
    id: "workshop",
    name: "Workshop",
    slots: [
      { x: 48, y: 200 },
      { x: 64, y: 200 },
      { x: 80, y: 200 },
    ],
    labelAnchor: { x: 64, y: 262 },
  },
  {
    id: "mailbox",
    name: "Mailbox",
    slots: [
      { x: 246, y: 200 },
      { x: 262, y: 200 },
      { x: 278, y: 200 },
    ],
    labelAnchor: { x: 262, y: 262 },
  },
  {
    id: "dock",
    name: "Dock",
    slots: [
      { x: 142, y: 150 },
      { x: 160, y: 150 },
      { x: 178, y: 150 },
      { x: 150, y: 170 },
      { x: 170, y: 170 },
    ],
    labelAnchor: { x: 160, y: 198 },
  },
];

const CATEGORY_STATION: Record<ToolCategory, StationId> = {
  shell: "terminal",
  search: "library",
  files: "workshop",
  human: "mailbox",
  unknown: "workshop",
};

// ------------------------------------------------------------- theme

export const handheldTheme: Theme = {
  id: "handheld",
  name: "Handheld",
  palette: PALETTE,
  scaling: "integer",
  width: COLS * TILE,
  height: ROWS * TILE,
  walkSpeed: 55,
  bubbleClearance: 25,
  stations: STATIONS,

  station(id: StationId): StationDef {
    const s = STATIONS.find((st) => st.id === id);
    if (!s) throw new Error(`no station ${id}`);
    return s;
  },

  stationFor(category: ToolCategory): StationId {
    return CATEGORY_STATION[category] ?? "workshop";
  },

  drawWorldDynamic(): void {
    // The pixel world has no ambient animation.
  },

  drawWorldStatic(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = PALETTE[3];
    ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    for (let r = 0; r < ROWS; r++) {
      const row = MAP[r] ?? "";
      for (let c = 0; c < COLS; c++) {
        const tile = TILES[row[c] ?? "."] ?? T_GRASS;
        blit(ctx, c * TILE, r * TILE, tile);
      }
    }
    // Structures.
    blit(ctx, 34, 28, S_TERMINAL);
    blit(ctx, 242, 30, S_LIBRARY);
    blit(ctx, 34, 214, S_WORKSHOP);
    blit(ctx, 252, 214, S_MAILBOX);
    blit(ctx, 130, 124, S_MOORING);
    // Station name labels.
    for (const s of STATIONS) {
      const w = textWidth(s.name);
      drawText(ctx, s.labelAnchor.x - Math.floor(w / 2), s.labelAnchor.y, s.name, PALETTE[0]);
    }
  },

  drawAgent(ctx: CanvasRenderingContext2D, x: number, y: number, v: AgentVisual): void {
    const t = v.timeMs;
    const isError = v.state === "error";
    const walkPhase = Math.floor(t / 150) % 2 === 0;
    const workPhase = Math.floor(t / 280) % 2 === 0;

    let pix = withRows(BODY, HATS[v.variant % HATS.length] ?? {});
    if (v.walking) {
      pix = withRows(pix, walkPhase ? LEGS_A : LEGS_B);
    } else {
      pix = withRows(pix, LEGS_STAND);
    }
    if (!v.walking && v.state === "using_tool") {
      pix = withRows(pix, workPhase ? ARMS_UP : ARMS_DOWN);
    }

    const left = Math.round(x) - 5;
    const top = Math.round(y) - 14;

    blit(ctx, left, y - 1, SHADOW);

    const dim = isError && Math.floor(t / 120) % 2 === 0;
    if (v.facing === -1) {
      // Mirror horizontally by reversing each row.
      pix = pix.map((row) => row.split("").reverse().join(""));
    }
    blit(ctx, left, top, pix, isError ? (dim ? DIM : undefined) : undefined);

    // State overlays.
    if (v.state === "awaiting_approval" && Math.floor(t / 400) % 2 === 0) {
      ctx.fillStyle = PALETTE[3];
      ctx.fillRect(Math.round(x) - 3, top - 9, 6, 8);
      drawText(ctx, x - 1, top - 8, "!", PALETTE[0]);
    }
    if (v.state === "done") {
      blit(ctx, left + 11, top + 2, FLAG);
    }
    if (v.state === "paused") {
      ctx.fillStyle = PALETTE[0];
      ctx.fillRect(Math.round(x) - 3, top - 7, 2, 5);
      ctx.fillRect(Math.round(x) + 1, top - 7, 2, 5);
    }
    if (v.state === "thinking") {
      // Animated "..." above the head.
      const dots = (Math.floor(t / 350) % 3) + 1;
      ctx.fillStyle = PALETTE[0];
      for (let i = 0; i < dots; i++) ctx.fillRect(Math.round(x) - 4 + i * 4, top - 4, 2, 2);
    }
    if (v.selected) {
      ctx.fillStyle = PALETTE[0];
      // Corner brackets around the sprite.
      const bx = left - 2;
      const by = top - 2;
      const bw = 14;
      const bh = 18;
      for (const [cx, cy, w, h] of [
        [bx, by, 3, 1], [bx, by, 1, 3],
        [bx + bw - 3, by, 3, 1], [bx + bw - 1, by, 1, 3],
        [bx, by + bh - 1, 3, 1], [bx, by + bh - 3, 1, 3],
        [bx + bw - 3, by + bh - 1, 3, 1], [bx + bw - 1, by + bh - 3, 1, 3],
      ] as const) {
        ctx.fillRect(cx, cy, w, h);
      }
    }
  },

  drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    // Wrap into at most 2 lines of ~14 chars.
    const words = text.toUpperCase().split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length <= 14) {
        cur = (cur + " " + w).trim();
      } else {
        if (cur) lines.push(cur);
        cur = w.slice(0, 14);
        if (lines.length === 2) break;
      }
    }
    if (cur && lines.length < 2) lines.push(cur);
    if (lines.length === 0) return;

    const wMax = Math.max(...lines.map((l) => textWidth(l)));
    const bw = wMax + 6;
    const bh = lines.length * (GLYPH_H + 1) + 5;
    let bx = Math.round(x - bw / 2);
    bx = Math.max(2, Math.min(COLS * TILE - bw - 2, bx));
    const by = Math.max(2, Math.round(y - bh - 6));

    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = PALETTE[3];
    ctx.fillRect(bx, by, bw, bh);
    // Tail.
    const tx = Math.round(x);
    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(tx - 2, by + bh + 1, 5, 1);
    ctx.fillRect(tx - 1, by + bh + 2, 3, 1);
    ctx.fillStyle = PALETTE[3];
    ctx.fillRect(tx - 1, by + bh, 3, 2);

    lines.forEach((l, i) => {
      drawText(ctx, bx + 3, by + 3 + i * (GLYPH_H + 1), l, PALETTE[0]);
    });
  },

  drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
    const w = textWidth(text.toUpperCase());
    const bx = Math.max(2, Math.min(COLS * TILE - w - 6, Math.round(x - w / 2) - 2));
    ctx.fillStyle = PALETTE[2];
    ctx.fillRect(bx, Math.round(y) - 1, w + 4, GLYPH_H + 2);
    drawText(ctx, bx + 2, y, text, PALETTE[0]);
  },
};
