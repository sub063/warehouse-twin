/**
 * Pure selectors over reducer state, shared by UI panels (and later,
 * replay). Kept here so they can be unit-tested with the reducer.
 */

import type { MissionSpec, TaskSpec, TerminalSpec } from "./events";
import type { AgentView, TeamMessage, WorldState } from "./reducer";

/** Terminals in a universe (or every universe when null), in creation order. */
export function terminalsIn(world: WorldState, universe: string | null): TerminalSpec[] {
  const out: TerminalSpec[] = [];
  for (const id of world.terminalOrder) {
    const t = world.terminals[id];
    if (t && (universe === null || t.universe === universe)) out.push(t);
  }
  return out;
}

/** Union of tools the universe's terminals provide (what agents may be allowed). */
export function toolsAvailableIn(world: WorldState, universe: string | null): string[] {
  const tools: string[] = [];
  for (const t of terminalsIn(world, universe)) {
    for (const tool of t.tools) if (!tools.includes(tool)) tools.push(tool);
  }
  return tools;
}

/**
 * Files an agent has changed, derived from successful file-category
 * tool calls. Mock (and later real) adapters put the path first in
 * argsSummary, e.g. "src/config/loader.ts (+41 -80)".
 */
export function filesChanged(agent: AgentView): string[] {
  const files: string[] = [];
  for (const e of agent.timeline) {
    if (e.type !== "tool.finished" || !e.payload.ok) continue;
    if (!/^file\.(write|edit|delete)$/.test(e.payload.tool)) continue;
    // Find the args of the matching start (same tool, latest before).
    const start = [...agent.timeline]
      .reverse()
      .find((s) => s.type === "tool.started" && s.payload.tool === e.payload.tool && s.seq < e.seq);
    const args = start?.type === "tool.started" ? start.payload.argsSummary : "";
    const path = args.split(/\s+/)[0];
    if (path && !files.includes(path)) files.push(path);
  }
  return files;
}

/** Elapsed run time in ms: creation to finish (or to `now` while running). */
export function elapsedMs(agent: AgentView, now: number): number {
  return Math.max(0, (agent.finishedTs ?? now) - agent.createdTs);
}

/** Tasks in a universe in planner order. */
export function tasksIn(world: WorldState, universe: string | null): TaskSpec[] {
  return world.taskOrder
    .map((id) => world.tasks[id])
    .filter((t): t is TaskSpec => Boolean(t) && (universe === null || t!.universe === universe))
    .sort((a, b) => a.order - b.order);
}

/** The task an agent is currently working on, if any. */
export function currentTaskOf(world: WorldState, agentId: string): TaskSpec | undefined {
  const mine = tasksIn(world, null).filter((t) => t.assigneeId === agentId);
  return mine.find((t) => t.status === "in_progress") ?? mine.at(-1);
}

/** The latest active mission in a universe. */
export function activeMission(world: WorldState, universe: string): MissionSpec | undefined {
  return [...world.missionOrder]
    .reverse()
    .map((id) => world.missions[id])
    .find((m) => m && m.universe === universe && m.status !== "done");
}

export function teamMessagesIn(world: WorldState, universe: string): TeamMessage[] {
  return world.teamMessages.filter((m) => m.universe === universe);
}
