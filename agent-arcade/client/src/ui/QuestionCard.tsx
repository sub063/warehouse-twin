import { useState } from "react";
import type { AgentView, PendingQuestion } from "../../../shared/src";
import { focusOn, selectAgent, sendCommand } from "../store";

/** One question an agent is waiting on: pick an option or type an answer. */
export function QuestionCard({ agent, question, showAgent = false }: { agent: AgentView; question: PendingQuestion; showAgent?: boolean }) {
  const [draft, setDraft] = useState("");
  const answer = (text: string) => {
    const t = text.trim();
    if (!t) return;
    sendCommand({ kind: "answer_question", agentId: agent.id, questionId: question.questionId, answer: t });
    setDraft("");
  };
  return (
    <div className="question-card">
      {showAgent && (
        <button
          className="link from"
          onClick={() => {
            selectAgent(agent.id);
            focusOn("agent", agent.id);
          }}
        >
          {agent.spec.name}
          {agent.spec.role ? ` · ${agent.spec.role}` : ""}
        </button>
      )}
      <p>{question.text}</p>
      {question.options.length > 0 && (
        <div className="question-options">
          {question.options.map((o) => (
            <button key={o} className="btn" onClick={() => answer(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="message-box">
        <input
          value={draft}
          placeholder={question.options.length ? "Or type your own answer…" : "Type your answer…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && answer(draft)}
        />
        <button className="btn primary" disabled={!draft.trim()} onClick={() => answer(draft)}>
          Answer
        </button>
      </div>
    </div>
  );
}
