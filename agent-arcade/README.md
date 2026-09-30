# Agent Arcade

A visual control room for AI agents: deploy, manage, and watch agents work
as characters in a small game world, backed by a real event-sourced control
panel. The UI chrome is a clean, Apple-style frosted design; the world
renderer sits behind a `Theme` interface with two looks:

- **Isle** (default): smooth mobile-game island — 3/4-view buildings,
  round agent bots, vector-drawn in code, sharp at any scale
- **Handheld**: retro 4-shade pixel world, integer-scaled and crisp

Agents live in **universes** (e.g. Personal, Business, per-project
workspaces). The top-bar switcher filters the world, roster, and cost to
one universe at a time; "All" shows everything.

## Status: Milestones 1–3 done

- Event schema (v1) + pure reducer shared between live view and replay
- MockAdapter: simulated agents, zero network/API calls (default mode)
- Big scrollable world (drag/scroll to pan, ⌘/Ctrl+scroll or buttons to
  zoom, minimap), two themes, universes, **terminals** (per-universe
  stations you define: what they're for, tools they provide, what they
  require; agents route tool calls to them)
- Roster, detail panel (timeline, files changed), spawn / pause / resume /
  stop / message, approve / deny, pause-all / stop-all
- **Live mode**: real agents on the Anthropic API (`ClaudeAdapter`) with
  per-agent workspace sandboxing and approval gating — see below

Milestone 4 (SQLite persistence + replay scrubber) is not built yet.

## Live mode (real agents)

1. Copy `.env.example` to `agent-arcade/.env` and set `ANTHROPIC_API_KEY`.
2. Restart `npm run dev`. The top-bar **Mock | Live** toggle becomes
   enabled; it stays on Mock until you switch it.
3. In Live, "+ New Agent" deploys a real agent (Opus 5.5 by default).

Safety rules baked in:

- Each live agent works only inside `agent-arcade/workspaces/<agentId>`;
  any path outside it (including via `..`, absolute paths or symlinks) is
  rejected and reported back to the model.
- Shell commands and deletions wait for your approval (the Mailbox) unless
  you untick "require approval" when spawning. Denied actions are skipped.
- The API key is read from the environment / `.env` only; it is never
  logged, never sent to the browser, and stripped from the environment of
  any shell command an agent runs.
- Budgets stop the agent with a `budget_exceeded` event.
- Custom terminals (e.g. image generation) are advertised to the model so
  it can plan; calling one returns "not connected (requires: …)" until a
  connector is wired up.

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
  interface (`client/src/world/theme.ts`); themes in
  `client/src/world/isle/` (smooth vector) and
  `client/src/world/handheld/` (pixel art)

Everything the UI shows derives from the event stream via
`shared/src/reducer.ts`.
