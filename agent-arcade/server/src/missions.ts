/**
 * Missions: a shared goal in a universe, planned into ordered tasks and
 * worked by a team of agents who talk in the team channel. The
 * MissionManager plans (mock templates, or a real model in live mode),
 * spawns one agent per task through whichever adapter is active, and
 * coordinates hand-offs from the event stream: when a task's agent
 * finishes, the task goes to review and the next task starts.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AgentSpec,
  ArcadeEvent,
  DraftEvent,
  MissionSpec,
  TaskSpec,
  TerminalKind,
  TerminalSpec,
  ToolCategory,
} from "../../shared/src";
import { normalizeUniverse } from "../../shared/src";
import type { MockAdapter } from "./mockAdapter";
import type { MockScript, Step } from "./mockScripts";

export interface PlannedTask {
  title: string;
  detail: string;
  /** Terminal kind the work mostly happens at. */
  kind: TerminalKind;
  role: string;
}

export type Planner = (goal: string, terminals: TerminalSpec[]) => Promise<PlannedTask[]>;

const NAMES = ["Scout", "Mason", "Patch", "Forge", "Quill", "Nix", "Ember", "Vale", "Juno", "Orin", "Sage", "Rook"];

/** Template planner for mock mode: tasks follow the goal's shape and the terminals available. */
export const mockPlanner: Planner = async (goal, terminals) => {
  const kinds = new Set(terminals.map((t) => t.kind));
  const g = goal.toLowerCase();
  const tasks: PlannedTask[] = [];
  // Long goals are welcome; task titles/details quote a short form and the full text lives on the mission.
  const short = goal.length > 48 ? goal.slice(0, 45).trimEnd() + "…" : goal;
  const brief = goal.length > 160 ? goal.slice(0, 157).trimEnd() + "…" : goal;
  tasks.push({ title: `Research: ${short}`, detail: `Find what matters for "${brief}" and write notes for the team.`, kind: "research", role: "Researcher" });
  if (/build|code|app|fix|test|refactor|website|site|script|bug|feature/.test(g)) {
    tasks.push({ title: "Implement the changes", detail: `Do the hands-on work for "${brief}" in the workspace.`, kind: "files", role: "Builder" });
    tasks.push({ title: "Test and verify", detail: "Run the checks and fix what fails.", kind: "shell", role: "Tester" });
  }
  if (/design|image|visual|logo|art|photo|render/.test(g) && kinds.has("image")) {
    tasks.push({ title: "Create the visuals", detail: `Generate images for "${brief}".`, kind: "image", role: "Designer" });
  }
  if (/3d|model|product|prototype/.test(g) && kinds.has("model3d")) {
    tasks.push({ title: "Build the 3D model", detail: "Turn the concept into a 3D model.", kind: "model3d", role: "Modeler" });
  }
  if (/sell|list|shop|store|price|product|launch/.test(g) && kinds.has("store")) {
    tasks.push({ title: "Publish the listing and set pricing", detail: "Create the listing and choose intro pricing.", kind: "store", role: "Merchant" });
  }
  if (/market|promo|launch|campaign|social|announce/.test(g) && kinds.has("marketing")) {
    tasks.push({ title: "Run the launch promo", detail: "Campaign + announcement posts.", kind: "marketing", role: "Marketer" });
  }
  if (/sell|sales|customer|crm|launch/.test(g) && kinds.has("chat")) {
    tasks.push({ title: "Follow up on first sales", detail: "Track leads and log the first orders.", kind: "chat", role: "Sales" });
  }
  if (/write|summar|report|notes|doc|plan|brief|email|post/.test(g) || tasks.length === 1) {
    tasks.push({ title: "Write it up", detail: `Turn the findings into the deliverable for "${brief}".`, kind: "files", role: "Writer" });
  }
  tasks.push({ title: "Review and wrap up", detail: "Check everything against the goal and prepare it for your review.", kind: "files", role: "Reviewer" });
  return tasks.slice(0, 7);
};

