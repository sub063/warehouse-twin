/**
 * Pure selectors over reducer state, shared by UI panels (and later,
 * replay). Kept here so they can be unit-tested with the reducer.
 */

import type { AgentView } from "./reducer";

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
