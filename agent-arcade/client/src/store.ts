/**
 * Client store: one WebSocket in, the shared pure reducer, and a tiny
 * subscribe/notify wrapper for React (useSyncExternalStore) and for the
 * canvas render loop (which reads getState() directly every frame).
 */

import type { WorldState } from "../../shared/src";
import { initialState, reduce, reduceAll } from "../../shared/src";

export interface UiState {
  world: WorldState;
  connected: boolean;
  /** "mock" until milestone 3 introduces live mode. */
  mode: "mock";
  selectedAgentId?: string;
}

let state: UiState = { world: initialState(), connected: false, mode: "mock" };
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
  set({ ...state, selectedAgentId: id });
}

function logNewIgnored(prev: WorldState, next: WorldState): void {
  if (next.ignored.length > prev.ignored.length || next.ignored.at(-1) !== prev.ignored.at(-1)) {
    const entry = next.ignored.at(-1);
    if (entry) console.warn("[agent-arcade] ignored event:", entry);
  }
}

export function connect(url = `ws://${location.hostname}:8787`): void {
  let retryMs = 500;

  const open = () => {
    const ws = new WebSocket(url);
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
