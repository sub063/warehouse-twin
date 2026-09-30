import type { AgentView, PendingApproval } from "../../../shared/src";
import { focusOn, selectAgent, sendCommand } from "../store";

/** One gated action waiting on the human: approve or deny. */
export function ApprovalCard({ agent, approval, showAgent = false }: { agent: AgentView; approval: PendingApproval; showAgent?: boolean }) {
  const resolve = (approved: boolean) => sendCommand({ kind: "resolve_approval", agentId: agent.id, actionId: approval.actionId, approved });
  return (
    <div className="approval-card">
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
      <p>{approval.description}</p>
      <div className="approval-actions">
        <button className="btn primary" onClick={() => resolve(true)}>
          Approve
        </button>
        <button className="btn danger" onClick={() => resolve(false)}>
          Deny
        </button>
      </div>
    </div>
  );
}
