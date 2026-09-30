/**
 * The world canvas. Renders at the theme's base resolution into an
 * offscreen canvas, then blits at the largest integer scale that fits —
 * nearest-neighbor, so pixels stay crisp at 2x/3x/4x.
 */

import { useEffect, useRef } from "react";
import { getState, selectAgent } from "../store";
import { WorldSim } from "./sim";
import type { AgentVisual, Theme } from "./theme";

export function WorldCanvas({ theme }: { theme: Theme }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<WorldSim | null>(null);
  const scaleRef = useRef(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const sim = new WorldSim(theme);
    simRef.current = sim;

    // Offscreen base-resolution layers.
    const base = document.createElement("canvas");
    base.width = theme.width;
    base.height = theme.height;
    const bctx = base.getContext("2d")!;

    const still = document.createElement("canvas");
    still.width = theme.width;
    still.height = theme.height;
    const sctx = still.getContext("2d")!;
    theme.drawWorld(sctx);

    const ctx = canvas.getContext("2d")!;

    const applyScale = () => {
      const rect = wrap.getBoundingClientRect();
      const scale = Math.max(1, Math.floor(Math.min(rect.width / theme.width, rect.height / theme.height)));
      scaleRef.current = scale;
      canvas.width = theme.width * scale;
      canvas.height = theme.height * scale;
      canvas.style.width = `${theme.width * scale}px`;
      canvas.style.height = `${theme.height * scale}px`;
      ctx.imageSmoothingEnabled = false;
    };
    applyScale();
    const ro = new ResizeObserver(applyScale);
    ro.observe(wrap);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      const { world, selectedAgentId } = getState();
      const sprites = sim.tick(world, dt);

      bctx.drawImage(still, 0, 0);

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
        theme.drawAgent(bctx, s.x, s.y, visual);
      }

      // Unknown-tool label at the workshop.
      for (const s of sprites) {
        const a = world.agents[s.agentId];
        if (a?.state === "using_tool" && a.currentTool?.category === "unknown" && !s.walking) {
          theme.drawLabel(bctx, s.x, s.y + 4, a.currentTool.tool);
        }
      }

      // Speech bubbles last so they sit on top; stagger height a little
      // per agent so neighbors' bubbles don't fully overlap.
      for (const s of sprites) {
        const a = world.agents[s.agentId];
        if (!a?.bubble) continue;
        // Hide stale bubbles: only show for a while after the last message.
        const lastMsg = [...a.timeline].reverse().find((e) => e.type === "message" && e.payload.from === "agent");
        if (!lastMsg || Date.now() - lastMsg.ts > 8000) continue;
        const stagger = (world.order.indexOf(s.agentId) % 3) * 5;
        theme.drawBubble(bctx, s.x, s.y - 14 - stagger, a.bubble);
      }

      ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / scaleRef.current;
      const y = (ev.clientY - rect.top) / scaleRef.current;
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
    <div className="world-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="world-canvas" />
    </div>
  );
}
