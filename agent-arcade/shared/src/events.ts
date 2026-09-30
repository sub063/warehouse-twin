/**
 * Agent Arcade event schema, version 1.
 *
 * Every fact the system knows travels as one of these events. The server
 * stamps the envelope (v, id, seq, ts); adapters only produce the
 * type + agentId + payload. The UI derives everything from the event
 * stream via the pure reducer in reducer.ts, so live view and replay
 * share one code path.
 */

export const EVENT_SCHEMA_VERSION = 1 as const;

export type AgentState =
  | "idle"
  | "thinking"
  | "using_tool"
  | "awaiting_approval"
  /** Waiting for the human to answer a question. */
  | "asking_you"
  | "paused"
  | "error"
  | "done";

/** Tool categories map 1:1 to world stations (see the Theme). */
export type ToolCategory =
  | "shell" // Terminal station
  | "search" // Library station
  | "files" // Workshop station
  | "human" // Mailbox station
  | "unknown"; // Workshop station, labeled with the tool name

export type AgentOutcome = "completed" | "stopped" | "budget_exceeded" | "error";

export interface Budget {
  /** Stop when inputTokens + outputTokens reaches this. */
  maxTokens?: number;
  /** Stop when accumulated costUsd reaches this. */
  maxUsd?: number;
}

/** The two universes (workspaces). Anything else folds into Business. */
export type Universe = "Personal" | "Business";
export const UNIVERSES: readonly Universe[] = ["Personal", "Business"];
export function normalizeUniverse(u: unknown): Universe {
  return u === "Personal" ? "Personal" : "Business";
}

export type TaskStatus = "planned" | "in_progress" | "review" | "done";

export interface TaskSpec {
  id: string;
  universe: string;
  /** Mission (shared goal) this task belongs to, if any. */
  missionId?: string;
  title: string;
  detail: string;
  /** Agent working on it, if assigned. */
  assigneeId?: string;
  status: TaskStatus;
  /** 0-100 */
  progress: number;
  /** Role label for whoever picks this task up (e.g. "Researcher"). */
  role?: string;
  /** Which kind of terminal the work mostly happens at. */
  kind?: TerminalKind;
  /** Who should pick it up after the previous task finishes (planner order). */
  order: number;
}

export interface MissionSpec {
  id: string;
  universe: string;
  goal: string;
  status: "active" | "review" | "done";
}

export interface AgentSpec {
  name: string;
  goal: string;
  model: string;
  allowedTools: string[];
  budget: Budget;
  /** Default true: shell commands and deletions need human approval. */
  approvalRequired: boolean;
  /** The universe (workspace) this agent lives in: "Personal" or "Business". */
  universe: string;
  /** Mission and task this agent was spawned for, when part of a team. */
  missionId?: string;
  taskId?: string;
  /** Short role label shown on the card, e.g. "Researcher". */
  role?: string;
}

/**
 * Kinds of terminal. A terminal is a place in a universe where agents go
 * to do one type of work (run shell commands, generate images, build 3D
 * models, list products, ...). The kind picks the building art.
 */
export type TerminalKind =
  | "shell"
  | "research"
  | "files"
  | "image"
  | "model3d"
  | "store"
  | "marketing"
  | "data"
  | "chat"
  | "legal"
  | "logistics"
  | "hr"
  | "custom";

export const TERMINAL_KINDS: readonly TerminalKind[] = [
  "shell",
  "research",
  "files",
  "image",
  "model3d",
  "store",
  "marketing",
  "data",
  "chat",
  "legal",
  "logistics",
  "hr",
  "custom",
];

export interface TerminalSpec {
  id: string;
  universe: string;
  name: string;
  /** What this terminal is used for, in the human's words. */
  description: string;
  kind: TerminalKind;
  /** Tool names this terminal provides (agents' tool calls route here). */
  tools: string[];
  /** Skills, connectors or plugins the terminal needs (free text, e.g. "Higgsfield API key"). */
  requires: string[];
}

