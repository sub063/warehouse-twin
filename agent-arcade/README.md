# Agent Arcade

A visual control room for AI agents: deploy, manage, and watch agents work as
characters in a small retro pixel-art world ("Handheld" theme), backed by a
real event-sourced control panel.

## Status: Milestone 1

- Event schema (v1) + pure reducer shared between live view and replay
- MockAdapter: simulated agents, zero network/API calls (default mode)
- Handheld world: stations (Terminal, Library, Workshop, Mailbox, Dock),
  walking sprites, speech bubbles, and per-state visuals
- 3 mock agents run on launch

Milestones 2–4 (full roster/detail/controls, real-agent adapter, SQLite +
replay) are not built yet.

## Run

```bash
cd agent-arcade
npm install
npm run dev        # starts server (ws://127.0.0.1:8787) + client (http://127.0.0.1:5173)
```

Open http://127.0.0.1:5173.

- `MOCK_AGENTS=5 npm run dev` spawns 5 mock agents (soak testing).
- `npm run test` — reducer unit tests
- `npm run typecheck` / `npm run build`

## Layout

- `shared/` — event types, pure reducer, `AgentAdapter` interface
- `server/` — Node + TS: event bus, WebSocket fan-out, `MockAdapter`
- `client/` — Vite + React + TS: store, world renderer behind a `Theme`
  interface (`client/src/world/theme.ts`), Handheld theme art in
  `client/src/world/handheld/`

Everything the UI shows derives from the event stream via
`shared/src/reducer.ts`.
