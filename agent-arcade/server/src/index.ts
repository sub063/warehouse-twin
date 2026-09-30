/**
 * Agent Arcade server: boots mock agents, stamps their events onto the
 * bus, streams the log + live events to every WebSocket client, and
 * executes client commands (spawn, lifecycle, messages, approvals,
 * terminals, mode). Binds to localhost only.
 *
 * Modes: "mock" (default; simulated agents, no network) and "live"
 * (real agents on the Anthropic API via ClaudeAdapter). Live is only
 * offered when an API key is present in the environment or .env, and
 * stays off until the human switches it on from the top bar.
 */

import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentAdapter, AgentSpec, ClientCommand, RunMode, ServerMessage, TerminalSpec } from "../../shared/src";
import { normalizeUniverse, reduceAll, teamMessagesIn, TERMINAL_KINDS } from "../../shared/src";
import { MissionManager, mockPlanner } from "./missions";
import { EventBus } from "./bus";
import { ClaudeAdapter, LIVE_MODELS } from "./claudeAdapter";
import { openStore } from "./db";
import { hasApiKey, loadEnv } from "./env";
import { MockAdapter } from "./mockAdapter";
import { MOCK_SCRIPTS } from "./mockScripts";
import { TerminalRegistry } from "./terminals";

loadEnv();

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
// Default 4 agents on launch; MOCK_AGENTS=6 for soak testing (max = scripts available).
const AGENT_COUNT = Math.min(Number(process.env.MOCK_AGENTS ?? 4), MOCK_SCRIPTS.length);
const WORKSPACE_ROOT = path.resolve(process.cwd(), "..", "workspaces");
// Event log + agent records live in SQLite (ARCADE_DB=":memory:" to disable).
const DB_FILE = process.env.ARCADE_DB ?? path.resolve(process.cwd(), "..", "data", "arcade.db");

const store = openStore(DB_FILE);
const bus = new EventBus(store);
const terminals = new TerminalRegistry((draft) => bus.publish(draft));

// Rebuild server-side state from the persisted log: terminals come back
// as they were; agents that were still running when the server last
// stopped can't be resumed (their runtime is gone), so close them out.
const restored = reduceAll(bus.snapshot());
for (const id of restored.terminalOrder) {
  const t = restored.terminals[id];
  if (t) terminals.restore(t);
}
let orphans = 0;
for (const id of restored.order) {
  const a = restored.agents[id];
  if (a && a.outcome === undefined) {
    orphans += 1;
    bus.publish({ agentId: id, type: "message", payload: { from: "agent", text: "server restarted, run ended" } });
    bus.publish({ agentId: id, type: "agent.finished", payload: { outcome: "stopped" } });
  }
}
const firstRun = restored.order.length === 0;

const mock = new MockAdapter({
  autoResolveApprovalsMs: null,
  resolveTerminal: (universe, tool, category) => terminals.resolve(universe, tool, category),
});
mock.onEvent((draft) => bus.publish(draft));

// The live adapter is only constructed when a key exists; the Anthropic
// client reads ANTHROPIC_API_KEY from the environment itself.
const liveAvailable = hasApiKey();
let live: ClaudeAdapter | null = null;
if (liveAvailable) {
  const client = new Anthropic();
  live = new ClaudeAdapter({
    stream: (params, signal) => client.messages.stream(params, { signal }),
    workspaceRoot: WORKSPACE_ROOT,
    resolveTerminal: (universe, tool, category) => terminals.resolve(universe, tool, category),
    terminalsFor: (universe) => terminals.inUniverse(universe),
    teamContext: (universe) => teamMessagesIn(reduceAll(bus.snapshot()), universe).slice(-12).map((m) => `${m.fromName}: ${m.text}`),
  });
  live.onEvent((draft) => bus.publish(draft));
}

let mode: RunMode = "mock";
const owners = new Map<string, AgentAdapter>();
const adapters: AgentAdapter[] = live ? [mock, live] : [mock];

const missions = new MissionManager({
  publish: (d) => bus.publish(d),
  terminalsFor: (u) => terminals.inUniverse(u),
  adapterForNewAgents: () => (mode === "live" && live ? live : mock),
  mock,
  planner: () => mockPlanner,
  onSpawned: (id, adapter) => owners.set(id, adapter),
  liveModel: () => LIVE_MODELS[0],
  isLive: () => mode === "live" && live !== null,
});
// Orphans were closed out above, so nothing restored is still running.
missions.restore(restored.missions, restored.tasks, new Set());
// Hand-offs and progress are driven from the event stream itself.
bus.subscribe((e) => missions.observe(e));

