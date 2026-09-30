import { useEffect, useState } from "react";
import type { AgentView, ArcadeEvent, WorldState } from "../../../shared/src";
import { currentTaskOf, elapsedMs, filesChanged } from "../../../shared/src";
import { openFile, sendCommand, startReplay } from "../store";
import { QuestionCard } from "./QuestionCard";
import { ApprovalCard } from "./ApprovalCard";
import { fmtClock, fmtElapsed, fmtTokens, useNow } from "./format";

const TIMELINE_LIMIT = 80;

function TimelineRow({ e }: { e: ArcadeEvent }) {
  switch (e.type) {
    case "agent.created":
      return <Row ts={e.ts} icon="●" cls="muted" text="agent deployed" />;
    case "message":
      return (
        <Row
          ts={e.ts}
          icon={e.payload.from === "human" ? "you" : "bot"}
          cls={e.payload.from === "human" ? "human" : "agent"}
          text={e.payload.text}
        />
      );
    case "tool.started":
      return <Row ts={e.ts} icon="▶" cls="tool" text={`${e.payload.tool} — ${e.payload.argsSummary}`} />;
    case "tool.finished":
      return (
        <Row
          ts={e.ts}
          icon={e.payload.ok ? "✓" : "✕"}
          cls={e.payload.ok ? "ok" : "fail"}
          text={`${e.payload.tool} (${(e.payload.durationMs / 1000).toFixed(1)}s) — ${e.payload.resultSummary}`}
        />
      );
    case "question.asked":
      return <Row ts={e.ts} icon="?" cls="question" text={`asked you: ${e.payload.text}`} />;
    case "question.answered":
      return null; // the human's answer shows as a message row
    case "approval.requested":
      return <Row ts={e.ts} icon="?" cls="approval" text={`approval requested: ${e.payload.description}`} />;
    case "approval.resolved":
      return (
        <Row
          ts={e.ts}
          icon={e.payload.approved ? "✓" : "✕"}
          cls={e.payload.approved ? "ok" : "fail"}
          text={e.payload.approved ? "approved" : "denied"}
        />
      );
    case "agent.state_changed":
      if (e.payload.state === "paused") return <Row ts={e.ts} icon="‖" cls="muted" text="paused" />;
      if (e.payload.state === "error") return <Row ts={e.ts} icon="!" cls="fail" text="hit an error" />;
      return null;
    case "agent.finished":
      return <Row ts={e.ts} icon="⚑" cls="muted" text={`finished: ${e.payload.outcome.replace("_", " ")}`} />;
    default:
      return null;
  }
}

function Row({ ts, icon, cls, text }: { ts: number; icon: string; cls: string; text: string }) {
  return (
    <li className={`tl-row tl-${cls}`}>
      <span className="tl-time">{fmtClock(ts)}</span>
      <span className="tl-icon">{icon}</span>
      <span className="tl-text">{text}</span>
    </li>
  );
}