/** Payloads per event type. */
export interface EventPayloads {
  "agent.created": { spec: AgentSpec };
  "agent.state_changed": { state: AgentState };
  /** terminalId routes the call to a terminal; category is the fallback. */
  "tool.started": { tool: string; category: ToolCategory; argsSummary: string; terminalId?: string };
  "tool.finished": { tool: string; ok: boolean; durationMs: number; resultSummary: string };
  message: { from: "agent" | "human"; text: string };
  "approval.requested": { actionId: string; description: string };
  "approval.resolved": { actionId: string; approved: boolean };
  /** The agent asked the human something and is waiting. */
  "question.asked": { questionId: string; text: string; options?: string[] };
  "question.answered": { questionId: string; answer: string };
  /** Incremental usage for the step just taken; the reducer accumulates totals. */
  "usage.updated": { inputTokens: number; outputTokens: number; costUsd: number };
  "agent.finished": { outcome: AgentOutcome };
  /** Standing instructions the agent keeps following (replaces previous). */
  "agent.instructions_set": { text: string };
  /** Universe-level events: agentId is "" (no agent). */
  "terminal.added": { terminal: TerminalSpec };
  "terminal.removed": { terminalId: string; universe: string };
  "mission.created": { mission: MissionSpec };
  "mission.updated": { missionId: string; status: MissionSpec["status"] };
  "task.created": { task: TaskSpec };
  "task.updated": { taskId: string; status?: TaskStatus; progress?: number; assigneeId?: string; note?: string };
  /** Team channel: agents talking to each other (and the human) in a universe. agentId = sender, "" for the human. */
  "team.message": { universe: string; missionId?: string; fromName: string; text: string };
}

export type EventType = keyof EventPayloads;

export interface EventEnvelope {
  v: typeof EVENT_SCHEMA_VERSION;
  /** Unique event id. */
  id: string;
  /** Global monotonic sequence number assigned by the server. */
  seq: number;
  /** Unix ms timestamp assigned by the server. */
  ts: number;
  /** Owning agent; "" for universe-level events (terminal.*). */
  agentId: string;
}

export type ArcadeEvent = {
  [T in EventType]: EventEnvelope & { type: T; payload: EventPayloads[T] };
}[EventType];

/** What an adapter emits; the server bus stamps the envelope. */
export type DraftEvent = {
  [T in EventType]: { agentId: string; type: T; payload: EventPayloads[T] };
}[EventType];

export const EVENT_TYPES: readonly EventType[] = [
  "agent.created",
  "agent.state_changed",
  "tool.started",
  "tool.finished",
  "message",
  "approval.requested",
  "approval.resolved",
  "question.asked",
  "question.answered",
  "usage.updated",
  "agent.finished",
  "terminal.added",
  "terminal.removed",
  "agent.instructions_set",
  "mission.created",
  "mission.updated",
  "task.created",
  "task.updated",
  "team.message",
];

export function isKnownEventType(t: string): t is EventType {
  return (EVENT_TYPES as readonly string[]).includes(t);
}

export type RunMode = "mock" | "live";

/** Messages sent over the WebSocket, server -> client. */
export type ServerMessage =
  | { kind: "snapshot"; events: ArcadeEvent[] }
  | { kind: "event"; event: ArcadeEvent }
  /** Which adapter new agents use; live needs an API key on the server. */
  | { kind: "mode"; mode: RunMode; liveAvailable: boolean; liveModels: string[]; workspaceRoot?: string }
  /** Reply to list_files: what an agent has produced in its workspace. */
  | { kind: "files"; requestId: string; agentId: string; files: WorkspaceFile[]; error?: string }
  /** Reply to read_file. */
  | { kind: "file"; requestId: string; agentId: string; path: string; content?: string; error?: string; truncated?: boolean };

export interface WorkspaceFile {
  path: string;
  size: number;
  /** Last modified, ms since epoch. */
  mtime: number;
}

/** Commands sent over the WebSocket, client -> server. */
export type ClientCommand =
  | { kind: "spawn"; spec: AgentSpec }
  | { kind: "pause"; agentId: string }
  | { kind: "resume"; agentId: string }
  | { kind: "stop"; agentId: string }
  | { kind: "send_message"; agentId: string; text: string }
  | { kind: "resolve_approval"; agentId: string; actionId: string; approved: boolean }
  | { kind: "answer_question"; agentId: string; questionId: string; answer: string }
  | { kind: "list_files"; requestId: string; agentId: string }
  | { kind: "read_file"; requestId: string; agentId: string; path: string }
  | { kind: "pause_all" }
  | { kind: "resume_all" }
  | { kind: "stop_all" }
  | { kind: "add_terminal"; terminal: Omit<TerminalSpec, "id"> }
  | { kind: "remove_terminal"; terminalId: string }
  | { kind: "set_mode"; mode: RunMode }
  | { kind: "set_instructions"; agentId: string; text: string }
  /** Set a shared goal: the server plans tasks and puts a team on it. */
  | { kind: "start_mission"; universe: string; goal: string }
  | { kind: "create_task"; universe: string; title: string; detail: string; assigneeId?: string; missionId?: string }
  | { kind: "update_task"; taskId: string; status?: TaskStatus; progress?: number; assigneeId?: string; note?: string }
  /** Human posts into a universe's team channel (every active agent there hears it). */
  | { kind: "team_post"; universe: string; text: string };
