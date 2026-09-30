/**
 * SQLite persistence for the event log and agent records, on Node's
 * built-in node:sqlite (no native build, no dependency). The event log
 * is the source of truth; agent rows are a convenience index derived
 * from agent.created / agent.finished. If node:sqlite is unavailable
 * (Node < 22.13) the server runs in memory and says so once.
 */

import fs from "node:fs";
import path from "node:path";
import type { ArcadeEvent } from "../../shared/src";

// Loaded lazily so the server still starts on runtimes without node:sqlite.
type SqliteModule = typeof import("node:sqlite");
let sqlite: SqliteModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sqlite = require("node:sqlite") as SqliteModule;
} catch {
  sqlite = null;
}

export function sqliteAvailable(): boolean {
  return sqlite !== null;
}

export interface EventStore {
  /** All events in seq order. */
  loadEvents(): ArcadeEvent[];
  append(e: ArcadeEvent): void;
  close(): void;
}

/** In-memory stand-in with the same interface (no persistence). */
export class MemoryStore implements EventStore {
  private events: ArcadeEvent[] = [];
  loadEvents(): ArcadeEvent[] {
    return this.events.slice();
  }
  append(e: ArcadeEvent): void {
    this.events.push(e);
  }
  close(): void {}
}

export class SqliteStore implements EventStore {
  private db: import("node:sqlite").DatabaseSync;
  private insertEvent;
  private insertAgent;
  private finishAgent;

  constructor(file: string) {
    if (!sqlite) throw new Error("node:sqlite is not available on this Node version");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        v INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_agent ON events(agent_id, seq);
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        universe TEXT NOT NULL,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        created_ts INTEGER NOT NULL,
        finished_ts INTEGER,
        outcome TEXT,
        spec TEXT NOT NULL
      );
    `);
    this.insertEvent = this.db.prepare(
      "INSERT INTO events (seq, id, v, ts, agent_id, type, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.insertAgent = this.db.prepare(
      "INSERT OR IGNORE INTO agents (id, universe, name, model, created_ts, spec) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.finishAgent = this.db.prepare("UPDATE agents SET finished_ts = ?, outcome = ? WHERE id = ?");
  }

  loadEvents(): ArcadeEvent[] {
    const rows = this.db.prepare("SELECT seq, id, v, ts, agent_id, type, payload FROM events ORDER BY seq").all() as Array<{
      seq: number;
      id: string;
      v: number;
      ts: number;
      agent_id: string;
      type: string;
      payload: string;
    }>;
    const out: ArcadeEvent[] = [];
    for (const r of rows) {
      try {
        out.push({ v: r.v, id: r.id, seq: r.seq, ts: r.ts, agentId: r.agent_id, type: r.type, payload: JSON.parse(r.payload) } as ArcadeEvent);
      } catch {
        // A corrupt row is skipped; the reducer tolerates gaps.
      }
    }
    return out;
  }

  append(e: ArcadeEvent): void {
    this.insertEvent.run(e.seq, e.id, e.v, e.ts, e.agentId, e.type, JSON.stringify(e.payload));
    if (e.type === "agent.created") {
      const s = e.payload.spec;
      this.insertAgent.run(e.agentId, s.universe, s.name, s.model, e.ts, JSON.stringify(s));
    } else if (e.type === "agent.finished") {
      this.finishAgent.run(e.ts, e.payload.outcome, e.agentId);
    }
  }

  close(): void {
    this.db.close();
  }
}

/** Open the SQLite store at `file`, or fall back to memory with a warning. */
export function openStore(file: string): EventStore {
  if (sqliteAvailable()) return new SqliteStore(file);
  console.warn("[agent-arcade] node:sqlite not available on this Node version — running without persistence");
  return new MemoryStore();
}