const KIND_TOOL: Record<TerminalKind, { tool: string; category: ToolCategory }> = {
  shell: { tool: "shell.run", category: "shell" },
  research: { tool: "web.search", category: "search" },
  files: { tool: "file.edit", category: "files" },
  image: { tool: "higgsfield.generate_image", category: "unknown" },
  model3d: { tool: "meshy.text_to_3d", category: "unknown" },
  store: { tool: "store.create_listing", category: "unknown" },
  marketing: { tool: "ads.create_campaign", category: "unknown" },
  data: { tool: "data.query", category: "unknown" },
  chat: { tool: "crm.log_sale", category: "unknown" },
  custom: { tool: "custom.run", category: "unknown" },
};

/** A mock script that works one task at its terminal, talking to the team as it goes. */
export function scriptForTask(spec: AgentSpec, task: TaskSpec, kind: TerminalKind, terminals: TerminalSpec[]): MockScript {
  const term = terminals.find((t) => t.kind === kind);
  const tool = term?.tools[0] ?? KIND_TOOL[kind].tool;
  const category = KIND_TOOL[kind].category;
  const gated = tool === "shell.run" || tool === "file.delete" || tool === "store.create_listing" || tool === "ads.create_campaign";
  const steps: Step[] = [
    { kind: "team", text: `Starting "${task.title}".` },
    { kind: "think", ms: [3000, 5000], say: "reading the plan" },
    { kind: "tool", tool: "file.read", category: "files", args: "team/notes.md", ms: [4000, 6000], say: "checking team notes", okResult: "notes read" },
    { kind: "tool", tool, category, args: task.title.slice(0, 40), ms: [8000, 13000], say: `working at ${term?.name ?? kind}`, okResult: "step 1 done", failChance: 0.08, failResult: "hit a snag", ...(gated ? { approval: `${term?.name ?? tool}: ${task.title}` } : {}) },
    { kind: "team", text: `Halfway through "${task.title}" — looking good so far.` },
    ...(task.order === 0
      ? [{ kind: "ask", text: `Quick check on "${task.title}": should I optimise for speed or for quality?`, options: ["Speed", "Quality", "Balanced"] } satisfies Step]
      : []),
    { kind: "tool", tool, category, args: task.detail.slice(0, 40), ms: [8000, 13000], say: "finishing the work", okResult: "step 2 done", failChance: 0.06, failResult: "retrying" },
    { kind: "tool", tool: "file.write", category: "files", args: `team/${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}.md (+30)`, ms: [5000, 8000], say: "writing my results", okResult: "results saved" },
    { kind: "team", text: `Done with "${task.title}". Results are in team/ — handing off.` },
    { kind: "say", text: "ready for review" },
    { kind: "finish", outcome: "completed" },
  ];
  return { spec, steps };
}

export interface MissionManagerDeps {
  publish: (draft: DraftEvent) => ArcadeEvent;
  terminalsFor: (universe: string) => TerminalSpec[];
  /** Adapter to spawn team members on (mock or live, by current mode). */
  adapterForNewAgents: () => AgentAdapter;
  mock: MockAdapter;
  planner: () => Planner;
  /** Called when an agent is created so the server can route commands. */
  onSpawned: (agentId: string, adapter: AgentAdapter) => void;
  /** Default live model for spawned team members. */
  liveModel: () => string;
  isLive: () => boolean;
}

export class MissionManager {
  private missions = new Map<string, MissionSpec>();
  private tasks = new Map<string, TaskSpec>();
  private agentTask = new Map<string, string>();
  private stepsSeen = new Map<string, number>();
  private nameIndex = 0;

  constructor(private deps: MissionManagerDeps) {}

