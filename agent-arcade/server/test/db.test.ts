import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentSpec } from "../../shared/src";
import { reduceAll } from "../../shared/src";
import { EventBus } from "../src/bus";
import { MemoryStore, SqliteStore, sqliteAvailable } from "../src/db";

const spec: AgentSpec = {
  name: "Persist",
  goal: "survive restarts",
  model: "mock-std",
  allowedTools: [],
  budget: {},
  approvalRequired: true,
  universe: "Personal",
};

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-db-"));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("EventBus + store", () => {
  it("assigns seq numbers and appends every event to the store", () => {
    const store = new MemoryStore();
    const bus = new EventBus(store);
    bus.publish({ agentId: "a1", type: "agent.created", payload: { spec } });
    bus.publish({ agentId: "a1", type: "message", payload: { from: "agent", text: "hi" } });
    expect(store.loadEvents().map((e) => e.seq)).toEqual([0, 1]);
    expect(bus.snapshot()).toHaveLength(2);
  });

  it.skipIf(!sqliteAvailable())("persists to SQLite and resumes seq after a restart", () => {
    const file = path.join(dir, "arcade.db");
    const store1 = new SqliteStore(file);
    const bus1 = new EventBus(store1);
    bus1.publish({ agentId: "a1", type: "agent.created", payload: { spec } });
    bus1.publish({
      agentId: "",
      type: "terminal.added",
      payload: { terminal: { id: "t1", universe: "Personal", name: "Terminal", description: "", kind: "shell", tools: ["shell.run"], requires: [] } },
    });
    bus1.publish({ agentId: "a1", type: "agent.finished", payload: { outcome: "completed" } });
    store1.close();

    const store2 = new SqliteStore(file);
    const bus2 = new EventBus(store2);
    const log = bus2.snapshot();
    expect(log).toHaveLength(3);
    expect(log.map((e) => e.type)).toEqual(["agent.created", "terminal.added", "agent.finished"]);
    // Payloads round-trip through JSON and the reducer sees the same world.
    const world = reduceAll(log);
    expect(world.agents["a1"]?.outcome).toBe("completed");
    expect(world.terminals["t1"]?.tools).toEqual(["shell.run"]);
    // New events continue the sequence.
    const next = bus2.publish({ agentId: "a1", type: "message", payload: { from: "human", text: "again" } });
    expect(next.seq).toBe(3);
    store2.close();
  });

  it.skipIf(!sqliteAvailable())("keeps an agents index with outcome", () => {
    const store = new SqliteStore(":memory:");
    const bus = new EventBus(store);
    bus.publish({ agentId: "a9", type: "agent.created", payload: { spec } });
    bus.publish({ agentId: "a9", type: "agent.finished", payload: { outcome: "stopped" } });
    // Peek through a fresh statement on the same connection.
    const db = (store as unknown as { db: { prepare: (s: string) => { get: () => Record<string, unknown> } } }).db;
    const row = db.prepare("SELECT name, outcome, finished_ts FROM agents WHERE id = 'a9'").get();
    expect(row.name).toBe("Persist");
    expect(row.outcome).toBe("stopped");
    expect(typeof row.finished_ts).toBe("number");
    store.close();
  });
});
