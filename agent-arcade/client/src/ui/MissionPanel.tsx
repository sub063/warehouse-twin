import { useEffect, useRef, useState } from "react";
import type { WorldState } from "../../../shared/src";
import { activeMission, openQuestions, tasksIn, teamMessagesIn } from "../../../shared/src";
import { QuestionCard } from "./QuestionCard";
import { selectAgent, sendCommand, setLeftTab } from "../store";
import { fmtClock } from "./format";

/** Right panel default: the universe's goal, team progress and team chat. */
export function MissionPanel({ world, universe }: { world: WorldState; universe: string }) {
  const mission = activeMission(world, universe);
  const tasks = tasksIn(world, universe).filter((t) => !mission || t.missionId === mission.id);
  const questions = openQuestions(world, universe);
  const messages = teamMessagesIn(world, universe)
    .filter((m) => !mission || !m.missionId || m.missionId === mission.id)
    .slice(-80);
  const [goal, setGoal] = useState("");
  const [newGoal, setNewGoal] = useState(false);
  const [post, setPost] = useState("");
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setNewGoal(false), [universe, mission?.id]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages.length]);

  const done = tasks.filter((t) => t.status === "done").length;
  const review = tasks.filter((t) => t.status === "review").length;
  const doing = tasks.filter((t) => t.status === "in_progress");
  const pct = tasks.length ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length) : 0;

  const startGoal = () => {
    const g = goal.trim();
    if (!g) return;
    sendCommand({ kind: "start_mission", universe, goal: g });
    setGoal("");
    setNewGoal(false);
  };
  const sendPost = () => {
    const t = post.trim();
    if (!t) return;
    sendCommand({ kind: "team_post", universe, text: t });
    setPost("");
  };

  return (
    <div className="mission">
      {questions.length > 0 && (
        <div className="section questions inbox">
          <h3>
            Questions for you <span className="count">{questions.length}</span>
          </h3>
          {questions.map(({ agent, question }) => (
            <QuestionCard key={question.questionId} agent={agent} question={question} showAgent />
          ))}
        </div>
      )}
      <div className="section">
        <h3>Goal · {universe}</h3>
        {mission && !newGoal ? (
          <>
            <p className="goal-text">{mission.goal}</p>
            <div className="progress-line">
              <div className="progress-bar">
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="muted">{pct}%</span>
            </div>
            <p className="muted small">
              {tasks.length} tasks · {doing.length} in progress · {review} need review · {done} done
              {mission.status === "review" && " — everything is waiting for your review"}
            </p>
            {doing.length > 0 && (
              <ul className="doing-now">
                {doing.map((t) => {
                  const a = t.assigneeId ? world.agents[t.assigneeId] : undefined;
                  return (
                    <li key={t.id}>
                      {a ? (
                        <button className="link" onClick={() => selectAgent(a.id)}>
                          {a.spec.name}
                        </button>
                      ) : (
                        <span>unassigned</span>
                      )}
                      <span className="muted"> · {t.title}</span>
                      <span className="muted small"> {t.progress}%</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="controls">
              <button className="btn" onClick={() => setLeftTab("tasks")}>
                Open task board
              </button>
              <button className="btn" onClick={() => setNewGoal(true)}>
                New goal
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="placeholder">
              {mission
                ? "Setting a new goal starts a fresh plan and team. The current goal's tasks stay on the task board until you approve them."
                : "No goal yet. Describe what you want done and a team will plan it into tasks, split the work, and talk it through in the channel below."}
            </p>
            <textarea
              value={goal}
              rows={5}
              placeholder="e.g. Research the best 3 CRM tools for a 5-person team and write a comparison"
              onChange={(e) => setGoal(e.target.value)}
            />
            <div className="controls">
              <button className="btn primary" onClick={startGoal} disabled={!goal.trim()}>
                Set goal &amp; assemble team
              </button>
              {mission && (
                <button className="btn" onClick={() => setNewGoal(false)}>
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="section chat-section">
        <h3>Team channel</h3>
        <div className="chat" ref={chatRef}>
          {messages.length === 0 && <p className="placeholder">Quiet so far. Agents post hand-offs, questions and results here; you can too.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.agentId === "" ? (m.fromName === "You" ? "me" : "system") : "agent"}`}>
              <span className="chat-from">
                {m.agentId ? (
                  <button className="link" onClick={() => selectAgent(m.agentId)}>
                    {m.fromName}
                  </button>
                ) : (
                  m.fromName
                )}
                <span className="chat-time">{fmtClock(m.ts)}</span>
              </span>
              <span className="chat-text">{m.text}</span>
            </div>
          ))}
        </div>
        <div className="message-box">
          <input
            value={post}
            placeholder="Tell the whole team something…"
            onChange={(e) => setPost(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendPost()}
          />
          <button className="btn primary" onClick={sendPost} disabled={!post.trim()}>
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
