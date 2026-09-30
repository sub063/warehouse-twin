import { useSyncExternalStore } from "react";
import { getState, subscribe } from "./store";
import { handheldTheme } from "./world/handheld";
import { WorldCanvas } from "./world/WorldCanvas";

export function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const { world, connected, mode, selectedAgentId } = state;
  const agentCount = world.order.length;
  const selected = selectedAgentId ? world.agents[selectedAgentId] : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Agent Arcade</span>
        <span className={`badge mode-${mode}`}>{mode === "mock" ? "MOCK MODE" : "LIVE"}</span>
        <span className={`badge ${connected ? "ok" : "warn"}`}>{connected ? "connected" : "connecting…"}</span>
        <span className="spacer" />
        <span className="stat">{agentCount} agents</span>
        <span className="stat">total ${world.totalCostUsd.toFixed(4)}</span>
      </header>
      <div className="columns">
        <aside className="panel left">
          <h2>Roster</h2>
          <p className="placeholder">Coming in milestone 2.</p>
          <ul className="mini-roster">
            {world.order.map((id) => {
              const a = world.agents[id];
              if (!a) return null;
              return (
                <li key={id} className={id === selectedAgentId ? "selected" : ""}>
                  <span className="name">{a.spec.name}</span>
                  <span className={`state state-${a.state}`}>{a.state.replace("_", " ")}</span>
                </li>
              );
            })}
          </ul>
        </aside>
        <main className="center">
          <WorldCanvas theme={handheldTheme} />
        </main>
        <aside className="panel right">
          <h2>Agent detail</h2>
          {selected ? (
            <div className="detail-stub">
              <p className="name">{selected.spec.name}</p>
              <p className="goal">{selected.spec.goal}</p>
              <p>
                state: <b>{selected.state}</b>
              </p>
              <p>
                tokens: {selected.usage.inputTokens + selected.usage.outputTokens} · $
                {selected.usage.costUsd.toFixed(4)}
              </p>
            </div>
          ) : (
            <p className="placeholder">Click an agent in the world. Full panel comes in milestone 2.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
