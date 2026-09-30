/**
 * Pure reducer from the event stream to view state. Live view and replay
 * both call reduce() over events in seq order. It never throws on bad
 * input: unknown or out-of-order events are recorded in state.ignored
 * (callers log them) and the rest of the state is left intact.
 */

import type {
  AgentSpec,
  AgentState,
  ArcadeEvent,
  ToolCategory,
} from "./events";
import { isKnownEventType } from "./events";

export interface ToolRun {
  tool: string;
  category: ToolCategory;
  argsSummary: string;
  startedTs: number;
  /** Set once tool.finished arrives. */
  ok?: boolean;
  durationMs?: number;
  resultSummary?: string;
}

export interface PendingApproval {
  actionId: string;
  description: string;
  requestedTs: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AgentView {
  id: string;
  spec: AgentSpec;
  state: AgentState;
  /** Timestamp of the last state change (drives elapsed-time displays). */
  stateSince: number;
  createdTs: number;
  finishedTs?: number;
  outcome?: "completed" | "stopped" | "budget_exceeded" | "error";
  /** Tool currently running, if any. */
  currentTool?: ToolRun;
  /** Most recently finished tool. */
  lastTool?: ToolRun;
  /** Short status text for the speech bubble. */
  bubble?: string;
  pendingApprovals: PendingApproval[];
  usage: Usage;
  /** Full per-agent event timeline (drives the detail panel and replay). */
  timeline: ArcadeEvent[];
}

export interface IgnoredEvent {
  reason: string;
  type?: string;
  seq?: number;
  agentId?: string;
}

export interface WorldState {
  agents: Record<string, AgentView>;
  /** Agent ids in creation order. */
  order: string[];
  totalCostUsd: number;
  /** Highest seq applied. */
  lastSeq: number;
  /** Events that could not be applied; capped, never fatal. */
  ignored: IgnoredEvent[];
}

export const MAX_IGNORED = 100;

export function initialState(): WorldState {
  return { agents: {}, order: [], totalCostUsd: 0, lastSeq: -1, ignored: [] };
}

function ignore(state: WorldState, entry: IgnoredEvent): WorldState {
  const ignored = [...state.ignored, entry].slice(-MAX_IGNORED);
  return { ...state, ignored };
}

function withAgent(
  state: WorldState,
  e: ArcadeEvent,
  update: (a: AgentView) => AgentView,
): WorldState {
  const agent = state.agents[e.agentId];
  if (!agent) {
    return ignore(state, {
      reason: "event for unknown agent",
      type: e.type,
      seq: e.seq,
      agentId: e.agentId,
    });
  }
  const next = update(agent);
  return {
    ...state,
    agents: { ...state.agents, [e.agentId]: { ...next, timeline: [...agent.timeline, e] } },
  };
}

export function reduce(state: WorldState, event: unknown): WorldState {
  const e = event as ArcadeEvent;
  if (
    e === null ||
    typeof e !== "object" ||
    typeof (e as { type?: unknown }).type !== "string" ||
    typeof (e as { agentId?: unknown }).agentId !== "string"
  ) {
    return ignore(state, { reason: "malformed event" });
  }
  if (!isKnownEventType(e.type)) {
    return ignore(state, {
      reason: "unknown event type",
      type: e.type,
      seq: typeof e.seq === "number" ? e.seq : undefined,
      agentId: e.agentId,
    });
  }

  const applied = apply(state, e);
  return { ...applied, lastSeq: Math.max(state.lastSeq, e.seq ?? state.lastSeq) };
}

function apply(state: WorldState, e: ArcadeEvent): WorldState {
  switch (e.type) {
    case "agent.created": {
      if (state.agents[e.agentId]) {
        return ignore(state, { reason: "duplicate agent.created", seq: e.seq, agentId: e.agentId });
      }
      const view: AgentView = {
        id: e.agentId,
        spec: e.payload.spec,
        state: "idle",
        stateSince: e.ts,
        createdTs: e.ts,
        pendingApprovals: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        timeline: [e],
      };
      return {
        ...state,
        agents: { ...state.agents, [e.agentId]: view },
        order: [...state.order, e.agentId],
      };
    }

    case "agent.state_changed":
      return withAgent(state, e, (a) => ({
        ...a,
        state: e.payload.state,
        stateSince: e.ts,
      }));

    case "tool.started":
      return withAgent(state, e, (a) => ({
        ...a,
        currentTool: {
          tool: e.payload.tool,
          category: e.payload.category,
          argsSummary: e.payload.argsSummary,
          startedTs: e.ts,
        },
      }));

    case "tool.finished":
      return withAgent(state, e, (a) => {
        // Out-of-order tolerance: a finish without a matching start still
        // records a lastTool instead of crashing.
        const run: ToolRun = a.currentTool ?? {
          tool: e.payload.tool,
          category: "unknown",
          argsSummary: "",
          startedTs: e.ts - e.payload.durationMs,
        };
        return {
          ...a,
          currentTool: undefined,
          lastTool: {
            ...run,
            ok: e.payload.ok,
            durationMs: e.payload.durationMs,
            resultSummary: e.payload.resultSummary,
          },
        };
      });

    case "message":
      return withAgent(state, e, (a) => ({
        ...a,
        bubble: e.payload.from === "agent" ? e.payload.text : a.bubble,
      }));

    case "approval.requested":
      return withAgent(state, e, (a) => ({
        ...a,
        pendingApprovals: [
          ...a.pendingApprovals,
          { actionId: e.payload.actionId, description: e.payload.description, requestedTs: e.ts },
        ],
      }));

    case "approval.resolved":
      return withAgent(state, e, (a) => ({
        ...a,
        pendingApprovals: a.pendingApprovals.filter((p) => p.actionId !== e.payload.actionId),
      }));

    case "usage.updated": {
      const next = withAgent(state, e, (a) => ({
        ...a,
        usage: {
          inputTokens: a.usage.inputTokens + e.payload.inputTokens,
          outputTokens: a.usage.outputTokens + e.payload.outputTokens,
          costUsd: a.usage.costUsd + e.payload.costUsd,
        },
      }));
      if (next === state || !next.agents[e.agentId]) return next; // ignored
      return { ...next, totalCostUsd: state.totalCostUsd + e.payload.costUsd };
    }

    case "agent.finished":
      return withAgent(state, e, (a) => ({
        ...a,
        outcome: e.payload.outcome,
        finishedTs: e.ts,
        state: e.payload.outcome === "error" ? "error" : "done",
        stateSince: e.ts,
        currentTool: undefined,
      }));
  }
}

/** Reduce a whole ordered log (used for snapshots and replay). */
export function reduceAll(events: unknown[], from?: WorldState): WorldState {
  let s = from ?? initialState();
  for (const e of events) s = reduce(s, e);
  return s;
}
