import { describe, expect, it } from "vitest";
import type { AgentSpec, ArcadeEvent, DraftEvent } from "../src/events";
import { initialState, reduce, reduceAll, MAX_IGNORED } from "../src/reducer";

const spec: AgentSpec = {
  name: "Testy",
  goal: "test the reducer",
  model: "mock-1",
  allowedTools: ["shell", "search"],
  budget: { maxTokens: 1000 },
  approvalRequired: true,
  universe: "Testland",
};

let seqCounter = 0;
function ev(draft: DraftEvent, over: Partial<ArcadeEvent> = {}): ArcadeEvent {
  seqCounter += 1;
  return {
    v: 1,
    id: `e${seqCounter}`,
    seq: seqCounter,
    ts: 1000 + seqCounter * 100,
    ...draft,
    ...over,
  } as ArcadeEvent;
}

function created(agentId = "a1") {
  return ev({ agentId, type: "agent.created", payload: { spec } });
}

describe("agent.created", () => {
  it("adds the agent in idle state with zero usage", () => {
    const s = reduce(initialState(), created());
    const a = s.agents["a1"]!;
    expect(a.state).toBe("idle");
    expect(a.spec.name).toBe("Testy");
    expect(a.usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(s.order).toEqual(["a1"]);
    expect(a.timeline).toHaveLength(1);
  });

  it("ignores a duplicate agent.created", () => {
    const s0 = reduce(initialState(), created());
    const s1 = reduce(s0, created());
    expect(s1.order).toEqual(["a1"]);
    expect(s1.ignored.at(-1)?.reason).toBe("duplicate agent.created");
  });
});

describe("agent.state_changed", () => {
  it("updates state and stateSince for every state", () => {
    const states = ["thinking", "using_tool", "awaiting_approval", "paused", "error", "done", "idle"] as const;
    let s = reduce(initialState(), created());
    for (const st of states) {
      const e = ev({ agentId: "a1", type: "agent.state_changed", payload: { state: st } });
      s = reduce(s, e);
      expect(s.agents["a1"]!.state).toBe(st);
      expect(s.agents["a1"]!.stateSince).toBe(e.ts);
    }
  });
});

describe("tool.started / tool.finished", () => {
  it("tracks the current tool and moves it to lastTool on finish", () => {
    let s = reduce(initialState(), created());
    s = reduce(
      s,
      ev({
        agentId: "a1",
        type: "tool.started",
        payload: { tool: "bash", category: "shell", argsSummary: "npm test" },
      }),
    );
    expect(s.agents["a1"]!.currentTool?.tool).toBe("bash");
    expect(s.agents["a1"]!.currentTool?.category).toBe("shell");

    s = reduce(
      s,
      ev({
        agentId: "a1",
        type: "tool.finished",
        payload: { tool: "bash", ok: true, durationMs: 1234, resultSummary: "2 tests passed" },
      }),
    );
    const a = s.agents["a1"]!;
    expect(a.currentTool).toBeUndefined();
    expect(a.lastTool).toMatchObject({ tool: "bash", ok: true, durationMs: 1234, resultSummary: "2 tests passed" });
  });

  it("tolerates tool.finished arriving before tool.started (out of order)", () => {
    let s = reduce(initialState(), created());
    s = reduce(
      s,
      ev({
        agentId: "a1",
        type: "tool.finished",
        payload: { tool: "bash", ok: false, durationMs: 10, resultSummary: "boom" },
      }),
    );
    const a = s.agents["a1"]!;
    expect(a.lastTool?.tool).toBe("bash");
    expect(a.lastTool?.ok).toBe(false);
    // The late start then just becomes the new current tool; still no crash.
    s = reduce(
      s,
      ev({ agentId: "a1", type: "tool.started", payload: { tool: "bash", category: "shell", argsSummary: "x" } }),
    );
    expect(s.agents["a1"]!.currentTool?.tool).toBe("bash");
  });
});

describe("message", () => {
  it("agent messages set the speech bubble; human messages do not", () => {
    let s = reduce(initialState(), created());
    s = reduce(s, ev({ agentId: "a1", type: "message", payload: { from: "agent", text: "reading the docs" } }));
    expect(s.agents["a1"]!.bubble).toBe("reading the docs");
    s = reduce(s, ev({ agentId: "a1", type: "message", payload: { from: "human", text: "hurry up" } }));
    expect(s.agents["a1"]!.bubble).toBe("reading the docs");
    expect(s.agents["a1"]!.timeline.filter((e) => e.type === "message")).toHaveLength(2);
  });
});

describe("approval.requested / approval.resolved", () => {
  it("adds and removes pending approvals by actionId", () => {
    let s = reduce(initialState(), created());
    s = reduce(s, ev({ agentId: "a1", type: "approval.requested", payload: { actionId: "x1", description: "rm -rf build" } }));
    s = reduce(s, ev({ agentId: "a1", type: "approval.requested", payload: { actionId: "x2", description: "delete old.txt" } }));
    expect(s.agents["a1"]!.pendingApprovals.map((p) => p.actionId)).toEqual(["x1", "x2"]);
    s = reduce(s, ev({ agentId: "a1", type: "approval.resolved", payload: { actionId: "x1", approved: true } }));
    expect(s.agents["a1"]!.pendingApprovals.map((p) => p.actionId)).toEqual(["x2"]);
  });

  it("resolving an unknown actionId is harmless", () => {
    let s = reduce(initialState(), created());
    s = reduce(s, ev({ agentId: "a1", type: "approval.resolved", payload: { actionId: "ghost", approved: false } }));
    expect(s.agents["a1"]!.pendingApprovals).toEqual([]);
  });
});

describe("usage.updated", () => {
  it("accumulates per-agent usage and global total cost", () => {
    let s = reduce(initialState(), created());
    s = reduce(s, ev({ agentId: "a1", type: "usage.updated", payload: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 } }));
    s = reduce(s, ev({ agentId: "a1", type: "usage.updated", payload: { inputTokens: 10, outputTokens: 5, costUsd: 0.002 } }));
    const a = s.agents["a1"]!;
    expect(a.usage.inputTokens).toBe(110);
    expect(a.usage.outputTokens).toBe(55);
    expect(a.usage.costUsd).toBeCloseTo(0.012);
    expect(s.totalCostUsd).toBeCloseTo(0.012);
  });

  it("usage for an unknown agent does not change the total", () => {
    const s = reduce(initialState(), ev({ agentId: "ghost", type: "usage.updated", payload: { inputTokens: 1, outputTokens: 1, costUsd: 5 } }));
    expect(s.totalCostUsd).toBe(0);
    expect(s.ignored.at(-1)?.reason).toBe("event for unknown agent");
  });
});

