/**
 * Agent Arcade server. Mock mode only in milestone 1: boots mock agents,
 * stamps their events onto the bus, and streams the log + live events to
 * every WebSocket client. Binds to localhost only; makes no outbound
 * calls of any kind.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { ServerMessage } from "../../shared/src";
import { EventBus } from "./bus";
import { MockAdapter } from "./mockAdapter";
import { MOCK_SCRIPTS } from "./mockScripts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
// Default 3 agents on launch; MOCK_AGENTS=5 for soak testing (max = scripts available).
const AGENT_COUNT = Math.min(Number(process.env.MOCK_AGENTS ?? 3), MOCK_SCRIPTS.length);

const bus = new EventBus();
const adapter = new MockAdapter();
adapter.onEvent((draft) => bus.publish(draft));

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
  ws.on("close", unsubscribe);
  ws.on("error", unsubscribe);
});

wss.on("listening", () => {
  console.log(`[agent-arcade] mock mode · ws://${HOST}:${PORT} · spawning ${AGENT_COUNT} agents`);
  // Stagger spawns a little so the dock doesn't teleport-crowd at t=0.
  MOCK_SCRIPTS.slice(0, AGENT_COUNT).forEach((script, i) => {
    setTimeout(() => adapter.startScript(script), 500 + i * 1500);
  });
});
