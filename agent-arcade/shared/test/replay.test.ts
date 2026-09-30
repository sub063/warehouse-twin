import { describe, expect, it } from "vitest";
import type { AgentSpec, ArcadeEvent, DraftEvent } from "../src/events";
import { initialState, reduce, reduceAll } from "../src/reducer";
import { ReplayPlayer, runRange } from "../src/replay";

const spec: AgentSpec = {
  name: "R",
  goal: "replay",
  model: "mock-std",
  allowedTools: [],
  budget: {},
  approvalRequired: true,
  universe: "U",
};

let seq = 0;
const ev = (d: DraftEvent, ts: number): ArcadeEvent => ({ v: 1, id: `e${++seq}`, seq, ts, ...d }) as ArcadeEvent;

const log: ArcadeEvent[] = [
  ev({ agentId: "a", type: "agent.created", payload: { spec } }, 1000),
  ev({ agentId: "a", type: "agent.state_changed", payload: { state: "thinking" } }, 2000),
  ev({ agentId: "a", type: "tool.started", payload: { tool: "shell.run", category: "shell", argsSummary: "ls" } }, 3000),
  ev({ agentId: "a", type: "tool.finished", payload: { tool: "shell.run", ok: true, durationMs: 500, resultSummary: "ok" } }, 3500),
  ev({ agentId: "a", type: "agent.finished", payload: { outcome: "completed" } }, 5000),
];

describe("ReplayPlayer", () => {
  it("matches a from-scratch reduction at every cursor, forward and backward", () => {
    const p = new ReplayPlayer(log);
    for (const t of [500, 1000, 2500, 3000, 3499, 3500, 4999, 5000, 9000, 2000, 1000, 0]) {
      const expected = reduceAll(log.filter((e) => e.ts <= t));
      expect(p.seek(t)).toEqual(expected);
    }
  });

  it("is incremental going forward (does not re-apply earlier events)", () => {
    const p = new ReplayPlayer(log);
    const a = p.seek(3000);
    const b = p.seek(3000);
    expect(b).toBe(a); // same object: nothing new applied
    const c = p.seek(3500);
    expect(c.agents["a"]?.lastTool?.ok).toBe(true);
  });

  it("tolerates unsorted input", () => {
    const shuffled = [log[3]!, log[0]!, log[4]!, log[1]!, log[2]!];
    const p = new ReplayPlayer(shuffled);
    expect(p.seek(9000)).toEqual(reduceAll(log));
  });
});

describe("runRange", () => {
  it("spans creation to the last event / finish", () => {
    const world = reduceAll(log);
    expect(runRange(world.agents["a"]!)).toEqual({ startTs: 1000, endTs: 5000 });
    const running = reduce(initialState(), log[0]!);
    expect(runRange(running.agents["a"]!)).toEqual({ startTs: 1000, endTs: 1000 });
  });
});
