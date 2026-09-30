import type { TerminalSpec, WorldState } from "../../../shared/src";
import { selectAgent, sendCommand } from "../store";
import { fmtClock } from "./format";
import { KIND_LABELS } from "./TerminalModal";

/** Detail panel for a selected terminal (or the built-in Dock / Mailbox). */
export function TerminalDetail({
  stationId,
  terminal,
  world,
  visibleIds,
}: {
  stationId: string;
  terminal?: TerminalSpec;
  world: WorldState;
  visibleIds: string[];
}) {
  const builtin =
    stationId === "dock"
      ? { name: "Dock", description: "Spawn point and idle area. Agents rest here between tasks and when they finish." }
      : stationId === "mailbox"
        ? { name: "Mailbox", description: "Where agents wait for your approval on shell commands, deletions and other gated actions." }
        : undefined;

  const agentsHere = visibleIds
    .map((id) => world.agents[id])
    .filter((a) => {
      if (!a) return false;
      if (stationId === "mailbox") return a.state === "awaiting_approval";
      if (stationId === "dock") return a.state === "idle" || a.state === "done";
      return a.state === "using_tool" && a.currentTool?.terminalId === stationId;
    });

  // Recent tool calls routed to this terminal, across visible agents.
  const recent = terminal
    ? visibleIds
        .flatMap((id) => world.agents[id]?.timeline.map((e) => ({ e, agent: world.agents[id]! })) ?? [])
        .filter(({ e }) => e.type === "tool.started" && e.payload.terminalId === stationId)
        .sort((a, b) => b.e.seq - a.e.seq)
        .slice(0, 12)
    : [];

  const remove = () => {
    if (!terminal) return;
    if (window.confirm(`Remove terminal "${terminal.name}"? Agents using it will head back to the dock.`)) {
      sendCommand({ kind: "remove_terminal", terminalId: terminal.id });
    }
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <p className="name">{terminal?.name ?? builtin?.name ?? stationId}</p>
        <span className="state-pill">{terminal ? KIND_LABELS[terminal.kind] : "built-in"}</span>
      </div>
      {terminal && <p className="universe-tag">{terminal.universe}</p>}
      <p className="goal">{terminal?.description || builtin?.description || "No description yet."}</p>

      {terminal && (
        <>
          <div className="section">
            <h3>Tools provided</h3>
            {terminal.tools.length ? (
              <ul className="files">
                {terminal.tools.map((t) => (
                  <li key={t}>
                    <code>{t}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="placeholder">None listed — add tool names so agents can route work here.</p>
            )}
          </div>
          <div className="section">
            <h3>Requires</h3>
            {terminal.requires.length ? (
              <ul className="chips">
                {terminal.requires.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="placeholder">No skills, connectors or plugins noted.</p>
            )}
          </div>
        </>
      )}

      <div className="section">
        <h3>Agents here now</h3>
        {agentsHere.length ? (
          <ul className="agent-links">
            {agentsHere.map((a) => (
              <li key={a!.id}>
                <button className="link" onClick={() => selectAgent(a!.id)}>
                  {a!.spec.name}
                </button>
                <span className="muted">
                  {a!.currentTool ? ` · ${a!.currentTool.tool}` : ` · ${a!.state.replace("_", " ")}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="placeholder">Nobody right now.</p>
        )}
      </div>

      {terminal && (
        <div className="section">
          <h3>Recent work here</h3>
          {recent.length ? (
            <ul className="timeline">
              {recent.map(({ e, agent }) => (
                <li key={e.id} className="tl-row tl-tool">
                  <span className="tl-time">{fmtClock(e.ts)}</span>
                  <span className="tl-icon">▶</span>
                  <span className="tl-text">
                    {agent.spec.name}: {e.type === "tool.started" ? `${e.payload.tool} — ${e.payload.argsSummary}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder">No tool calls routed here yet.</p>
          )}
        </div>
      )}

      {terminal && (
        <div className="section">
          <button className="btn danger" onClick={remove}>
            Remove terminal
          </button>
        </div>
      )}
    </div>
  );
}