  /** Restore from the persisted log so hand-offs keep working after a restart. */
  /**
   * Reload persisted missions/tasks. `runningAgentIds` is whoever is still
   * alive: an in-progress task whose agent is gone (server restart) goes back
   * to Planned so it can be picked up again.
   */
  restore(missions: Record<string, MissionSpec>, tasks: Record<string, TaskSpec>, runningAgentIds: Set<string> = new Set()): void {
    for (const m of Object.values(missions)) this.missions.set(m.id, m);
    for (const t of Object.values(tasks)) {
      this.tasks.set(t.id, t);
      if (t.assigneeId) this.agentTask.set(t.assigneeId, t.id);
    }
    for (const t of Object.values(tasks)) {
      if (t.status === "in_progress" && t.assigneeId && !runningAgentIds.has(t.assigneeId)) {
        this.updateTask(t.id, { status: "planned", progress: t.progress, note: "agent stopped while the server was down" });
      }
    }
  }

  /** Latest mission in a universe that is not done, if any. */
  activeMissionId(universe: string): string | undefined {
    let found: string | undefined;
    for (const m of this.missions.values()) if (m.universe === universe && m.status !== "done") found = m.id;
    return found;
  }

  async start(universeRaw: string, goal: string): Promise<MissionSpec> {
    const universe = normalizeUniverse(universeRaw);
    const mission: MissionSpec = { id: randomUUID().slice(0, 8), universe, goal, status: "active" };
    this.missions.set(mission.id, mission);
    this.deps.publish({ agentId: "", type: "mission.created", payload: { mission } });
    this.deps.publish({ agentId: "", type: "team.message", payload: { universe, missionId: mission.id, fromName: "You", text: `New goal: ${goal}` } });

    const terminals = this.deps.terminalsFor(universe);
    let planned: PlannedTask[];
    try {
      planned = await this.deps.planner()(goal, terminals);
    } catch (err) {
      planned = await mockPlanner(goal, terminals);
      this.deps.publish({ agentId: "", type: "team.message", payload: { universe, missionId: mission.id, fromName: "Planner", text: `Planner fell back to templates (${err instanceof Error ? err.message.slice(0, 80) : "error"}).` } });
    }
    planned.forEach((p, i) => {
      const task: TaskSpec = { id: randomUUID().slice(0, 8), universe, missionId: mission.id, title: p.title, detail: p.detail, status: "planned", progress: 0, role: p.role, kind: p.kind, order: i };
      this.tasks.set(task.id, task);
      this.deps.publish({ agentId: "", type: "task.created", payload: { task } });
    });
    this.deps.publish({
      agentId: "",
      type: "team.message",
      payload: { universe, missionId: mission.id, fromName: "Planner", text: `Plan: ${planned.map((p, i) => `${i + 1}. ${p.title}`).join("  ")}` },
    });
    // First two tasks run in parallel; the rest start as earlier ones finish.
    for (const t of this.missionTasks(mission.id).slice(0, 2)) this.startTask(t);
    return mission;
  }

  createTask(universeRaw: string, title: string, detail: string, assigneeId?: string, missionId?: string): TaskSpec {
    const universe = normalizeUniverse(universeRaw);
    const order = this.missionTasks(missionId ?? "").length + this.tasks.size;
    const task: TaskSpec = { id: randomUUID().slice(0, 8), universe, missionId, title, detail, assigneeId, status: "planned", progress: 0, order };
    this.tasks.set(task.id, task);
    this.deps.publish({ agentId: "", type: "task.created", payload: { task } });
    return task;
  }

  updateTask(taskId: string, patch: { status?: TaskSpec["status"]; progress?: number; assigneeId?: string; note?: string }): void {
    const t = this.tasks.get(taskId);
    if (!t) return;
    const next = { ...t, ...(patch.status ? { status: patch.status } : {}), ...(patch.progress !== undefined ? { progress: patch.progress } : {}), ...(patch.assigneeId ? { assigneeId: patch.assigneeId } : {}) };
    this.tasks.set(taskId, next);
    if (patch.assigneeId) this.agentTask.set(patch.assigneeId, taskId);
    this.deps.publish({ agentId: "", type: "task.updated", payload: { taskId, ...patch } });
    if (patch.status === "in_progress" && !t.assigneeId && !patch.assigneeId) {
      // Human kicked off a planned task by hand: spawn someone for it.
      this.startTask(next);
    }
    this.checkMission(next.missionId);
  }

