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

export interface AgentSpec {
  name: string;
  goal: string;
  model: string;
  allowedTools: string[];
  budget: Budget;
  /** Default true: shell commands and deletions need human approval. */
  approvalRequired: boolean;
  /**
   * The universe (workspace) this agent lives in, e.g. "Personal",
   * "Business", or a project name. The UI shows one universe at a time.
   */
  universe: string;
}

/** Payloads per event type. */
export interface EventPayloads {
  "agent.created": { spec: AgentSpec };
  "agent.state_changed": { state: AgentState };
  "tool.started": { tool: string; category: ToolCategory; argsSummary: string };
  "tool.finished": { tool: string; ok: boolean; durationMs: number; resultSummary: string };
  message: { from: "agent" | "human"; text: string };
  "approval.requested": { actionId: string; description: string };
  "approval.resolved": { actionId: string; approved: boolean };
  /** Incremental usage for the step just taken; the reducer accumulates totals. */
  "usage.updated": { inputTokens: number; outputTokens: number; costUsd: number };
  "agent.finished": { outcome: AgentOutcome };
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
  "usage.updated",
  "agent.finished",
];

export function isKnownEventType(t: string): t is EventType {
  return (EVENT_TYPES as readonly string[]).includes(t);
}

/** Messages sent over the WebSocket, server -> client. */
export type ServerMessage =
  | { kind: "snapshot"; events: ArcadeEvent[] }
  | { kind: "event"; event: ArcadeEvent };

/** Commands sent over the WebSocket, client -> server. */
export type ClientCommand =
  | { kind: "spawn"; spec: AgentSpec }
  | { kind: "pause"; agentId: string }
  | { kind: "resume"; agentId: string }
  | { kind: "stop"; agentId: string }
  | { kind: "send_message"; agentId: string; text: string }
  | { kind: "resolve_approval"; agentId: string; actionId: string; approved: boolean }
  | { kind: "pause_all" }
  | { kind: "resume_all" }
  | { kind: "stop_all" };
