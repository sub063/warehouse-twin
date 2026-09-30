# Agent Arcade

A visual control room for AI agents: deploy, manage, and watch agents work
as characters in a small game world, backed by a real event-sourced control
panel. The UI chrome is a clean, Apple-style frosted design; the world
renderer sits behind a `Theme` interface with two looks:

- **Isle** (default): smooth mobile-game island — 3/4-view buildings,
  round agent bots, vector-drawn in code, sharp at any scale
- **Handheld**: retro 4-shade pixel world, integer-scaled and crisp

Agents live in one of two **universes**, Personal or Business. The
top-bar switcher filters the world, team, tasks, terminals and cost to
one universe at a time.

## Goals, teams and tasks

You do not have to spawn agents one by one. In the right panel, describe
a **goal** ("Research the best 3 CRM tools and write a comparison") and
press *Set goal & assemble team*:

- a planner splits the goal into ordered **tasks** (research, build,
  test, visuals, listing, promo, budget, legal review, shipping,
  hiring, review, ... depending on the goal and which departments exist
  in that universe)
- one agent is deployed per task with a **role** (Researcher, Writer,
  Merchant, ...); the first two tasks run in parallel and the next one
  starts as each finishes
- agents talk in the **team channel**: hand-offs, progress, questions.
  You can post there too, and every running agent hears it
- the **Tasks** tab is a board: Doing now / Planned / Needs review / Done
  with per-task progress, Start, Approve, Redo and Mark ready; earlier
  goals fold away under the board
- each agent card says its goal, its task and what it is doing *now*;
  the detail panel adds **standing instructions** (a text box of general
  guidance the agent always follows) and a direct message box
- hover any building in the world to see what that department is for and
  which tools it provides
- agents can **ask you questions**: they walk to the mailbox with a "?"
  badge, the question lands in *Questions for you* at the top of the
  right panel (and the top bar pill), with option buttons or a free-text
  answer; the answer goes straight back to the agent, which carries on.
  Live agents get an `ask.user` tool for this

Live agents get `team.post` and `task.update` tools for the same
channel and progress reporting.

## Status: Milestones 1–4 done, plus goals/teams/tasks

- Event schema (v1) + pure reducer shared between live view and replay
- MockAdapter: simulated agents, zero network/API calls (default mode)
- Big scrollable world (drag/scroll to pan, ⌘/Ctrl+scroll or buttons to
  zoom, minimap), two themes, universes, **departments** (buildings you
  define per universe: R&D, Engineering, Marketing, Sales, Legal,
  Logistics, Accounting, HR, or anything custom such as an image studio;
  each says what it's for, which tools it provides and what it requires,
  and agents route their work there)
- Roster, detail panel (timeline, files changed), spawn / pause / resume /
  stop / message, approve / deny, pause-all / stop-all
- **Live mode**: real agents on the Anthropic API (`ClaudeAdapter`) with
  per-agent workspace sandboxing and approval gating — see below
- **Persistence + replay**: the event log and agent records live in
  SQLite (`agent-arcade/data/arcade.db`, Node's built-in `node:sqlite`,
  no extra dependency). Everything survives a restart — agents,
  terminals, universes — and any finished run can be replayed from its
  detail panel with a timeline scrubber (play/pause, 1×/4×/16×), driven
  by the same reducer as the live view.

Notes: demo mock agents are seeded only on a fresh database (or with
`MOCK_AGENTS=n`); agents still running when the server stops are closed
out as "stopped" on the next start. Set `ARCADE_DB=":memory:"` to run
without persistence.

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

**Easiest:** double-click `start.cmd` (Windows) or run `./start.sh`
(macOS/Linux) inside `agent-arcade/`. It installs on first run, starts
everything, and opens the app in its own window. Close the console
window to stop.

Manual:

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
