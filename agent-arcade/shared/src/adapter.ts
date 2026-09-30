/**
 * AgentAdapter: the seam between the event stream and any agent runtime.
 * MockAdapter (milestone 1) and the real-runtime adapter (milestone 3)
 * both implement this. Adapters emit DraftEvents; the server bus stamps
 * the envelope (id, seq, ts, v) and fans out to clients + the log.
 */

import type { AgentSpec, DraftEvent } from "./events";

export interface AgentAdapter {
  /** Spawn a new agent. Returns its id. */
  start(spec: AgentSpec): string;
  pause(agentId: string): void;
  resume(agentId: string): void;
  stop(agentId: string): void;
  /** Deliver a human message to a running agent. */
  sendMessage(agentId: string, text: string): void;
  /** Approve or deny a pending action. */
  resolveApproval(agentId: string, actionId: string, approved: boolean): void;
  /** Replace the agent's standing instructions. */
  setInstructions(agentId: string, text: string): void;
  /** Deliver a team-channel message (from another agent or the human). */
  deliverTeamMessage(agentId: string, fromName: string, text: string): void;
  /** Subscribe to everything the adapter's agents do. */
  onEvent(listener: (e: DraftEvent) => void): void;
  /** Ids of agents this adapter is still running (pause-all / stop-all). */
  activeAgentIds(): string[];
}
