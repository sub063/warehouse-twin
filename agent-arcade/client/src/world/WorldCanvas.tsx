/**
 * The world canvas. Two render paths, picked by the theme:
 *
 * - "integer" (pixel themes): render at base resolution offscreen, blit
 *   at the largest integer scale with nearest-neighbor — crisp pixels.
 * - "smooth" (vector themes): a camera over a world larger than the
 *   viewport. The static scene is rasterized once (per layout / zoom
 *   band) into a world-sized canvas that the compositor pans via CSS
 *   transform; a viewport-sized top canvas redraws only agents, bubbles
 *   and ambient animation each frame. Drag to pan, wheel to scroll,
 *   ctrl/⌘+wheel or the buttons to zoom; the minimap jumps the camera.
 *
 * Stations come from the active universe's terminals (plus the built-in
 * Dock and Mailbox), laid out by the theme.
 */

import { useEffect, useRef } from "react";
import type { AgentView, ArcadeEvent, TerminalSpec, WorldState } from "../../../shared/src";
import { ReplayPlayer } from "../../../shared/src";
import { advanceReplay, getState, selectAgent, selectTerminal } from "../store";
import { WorldSim } from "./sim";
import type { AgentVisual, StationDef, Theme } from "./theme";

const MAX_RASTER_SCALE = 2; // world raster cap (memory); CSS scales beyond it
const MINIMAP_W = 180;

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
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const universeRef = useRef<string | null>(universe);
  universeRef.current = universe;
  const terminalsRef = useRef<TerminalSpec[]>(terminals);
  terminalsRef.current = terminals;
  const controlsRef = useRef<{ zoomBy: (f: number) => void; home: () => void } | null>(null);

  useEffect(() => {
    const bg = bgRef.current;
    const fg = fgRef.current;
    const mini = miniRef.current;
    const wrap = wrapRef.current;
    if (!bg || !fg || !mini || !wrap) return;

    const sim = new WorldSim(theme);
    const smooth = theme.scaling === "smooth";
    const bgCtx = bg.getContext("2d")!;
    const fgCtx = fg.getContext("2d")!;
    const miniCtx = mini.getContext("2d")!;
    wrap.style.background = theme.backdrop;

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

    // ---- camera (smooth path) ----
    const dpr = smooth ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    let cssW = 1;
    let cssH = 1;
    const cam = { x: theme.home.x, y: theme.home.y, zoom: theme.homeZoom };
    let rasterScale = 0; // current bg raster scale (logical -> bg px)
    let rasterTimer: ReturnType<typeof setTimeout> | undefined;
    // Integer path scale.
    let intScale = 1;

    const minZoom = () => Math.max(0.3, Math.min(cssW / theme.width, cssH / theme.height));
    const maxZoom = 4;

    const clampCamera = () => {
      cam.zoom = Math.max(minZoom(), Math.min(maxZoom, cam.zoom));
      const halfW = cssW / 2 / cam.zoom;
      const halfH = cssH / 2 / cam.zoom;
      // Keep the viewport inside the world; center when the world is smaller.
      cam.x = halfW * 2 >= theme.width ? theme.width / 2 : Math.max(halfW, Math.min(theme.width - halfW, cam.x));
      cam.y = halfH * 2 >= theme.height ? theme.height / 2 : Math.max(halfH, Math.min(theme.height - halfH, cam.y));
    };

    // Minimap base: the static scene at minimap size, redrawn only when
    // the world raster changes (downscaling the full raster per frame is
    // far too slow).
    const miniBase = document.createElement("canvas");
    const miniBaseCtx = miniBase.getContext("2d")!;

    const rasterBg = () => {
      rasterScale = Math.min(cam.zoom, MAX_RASTER_SCALE) * dpr;
      bg.width = Math.round(theme.width * rasterScale);
      bg.height = Math.round(theme.height * rasterScale);
      bg.style.width = `${theme.width * (rasterScale / dpr)}px`;
      bg.style.height = `${theme.height * (rasterScale / dpr)}px`;
      bgCtx.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
      theme.drawWorldStatic(bgCtx, stations);
      if (miniBase.width > 0) {
        miniBaseCtx.setTransform(1, 0, 0, 1, 0, 0);
        miniBaseCtx.drawImage(bg, 0, 0, miniBase.width, miniBase.height);
      }
    };

    const placeBg = () => {
      // Screen position of world origin, then scale the raster to the zoom.
      const ox = cssW / 2 - cam.x * cam.zoom;
      const oy = cssH / 2 - cam.y * cam.zoom;
      const s = cam.zoom / (rasterScale / dpr);
      bg.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
    };

    const scheduleRaster = () => {
      // Re-rasterize once the zoom settles (CSS scale bridges the gap).
      if (rasterTimer) clearTimeout(rasterTimer);
      rasterTimer = setTimeout(() => {
        if (Math.abs(Math.min(cam.zoom, MAX_RASTER_SCALE) * dpr - rasterScale) > 0.01) {
          rasterBg();
          placeBg();
        }
      }, 160);
    };

    const drawStatic = () => {
      if (smooth) {
        rasterBg();
        placeBg();
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
        cssW = Math.max(200, rect.width);
        cssH = Math.max(150, rect.height);
        fg.width = Math.round(cssW * dpr);
        fg.height = Math.round(cssH * dpr);
        fg.style.width = `${cssW}px`;
        fg.style.height = `${cssH}px`;
        clampCamera();
        if (rasterScale === 0) rasterBg();
        placeBg();
      } else {
        intScale = Math.max(1, Math.floor(Math.min(rect.width / theme.width, rect.height / theme.height)));
        fg.width = theme.width * intScale;
        fg.height = theme.height * intScale;
        fg.style.width = `${fg.width}px`;
        fg.style.height = `${fg.height}px`;
        bg.style.display = "none";
        mini.style.display = "none";
        fgCtx.imageSmoothingEnabled = false;
        drawStatic();
      }
    };
    relayout();
    applyScale();
    const ro = new ResizeObserver(applyScale);
    ro.observe(wrap);

    // Minimap sizing (2x for crispness), then seed its static base.
    const miniH = Math.round((MINIMAP_W * theme.height) / theme.width);
    mini.width = MINIMAP_W * 2;
    mini.height = miniH * 2;
    mini.style.width = `${MINIMAP_W}px`;
    mini.style.height = `${miniH}px`;
    miniBase.width = mini.width;
    miniBase.height = mini.height;
    if (smooth) {
      miniBaseCtx.drawImage(bg, 0, 0, miniBase.width, miniBase.height);
    }

    controlsRef.current = {
      zoomBy: (f) => {
        cam.zoom *= f;
        clampCamera();
        placeBg();
        scheduleRaster();
      },
      home: () => {
        cam.x = theme.home.x;
        cam.y = theme.home.y;
        cam.zoom = theme.homeZoom;
        clampCamera();
        placeBg();
        scheduleRaster();
      },
    };

    const inUniverse = (a: AgentView) =>
      universeRef.current === null || a.spec.universe === universeRef.current;

    // ---- camera focus requests (roster / terminal list clicks) ----
    let seenFocusNonce = 0;
    let focusTarget: { x: number; y: number } | null = null;

    // Replay: rebuild the run's world from its own events up to the cursor.
    let player: ReplayPlayer | null = null;
    let playerAgent = "";
    let playerEvents: ArcadeEvent[] | null = null;

    let raf = 0;
    let last = performance.now();
    let frameNo = 0;
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      frameNo += 1;
      relayout();
      advanceReplay(dt);
      const ui = getState();
      const { selectedAgentId, selectedTerminalId, focus, replay } = ui;
      let world: WorldState = ui.world;
      let visible = inUniverse;
      let nowTs = Date.now();
      if (replay) {
        const live = ui.world.agents[replay.agentId];
        if (live && (playerAgent !== replay.agentId || playerEvents !== live.timeline)) {
          // (Re)build when the run changes or its timeline reference does.
          playerAgent = replay.agentId;
          playerEvents = live.timeline;
          player = new ReplayPlayer(live.timeline);
        }
        if (player) world = player.seek(replay.cursorTs);
        visible = (a: AgentView) => a.id === replay.agentId;
        nowTs = replay.cursorTs;
      } else if (player) {
        player = null;
        playerAgent = "";
        playerEvents = null;
      }
      const sprites = sim.tick(world, dt, visible);

      if (smooth) {
        if (focus && focus.nonce !== seenFocusNonce) {
          seenFocusNonce = focus.nonce;
          if (focus.kind === "agent") {
            const s = sprites.find((sp) => sp.agentId === focus.id);
            focusTarget = s ? { x: s.x, y: s.y } : null;
          } else {
            const st = stations.find((sp) => sp.id === focus.id);
            focusTarget = st ? { x: st.x, y: st.y } : null;
          }
        }
        if (focusTarget) {
          cam.x += (focusTarget.x - cam.x) * 0.15;
          cam.y += (focusTarget.y - cam.y) * 0.15;
          if (Math.hypot(focusTarget.x - cam.x, focusTarget.y - cam.y) < 1) focusTarget = null;
          clampCamera();
          placeBg();
        }
      }

      const dctx = smooth ? fgCtx : bctx;
      if (smooth) {
        fgCtx.setTransform(1, 0, 0, 1, 0, 0);
        fgCtx.clearRect(0, 0, fg.width, fg.height);
        fgCtx.setTransform(
          dpr * cam.zoom,
          0,
          0,
          dpr * cam.zoom,
          dpr * (cssW / 2 - cam.x * cam.zoom),
          dpr * (cssH / 2 - cam.y * cam.zoom),
        );
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
        if (!lastMsg || nowTs - lastMsg.ts > 8000) continue;
        const stagger = (world.order.indexOf(s.agentId) % 3) * 6;
        theme.drawBubble(dctx, s.x, s.y - theme.bubbleClearance - stagger, a.bubble);
      }

      if (!smooth) fgCtx.drawImage(base, 0, 0, fg.width, fg.height);

      // Minimap at ~10 fps: scaled world, agent dots, viewport rectangle.
      if (smooth && frameNo % 6 === 0) {
        const mw = mini.width;
        const mh = mini.height;
        const k = mw / theme.width;
        miniCtx.setTransform(1, 0, 0, 1, 0, 0);
        miniCtx.drawImage(miniBase, 0, 0, mw, mh);
        for (const s of sprites) {
          miniCtx.fillStyle = s.agentId === selectedAgentId ? "#FFFFFF" : "#FFE55C";
          miniCtx.beginPath();
          miniCtx.arc(s.x * k, s.y * k, 5, 0, Math.PI * 2);
          miniCtx.fill();
          miniCtx.strokeStyle = "rgba(20,30,45,0.8)";
          miniCtx.lineWidth = 2;
          miniCtx.stroke();
        }
        const vw = (cssW / cam.zoom) * k;
        const vh = (cssH / cam.zoom) * k;
        miniCtx.strokeStyle = "rgba(255,255,255,0.95)";
        miniCtx.lineWidth = 3;
        miniCtx.strokeRect(cam.x * k - vw / 2, cam.y * k - vh / 2, vw, vh);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // ---- input ----
    const toWorld = (clientX: number, clientY: number) => {
      const rect = fg.getBoundingClientRect();
      if (!smooth) {
        return { x: (clientX - rect.left) / intScale, y: (clientY - rect.top) / intScale };
      }
      return {
        x: (clientX - rect.left - cssW / 2) / cam.zoom + cam.x,
        y: (clientY - rect.top - cssH / 2) / cam.zoom + cam.y,
      };
    };

    const select = (clientX: number, clientY: number) => {
      const p = toWorld(clientX, clientY);
      const hit = sim.hitTest(p.x, p.y);
      if (hit.agentId) selectAgent(hit.agentId);
      else if (hit.stationId) selectTerminal(hit.stationId);
      else {
        selectAgent(undefined);
        selectTerminal(undefined);
      }
    };

    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, moved: false, id: ev.pointerId };
      fg.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (smooth) {
        cam.x -= dx / cam.zoom;
        cam.y -= dy / cam.zoom;
        focusTarget = null;
        clampCamera();
        placeBg();
      }
      drag.x = ev.clientX;
      drag.y = ev.clientY;
    };
    const onUp = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const wasClick = !drag.moved;
      drag = null;
      fg.releasePointerCapture(ev.pointerId);
      if (wasClick) select(ev.clientX, ev.clientY);
    };
    const onWheel = (ev: WheelEvent) => {
      if (!smooth) return;
      ev.preventDefault();
      focusTarget = null;
      if (ev.ctrlKey || ev.metaKey) {
        // Zoom around the cursor.
        const before = toWorld(ev.clientX, ev.clientY);
        cam.zoom *= Math.exp(-ev.deltaY * 0.0025);
        clampCamera();
        const after = toWorld(ev.clientX, ev.clientY);
        cam.x += before.x - after.x;
        cam.y += before.y - after.y;
        clampCamera();
        placeBg();
        scheduleRaster();
      } else {
        const dx = ev.shiftKey && ev.deltaX === 0 ? ev.deltaY : ev.deltaX;
        const dy = ev.shiftKey && ev.deltaX === 0 ? 0 : ev.deltaY;
        cam.x += dx / cam.zoom;
        cam.y += dy / cam.zoom;
        clampCamera();
        placeBg();
      }
    };
    const onMiniClick = (ev: MouseEvent) => {
      const rect = mini.getBoundingClientRect();
      cam.x = ((ev.clientX - rect.left) / rect.width) * theme.width;
      cam.y = ((ev.clientY - rect.top) / rect.height) * theme.height;
      focusTarget = null;
      clampCamera();
      placeBg();
    };

    fg.addEventListener("pointerdown", onDown);
    fg.addEventListener("pointermove", onMove);
    fg.addEventListener("pointerup", onUp);
    fg.addEventListener("pointercancel", onUp);
    fg.addEventListener("wheel", onWheel, { passive: false });
    mini.addEventListener("click", onMiniClick);

    return () => {
      cancelAnimationFrame(raf);
      if (rasterTimer) clearTimeout(rasterTimer);
      ro.disconnect();
      fg.removeEventListener("pointerdown", onDown);
      fg.removeEventListener("pointermove", onMove);
      fg.removeEventListener("pointerup", onUp);
      fg.removeEventListener("pointercancel", onUp);
      fg.removeEventListener("wheel", onWheel);
      mini.removeEventListener("click", onMiniClick);
      bg.style.display = "";
      mini.style.display = "";
      bg.style.transform = "";
      controlsRef.current = null;
    };
  }, [theme]);

  return (
    <div className={`world-wrap ${theme.scaling}`} ref={wrapRef}>
      <canvas ref={bgRef} className="world-canvas layer-bg" />
      <canvas ref={fgRef} className="world-canvas layer-fg" />
      {theme.scaling === "smooth" && (
        <>
          <div className="world-controls">
            <button className="ctl" title="Zoom in" onClick={() => controlsRef.current?.zoomBy(1.25)}>
              +
            </button>
            <button className="ctl" title="Zoom out" onClick={() => controlsRef.current?.zoomBy(0.8)}>
              −
            </button>
            <button className="ctl" title="Back to center" onClick={() => controlsRef.current?.home()}>
              ⌂
            </button>
          </div>
          <div className="world-hint">drag to pan · scroll to move · ⌘/ctrl+scroll to zoom</div>
        </>
      )}
      <canvas ref={miniRef} className="minimap" />
    </div>
  );
}
