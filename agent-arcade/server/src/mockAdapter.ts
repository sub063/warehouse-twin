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
  timerRemaining?: number;
  prePauseState?: AgentState;
  pendingApproval?: { actionId: string; step: Extract<Step, { kind: "tool" }> };
}

export interface MockAdapterOptions {
  /** Auto-resolve approvals after this many ms; null waits for a human. */
  autoResolveApprovalsMs?: MsRange | null;
  /** Route a tool call to a terminal in the agent's universe. */
  resolveTerminal?: (universe: string, tool: string, category: ToolCategory) => string | undefined;
}

export class MockAdapter implements AgentAdapter {
  private runners = new Map<string, Runner>();
  private listeners = new Set<(e: DraftEvent) => void>();
  private autoResolve: MsRange | null;
  private resolveTerminal: MockAdapterOptions["resolveTerminal"];

  constructor(opts: MockAdapterOptions = {}) {
    this.autoResolve = opts.autoResolveApprovalsMs === undefined ? [7000, 12000] : opts.autoResolveApprovalsMs;
    this.resolveTerminal = opts.resolveTerminal;
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
    if (!r || r.finished) return;
    this.emit({ agentId, type: "message", payload: { from: "human", text } });
    this.emit({ agentId, type: "message", payload: { from: "agent", text: "noted, will do" } });
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
