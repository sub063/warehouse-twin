/**
 * The world canvas. Two render paths, picked by the theme:
 *
 * - "integer" (pixel themes): render at base resolution offscreen, blit
 *   at the largest integer scale with nearest-neighbor — crisp pixels.
 * - "smooth" (vector themes): two stacked canvases. The bottom one
 *   holds the static scene and is rasterized only on resize or when the
 *   station layout changes; the top one is cleared each frame and gets
 *   just the ambient animation, agents, and bubbles.
 *
 * Stations come from the active universe's terminals (plus the built-in
 * Dock and Mailbox), laid out by the theme.
 */

import { useEffect, useRef } from "react";
import type { AgentView, TerminalSpec } from "../../../shared/src";
import { getState, selectAgent, selectTerminal } from "../store";
import { WorldSim } from "./sim";
import type { AgentVisual, StationDef, Theme } from "./theme";

export function WorldCanvas({
  theme,
  universe,
  terminals,
}: {
  theme: Theme;
  universe: string | null;
  terminals: TerminalSpec[];
}) {
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const fgRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const universeRef = useRef<string | null>(universe);
  universeRef.current = universe;
  const terminalsRef = useRef<TerminalSpec[]>(terminals);
  terminalsRef.current = terminals;

  useEffect(() => {
    const bg = bgRef.current;
    const fg = fgRef.current;
    const wrap = wrapRef.current;
    if (!bg || !fg || !wrap) return;

    const sim = new WorldSim(theme);
    const smooth = theme.scaling === "smooth";
    const bgCtx = bg.getContext("2d")!;
    const fgCtx = fg.getContext("2d")!;

    // Offscreen layers for the integer path.
    const base = document.createElement("canvas");
    base.width = theme.width;
    base.height = theme.height;
    const bctx = base.getContext("2d")!;
    const still = document.createElement("canvas");
    still.width = theme.width;
    still.height = theme.height;
    const sctx = still.getContext("2d")!;

    let stations: StationDef[] = [];
    let layoutKey = "";

    // View transform state (logical -> canvas element px).
    let scale = 1;
    let offX = 0;
    let offY = 0;
    const dpr = smooth ? Math.min(window.devicePixelRatio || 1, 2) : 1;

    const drawStatic = () => {
      if (smooth) {
        bgCtx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
        theme.drawWorldStatic(bgCtx, stations);
      } else {
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        theme.drawWorldStatic(sctx, stations);
      }
    };

    const relayout = () => {
      const list = terminalsRef.current;
      const key = list.map((t) => `${t.id}:${t.name}:${t.kind}`).join("|");
      if (key === layoutKey) return;
      layoutKey = key;
      stations = theme.layoutStations(list);
      sim.setStations(stations);
      drawStatic();
    };

    const applyScale = () => {
      const rect = wrap.getBoundingClientRect();
      if (smooth) {
        const cssW = Math.max(200, rect.width);
        const cssH = Math.max(150, rect.height);
        for (const c of [bg, fg]) {
          c.width = Math.round(cssW * dpr);
          c.height = Math.round(cssH * dpr);
          c.style.width = `${cssW}px`;
          c.style.height = `${cssH}px`;
        }
        scale = Math.min(cssW / theme.width, cssH / theme.height);
        offX = (cssW - theme.width * scale) / 2;
        offY = (cssH - theme.height * scale) / 2;
      } else {
        scale = Math.max(1, Math.floor(Math.min(rect.width / theme.width, rect.height / theme.height)));
        offX = 0;
        offY = 0;
        fg.width = theme.width * scale;
        fg.height = theme.height * scale;
        fg.style.width = `${fg.width}px`;
        fg.style.height = `${fg.height}px`;
        bg.style.display = "none";
        fgCtx.imageSmoothingEnabled = false;
      }
      drawStatic();
    };
    relayout();
    applyScale();
    const ro = new ResizeObserver(applyScale);
    ro.observe(wrap);

    const inUniverse = (a: AgentView) =>
      universeRef.current === null || a.spec.universe === universeRef.current;

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      relayout();
      const { world, selectedAgentId, selectedTerminalId } = getState();
      const sprites = sim.tick(world, dt, inUniverse);

      const dctx = smooth ? fgCtx : bctx;
      if (smooth) {
        fgCtx.setTransform(1, 0, 0, 1, 0, 0);
        fgCtx.clearRect(0, 0, fg.width, fg.height);
        fgCtx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
      } else {
        bctx.drawImage(still, 0, 0);
      }
      theme.drawWorldDynamic(dctx, stations, now);

      if (selectedTerminalId) {
        const st = stations.find((s) => s.id === selectedTerminalId);
        if (st) theme.drawStationSelection(dctx, st, now);
      }

      for (const s of sprites) {
        const a = world.agents[s.agentId];
        if (!a) continue;
        const visual: AgentVisual = {
          variant: world.order.indexOf(s.agentId),
          state: a.state,
          walking: s.walking,
          facing: s.facing,
          timeMs: now,
          selected: s.agentId === selectedAgentId,
        };
        theme.drawAgent(dctx, s.x, s.y, visual);
      }

      // Tool-name label while working at a terminal that maps by category
      // only (no explicit terminal), so it's clear what's happening there.
      for (const s of sprites) {
        const a = world.agents[s.agentId];
        if (a?.state === "using_tool" && a.currentTool && !a.currentTool.terminalId && !s.walking) {
          theme.drawLabel(dctx, s.x, s.y + 4, a.currentTool.tool);
        }
      }

      for (const s of sprites) {
        const a = world.agents[s.agentId];
        if (!a?.bubble) continue;
        const lastMsg = [...a.timeline].reverse().find((e) => e.type === "message" && e.payload.from === "agent");
        if (!lastMsg || Date.now() - lastMsg.ts > 8000) continue;
        const stagger = (world.order.indexOf(s.agentId) % 3) * 6;
        theme.drawBubble(dctx, s.x, s.y - theme.bubbleClearance - stagger, a.bubble);
      }

      if (!smooth) fgCtx.drawImage(base, 0, 0, fg.width, fg.height);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onClick = (ev: MouseEvent) => {
      const rect = fg.getBoundingClientRect();
      const x = (ev.clientX - rect.left - offX) / scale;
      const y = (ev.clientY - rect.top - offY) / scale;
      const hit = sim.hitTest(x, y);
      if (hit.agentId) selectAgent(hit.agentId);
      else if (hit.stationId) selectTerminal(hit.stationId);
      else {
        selectAgent(undefined);
        selectTerminal(undefined);
      }
    };
    fg.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fg.removeEventListener("click", onClick);
      bg.style.display = "";
    };
  }, [theme]);

  return (
    <div className={`world-wrap ${theme.scaling}`} ref={wrapRef}>
      <canvas ref={bgRef} className="world-canvas layer-bg" />
      <canvas ref={fgRef} className="world-canvas layer-fg" />
    </div>
  );
}