describe("agent.finished", () => {
  it("sets outcome, finishedTs and done state", () => {
    let s = reduce(initialState(), created());
    const e = ev({ agentId: "a1", type: "agent.finished", payload: { outcome: "completed" } });
    s = reduce(s, e);
    const a = s.agents["a1"]!;
    expect(a.outcome).toBe("completed");
    expect(a.finishedTs).toBe(e.ts);
    expect(a.state).toBe("done");
  });

  it("an error outcome lands in error state", () => {
    let s = reduce(initialState(), created());
    s = reduce(s, ev({ agentId: "a1", type: "agent.finished", payload: { outcome: "error" } }));
    expect(s.agents["a1"]!.state).toBe("error");
  });

  it("budget_exceeded is a done state with its own outcome", () => {
    let s = reduce(initialState(), created());
    s = reduce(s, ev({ agentId: "a1", type: "agent.finished", payload: { outcome: "budget_exceeded" } }));
    expect(s.agents["a1"]!.state).toBe("done");
    expect(s.agents["a1"]!.outcome).toBe("budget_exceeded");
  });
});

describe("unknown and malformed events", () => {
  it("ignores unknown event types without crashing and records them", () => {
    let s = reduce(initialState(), created());
    s = reduce(s, ev({ agentId: "a1", type: "agent.teleported", payload: { to: "moon" } } as unknown as DraftEvent));
    expect(s.agents["a1"]!.state).toBe("idle");
    expect(s.ignored.at(-1)).toMatchObject({ reason: "unknown event type", type: "agent.teleported" });
  });

  it("ignores malformed junk (null, strings, missing fields)", () => {
    let s = initialState();
    for (const junk of [null, undefined, 42, "hi", {}, { type: 5 }, { type: "message" }]) {
      s = reduce(s, junk);
    }
    expect(s.ignored).toHaveLength(7);
    expect(s.order).toEqual([]);
  });

  it("caps the ignored list", () => {
    let s = initialState();
    for (let i = 0; i < MAX_IGNORED + 20; i++) s = reduce(s, { bad: true });
    expect(s.ignored).toHaveLength(MAX_IGNORED);
  });

  it("events for agents that do not exist are ignored per type", () => {
    const drafts: DraftEvent[] = [
      { agentId: "ghost", type: "agent.state_changed", payload: { state: "thinking" } },
      { agentId: "ghost", type: "tool.started", payload: { tool: "t", category: "shell", argsSummary: "" } },
      { agentId: "ghost", type: "tool.finished", payload: { tool: "t", ok: true, durationMs: 1, resultSummary: "" } },
      { agentId: "ghost", type: "message", payload: { from: "agent", text: "hello" } },
      { agentId: "ghost", type: "approval.requested", payload: { actionId: "a", description: "d" } },
      { agentId: "ghost", type: "approval.resolved", payload: { actionId: "a", approved: true } },
      { agentId: "ghost", type: "agent.finished", payload: { outcome: "completed" } },
    ];
    let s = initialState();
    for (const d of drafts) s = reduce(s, ev(d));
    expect(Object.keys(s.agents)).toEqual([]);
    expect(s.ignored).toHaveLength(drafts.length);
  });
});

describe("reduceAll / replay", () => {
  it("replaying a full log gives the same state as live reduction", () => {
    const log: unknown[] = [
      created(),
      ev({ agentId: "a1", type: "agent.state_changed", payload: { state: "using_tool" } }),
      ev({ agentId: "a1", type: "tool.started", payload: { tool: "web.search", category: "search", argsSummary: "vite docs" } }),
      { garbage: true },
      ev({ agentId: "a1", type: "usage.updated", payload: { inputTokens: 20, outputTokens: 80, costUsd: 0.003 } }),
      ev({ agentId: "a1", type: "tool.finished", payload: { tool: "web.search", ok: true, durationMs: 900, resultSummary: "3 results" } }),
      ev({ agentId: "a1", type: "agent.finished", payload: { outcome: "completed" } }),
    ];
    const replayed = reduceAll(log);
    let live = initialState();
    for (const e of log) live = reduce(live, e);
    expect(replayed).toEqual(live);
    expect(replayed.agents["a1"]!.state).toBe("done");
    expect(replayed.ignored).toHaveLength(1);
  });

  it("tracks lastSeq as the highest seq applied", () => {
    const e1 = created();
    const e2 = ev({ agentId: "a1", type: "message", payload: { from: "agent", text: "hi" } });
    // Deliver out of order: lastSeq still ends at the max.
    const s = reduceAll([e2, e1]); // e2 ignored (agent unknown yet), e1 applies
    expect(s.lastSeq).toBe(Math.max(e1.seq, e2.seq));
  });
});
