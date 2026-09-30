/**
 * The world canvas. Two render paths, picked by the theme:
 *
 * - "integer" (pixel themes): render at base resolution offscreen, blit
 *   at the largest integer scale with nearest-neighbor — crisp pixels.
 * - "smooth" (vector themes): two stacked canvases. The bottom one
 *   holds the static scene and is rasterized only on resize; the top
 *   one is cleared each frame and gets just the ambient animation,
 *   agents, and bubbles. That keeps per-frame rasterization tiny, so
 *   the world stays at full frame rate even without GPU acceleration.
 */

import { useEffect, useRef } from "react";
import type { AgentView } from "../../../shared/src";
import { getState, selectAgent } from "../store";
import { WorldSim } from "./sim";
import type { AgentVisual, Theme } from "./theme";

export function WorldCanvas({ theme, universe }: { theme: Theme; universe: string | null }) {
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const fgRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const universeRef = useRef<string | null>(universe);
  universeRef.current = universe;

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
    if (!smooth) theme.drawWorldStatic(still.getContext("2d")!);

    // View transform state (logical -> canvas element px).
    let scale = 1;
    let offX = 0;
    let offY = 0;
    const dpr = smooth ? Math.min(window.devicePixelRatio || 1, 2) : 1;

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
        // Rasterize the static scene once per resize.
        bgCtx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
        theme.drawWorldStatic(bgCtx);
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
    };
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
      const { world, selectedAgentId } = getState();
      const sprites = sim.tick(world, dt, inUniverse);

      // Pick the drawing context for this frame's content.
      const dctx = smooth ? fgCtx : bctx;
      if (smooth) {
        fgCtx.setTransform(1, 0, 0, 1, 0, 0);
        fgCtx.clearRect(0, 0, fg.width, fg.height);
        fgCtx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
      } else {
        bctx.drawImage(still, 0, 0);
      }
      theme.drawWorldDynamic(dctx, now);

      // Sprites, back to front.
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

      // Unknown-tool label at the workshop.
      for (const s of sprites) {
        const a = world.agents[s.agentId];
        if (a?.state === "using_tool" && a.currentTool?.category === "unknown" && !s.walking) {
          theme.drawLabel(dctx, s.x, s.y + 4, a.currentTool.tool);
        }
      }

      // Speech bubbles last so they sit on top; stagger height a little
      // per agent so neighbors' bubbles don't fully overlap.
      for (const s of sprites) {
        const a = world.agents[s.agentId];
        if (!a?.bubble) continue;
        const lastMsg = [...a.timeline].reverse().find((e) => e.type === "message" && e.payload.from === "agent");
        if (!lastMsg || Date.now() - lastMsg.ts > 8000) continue;
        const stagger = (world.order.indexOf(s.agentId) % 3) * 6;
        theme.drawBubble(dctx, s.x, s.y - theme.bubbleClearance - stagger, a.bubble);
      }

      if (!smooth) {
        fgCtx.drawImage(base, 0, 0, fg.width, fg.height);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onClick = (ev: MouseEvent) => {
      const rect = fg.getBoundingClientRect();
      const x = (ev.clientX - rect.left - offX) / scale;
      const y = (ev.clientY - rect.top - offY) / scale;
      selectAgent(sim.hitTest(x, y));
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
