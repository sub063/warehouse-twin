import { useState } from "react";
import type { TaskSpec, TaskStatus, WorldState } from "../../../shared/src";
import { activeMission, latestMission, tasksIn } from "../../../shared/src";
import { focusOn, selectAgent, sendCommand } from "../store";

const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "in_progress", label: "Doing now" },
  { status: "planned", label: "Planned" },
  { status: "review", label: "Needs review" },
  { status: "done", label: "Done" },
];

function TaskCard({ task, world }: { task: TaskSpec; world: WorldState }) {
  const agent = task.assigneeId ? world.agents[task.assigneeId] : undefined;
  return (
    <li className={`task-card status-${task.status}`}>
      <div className="task-title">{task.title}</div>
      {task.detail && <div className="task-detail">{task.detail}</div>}
      <div className="progress-line">
        <div className="progress-bar">
          <span style={{ width: `${task.progress}%` }} />
        </div>
        <span className="muted small">{task.progress}%</span>
      </div>
      <div className="task-foot">
        {agent ? (
          <button
            className="link"
            onClick={() => {
              selectAgent(agent.id);
              focusOn("agent", agent.id);
            }}
          >
            {agent.spec.name}
            {agent.spec.role ? ` · ${agent.spec.role}` : ""}
          </button>
        ) : (
          <span className="muted small">unassigned</span>
        )}
        <span className="task-actions">
          {task.status === "planned" && (
            <button className="btn tiny" onClick={() => sendCommand({ kind: "update_task", taskId: task.id, status: "in_progress" })}>
              Start
            </button>
          )}
          {task.status === "review" && (
            <>
              <button className="btn tiny primary" onClick={() => sendCommand({ kind: "update_task", taskId: task.id, status: "done" })}>
                Approve
              </button>
              <button className="btn tiny" onClick={() => sendCommand({ kind: "update_task", taskId: task.id, status: "planned", progress: 0 })}>
                Redo
              </button>
            </>
          )}
          {task.status === "in_progress" && (
            <button className="btn tiny" onClick={() => sendCommand({ kind: "update_task", taskId: task.id, status: "review", progress: 100 })}>
              Mark ready
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

export function TaskBoard({ world, universe }: { world: WorldState; universe: string }) {
  // Show the goal in progress, or the last finished one so its work stays visible.
  const mission = activeMission(world, universe) ?? latestMission(world, universe);
  const all = tasksIn(world, universe);
  // The board shows the current goal's tasks plus one-off tasks; earlier goals fold away below.
  const tasks = all.filter((t) => !t.missionId || t.missionId === mission?.id);
  const earlier = all.filter((t) => t.missionId && t.missionId !== mission?.id && t.status !== "done");
  const [showEarlier, setShowEarlier] = useState(false);
  const [title, setTitle] = useState("");
  const add = () => {
    const t = title.trim();
    if (!t) return;
    sendCommand({ kind: "create_task", universe, title: t, detail: "" });
    setTitle("");
  };
  return (
    <div className="task-board">
      {mission && <p className="board-goal">{mission.goal}</p>}
      <div className="message-box">
        <input value={title} placeholder="Add a task…" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn" onClick={add} disabled={!title.trim()}>
          Add
        </button>
      </div>
      {COLUMNS.map((c) => {
        const items = tasks.filter((t) => t.status === c.status);
        return (
          <div key={c.status} className="task-column">
            <h3>
              {c.label} <span className="count">{items.length}</span>
            </h3>
            <ul>
              {items.map((t) => (
                <TaskCard key={t.id} task={t} world={world} />
              ))}
              {items.length === 0 && <li className="placeholder small">—</li>}
            </ul>
          </div>
        );
      })}
      {earlier.length > 0 && (
        <div className="task-column earlier">
          <h3>
            <button className="link" onClick={() => setShowEarlier((v) => !v)}>
              {showEarlier ? "▾" : "▸"} Earlier goals <span className="count">{earlier.length}</span>
            </button>
          </h3>
          {showEarlier && (
            <ul>
              {earlier.map((t) => (
                <TaskCard key={t.id} task={t} world={world} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
