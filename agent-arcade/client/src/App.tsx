import { useSyncExternalStore } from "react";
import { getState, selectAgent, setTheme, setUniverse, subscribe, universesOf } from "./store";
import { handheldTheme } from "./world/handheld";
import { isleTheme } from "./world/isle";
import { WorldCanvas } from "./world/WorldCanvas";

const THEMES = { isle: isleTheme, handheld: handheldTheme } as const;

export function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const { world, connected, mode, selectedAgentId, activeUniverse, themeId } = state;
  const theme = THEMES[themeId];

  const universes = universesOf(world);
  const visibleIds = world.order.filter(
    (id) => activeUniverse === null || world.agents[id]?.spec.universe === activeUniverse,
  );
  const scopeCost = visibleIds.reduce((sum, id) => sum + (world.agents[id]?.usage.costUsd ?? 0), 0);
  const selected = selectedAgentId ? world.agents[selectedAgentId] : undefined;

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
          <ul className="mini-roster">
            {visibleIds.map((id) => {
              const a = world.agents[id];
              if (!a) return null;
              return (
                <li
                  key={id}
                  className={id === selectedAgentId ? "selected" : ""}
                  onClick={() => selectAgent(id)}
                >
                  <div className="row-top">
                    <span className="name">{a.spec.name}</span>
                    <span className={`state state-${a.state}`}>{a.state.replace("_", " ")}</span>
                  </div>
                  {activeUniverse === null && <span className="universe">{a.spec.universe}</span>}
                </li>
              );
            })}
            {visibleIds.length === 0 && <li className="placeholder">No agents in this universe yet.</li>}
          </ul>
          <p className="placeholder footnote">Full roster arrives in milestone 2.</p>
        </aside>

        <main className="center">
          <WorldCanvas theme={theme} universe={activeUniverse} />
        </main>

        <aside className="panel right">
          <h2>Agent detail</h2>
          {selected ? (
            <div className="detail-stub">
              <p className="name">{selected.spec.name}</p>
              <p className="universe-tag">{selected.spec.universe}</p>
              <p className="goal">{selected.spec.goal}</p>
              <p>
                state <b>{selected.state.replace("_", " ")}</b>
              </p>
              <p>
                tokens {selected.usage.inputTokens + selected.usage.outputTokens} · $
                {selected.usage.costUsd.toFixed(4)}
              </p>
            </div>
          ) : (
            <p className="placeholder">Tap an agent in the world or the roster. The full panel comes in milestone 2.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
