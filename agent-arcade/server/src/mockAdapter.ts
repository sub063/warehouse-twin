/**
 * MockAdapter: simulated agents playing scripted-but-randomized work.
 * Default mode. Makes zero network or API calls — everything here is
 * setTimeout + Math.random.
 *
 * Because milestone 1 has no approval UI yet, pending approvals are
 * auto-resolved after a few seconds (85% approve) so the world keeps
 * moving; resolveApproval() already works and milestone 2 will turn
 * auto-resolve off when a human is in the loop.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveInside, SandboxError, workspaceFor } from "./sandbox";
import type { AgentAdapter, AgentSpec, AgentState, DraftEvent, ToolCategory } from "../../shared/src";
import type { MockScript, MsRange, Step } from "./mockScripts";

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const randInt = (lo: number, hi: number) => Math.round(rand(lo, hi));
const dur = ([lo, hi]: MsRange) => randInt(lo, hi);

/** Mock $ per token, by model name. */
const RATES: Record<string, { input: number; output: number }> = {
  "mock-fast": { input: 0.4e-6, output: 1.6e-6 },
  "mock-std": { input: 2e-6, output: 8e-6 },
};

interface Runner {
  id: string;
  script: MockScript;
  stepIndex: number;
  consecutiveFailures: number;
  tokensUsed: number;
  usdUsed: number;
  state: AgentState;
  finished: boolean;
  paused: boolean;
  // One pending timer per runner; pause/resume works by capturing the
  // remaining delay and re-arming it.
  timer?: ReturnType<typeof setTimeout>;
  timerFn?: () => void;
  timerFireAt?: number;
  pendingQuestion?: { questionId: string; text: string };
  /** Files this run has written (relative paths). */
  filesWritten: string[];
  /** Things the human told us in chat; surface them in the deliverable. */
  humanNotes: string[];
  lastResult?: string;
  timerRemaining?: number;
  prePauseState?: AgentState;
  pendingApproval?: { actionId: string; step: Extract<Step, { kind: "tool" }> };
}

export interface MockAdapterOptions {
  /** Auto-resolve approvals after this many ms; null waits for a human. */
  autoResolveApprovalsMs?: MsRange | null;
  /** Route a tool call to a terminal in the agent's universe. */
  resolveTerminal?: (universe: string, tool: string, category: ToolCategory) => string | undefined;
  /** When set, mock file.write/file.edit steps write real files under <root>/<agentId>/. */
  workspaceRoot?: string;
}

export class MockAdapter implements AgentAdapter {
  private runners = new Map<string, Runner>();
  private listeners = new Set<(e: DraftEvent) => void>();
  private autoResolve: MsRange | null;
  private resolveTerminal: MockAdapterOptions["resolveTerminal"];
  private workspaceRoot?: string;

  constructor(opts: MockAdapterOptions = {}) {
    this.autoResolve = opts.autoResolveApprovalsMs === undefined ? [7000, 12000] : opts.autoResolveApprovalsMs;
    this.resolveTerminal = opts.resolveTerminal;
    this.workspaceRoot = opts.workspaceRoot;
  }

  onEvent(listener: (e: DraftEvent) => void): void {
    this.listeners.add(listener);
  }