/** Every running agent in a universe hears a team-channel post. */
function broadcastTeam(universe: string, fromName: string, text: string, exceptAgentId?: string): void {
  const world = reduceAll(bus.snapshot());
  for (const id of world.order) {
    const a = world.agents[id];
    if (!a || a.outcome !== undefined || a.spec.universe !== universe || id === exceptAgentId) continue;
    owners.get(id)?.deliverTeamMessage(id, fromName, text);
  }
}
bus.subscribe((e) => {
  // Agents' own team posts reach their teammates (not themselves).
  if (e.type === "team.message" && e.agentId !== "") broadcastTeam(e.payload.universe, e.payload.fromName, e.payload.text, e.agentId);
});

function modeMessage(): ServerMessage {
  return { kind: "mode", mode, liveAvailable, liveModels: [...LIVE_MODELS] };
}

/** Clamp and default a spawn spec from the client (it's untrusted input). */
function sanitizeSpec(raw: unknown): AgentSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<AgentSpec>;
  if (typeof r.name !== "string" || typeof r.goal !== "string") return null;
  const budget: AgentSpec["budget"] = {};
  if (typeof r.budget?.maxTokens === "number" && r.budget.maxTokens > 0) {
    budget.maxTokens = Math.min(r.budget.maxTokens, 10_000_000);
  }
  if (typeof r.budget?.maxUsd === "number" && r.budget.maxUsd > 0) {
    budget.maxUsd = Math.min(r.budget.maxUsd, 1000);
  }
  const liveModel = (LIVE_MODELS as readonly string[]).includes(r.model ?? "") ? r.model! : LIVE_MODELS[0];
  const mockModel = r.model === "mock-fast" ? "mock-fast" : "mock-std";
  return {
    name: r.name.slice(0, 40).trim() || "Agent",
    goal: r.goal.slice(0, 400).trim() || "do something useful",
    model: mode === "live" ? liveModel : mockModel,
    allowedTools: Array.isArray(r.allowedTools)
      ? r.allowedTools.filter((t): t is string => typeof t === "string").slice(0, 20)
      : [],
    budget,
    approvalRequired: r.approvalRequired !== false,
    universe: normalizeUniverse(r.universe),
    ...(typeof r.role === "string" ? { role: r.role.slice(0, 30) } : {}),
  };
}

/** Validate a terminal from the client; returns null if unusable. */
function sanitizeTerminal(raw: unknown): Omit<TerminalSpec, "id"> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<TerminalSpec>;
  if (typeof r.name !== "string" || !r.name.trim() || typeof r.universe !== "string" || !r.universe.trim()) {
    return null;
  }
  const strings = (v: unknown, max: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().slice(0, 60)).slice(0, max) : [];
  return {
    universe: normalizeUniverse(r.universe),
    name: r.name.trim().slice(0, 40),
    description: typeof r.description === "string" ? r.description.trim().slice(0, 300) : "",
    kind: TERMINAL_KINDS.includes(r.kind as never) ? (r.kind as TerminalSpec["kind"]) : "custom",
    tools: strings(r.tools, 20),
    requires: strings(r.requires, 20),
  };
}

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

function handleCommand(cmd: ClientCommand): void {
  switch (cmd.kind) {
    case "spawn": {
      const spec = sanitizeSpec(cmd.spec);
      if (!spec) return;
      terminals.ensureDefaults(spec.universe);
      const adapter = mode === "live" && live ? live : mock;
      const id = adapter.start(spec);
      owners.set(id, adapter);
      return;
    }
    case "pause":
      return owners.get(cmd.agentId)?.pause(cmd.agentId);
    case "resume":
      return owners.get(cmd.agentId)?.resume(cmd.agentId);
    case "stop":
      return owners.get(cmd.agentId)?.stop(cmd.agentId);
    case "send_message":
      if (typeof cmd.text === "string" && cmd.text.trim()) {
        owners.get(cmd.agentId)?.sendMessage(cmd.agentId, cmd.text.slice(0, 500));
      }
      return;
    case "resolve_approval":
      return owners.get(cmd.agentId)?.resolveApproval(cmd.agentId, cmd.actionId, cmd.approved === true);
    case "pause_all":
      for (const a of adapters) for (const id of a.activeAgentIds()) a.pause(id);
      return;
    case "resume_all":
      for (const a of adapters) for (const id of a.activeAgentIds()) a.resume(id);
      return;
    case "stop_all":
      for (const a of adapters) for (const id of a.activeAgentIds()) a.stop(id);
      return;
    case "add_terminal": {
      const t = sanitizeTerminal(cmd.terminal);
      if (t) {
        terminals.ensureDefaults(t.universe);
        terminals.add(t.universe, t);
      }
      return;
    }
    case "remove_terminal":
      if (typeof cmd.terminalId === "string") terminals.remove(cmd.terminalId);
      return;
    case "answer_question":
      if (typeof cmd.answer === "string" && cmd.answer.trim()) owners.get(cmd.agentId)?.answerQuestion(cmd.agentId, cmd.questionId, cmd.answer.trim().slice(0, 500));
      return;
    case "set_instructions":
      if (typeof cmd.text === "string") owners.get(cmd.agentId)?.setInstructions(cmd.agentId, cmd.text.slice(0, 2000));
      return;
    case "start_mission":
      if (typeof cmd.goal === "string" && cmd.goal.trim()) {
        const u = normalizeUniverse(cmd.universe);
        terminals.ensureDefaults(u);
        void missions.start(u, cmd.goal.trim().slice(0, 400));
      }
      return;
    case "create_task":
      if (typeof cmd.title === "string" && cmd.title.trim()) {
        const u = normalizeUniverse(cmd.universe);
        missions.createTask(u, cmd.title.trim().slice(0, 120), typeof cmd.detail === "string" ? cmd.detail.slice(0, 400) : "", cmd.assigneeId, cmd.missionId);
      }
      return;
    case "update_task":
      if (typeof cmd.taskId === "string") {
        missions.updateTask(cmd.taskId, {
          ...(cmd.status ? { status: cmd.status } : {}),
          ...(typeof cmd.progress === "number" ? { progress: cmd.progress } : {}),
          ...(typeof cmd.assigneeId === "string" ? { assigneeId: cmd.assigneeId } : {}),
          ...(typeof cmd.note === "string" ? { note: cmd.note.slice(0, 200) } : {}),
        });
      }
      return;
    case "team_post":
      if (typeof cmd.text === "string" && cmd.text.trim()) {
        const u = normalizeUniverse(cmd.universe);
        const text = cmd.text.trim().slice(0, 500);
        const missionId = missions.activeMissionId(u);
        bus.publish({ agentId: "", type: "team.message", payload: { universe: u, missionId, fromName: "You", text } });
        broadcastTeam(u, "You", text);
      }
      return;
    case "set_mode":
      // Live is opt-in and only possible with a key on the server.
      mode = cmd.mode === "live" && liveAvailable ? "live" : "mock";
      broadcast(modeMessage());
      return;
  }
}

