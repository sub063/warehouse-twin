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
  MissionSpec,
  TaskSpec,
  TerminalSpec,
  ToolCategory,
} from "./events";
import { isKnownEventType, normalizeUniverse } from "./events";

export interface TeamMessage {
  id: string;
  ts: number;
  universe: string;
  missionId?: string;
  /** Sender agent id, or "" for the human. */
  agentId: string;
  fromName: string;
  text: string;
}

export interface ToolRun {
  tool: string;
  category: ToolCategory;
  argsSummary: string;
  /** Terminal the call was routed to, when the adapter said. */
  terminalId?: string;
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

export interface PendingQuestion {
  questionId: string;
  text: string;
  options: string[];
  askedTs: number;
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
  /** Standing instructions from the human. */
  instructions?: string;
  pendingApprovals: PendingApproval[];
  /** Questions the agent is waiting on the human to answer. */
  pendingQuestions: PendingQuestion[];
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
  /** Terminals by id, across all universes (filter by .universe). */
  terminals: Record<string, TerminalSpec>;
  /** Terminal ids in creation order. */
  terminalOrder: string[];
  missions: Record<string, MissionSpec>;
  missionOrder: string[];
  tasks: Record<string, TaskSpec>;
  taskOrder: string[];
  /** Team channel messages, oldest first (capped). */
  teamMessages: TeamMessage[];
  totalCostUsd: number;
  /** Highest seq applied. */
  lastSeq: number;
  /** Events that could not be applied; capped, never fatal. */
  ignored: IgnoredEvent[];
}

export const MAX_IGNORED = 100;
export const MAX_TEAM_MESSAGES = 500;

export function initialState(): WorldState {
  return {
    agents: {},
    order: [],
    terminals: {},
    terminalOrder: [],
    missions: {},
    missionOrder: [],
    tasks: {},
    taskOrder: [],
    teamMessages: [],
    totalCostUsd: 0,
    lastSeq: -1,
    ignored: [],
  };
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
        spec: { ...e.payload.spec, universe: normalizeUniverse(e.payload.spec.universe) },
        state: "idle",
        stateSince: e.ts,
        createdTs: e.ts,
        pendingApprovals: [],
        pendingQuestions: [],
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
          terminalId: e.payload.terminalId,
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

    case "question.asked":
      return withAgent(state, e, (a) => ({
        ...a,
        bubble: e.payload.text,
        pendingQuestions: [
          ...a.pendingQuestions.filter((q) => q.questionId !== e.payload.questionId),
          { questionId: e.payload.questionId, text: e.payload.text, options: Array.isArray(e.payload.options) ? e.payload.options.filter((o) => typeof o === "string") : [], askedTs: e.ts },
        ],
      }));

    case "question.answered":
      return withAgent(state, e, (a) => ({
        ...a,
        pendingQuestions: a.pendingQuestions.filter((q) => q.questionId !== e.payload.questionId),
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

    case "terminal.added": {
      const t = e.payload.terminal;
      if (!t || typeof t.id !== "string" || typeof t.universe !== "string") {
        return ignore(state, { reason: "malformed terminal", type: e.type, seq: e.seq });
      }
      const exists = Boolean(state.terminals[t.id]);
      return {
        ...state,
        terminals: { ...state.terminals, [t.id]: { ...t, universe: normalizeUniverse(t.universe) } },
        terminalOrder: exists ? state.terminalOrder : [...state.terminalOrder, t.id],
      };
    }

    case "agent.instructions_set":
      return withAgent(state, e, (a) => ({ ...a, instructions: e.payload.text }));

    case "mission.created": {
      const m = e.payload.mission;
      if (!m || typeof m.id !== "string") return ignore(state, { reason: "malformed mission", type: e.type, seq: e.seq });
      const mission = { ...m, universe: normalizeUniverse(m.universe) };
      return {
        ...state,
        missions: { ...state.missions, [m.id]: mission },
        missionOrder: state.missions[m.id] ? state.missionOrder : [...state.missionOrder, m.id],
      };
    }

    case "mission.updated": {
      const m = state.missions[e.payload.missionId];
      if (!m) return ignore(state, { reason: "update of unknown mission", type: e.type, seq: e.seq });
      return { ...state, missions: { ...state.missions, [m.id]: { ...m, status: e.payload.status } } };
    }

    case "task.created": {
      const t = e.payload.task;
      if (!t || typeof t.id !== "string") return ignore(state, { reason: "malformed task", type: e.type, seq: e.seq });
      const task: TaskSpec = { ...t, universe: normalizeUniverse(t.universe), progress: clampPct(t.progress) };
      return {
        ...state,
        tasks: { ...state.tasks, [t.id]: task },
        taskOrder: state.tasks[t.id] ? state.taskOrder : [...state.taskOrder, t.id],
      };
    }

    case "task.updated": {
      const t = state.tasks[e.payload.taskId];
      if (!t) return ignore(state, { reason: "update of unknown task", type: e.type, seq: e.seq });
      const next: TaskSpec = {
        ...t,
        status: e.payload.status ?? t.status,
        progress: e.payload.progress !== undefined ? clampPct(e.payload.progress) : t.progress,
        assigneeId: e.payload.assigneeId ?? t.assigneeId,
      };
      if (next.status === "done") next.progress = 100;
      return { ...state, tasks: { ...state.tasks, [t.id]: next } };
    }

    case "team.message": {
      const msg: TeamMessage = {
        id: e.id,
        ts: e.ts,
        universe: normalizeUniverse(e.payload.universe),
        missionId: e.payload.missionId,
        agentId: e.agentId,
        fromName: e.payload.fromName,
        text: e.payload.text,
      };
      return { ...state, teamMessages: [...state.teamMessages, msg].slice(-MAX_TEAM_MESSAGES) };
    }

    case "terminal.removed": {
      if (!state.terminals[e.payload.terminalId]) {
        return ignore(state, { reason: "remove of unknown terminal", type: e.type, seq: e.seq });
      }
      const terminals = { ...state.terminals };
      delete terminals[e.payload.terminalId];
      return {
        ...state,
        terminals,
        terminalOrder: state.terminalOrder.filter((id) => id !== e.payload.terminalId),
      };
    }
  }
}

function clampPct(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Reduce a whole ordered log (used for snapshots and replay). */
export function reduceAll(events: unknown[], from?: WorldState): WorldState {
  let s = from ?? initialState();
  for (const e of events) s = reduce(s, e);
  return s;
}