  /** Feed every event here; hand-offs and progress come from the stream. */
  observe(e: ArcadeEvent): void {
    const taskId = this.agentTask.get(e.agentId);
    if (!taskId) return;
    const task = this.tasks.get(taskId);
    if (!task || task.status === "done") return;
    if (e.type === "tool.finished" && e.payload.ok && task.status === "in_progress") {
      const seen = (this.stepsSeen.get(e.agentId) ?? 0) + 1;
      this.stepsSeen.set(e.agentId, seen);
      const progress = Math.min(90, Math.round((seen / 4) * 90));
      if (progress > task.progress) this.updateTask(taskId, { progress });
    } else if (e.type === "agent.finished") {
      if (e.payload.outcome === "completed") {
        this.updateTask(taskId, { status: "review", progress: 100 });
        this.startNext(task.missionId);
      } else {
        this.updateTask(taskId, { status: "planned", progress: task.progress, note: `agent ${e.payload.outcome}` });
        this.deps.publish({ agentId: "", type: "team.message", payload: { universe: task.universe, missionId: task.missionId, fromName: "Planner", text: `"${task.title}" is back in Planned (agent ${e.payload.outcome}).` } });
      }
    }
  }

  private missionTasks(missionId: string): TaskSpec[] {
    return [...this.tasks.values()].filter((t) => t.missionId === missionId).sort((a, b) => a.order - b.order);
  }

  private startNext(missionId: string | undefined): void {
    if (!missionId) return;
    const next = this.missionTasks(missionId).find((t) => t.status === "planned" && !t.assigneeId);
    if (next) this.startTask(next);
    this.checkMission(missionId);
  }

  private checkMission(missionId: string | undefined): void {
    if (!missionId) return;
    const m = this.missions.get(missionId);
    if (!m || m.status === "done") return;
    const tasks = this.missionTasks(missionId);
    const allDone = tasks.length > 0 && tasks.every((t) => t.status === "done");
    const allReviewable = tasks.length > 0 && tasks.every((t) => t.status === "done" || t.status === "review");
    const status: MissionSpec["status"] = allDone ? "done" : allReviewable ? "review" : "active";
    if (status !== m.status) {
      this.missions.set(missionId, { ...m, status });
      this.deps.publish({ agentId: "", type: "mission.updated", payload: { missionId, status } });
      if (status === "review") {
        this.deps.publish({ agentId: "", type: "team.message", payload: { universe: m.universe, missionId, fromName: "Planner", text: "Every task is done and waiting for your review." } });
      }
    }
  }

  private startTask(task: TaskSpec): void {
    const role = task.role ?? "Helper";
    const kind = task.kind ?? "files";
    const terminals = this.deps.terminalsFor(task.universe);
    const mission = task.missionId ? this.missions.get(task.missionId) : undefined;
    const name = NAMES[this.nameIndex++ % NAMES.length]!;
    const live = this.deps.isLive();
    const spec: AgentSpec = {
      name,
      goal: `${task.title} — ${task.detail}${mission ? ` (team goal: ${mission.goal})` : ""}`,
      model: live ? this.deps.liveModel() : "mock-std",
      allowedTools: Array.from(new Set(terminals.flatMap((t) => t.tools))),
      budget: live ? { maxUsd: 1 } : { maxTokens: 40_000 },
      approvalRequired: true,
      universe: task.universe,
      missionId: task.missionId,
      taskId: task.id,
      role,
    };
    const adapter = this.deps.adapterForNewAgents();
    let id: string;
    if (!live) {
      id = this.deps.mock.startScript(scriptForTask(spec, task, kind, terminals));
    } else {
      id = adapter.start(spec);
    }
    this.deps.onSpawned(id, live ? adapter : this.deps.mock);
    this.agentTask.set(id, task.id);
    this.stepsSeen.set(id, 0);
    this.updateTask(task.id, { status: "in_progress", assigneeId: id, progress: 5 });
  }
}
