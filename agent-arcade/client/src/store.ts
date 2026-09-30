/**
 * Client store: one WebSocket in, the shared pure reducer, and a tiny
 * subscribe/notify wrapper for React (useSyncExternalStore) and for the
 * canvas render loop (which reads getState() directly every frame).
 */

import type { ClientCommand, WorldState } from "../../shared/src";
import { initialState, reduce, reduceAll } from "../../shared/src";

export interface UiState {
  world: WorldState;
  connected: boolean;
  /** "mock" until milestone 3 introduces live mode. */
  mode: "mock";
  selectedAgentId?: string;
  /** Selected station (terminal id, or "dock"/"mailbox"). */
  selectedTerminalId?: string;
  /** Active universe (workspace) filter; null = all universes. */
  activeUniverse: string | null;
  themeId: "isle" | "handheld";
}

let state: UiState = {
  world: initialState(),
  connected: false,
  mode: "mock",
  activeUniverse: null,
  themeId: "isle",
};
const listeners = new Set<() => void>();

export function getState(): UiState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(next: UiState): void {
  state = next;
  for (const l of listeners) l();
}

export function selectAgent(id: string | undefined): void {
  set({ ...state, selectedAgentId: id, selectedTerminalId: id ? undefined : state.selectedTerminalId });
}

export function selectTerminal(id: string | undefined): void {
  set({ ...state, selectedTerminalId: id, selectedAgentId: id ? undefined : state.selectedAgentId });
}

export function setUniverse(universe: string | null): void {
  // Drop selections that aren't in the new universe.
  const sel = state.selectedAgentId ? state.world.agents[state.selectedAgentId] : undefined;
  const keepAgent = sel && (universe === null || sel.spec.universe === universe);
  const term = state.selectedTerminalId ? state.world.terminals[state.selectedTerminalId] : undefined;
  const keepTerminal = state.selectedTerminalId && (!term || universe === null || term.universe === universe);
  set({
    ...state,
    activeUniverse: universe,
    selectedAgentId: keepAgent ? state.selectedAgentId : undefined,
    selectedTerminalId: keepTerminal ? state.selectedTerminalId : undefined,
  });
}

export function setTheme(themeId: "isle" | "handheld"): void {
  set({ ...state, themeId });
}

/** Unique universe names, in first-seen (agent creation) order. */
export function universesOf(world: WorldState): string[] {
  const seen: string[] = [];
  for (const id of world.order) {
    const u = world.agents[id]?.spec.universe;
    if (u && !seen.includes(u)) seen.push(u);
  }
  return seen;
}

function logNewIgnored(prev: WorldState, next: WorldState): void {
  if (next.ignored.length > prev.ignored.length || next.ignored.at(-1) !== prev.ignored.at(-1)) {
    const entry = next.ignored.at(-1);
    if (entry) console.warn("[agent-arcade] ignored event:", entry);
  }
}

let socket: WebSocket | null = null;

/** Send a command to the server; dropped (with a warning) if offline. */
export function sendCommand(cmd: ClientCommand): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(cmd));
  } else {
    console.warn("[agent-arcade] not connected; command dropped:", cmd.kind);
  }
}

export function connect(url = `ws://${location.hostname}:8787`): void {
  let retryMs = 500;

  const open = () => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      retryMs = 500;
      set({ ...state, connected: true });
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as { kind: string; events?: unknown[]; event?: unknown };
        if (data.kind === "snapshot" && Array.isArray(data.events)) {
          const world = reduceAll(data.events);
          logNewIgnored(state.world, world);
          set({ ...state, world });
        } else if (data.kind === "event") {
          const world = reduce(state.world, data.event);
          logNewIgnored(state.world, world);
          set({ ...state, world });
        }
      } catch (err) {
        console.warn("[agent-arcade] bad server message", err);
      }
    };
    ws.onclose = () => {
      set({ ...state, connected: false });
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    };
    ws.onerror = () => ws.close();
  };

  open();
}
