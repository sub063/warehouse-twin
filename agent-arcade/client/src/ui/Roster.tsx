import type { WorldState } from "../../../shared/src";
import { currentTaskOf, elapsedMs } from "../../../shared/src";
import { focusOn, selectAgent } from "../store";
import { fmtElapsed, fmtTokens, useNow } from "./format";

/** What the agent is doing right now, in plain words. */
export function doingNow(world: WorldState, id: string): string {
  const a = world.agents[id];
  if (!a) return "";
  if (a.outcome) return `finished: ${a.outcome.replace("_", " ")}`;
  if (a.pendingQuestions.length > 0) return `asking you: ${a.pendingQuestions[0]!.text}`;
  if (a.pendingApprovals.length > 0) return `waiting for your approval: ${a.pendingApprovals[0]!.description}`;
  if (a.state === "paused") return "paused";
  if (a.state === "error") return `hit an error${a.lastTool ? ` in ${a.lastTool.tool}` : ""}, recovering`;
  if (a.currentTool) {
    const where = a.currentTool.terminalId ? world.terminals[a.currentTool.terminalId]?.name : undefined;
    return `${a.currentTool.tool}${where ? ` at ${where}` : ""} — ${a.currentTool.argsSummary}`;
  }
  if (a.state === "thinking") return a.bubble ? `thinking: ${a.bubble}` : "thinking";
  return a.bubble ?? a.state.replace("_", " ");
}

export function Roster({
  world,
  visibleIds,
  selectedAgentId,
}: {
  world: WorldState;
  visibleIds: string[];
  selectedAgentId?: string;
}) {
  const now = useNow(1000);
  const active = visibleIds.filter((id) => world.agents[id]?.outcome === undefined);
  const finished = visibleIds.filter((id) => world.agents[id]?.outcome !== undefined);

  const row = (id: string) => {
    const a = world.agents[id];
    if (!a) return null;
    const task = currentTaskOf(world, id);
    const mission = a.spec.missionId ? world.missions[a.spec.missionId] : undefined;
    return (
      <li
        key={id}
        className={id === selectedAgentId ? "selected" : ""}
        onClick={() => {
          selectAgent(id);
          focusOn("agent", id);
        }}
      >
        <div className="row-top">
          <span className={`state-dot state-${a.state}`} />
          <span className="name">{a.spec.name}</span>
          {a.spec.role && <span className="role">{a.spec.role}</span>}
          <span className="elapsed">{fmtElapsed(elapsedMs(a, now))}</span>
        </div>
        <div className="card-line">
          <span className="k">Task</span>
          <span className="v">{task ? task.title : mission ? "waiting for assignment" : a.spec.goal}</span>
        </div>
        <div className="card-line">
          <span className="k">Now</span>
          <span className={`v ${a.pendingApprovals.length ? "warn" : ""}`}>{doingNow(world, id)}</span>
        </div>
        <div className="row-bottom">
          <span className={`state state-${a.state}`}>{a.state.replace("_", " ")}</span>
          <span className="usage">
            {fmtTokens(a.usage.inputTokens + a.usage.outputTokens)} tok · ${a.usage.costUsd.toFixed(3)}
          </span>
        </div>
      </li>
    );
  };

  return (
    <div>
      <ul className="roster">
        {active.map(row)}
        {active.length === 0 && <li className="placeholder empty">Nobody is working in this universe. Set a goal or add an agent.</li>}
      </ul>
      {finished.length > 0 && (
        <>
          <h2 className="section-gap">Finished</h2>
          <ul className="roster finished">{finished.slice().reverse().map(row)}</ul>
        </>
      )}
    </div>
  );
}
