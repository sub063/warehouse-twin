import { useEffect, useState } from "react";
import type { AgentView, TaskSpec, WorkspaceFile, WorldState } from "../../../shared/src";
import { activeMission, latestMission, filesChanged, tasksIn } from "../../../shared/src";
import { focusOn, listFiles, openFile, selectAgent } from "../store";
import { doingNow } from "./Roster";
import { fmtClock } from "./format";

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Last thing the agent said: its own summary of what it delivered. */
function lastWords(agent: AgentView): string | undefined {
  for (let i = agent.timeline.length - 1; i >= 0; i--) {
    const e = agent.timeline[i]!;
    if (e.type === "message" && e.payload.from === "agent" && !/^(waiting|got it|okay|server restarted)/i.test(e.payload.text)) return e.payload.text;
  }
  return undefined;
}

function AgentOutput({ agent, task, world }: { agent: AgentView; task?: TaskSpec; world: WorldState }) {
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const claimed = filesChanged(agent);
  // Re-list whenever the agent finishes another file write, or finishes altogether.
  const key = `${claimed.length}:${agent.outcome ?? ""}`;
  useEffect(() => {
    let alive = true;
    listFiles(agent.id)
      .then((f) => alive && setFiles(f))
      .catch(() => alive && setFiles([]));
    return () => {
      alive = false;
    };
  }, [agent.id, key]);
  const summary = agent.outcome ? lastWords(agent) : doingNow(world, agent.id);
  const isFinal = agent.spec.role === "Reviewer" || files?.some((f) => /^FINAL\./i.test(f.path));
  return (
    <li className={`output-card${isFinal ? " final" : ""}`}>
      <div className="row-top">
        <button
          className="link name"
          onClick={() => {
            selectAgent(agent.id);
            focusOn("agent", agent.id);
          }}
        >
          {agent.spec.name}
          {agent.spec.role ? ` · ${agent.spec.role}` : ""}
        </button>
        <span className={`state-pill state-${agent.state}`}>{task ? task.status.replace("_", " ") : agent.state.replace("_", " ")}</span>
      </div>
      {task && <div className="task-title">{task.title}</div>}
      {summary && <p className="muted small">“{summary}”</p>}
      {files === null ? (
        <p className="placeholder small">Looking in the workspace…</p>
      ) : files.length === 0 ? (
        <p className="placeholder small">{agent.outcome ? "No files were produced." : "Nothing written yet."}</p>
      ) : (
        <ul className="files clickable">
          {files.map((f) => (
            <li key={f.path}>
              <button className="link" onClick={() => openFile(agent.id, f.path)} title={`Open ${f.path}`}>
                <code>{f.path}</code>
              </button>
              <span className="muted small">
                {" "}
                {fmtSize(f.size)} · {fmtClock(f.mtime)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Left-panel tab: everything the team has produced, task by task. */
export function OutputPanel({ world, universe, visibleIds, workspaceRoot }: { world: WorldState; universe: string; visibleIds: string[]; workspaceRoot?: string }) {
  // Show the goal in progress, or the last finished one so its work stays visible.
  const mission = activeMission(world, universe) ?? latestMission(world, universe);
  const tasks = tasksIn(world, universe).filter((t) => !mission || t.missionId === mission.id);
  const byAgent = new Map<string, TaskSpec>();
  for (const t of tasks) if (t.assigneeId) byAgent.set(t.assigneeId, t);
  // Mission members in task order first, then any other agent in the universe that wrote files.
  const ordered: AgentView[] = [];
  for (const t of [...tasks].sort((a, b) => a.order - b.order)) {
    const a = t.assigneeId ? world.agents[t.assigneeId] : undefined;
    if (a && !ordered.includes(a)) ordered.push(a);
  }
  // Without a goal, show any agent in the universe that has written files.
  if (!mission) {
    for (const id of visibleIds) {
      const a = world.agents[id];
      if (a && !ordered.includes(a) && filesChanged(a).length > 0) ordered.push(a);
    }
  }
  const final = ordered.find((a) => a.spec.role === "Reviewer");
  const rest = ordered.filter((a) => a !== final);
  return (
    <div className="output">
      {mission && <p className="board-goal">{mission.goal}</p>}
      {ordered.length === 0 && <p className="placeholder">Nothing produced yet. Set a goal, and each teammate's files and summary will show up here as they work.</p>}
      {final && (
        <>
          <h3>Final product</h3>
          <ul className="output-list">
            <AgentOutput agent={final} task={byAgent.get(final.id)} world={world} />
          </ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          <h3>Work by task</h3>
          <ul className="output-list">
            {rest.map((a) => (
              <AgentOutput key={a.id} agent={a} task={byAgent.get(a.id)} world={world} />
            ))}
          </ul>
        </>
      )}
      {workspaceRoot && ordered.length > 0 && (
        <p className="muted small folder">
          Files live on this computer under <code>{workspaceRoot}</code>, one folder per agent.
        </p>
      )}
    </div>
  );
}
