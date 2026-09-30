import type { WorldState } from "../../../shared/src";
import { elapsedMs } from "../../../shared/src";
import { focusOn, selectAgent } from "../store";
import { fmtElapsed, fmtTokens, useNow } from "./format";

export function Roster({
  world,
  visibleIds,
  selectedAgentId,
  showUniverse,
}: {
  world: WorldState;
  visibleIds: string[];
  selectedAgentId?: string;
  showUniverse: boolean;
}) {
  const now = useNow(1000);

  return (
    <ul className="roster">
      {visibleIds.map((id) => {
        const a = world.agents[id];
        if (!a) return null;
        const task = a.outcome
          ? `finished: ${a.outcome.replace("_", " ")}`
          : a.pendingApprovals.length > 0
            ? "waiting for your approval"
            : a.currentTool
              ? `${a.currentTool.tool} · ${a.currentTool.argsSummary}`
              : a.state.replace("_", " ");
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
              {showUniverse && <span className="universe">{a.spec.universe}</span>}
              <span className="elapsed">{fmtElapsed(elapsedMs(a, now))}</span>
            </div>
            <div className="task" title={task}>
              {task}
            </div>
            <div className="row-bottom">
              <span className={`state state-${a.state}`}>{a.state.replace("_", " ")}</span>
              <span className="usage">
                {fmtTokens(a.usage.inputTokens + a.usage.outputTokens)} tok · ${a.usage.costUsd.toFixed(4)}
              </span>
            </div>
          </li>
        );
      })}
      {visibleIds.length === 0 && <li className="placeholder empty">No agents in this universe yet.</li>}
    </ul>
  );
}
