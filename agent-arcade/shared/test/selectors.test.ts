import { describe, expect, it } from "vitest";
import type { AgentSpec, ArcadeEvent, DraftEvent } from "../src/events";
import { initialState, reduce } from "../src/reducer";
import { elapsedMs, filesChanged, terminalsIn, toolsAvailableIn } from "../src/selectors";

const spec: AgentSpec = {
  name: "Testy",
  goal: "test selectors",
  model: "mock-std",
  allowedTools: [],
  budget: {},
  approvalRequired: true,
  universe: "Testland",
};

let seq = 0;
function ev(draft: DraftEvent, ts?: number): ArcadeEvent {
  seq += 1;
  return { v: 1, id: `e${seq}`, seq, ts: ts ?? 1000 + seq * 100, ...draft } as ArcadeEvent;
}

function agentWith(events: DraftEvent[]) {
  let s = reduce(initialState(), ev({ agentId: "a1", type: "agent.created", payload: { spec } }, 5000));
  for (const d of events) s = reduce(s, ev(d));
  return s.agents["a1"]!;
}

describe("filesChanged", () => {
  it("collects unique paths from successful file tool calls", () => {
    const a = agentWith([
      { agentId: "a1", type: "tool.started", payload: { tool: "file.edit", category: "files", argsSummary: "src/a.ts (+3)" } },
      { agentId: "a1", type: "tool.finished", payload: { tool: "file.edit", ok: true, durationMs: 100, resultSummary: "ok" } },
      { agentId: "a1", type: "tool.started", payload: { tool: "file.write", category: "files", argsSummary: "docs/b.md (+40)" } },
      { agentId: "a1", type: "tool.finished", payload: { tool: "file.write", ok: true, durationMs: 100, resultSummary: "ok" } },
      // Same file edited again: no duplicate.
      { agentId: "a1", type: "tool.started", payload: { tool: "file.edit", category: "files", argsSummary: "src/a.ts (+1)" } },
      { agentId: "a1", type: "tool.finished", payload: { tool: "file.edit", ok: true, durationMs: 100, resultSummary: "ok" } },
    ]);
    expect(filesChanged(a)).toEqual(["src/a.ts", "docs/b.md"]);
  });

  it("ignores failed calls, reads, and non-file tools", () => {
    const a = agentWith([
      { agentId: "a1", type: "tool.started", payload: { tool: "file.edit", category: "files", argsSummary: "bad.ts" } },
      { agentId: "a1", type: "tool.finished", payload: { tool: "file.edit", ok: false, durationMs: 50, resultSummary: "denied" } },
      { agentId: "a1", type: "tool.started", payload: { tool: "file.read", category: "files", argsSummary: "read.ts" } },
      { agentId: "a1", type: "tool.finished", payload: { tool: "file.read", ok: true, durationMs: 50, resultSummary: "ok" } },
      { agentId: "a1", type: "tool.started", payload: { tool: "shell.run", category: "shell", argsSummary: "npm test" } },
      { agentId: "a1", type: "tool.finished", payload: { tool: "shell.run", ok: true, durationMs: 50, resultSummary: "ok" } },
    ]);
    expect(filesChanged(a)).toEqual([]);
  });
});

describe("elapsedMs", () => {
  it("runs against now while unfinished and freezes at finishedTs", () => {
    const running = agentWith([]);
    expect(elapsedMs(running, 12_000)).toBe(7000);
    let s = reduce(initialState(), ev({ agentId: "a1", type: "agent.created", payload: { spec } }, 5000));
    s = reduce(s, ev({ agentId: "a1", type: "agent.finished", payload: { outcome: "completed" } }, 9000));
    expect(elapsedMs(s.agents["a1"]!, 99_999_999)).toBe(4000);
  });
});

describe("terminalsIn / toolsAvailableIn", () => {
  it("filters terminals by universe and unions their tools", () => {
    let s = initialState();
    const mk = (id: string, universe: string, tools: string[]) =>
      ev({ agentId: "", type: "terminal.added", payload: { terminal: { id, universe, name: id, description: "", kind: "custom", tools, requires: [] } } });
    s = reduce(s, mk("a", "Personal", ["web.search"]));
    s = reduce(s, mk("b", "Business", ["shell.run", "web.search"]));
    s = reduce(s, mk("c", "Business", ["meshy.text_to_3d"]));
    expect(terminalsIn(s, "Business").map((t) => t.id)).toEqual(["b", "c"]);
    expect(terminalsIn(s, null).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(toolsAvailableIn(s, "Business")).toEqual(["shell.run", "web.search", "meshy.text_to_3d"]);
    expect(toolsAvailableIn(s, null)).toEqual(["web.search", "shell.run", "meshy.text_to_3d"]);
  });
});