  private emit(e: DraftEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Start an agent from a full script (keeps scripted behavior). */
  startScript(script: MockScript): string {
    const id = randomUUID().slice(0, 8);
    const runner: Runner = {
      id,
      script,
      stepIndex: 0,
      consecutiveFailures: 0,
      filesWritten: [],
      humanNotes: [],
      tokensUsed: 0,
      usdUsed: 0,
      state: "idle",
      finished: false,
      paused: false,
    };
    this.runners.set(id, runner);
    this.emit({ agentId: id, type: "agent.created", payload: { spec: script.spec } });
    this.setState(runner, "idle");
    this.schedule(runner, randInt(1000, 3000), () => this.runStep(runner));
    return id;
  }

  /**
   * AgentAdapter.start: spawn from a spec with a generic looping script
   * built from the tools the spec allows.
   */
  start(spec: AgentSpec): string {
    const has = (t: string) => spec.allowedTools.includes(t);
    const steps: Step[] = [
      { kind: "say", text: "okay, getting started" },
      { kind: "think", ms: [3000, 6000], say: "planning the work" },
    ];
    if (has("web.search") || has("web.read")) {
      steps.push({ kind: "tool", tool: "web.search", category: "search", args: "background research", ms: [5000, 9000], say: "researching", okResult: "notes gathered" });
    }
    if (has("file.read")) {
      steps.push({ kind: "tool", tool: "file.read", category: "files", args: "workspace files", ms: [5000, 8000], say: "looking around", okResult: "context gathered" });
    }
    if (has("file.edit") || has("file.write")) {
      steps.push({ kind: "tool", tool: "file.edit", category: "files", args: "notes/progress.md (+12)", ms: [6000, 10000], say: "making edits", okResult: "changes saved" });
    }
    if (has("shell.run")) {
      steps.push({ kind: "tool", tool: "shell.run", category: "shell", args: "run checks", ms: [6000, 10000], say: "running checks", okResult: "checks green", failChance: 0.15, failResult: "check failed", approval: "Run shell command: project checks" });
    }
    // Any other allowed tool (custom terminals): a generic step at its terminal.
    const known = ["web.search", "web.read", "file.read", "file.write", "file.edit", "file.delete", "shell.run"];
    for (const tool of spec.allowedTools.filter((t) => !known.includes(t))) {
      const service = tool.split(".")[0] ?? tool;
      steps.push({
        kind: "tool",
        tool,
        category: "unknown",
        args: `${spec.goal.slice(0, 40)}`,
        ms: [7000, 12000],
        say: `working with ${service}`,
        okResult: `${tool} done`,
        failChance: 0.08,
        failResult: `${service} request failed`,
      });
    }
    if (steps.length === 2) {
      // No tools allowed: think it over, report, and finish.
      steps.push({ kind: "say", text: "nothing I'm allowed to run" }, { kind: "finish", outcome: "completed" });
      return this.startScript({ spec, steps });
    }
    return this.startScript({ spec, steps, loopFrom: 1 });
  }

  /** Ids of agents that are still running (for pause-all / kill-all). */
  activeAgentIds(): string[] {
    return [...this.runners.values()].filter((r) => !r.finished).map((r) => r.id);
  }

  pause(agentId: string): void {
    const r = this.runners.get(agentId);
    if (!r || r.finished || r.paused) return;
    r.paused = true;
    if (r.timer) {
      clearTimeout(r.timer);
      r.timerRemaining = Math.max(0, (r.timerFireAt ?? Date.now()) - Date.now());
      r.timer = undefined;
    }
    r.prePauseState = r.state;
    this.setState(r, "paused");
  }

  resume(agentId: string): void {
    const r = this.runners.get(agentId);
    if (!r || r.finished || !r.paused) return;
    r.paused = false;
    this.setState(r, r.prePauseState ?? "thinking");
    const fn = r.timerFn;
    if (fn) this.schedule(r, r.timerRemaining ?? 0, fn);
  }

  stop(agentId: string): void {
    const r = this.runners.get(agentId);
    if (!r || r.finished) return;
    this.clearTimer(r);
    this.emit({ agentId, type: "message", payload: { from: "agent", text: "stopping as asked" } });
    this.finish(r, "stopped");
  }

  sendMessage(agentId: string, text: string): void {
    const r = this.runners.get(agentId);
    if (!r) return;
    this.emit({ agentId, type: "message", payload: { from: "human", text } });
    // Even a finished teammate can tell you what they did.
    const reply = this.replyTo(r, text);
    setTimeout(() => {
      this.emit({ agentId, type: "message", payload: { from: "agent", text: reply.text } });
      if (reply.then === "pause" && !r.paused && !r.finished) this.pause(r.id);
      if (reply.then === "resume" && r.paused && !r.finished) this.resume(r.id);
    }, randInt(500, 1300));
  }

  // ---- talking like a teammate ----

  /** What the agent is doing right now, in its own words. */
  private doingNow(r: Runner): string {
    if (r.finished) return r.state === "error" ? "I stopped on an error" : "I've wrapped up";
    if (r.paused) return "I'm paused";
    if (r.pendingQuestion) return `I'm waiting on your answer: "${r.pendingQuestion.text}"`;
    if (r.pendingApproval) return `I'm waiting for your approval to go ahead with "${r.pendingApproval.step.approval}"`;
    const step = r.script.steps[r.stepIndex];
    if (!step) return "I'm between steps";
    switch (step.kind) {
      case "tool":
        return `I'm ${step.say ?? `running ${step.tool}`} (${step.tool}: ${step.args})`;
      case "think":
        return `I'm thinking through ${step.say ?? "the next move"}`;
      case "ask":
        return "I'm about to ask you something";
      default:
        return "I'm catching the team up";
    }
  }

  /** Remaining meaningful steps, as short phrases. */
  private remaining(r: Runner): string[] {
    return r.script.steps
      .slice(r.stepIndex + 1)
      .filter((s): s is Extract<Step, { kind: "tool" | "ask" }> => s.kind === "tool" || s.kind === "ask")
      .map((s) => (s.kind === "ask" ? "check something with you" : s.say ?? `${s.tool} — ${s.args}`));
  }

  private progressPct(r: Runner): number {
    const total = r.script.steps.filter((s) => s.kind === "tool").length || 1;
    const done = r.script.steps.slice(0, r.stepIndex).filter((s) => s.kind === "tool").length;
    return r.finished ? 100 : Math.round((done / total) * 100);
  }

  private replyTo(r: Runner, raw: string): { text: string; then?: "pause" | "resume" } {
    const t = raw.toLowerCase().trim();
    const spec = r.script.spec;
    // "Title — detail (team goal: …)" → just the title for conversation.
    const task = spec.goal.replace(/\s*\(team goal:[\s\S]*\)$/, "").split(" — ")[0]!;
    const teamGoal = spec.goal.match(/\(team goal: ([\s\S]*)\)$/)?.[1];
    const files = r.filesWritten;
    const next = this.remaining(r);
    const pct = this.progressPct(r);
    const has = (re: RegExp) => re.test(t);

    if (has(/\b(pause|hold on|hold off|wait|stop for now|take a break)\b/)) {
      return r.finished ? { text: "I'm already done, nothing left to pause." } : { text: "Sure, pausing here. Say \"continue\" when you want me back on it.", then: "pause" };
    }
    if (has(/\b(resume|continue|carry on|go ahead|keep going|back to work|unpause)\b/)) {
      return r.paused ? { text: "On it — picking up where I left off.", then: "resume" } : { text: `Already on it: ${this.doingNow(r)}.` };
    }
    if (has(/\b(hi|hello|hey|yo|morning|afternoon)\b/) && t.length < 25) {
      return { text: `Hey! ${this.doingNow(r)}. Anything you need?` };
    }
    if (has(/who are you|your (role|job|name)|introduce/)) {
      return { text: `I'm ${spec.name}${spec.role ? `, the ${spec.role} on this team` : ""}. My task is "${task}".${teamGoal ? ` It's part of the team goal: ${teamGoal}.` : ""}` };
    }
    if (has(/\bwhy\b|what for|purpose|point of/)) {
      return { text: `Because my task is "${task}".${teamGoal ? ` That feeds the team goal: "${teamGoal}".` : ""} ${next.length ? `Next: ${next[0]}.` : ""}`.trim() };
    }
    if (has(/what('s| is) next|then what|after (this|that)|plan|remaining|left to do/)) {
      if (r.finished) return { text: "Nothing left on my plate — my task is done and waiting for your review." };
      return { text: next.length ? `Next up: ${next.slice(0, 3).join("; then ")}. After that I write up my results and hand off.` : "I'm on my last step: writing up the results." };
    }
    if (has(/\b(eta|how long|when|deadline|finish|done soon|time)\b/)) {
      if (r.finished) return { text: "Already finished." };
      const secs = next.length * 12;
      return { text: `About ${pct}% through. ${next.length} step${next.length === 1 ? "" : "s"} left, roughly ${secs < 60 ? `${secs} seconds` : `${Math.ceil(secs / 60)} minute${secs >= 120 ? "s" : ""}`}.` };
    }
    if (has(/\b(file|files|where|output|result|results|deliverable|wrote|written|saved|show me|see)\b/)) {
      if (files.length) return { text: `So far I've written ${files.map((f) => `${f}`).join(", ")}. You can open ${files.length === 1 ? "it" : "them"} from the Output tab or my Files list.` };
      return { text: "Nothing written yet — my results will land in my team/ folder when I get to the write-up step. You'll see it in the Output tab." };
    }
    if (has(/\b(stuck|problem|issue|blocker|blocked|need anything|need help|trouble|wrong)\b/)) {
      if (r.pendingApproval) return { text: `One thing: I need your approval for "${r.pendingApproval.step.approval}" — it's in your inbox.` };
      if (r.pendingQuestion) return { text: `Yes — I asked you: "${r.pendingQuestion.text}". Waiting on that.` };
      if (r.consecutiveFailures > 0) return { text: `I hit a snag on ${r.lastResult ?? "the last step"} and I'm retrying. Nothing I need from you yet.` };
      return { text: "No blockers right now. I'll ask in the channel if that changes." };
    }
    if (has(/what are you (doing|working|up to)|status|progress|how('s| is) it going|update|where are (you|we)|report|doing\?/)) {
      const tail = r.finished ? (files.length ? ` My results are in ${files.join(", ")}.` : "") : next.length ? ` Next: ${next[0]}.` : "";
      return { text: `${this.doingNow(r)} — about ${pct}% through "${task}".${tail}` };
    }
    if (has(/\b(thanks|thank you|great|nice|good job|well done|perfect|awesome)\b/)) {
      return { text: "Thanks! Back to it." };
    }
    if (has(/\b(ok|okay|sure|yes|no|fine)\b/) && t.length < 12) {
      return { text: "👍" };
    }
    // Anything else is treated as guidance: remember it and work it into the deliverable.
    r.humanNotes.push(raw.trim());
    return { text: `Got it — "${raw.trim().slice(0, 80)}". I'll factor that into "${task}"${files.length ? " and note it in my write-up" : ""}. ${r.finished ? "" : this.doingNow(r) + "."}`.trim() };
  }

  setInstructions(agentId: string, text: string): void {
    const r = this.runners.get(agentId);
    if (!r || r.finished) return;
    this.emit({ agentId, type: "agent.instructions_set", payload: { text } });
    this.emit({ agentId, type: "message", payload: { from: "agent", text: "got it, following new instructions" } });
  }

  deliverTeamMessage(agentId: string, fromName: string, text: string): void {
    const r = this.runners.get(agentId);
    if (!r || r.finished || r.paused) return;
    // Only reply to the human, and only from the one agent that's mid-task,
    // so a broadcast doesn't turn into a pile-on.
    if (fromName !== "You" || r.state !== "using_tool") return;
    setTimeout(() => {
      if (r.finished) return;
      this.emit({
        agentId,
        type: "team.message",
        payload: { universe: r.script.spec.universe, missionId: r.script.spec.missionId, fromName: r.script.spec.name, text: `Got it: "${text.slice(0, 60)}" — I'll factor that in.` },
      });
    }, 1500 + Math.random() * 1500);
  }

  answerQuestion(agentId: string, questionId: string, answer: string): void {
    const r = this.runners.get(agentId);
    if (!r || r.finished || r.pendingQuestion?.questionId !== questionId) return;
    r.pendingQuestion = undefined;
    this.clearTimer(r);
    this.emit({ agentId, type: "question.answered", payload: { questionId, answer } });
    this.emit({ agentId, type: "message", payload: { from: "human", text: answer } });
    this.setState(r, "thinking");
    this.emit({ agentId, type: "message", payload: { from: "agent", text: `got it — ${answer.length > 30 ? answer.slice(0, 28) + "…" : answer}` } });
    this.emit({
      agentId,
      type: "team.message",
      payload: { universe: r.script.spec.universe, missionId: r.script.spec.missionId, fromName: r.script.spec.name, text: `You answered: "${answer.slice(0, 80)}" — going with that.` },
    });
    this.schedule(r, randInt(1200, 2200), () => this.nextStep(r));
  }

  resolveApproval(agentId: string, actionId: string, approved: boolean): void {
    const r = this.runners.get(agentId);
    if (!r || r.finished || r.pendingApproval?.actionId !== actionId) return;
    const step = r.pendingApproval.step;
    r.pendingApproval = undefined;
    this.clearTimer(r);
    this.emit({ agentId, type: "approval.resolved", payload: { actionId, approved } });
    if (approved) {
      this.runTool(r, step);
    } else {
      this.emit({ agentId, type: "message", payload: { from: "agent", text: "okay, skipping that" } });
      this.setState(r, "thinking");
      this.schedule(r, randInt(2000, 4000), () => this.nextStep(r));
    }
  }

  // ---- internals ----

  private setState(r: Runner, state: AgentState): void {
    r.state = state;
    this.emit({ agentId: r.id, type: "agent.state_changed", payload: { state } });
  }

  private schedule(r: Runner, ms: number, fn: () => void): void {
    this.clearTimer(r);
    r.timerFn = fn;
    r.timerFireAt = Date.now() + ms;
    r.timer = setTimeout(() => {
      r.timer = undefined;
      r.timerFn = undefined;
      fn();
    }, ms);
  }

  private clearTimer(r: Runner): void {
    if (r.timer) clearTimeout(r.timer);
    r.timer = undefined;
    r.timerFn = undefined;
  }

  private finish(r: Runner, outcome: "completed" | "stopped" | "budget_exceeded" | "error"): void {
    if (r.finished) return;
    r.finished = true;
    this.clearTimer(r);
    this.setState(r, outcome === "error" ? "error" : "done");
    this.emit({ agentId: r.id, type: "agent.finished", payload: { outcome } });
  }

  private emitUsage(r: Runner, ms: number): void {
    const inputTokens = Math.round((ms / 1000) * rand(25, 70));
    const outputTokens = Math.round((ms / 1000) * rand(15, 50));
    const rate = RATES[r.script.spec.model] ?? RATES["mock-std"]!;
    const costUsd = inputTokens * rate.input + outputTokens * rate.output;
    r.tokensUsed += inputTokens + outputTokens;
    r.usdUsed += costUsd;
    this.emit({ agentId: r.id, type: "usage.updated", payload: { inputTokens, outputTokens, costUsd } });
  }

  /** True if the budget stopped the agent. */
  private checkBudget(r: Runner): boolean {
    const b = r.script.spec.budget;
    const over =
      (b.maxTokens !== undefined && r.tokensUsed >= b.maxTokens) ||
      (b.maxUsd !== undefined && r.usdUsed >= b.maxUsd);
    if (!over) return false;
    this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "budget limit reached" } });
    this.finish(r, "budget_exceeded");
    return true;
  }

  private nextStep(r: Runner): void {
    if (r.finished) return;
    r.stepIndex += 1;
    if (r.stepIndex >= r.script.steps.length) {
      if (r.script.loopFrom !== undefined) {
        r.stepIndex = r.script.loopFrom;
      } else {
        this.finish(r, "completed");
        return;
      }
    }
    this.runStep(r);
  }

  private runStep(r: Runner): void {
    if (r.finished) return;
    const step = r.script.steps[r.stepIndex];
    if (!step) {
      this.finish(r, "completed");
      return;
    }
    switch (step.kind) {
      case "say":
        this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: step.text } });
        this.schedule(r, randInt(800, 1600), () => this.nextStep(r));
        return;

      case "team":
        this.emit({
          agentId: r.id,
          type: "team.message",
          payload: { universe: r.script.spec.universe, missionId: r.script.spec.missionId, fromName: r.script.spec.name, text: step.text },
        });
        this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: step.text.length > 40 ? step.text.slice(0, 38) + "…" : step.text } });
        this.schedule(r, randInt(800, 1600), () => this.nextStep(r));
        return;

      case "ask": {
        const questionId = randomUUID().slice(0, 8);
        r.pendingQuestion = { questionId, text: step.text };
        this.setState(r, "asking_you");
        this.emit({ agentId: r.id, type: "question.asked", payload: { questionId, text: step.text, options: step.options } });
        this.emit({
          agentId: r.id,
          type: "team.message",
          payload: { universe: r.script.spec.universe, missionId: r.script.spec.missionId, fromName: r.script.spec.name, text: `Question for you: ${step.text}` },
        });
        return; // waits for answerQuestion()
      }

      case "think": {
        this.setState(r, "thinking");
        if (step.say) this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: step.say } });
        const ms = dur(step.ms);
        this.schedule(r, ms, () => {
          this.emitUsage(r, ms * 0.4);
          if (this.checkBudget(r)) return;
          this.nextStep(r);
        });
        return;
      }

      case "tool": {
        if (step.approval && r.script.spec.approvalRequired) {
          const actionId = randomUUID().slice(0, 8);
          r.pendingApproval = { actionId, step };
          this.setState(r, "awaiting_approval");
          this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "waiting for approval" } });
          this.emit({ agentId: r.id, type: "approval.requested", payload: { actionId, description: step.approval } });
          if (this.autoResolve) {
            this.schedule(r, dur(this.autoResolve), () =>
              this.resolveApproval(r.id, actionId, Math.random() < 0.85),
            );
          }
          return;
        }
        this.runTool(r, step);
        return;
      }

      case "finish":
        this.finish(r, step.outcome);
        return;
    }
  }

  /** Mock agents leave real files behind so their work can be inspected. */
  private materialize(r: Runner, step: Extract<Step, { kind: "tool" }>): void {
    if (!this.workspaceRoot || (step.tool !== "file.write" && step.tool !== "file.edit")) return;
    const rel = step.args.split(/\s+/)[0];
    if (!rel) return;
    try {
      const ws = workspaceFor(this.workspaceRoot, r.id);
      const full = resolveInside(ws, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const spec = r.script.spec;
      const body =
        step.content ??
        `# ${rel.split("/").pop()?.replace(/\.[a-z]+$/, "") ?? "notes"}\n\n_Written by ${spec.name}${spec.role ? ` (${spec.role})` : ""} · ${new Date().toISOString()}_\n\nGoal: ${spec.goal}\n\n${step.say ?? "Notes from this run."}\n`;
      const notes = r.humanNotes.length ? `\n## Notes from you\n${r.humanNotes.map((n) => `- ${n}`).join("\n")}\n` : "";
      if (step.tool === "file.edit" && fs.existsSync(full)) fs.appendFileSync(full, `\n${body}${notes}`);
      else fs.writeFileSync(full, body + notes);
      if (!r.filesWritten.includes(rel)) r.filesWritten.push(rel);
    } catch (err) {
      if (!(err instanceof SandboxError)) throw err;
    }
  }

  private runTool(r: Runner, step: Extract<Step, { kind: "tool" }>): void {
    this.setState(r, "using_tool");
    if (step.say) this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: step.say } });
    const terminalId = this.resolveTerminal?.(r.script.spec.universe, step.tool, step.category);
    this.emit({
      agentId: r.id,
      type: "tool.started",
      payload: { tool: step.tool, category: step.category, argsSummary: step.args, terminalId },
    });
    const ms = dur(step.ms);
    this.schedule(r, ms, () => {
      const failed = Math.random() < (step.failChance ?? 0);
      if (!failed) this.materialize(r, step);
      r.lastResult = failed ? step.failResult ?? "failed" : step.okResult;
      this.emit({
        agentId: r.id,
        type: "tool.finished",
        payload: {
          tool: step.tool,
          ok: !failed,
          durationMs: ms,
          resultSummary: failed ? step.failResult ?? "failed" : step.okResult,
        },
      });
      this.emitUsage(r, ms);
      if (this.checkBudget(r)) return;
      if (failed) {
        r.consecutiveFailures += 1;
        const giveUp = r.script.giveUpAfterFailures;
        this.setState(r, "error");
        if (giveUp !== undefined && r.consecutiveFailures >= giveUp) {
          this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "stuck, giving up here" } });
          this.schedule(r, randInt(3000, 5000), () => this.finish(r, "error"));
          return;
        }
        this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "hit a snag, retrying" } });
        this.schedule(r, randInt(4000, 6000), () => {
          this.setState(r, "thinking");
          this.schedule(r, randInt(2000, 3500), () => this.nextStep(r));
        });
        return;
      }
      r.consecutiveFailures = 0;
      this.nextStep(r);
    });
  }
}
