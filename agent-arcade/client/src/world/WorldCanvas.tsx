/**
 * The world canvas. Two render paths, picked by the theme:
 *
 * - "integer" (pixel themes): render at base resolution offscreen, blit
 *   at the largest integer scale with nearest-neighbor — crisp pixels.
 * - "smooth" (vector themes): scale the context (including device pixel
 *   ratio) and let the theme draw vector shapes every frame — smooth,
 *   mobile-game look at any size.
 */

import { useEffect, useRef } from "react";
import type { AgentView } from "../../../shared/src";
import { getState, selectAgent } from "../store";
import { WorldSim } from "./sim";
import type { AgentVisual, Theme } from "./theme";

export function WorldCanvas({ theme, universe }: { theme: Theme; universe: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const universeRef = useRef<string | null>(universe);
  universeRef.current = universe;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const sim = new WorldSim(theme);
    const smooth = theme.scaling === "smooth";
    const ctx = canvas.getContext("2d")!;

    // Offscreen layers for the integer path.
    const base = document.createElement("canvas");
    base.width = theme.width;
    base.height = theme.height;
    const bctx = base.getContext("2d")!;
    const still = document.createElement("canvas");
    still.width = theme.width;
    still.height = theme.height;
    if (!smooth) theme.drawWorld(still.getContext("2d")!, 0);

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
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        scale = Math.min(cssW / theme.width, cssH / theme.height);
        offX = (cssW - theme.width * scale) / 2;
        offY = (cssH - theme.height * scale) / 2;
        ctx.imageSmoothingEnabled = true;
      } else {
        scale = Math.max(1, Math.floor(Math.min(rect.width / theme.width, rect.height / theme.height)));
        offX = 0;
        offY = 0;
        canvas.width = theme.width * scale;
        canvas.height = theme.height * scale;
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
        ctx.imageSmoothingEnabled = false;
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

      // Pick the drawing context for this path.
      const dctx = smooth ? ctx : bctx;
      if (smooth) {
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
        theme.drawWorld(dctx, now);
      } else {
        bctx.drawImage(still, 0, 0);
      }

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
        ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left - offX) / scale;
      const y = (ev.clientY - rect.top - offY) / scale;
      selectAgent(sim.hitTest(x, y));
    };
    canvas.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
    };
  }, [theme]);

  return (
    <div className={`world-wrap ${theme.scaling}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="world-canvas" />
    </div>
  );
}
