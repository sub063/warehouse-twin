import { useState, useSyncExternalStore } from "react";
import { getState, sendCommand, setTheme, setUniverse, subscribe, universesOf } from "./store";
import { DetailPanel } from "./ui/DetailPanel";
import { Roster } from "./ui/Roster";
import { SpawnModal } from "./ui/SpawnModal";
import { handheldTheme } from "./world/handheld";
import { isleTheme } from "./world/isle";
import { WorldCanvas } from "./world/WorldCanvas";

const THEMES = { isle: isleTheme, handheld: handheldTheme } as const;

export function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const { world, connected, mode, selectedAgentId, activeUniverse, themeId } = state;
  const theme = THEMES[themeId];
  const [showSpawn, setShowSpawn] = useState(false);

  const universes = universesOf(world);
  const visibleIds = world.order.filter(
    (id) => activeUniverse === null || world.agents[id]?.spec.universe === activeUniverse,
  );
  const scopeCost = visibleIds.reduce((sum, id) => sum + (world.agents[id]?.usage.costUsd ?? 0), 0);
  const selected = selectedAgentId ? world.agents[selectedAgentId] : undefined;

  const active = world.order
    .map((id) => world.agents[id])
    .filter((a) => a && a.state !== "done" && a.outcome === undefined);
  const anyRunning = active.some((a) => a!.state !== "paused");

  const stopAll = () => {
    if (window.confirm(`Stop all ${active.length} running agent(s)? This can't be undone.`)) {
      sendCommand({ kind: "stop_all" });
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-side left">
          <span className="brand">Agent Arcade</span>
          <span className={`pill mode-${mode}`}>{mode === "mock" ? "Mock" : "Live"}</span>
          <span className={`dot ${connected ? "ok" : "off"}`} title={connected ? "connected" : "connecting…"} />
        </div>
        <nav className="universes" aria-label="Universe">
          <button className={activeUniverse === null ? "seg on" : "seg"} onClick={() => setUniverse(null)}>
            All
          </button>
          {universes.map((u) => (
            <button key={u} className={activeUniverse === u ? "seg on" : "seg"} onClick={() => setUniverse(u)}>
              {u}
            </button>
          ))}
        </nav>
        <div className="topbar-side right">
          <span className="stat">
            {visibleIds.length} agent{visibleIds.length === 1 ? "" : "s"}
          </span>
          <span className="stat">${scopeCost.toFixed(4)}</span>
          <button
            className="btn"
            disabled={active.length === 0}
            onClick={() => sendCommand({ kind: anyRunning ? "pause_all" : "resume_all" })}
          >
            {anyRunning || active.length === 0 ? "Pause all" : "Resume all"}
          </button>
          <button className="btn danger" disabled={active.length === 0} onClick={stopAll}>
            Stop all
          </button>
          <button className="btn primary" onClick={() => setShowSpawn(true)}>
            + New Agent
          </button>
          <div className="theme-toggle" aria-label="Theme">
            {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((id) => (
              <button key={id} className={themeId === id ? "seg on" : "seg"} onClick={() => setTheme(id)}>
                {THEMES[id].name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="columns">
        <aside className="panel left">
          <h2>Roster</h2>
          <Roster
            world={world}
            visibleIds={visibleIds}
            selectedAgentId={selectedAgentId}
            showUniverse={activeUniverse === null}
          />
        </aside>

        <main className="center">
          <WorldCanvas theme={theme} universe={activeUniverse} />
        </main>

        <aside className="panel right">
          <h2>Agent detail</h2>
          {selected ? (
            <DetailPanel agent={selected} />
          ) : (
            <p className="placeholder">Tap an agent in the world or the roster to see its goal, timeline, and controls.</p>
          )}
        </aside>
      </div>

      {showSpawn && (
        <SpawnModal universes={universes} activeUniverse={activeUniverse} onClose={() => setShowSpawn(false)} />
      )}
    </div>
  );
}
