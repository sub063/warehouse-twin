/**
 * Client store: one WebSocket in, the shared pure reducer, and a tiny
 * subscribe/notify wrapper for React (useSyncExternalStore) and for the
 * canvas render loop (which reads getState() directly every frame).
 */

import type { ClientCommand, Universe, WorldState } from "../../shared/src";
import { initialState, reduce, reduceAll, runRange } from "../../shared/src";

export interface UiState {
  world: WorldState;
  connected: boolean;
  /** Which adapter new agents use (server-authoritative). */
  mode: "mock" | "live";
  /** Whether the server has an API key and can run live agents. */
  liveAvailable: boolean;
  liveModels: string[];
  selectedAgentId?: string;
  /** Selected station (terminal id, or "dock"/"mailbox"). */
  selectedTerminalId?: string;
  /** Active universe: "Personal" or "Business". */
  activeUniverse: Universe;
  /** Left panel tab. */
  leftTab: "team" | "tasks" | "terminals";
  themeId: "isle" | "handheld";
  /** Ask the camera to pan to an agent or station (nonce marks each request). */
  focus?: { kind: "agent" | "station"; id: string; nonce: number };
  /** Replay of one finished run: the world is rebuilt up to cursorTs. */
  replay?: { agentId: string; startTs: number; endTs: number; cursorTs: number; playing: boolean; speed: number };
}

let state: UiState = {
  world: initialState(),
  connected: false,
  mode: "mock",
  liveAvailable: false,
  liveModels: [],
  activeUniverse: "Personal",
  leftTab: "team",
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

export function startReplay(agentId: string): void {
  const a = state.world.agents[agentId];
  if (!a) return;
  const { startTs, endTs } = runRange(a);
  set({
    ...state,
    selectedAgentId: agentId,
    selectedTerminalId: undefined,
    activeUniverse: a.spec.universe === "Personal" ? "Personal" : "Business",
    replay: { agentId, startTs, endTs, cursorTs: startTs, playing: true, speed: 4 },
  });
}

export function exitReplay(): void {
  set({ ...state, replay: undefined });
}

export function setReplay(patch: Partial<NonNullable<UiState["replay"]>>): void {
  if (!state.replay) return;
  const r = { ...state.replay, ...patch };
  r.cursorTs = Math.max(r.startTs, Math.min(r.endTs, r.cursorTs));
  if (r.cursorTs >= r.endTs) r.playing = false;
  set({ ...state, replay: r });
}

let lastReplayNotify = 0;
/**
 * Advance the replay clock from the render loop. The state object is
 * replaced every call (so getState() is always current) but React
 * subscribers are notified at most ~10x per second.
 */
export function advanceReplay(dtMs: number): void {
  const r = state.replay;
  if (!r || !r.playing) return;
  const cursorTs = Math.min(r.endTs, r.cursorTs + dtMs * r.speed);
  const playing = cursorTs < r.endTs;
  state = { ...state, replay: { ...r, cursorTs, playing } };
  const now = performance.now();
  if (!playing || now - lastReplayNotify > 100) {
    lastReplayNotify = now;
    for (const l of listeners) l();
  }
}

export function focusOn(kind: "agent" | "station", id: string): void {
  set({ ...state, focus: { kind, id, nonce: (state.focus?.nonce ?? 0) + 1 } });
}

export function selectTerminal(id: string | undefined): void {
  set({ ...state, selectedTerminalId: id, selectedAgentId: id ? undefined : state.selectedAgentId });
}

export function setUniverse(universe: Universe): void {
  // Drop selections that aren't in the new universe.
  const sel = state.selectedAgentId ? state.world.agents[state.selectedAgentId] : undefined;
  const keepAgent = sel && sel.spec.universe === universe;
  const term = state.selectedTerminalId ? state.world.terminals[state.selectedTerminalId] : undefined;
  const keepTerminal = state.selectedTerminalId && (!term || term.universe === universe);
  set({
    ...state,
    activeUniverse: universe,
    selectedAgentId: keepAgent ? state.selectedAgentId : undefined,
    selectedTerminalId: keepTerminal ? state.selectedTerminalId : undefined,
    replay: undefined,
  });
}

export function setLeftTab(tab: UiState["leftTab"]): void {
  set({ ...state, leftTab: tab });
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
        const data = JSON.parse(String(msg.data)) as {
          kind: string;
          events?: unknown[];
          event?: unknown;
          mode?: "mock" | "live";
          liveAvailable?: boolean;
          liveModels?: string[];
        };
        if (data.kind === "mode") {
          set({
            ...state,
            mode: data.mode === "live" ? "live" : "mock",
            liveAvailable: data.liveAvailable === true,
            liveModels: Array.isArray(data.liveModels) ? data.liveModels : [],
          });
        } else if (data.kind === "snapshot" && Array.isArray(data.events)) {
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