const wss = new WebSocketServer({ port: PORT, host: HOST });
wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[agent-arcade] port ${PORT} is already in use — an Agent Arcade server is probably still running from an earlier window.\n` +
        `  Close that window, or stop it with:  Windows: for /f "tokens=5" %p in ('netstat -ano ^| findstr :${PORT}') do taskkill /f /pid %p\n` +
        `                                       macOS/Linux: lsof -ti tcp:${PORT} | xargs kill\n` +
        `  Or run on another port: PORT=8790 (the launcher does this cleanup for you).`,
    );
    store.close();
    process.exit(1);
  }
  throw err;
});

wss.on("connection", (ws: WebSocket) => {
  const snapshot: ServerMessage = { kind: "snapshot", events: bus.snapshot() };
  ws.send(JSON.stringify(snapshot));
  ws.send(JSON.stringify(modeMessage()));
  const unsubscribe = bus.subscribe((event) => {
    if (ws.readyState === WebSocket.OPEN) {
      const msg: ServerMessage = { kind: "event", event };
      ws.send(JSON.stringify(msg));
    }
  });
  ws.on("message", (data) => {
    try {
      const cmd = JSON.parse(String(data)) as ClientCommand;
      if (typeof cmd === "object" && cmd !== null && typeof cmd.kind === "string") {
        handleCommand(cmd);
      }
    } catch {
      // Malformed command: ignore. The UI only sends well-formed JSON.
    }
  });
  ws.on("close", unsubscribe);
  ws.on("error", unsubscribe);
});

wss.on("listening", () => {
  // Demo agents only on a fresh database (or when MOCK_AGENTS is set).
  const seed = firstRun || process.env.MOCK_AGENTS !== undefined;
  console.log(
    `[agent-arcade] mode=${mode} · live ${liveAvailable ? "available (API key found)" : "unavailable (no API key)"} · ws://${HOST}:${PORT} · ` +
      `${bus.snapshot().length} events loaded (${restored.order.length} agents${orphans ? `, ${orphans} closed out` : ""}) · ` +
      (seed ? "seeding demo agent + Business mission" : "no demo agents (set a goal or use + New Agent)"),
  );
  if (!seed) return;
  // Demo: a solo agent in Personal and a full team mission in Business
  // (with the product-pipeline terminals so the mission fans out).
  for (const u of ["Personal", "Business"]) terminals.ensureDefaults(u);
  const forge = MOCK_SCRIPTS.find((s) => s.spec.name === "Forge");
  if (forge) terminals.ensure("Business", forge.terminals ?? []);
  MOCK_SCRIPTS.slice(0, Math.min(AGENT_COUNT, 1)).forEach((script) => {
    const id = mock.startScript(script);
    owners.set(id, mock);
  });
  setTimeout(() => void missions.start("Business", "Design, list and market the Lumen desk lamp"), 1500);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    store.close();
    process.exit(0);
  });
}
