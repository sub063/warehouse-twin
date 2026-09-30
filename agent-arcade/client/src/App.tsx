import { useMemo, useState, useSyncExternalStore } from "react";
import { ReplayPlayer, terminalsIn, UNIVERSES } from "../../shared/src";
import { focusOn, getState, selectAgent, selectTerminal, sendCommand, setLeftTab, setTheme, setUniverse, subscribe } from "./store";
import { DetailPanel } from "./ui/DetailPanel";
import { MissionPanel } from "./ui/MissionPanel";
import { ReplayBar } from "./ui/ReplayBar";
import { Roster } from "./ui/Roster";
import { SpawnModal } from "./ui/SpawnModal";
import { TaskBoard } from "./ui/TaskBoard";
import { TerminalDetail } from "./ui/TerminalDetail";
import { KIND_LABELS, TerminalModal } from "./ui/TerminalModal";
import { handheldTheme } from "./world/handheld";
import { isleTheme } from "./world/isle";
import { WorldCanvas } from "./world/WorldCanvas";

const THEMES = { isle: isleTheme, handheld: handheldTheme } as const;

export function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const { world, connected, mode, liveAvailable, selectedAgentId, selectedTerminalId, activeUniverse, leftTab, themeId, replay } = state;
  const theme = THEMES[themeId];
  const [modal, setModal] = useState<"spawn" | "terminal" | null>(null);

  const replayAgentLive = replay ? world.agents[replay.agentId] : undefined;
  const replayPlayer = useMemo(() => (replayAgentLive ? new ReplayPlayer(replayAgentLive.timeline) : null), [replayAgentLive]);
  const replayAgent = replay && replayPlayer ? replayPlayer.seek(replay.cursorTs).agents[replay.agentId] : undefined;

  const visibleIds = world.order.filter((id) => world.agents[id]?.spec.universe === activeUniverse);
  const terminals = terminalsIn(world, activeUniverse);
  const scopeCost = visibleIds.reduce((sum, id) => sum + (world.agents[id]?.usage.costUsd ?? 0), 0);
  const selected = replay ? replayAgent : selectedAgentId ? world.agents[selectedAgentId] : undefined;
  const selectedTerminal = selectedTerminalId ? world.terminals[selectedTerminalId] : undefined;
  const universes = [...UNIVERSES];

  const active = visibleIds.map((id) => world.agents[id]).filter((a) => a && a.outcome === undefined);
  const anyRunning = active.some((a) => a!.state !== "paused");
  const stopAll = () => {
    if (window.confirm(`Stop all ${active.length} running agent(s) in ${activeUniverse}? This can't be undone.`)) {
      for (const a of active) sendCommand({ kind: "stop", agentId: a!.id });
    }
  };
  const closeDetail = () => {
    selectAgent(undefined);
    selectTerminal(undefined);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-side left">
          <span className="brand">Agent Arcade</span>
          <nav className="universes" aria-label="Universe">
            {universes.map((u) => (
              <button key={u} className={activeUniverse === u ? "seg on" : "seg"} onClick={() => setUniverse(u)}>
                {u}
              </button>
            ))}
          </nav>
          <div className={`mode-toggle mode-${mode}`} aria-label="Mode" title={liveAvailable ? "Live agents run on the Anthropic API" : "Add ANTHROPIC_API_KEY to agent-arcade/.env and restart to enable Live"}>
            <button className={mode === "mock" ? "seg on" : "seg"} onClick={() => sendCommand({ kind: "set_mode", mode: "mock" })}>
              Mock
            </button>
            <button className={mode === "live" ? "seg on live" : "seg"} disabled={!liveAvailable} onClick={() => sendCommand({ kind: "set_mode", mode: "live" })}>
              Live
            </button>
          </div>
          {mode === "live" && <span className="pill mode-live">LIVE · real agents</span>}
          <span className={`dot ${connected ? "ok" : "off"}`} title={connected ? "connected" : "connecting…"} />
        </div>
        <div className="topbar-side right">
          <span className="stat">
            {active.length} working · ${scopeCost.toFixed(3)}
          </span>
          <button className="btn" disabled={active.length === 0} onClick={() => sendCommand({ kind: anyRunning ? "pause_all" : "resume_all" })}>
            {anyRunning || active.length === 0 ? "Pause all" : "Resume all"}
          </button>
          <button className="btn danger" disabled={active.length === 0} onClick={stopAll}>
            Stop all
          </button>
          <button className="btn" onClick={() => setModal("terminal")}>
            + Terminal
          </button>
          <button className="btn" onClick={() => setModal("spawn")}>
            + Agent
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
          <div className="tabs">
            {(
              [
                ["team", `Team (${active.length})`],
                ["tasks", "Tasks"],
                ["terminals", `Terminals (${terminals.length})`],
              ] as const
            ).map(([tab, label]) => (
              <button key={tab} className={leftTab === tab ? "tab on" : "tab"} onClick={() => setLeftTab(tab)}>
                {label}
              </button>
            ))}
          </div>
          {leftTab === "team" && <Roster world={world} visibleIds={visibleIds} selectedAgentId={selectedAgentId} />}
          {leftTab === "tasks" && <TaskBoard world={world} universe={activeUniverse} />}
          {leftTab === "terminals" && (
            <ul className="terminal-list rich">
              {terminals.map((t) => (
                <li
                  key={t.id}
                  className={t.id === selectedTerminalId ? "selected" : ""}
                  onClick={() => {
                    selectTerminal(t.id);
                    focusOn("station", t.id);
                  }}
                >
                  <div className="row-top">
                    <span className={`kind-swatch kind-${t.kind}`} title={KIND_LABELS[t.kind]} />
                    <span className="name">{t.name}</span>
                    <span className="muted">{KIND_LABELS[t.kind]}</span>
                  </div>
                  <div className="task-detail">{t.description || "No description yet — click to add one."}</div>
                  {t.tools.length > 0 && <div className="muted small">{t.tools.join(" · ")}</div>}
                </li>
              ))}
              {terminals.length === 0 && <li className="placeholder empty">No terminals yet — add one above.</li>}
            </ul>
          )}
        </aside>

        <main className="center">
          <WorldCanvas theme={theme} universe={activeUniverse} terminals={terminals} />
          {replay && <ReplayBar agent={replayAgentLive} replay={replay} />}
        </main>

        <aside className="panel right">
          {selected || selectedTerminalId ? (
            <>
              <h2 className="with-back">
                <button className="link" onClick={closeDetail}>
                  ← Goal &amp; team
                </button>
                {replay && <span className="replay-badge">REPLAY</span>}
              </h2>
              {selected ? (
                <DetailPanel agent={selected} world={world} replaying={Boolean(replay)} />
              ) : (
                <TerminalDetail stationId={selectedTerminalId!} terminal={selectedTerminal} world={world} visibleIds={visibleIds} />
              )}
            </>
          ) : (
            <MissionPanel world={world} universe={activeUniverse} />
          )}
        </aside>
      </div>

      {modal === "spawn" && (
        <SpawnModal world={world} universes={universes} activeUniverse={activeUniverse} mode={mode} liveModels={state.liveModels} onClose={() => setModal(null)} />
      )}
      {modal === "terminal" && <TerminalModal universes={universes} activeUniverse={activeUniverse} onClose={() => setModal(null)} />}
    </div>
  );
}