export function DetailPanel({ agent, world, replaying = false }: { agent: AgentView; world: WorldState; replaying?: boolean }) {
  const now = useNow(1000);
  const [draft, setDraft] = useState("");
  const [instructions, setInstructions] = useState(agent.instructions ?? "");
  useEffect(() => setInstructions(agent.instructions ?? ""), [agent.id, agent.instructions]);
  const task = currentTaskOf(world, agent.id);
  const mission = agent.spec.missionId ? world.missions[agent.spec.missionId] : undefined;
  const finished = agent.state === "done" || (agent.state === "error" && agent.outcome !== undefined);
  const canReplay = finished && !replaying;
  const files = filesChanged(agent);
  const timeline = agent.timeline.slice(-TIMELINE_LIMIT).reverse();

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendCommand({ kind: "send_message", agentId: agent.id, text });
    setDraft("");
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <p className="name">{agent.spec.name}</p>
        <span className={`state-pill state-${agent.state}`}>{agent.state.replace("_", " ")}</span>
      </div>
      <p className="universe-tag">
        {agent.spec.universe}
        {agent.spec.role ? ` · ${agent.spec.role}` : ""}
      </p>
      <div className="why">
        {mission && (
          <div className="card-line">
            <span className="k">Goal</span>
            <span className="v">{mission.goal}</span>
          </div>
        )}
        <div className="card-line">
          <span className="k">{mission ? "Task" : "Goal"}</span>
          <span className="v">{task ? `${task.title} — ${task.detail}` : agent.spec.goal}</span>
        </div>
        {task && (
          <div className="card-line">
            <span className="k">Progress</span>
            <span className="v">
              <span className="progress-bar inline">
                <span style={{ width: `${task.progress}%` }} />
              </span>{" "}
              {task.progress}% · {task.status.replace("_", " ")}
            </span>
          </div>
        )}
      </div>
      <p className="meta">
        {agent.spec.model} · {fmtElapsed(elapsedMs(agent, now))} ·{" "}
        {fmtTokens(agent.usage.inputTokens + agent.usage.outputTokens)} tok · ${agent.usage.costUsd.toFixed(4)}
        {agent.spec.budget.maxTokens !== undefined && ` / ${fmtTokens(agent.spec.budget.maxTokens)} tok budget`}
        {agent.spec.budget.maxUsd !== undefined && ` / $${agent.spec.budget.maxUsd} budget`}
      </p>

      {canReplay && (
        <div className="controls">
          <button className="btn primary" onClick={() => startReplay(agent.id)}>
            ▶ Replay run
          </button>
        </div>
      )}

      {!finished && !replaying && (
        <div className="controls">
          {agent.state === "paused" ? (
            <button className="btn" onClick={() => sendCommand({ kind: "resume", agentId: agent.id })}>
              Resume
            </button>
          ) : (
            <button className="btn" onClick={() => sendCommand({ kind: "pause", agentId: agent.id })}>
              Pause
            </button>
          )}
          <button className="btn danger" onClick={() => sendCommand({ kind: "stop", agentId: agent.id })}>
            Stop
          </button>
        </div>
      )}

      {!finished && !replaying && (
        <div className="section">
          <h3>Standing instructions</h3>
          <textarea
            value={instructions}
            rows={3}
            placeholder="General guidance this agent should always follow, e.g. “Prefer TypeScript. Ask before spending money. Keep messages short.”"
            onChange={(e) => setInstructions(e.target.value)}
          />
          <button
            className="btn"
            disabled={instructions === (agent.instructions ?? "")}
            onClick={() => sendCommand({ kind: "set_instructions", agentId: agent.id, text: instructions })}
          >
            Save instructions
          </button>
        </div>
      )}

      {!finished && !replaying && (
        <div className="message-box">
          <input
            value={draft}
            placeholder="Message this agent…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn primary" onClick={send} disabled={!draft.trim()}>
            Send
          </button>
        </div>
      )}

      {!finished && !replaying && agent.pendingQuestions.length > 0 && (
        <div className="section questions">
          <h3>Asks you</h3>
          {agent.pendingQuestions.map((q) => (
            <QuestionCard key={q.questionId} agent={agent} question={q} />
          ))}
        </div>
      )}

      {!finished && !replaying && agent.pendingApprovals.length > 0 && (
        <div className="section approvals">
          <h3>Needs your approval</h3>
          {agent.pendingApprovals.map((p) => (
            <ApprovalCard key={p.actionId} agent={agent} approval={p} />
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="section">
          <h3>Files changed</h3>
          <ul className="files">
            {files.map((f) => (
              <li key={f}>
                <button className="link" onClick={() => openFile(agent.id, f)} title="Open">
                  <code>{f}</code>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="section">
        <h3>Timeline</h3>
        <ul className="timeline">
          {timeline.map((e) => (
            <TimelineRow key={e.id} e={e} />
          ))}
        </ul>
      </div>
    </div>
  );
}
