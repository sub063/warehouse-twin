/**
 * Agent Arcade server. Mock mode only until milestone 3: boots mock
 * agents, stamps their events onto the bus, streams the log + live
 * events to every WebSocket client, and executes client commands
 * (spawn, lifecycle, messages, approvals). Binds to localhost only;
 * makes no outbound calls of any kind.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { AgentSpec, ClientCommand, ServerMessage, TerminalSpec } from "../../shared/src";
import { TERMINAL_KINDS } from "../../shared/src";
import { EventBus } from "./bus";
import { MockAdapter } from "./mockAdapter";
import { MOCK_SCRIPTS } from "./mockScripts";
import { TerminalRegistry } from "./terminals";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
// Default 4 agents on launch; MOCK_AGENTS=6 for soak testing (max = scripts available).
const AGENT_COUNT = Math.min(Number(process.env.MOCK_AGENTS ?? 4), MOCK_SCRIPTS.length);

const bus = new EventBus();
const terminals = new TerminalRegistry((draft) => bus.publish(draft));
// Approvals wait for the human (no auto-resolve); tool calls route to terminals.
const adapter = new MockAdapter({
  autoResolveApprovalsMs: null,
  resolveTerminal: (universe, tool, category) => terminals.resolve(universe, tool, category),
});
adapter.onEvent((draft) => bus.publish(draft));

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
    universe: r.universe.trim().slice(0, 40),
    name: r.name.trim().slice(0, 40),
    description: typeof r.description === "string" ? r.description.trim().slice(0, 300) : "",
    kind: TERMINAL_KINDS.includes(r.kind as never) ? (r.kind as TerminalSpec["kind"]) : "custom",
    tools: strings(r.tools, 20),
    requires: strings(r.requires, 20),
  };
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
  return {
    name: r.name.slice(0, 40).trim() || "Agent",
    goal: r.goal.slice(0, 400).trim() || "do something useful",
    model: r.model === "mock-fast" ? "mock-fast" : "mock-std",
    allowedTools: Array.isArray(r.allowedTools)
      ? r.allowedTools.filter((t): t is string => typeof t === "string").slice(0, 20)
      : [],
    budget,
    approvalRequired: r.approvalRequired !== false,
    universe: (typeof r.universe === "string" && r.universe.slice(0, 40).trim()) || "Personal",
  };
}

function handleCommand(cmd: ClientCommand): void {
  switch (cmd.kind) {
    case "spawn": {
      const spec = sanitizeSpec(cmd.spec);
      if (spec) {
        terminals.ensureDefaults(spec.universe);
        adapter.start(spec);
      }
      return;
    }
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
    case "pause":
      return adapter.pause(cmd.agentId);
    case "resume":
      return adapter.resume(cmd.agentId);
    case "stop":
      return adapter.stop(cmd.agentId);
    case "send_message":
      if (typeof cmd.text === "string" && cmd.text.trim()) {
        adapter.sendMessage(cmd.agentId, cmd.text.slice(0, 500));
      }
      return;
    case "resolve_approval":
      return adapter.resolveApproval(cmd.agentId, cmd.actionId, cmd.approved === true);
    case "pause_all":
      for (const id of adapter.activeAgentIds()) adapter.pause(id);
      return;
    case "resume_all":
      for (const id of adapter.activeAgentIds()) adapter.resume(id);
      return;
    case "stop_all":
      for (const id of adapter.activeAgentIds()) adapter.stop(id);
      return;
  }
}

const wss = new WebSocketServer({ port: PORT, host: HOST });

wss.on("connection", (ws: WebSocket) => {
  const snapshot: ServerMessage = { kind: "snapshot", events: bus.snapshot() };
  ws.send(JSON.stringify(snapshot));
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
  console.log(`[agent-arcade] mock mode · ws://${HOST}:${PORT} · spawning ${AGENT_COUNT} agents`);
  // Stagger spawns a little so the dock doesn't teleport-crowd at t=0.
  MOCK_SCRIPTS.slice(0, AGENT_COUNT).forEach((script, i) => {
    setTimeout(() => {
      terminals.ensure(script.spec.universe, script.terminals ?? []);
      adapter.startScript(script);
    }, 500 + i * 1500);
  });
});
