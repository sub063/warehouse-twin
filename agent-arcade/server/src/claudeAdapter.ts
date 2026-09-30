/**
 * ClaudeAdapter: real agents on the Anthropic Messages API with tool
 * use (streamed via client.messages.stream + finalMessage(); interrupted
 * with the request AbortSignal / stream.abort()). Every step becomes an
 * event on the same stream the mock adapter feeds, so the world, roster,
 * timeline and controls work identically.
 *
 * Safety:
 * - Each agent works only inside ./workspaces/<agentId>; file paths that
 *   escape it are rejected (sandbox.ts).
 * - Shell commands and deletions need human approval when the spec says
 *   approvalRequired (the default). Denied actions return an error tool
 *   result and the agent moves on.
 * - The API key is read from the environment/.env only, never logged,
 *   and stripped from the environment of any shell command an agent runs.
 * - Custom terminal tools (e.g. image generation) are advertised to the
 *   model so it can plan around them, but return "not connected" until a
 *   connector is wired up.
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  AgentAdapter,
  AgentSpec,
  AgentState,
  DraftEvent,
  TerminalSpec,
  ToolCategory,
} from "../../shared/src";
import { childEnv } from "./env";
import { resolveInside, SandboxError, workspaceFor } from "./sandbox";

/** What the adapter needs from a stream: the final message and abort. */
export interface StreamHandle {
  finalMessage(): Promise<Anthropic.Message>;
  abort(): void;
}

/** Starts one streamed model turn. Tests inject a scripted factory. */
export type StreamFactory = (params: Anthropic.MessageStreamParams, signal: AbortSignal) => StreamHandle;

export interface ClaudeAdapterOptions {
  stream: StreamFactory;
  /** Root folder for per-agent workspaces (./workspaces). */
  workspaceRoot: string;
  resolveTerminal?: (universe: string, tool: string, category: ToolCategory) => string | undefined;
  terminalsFor?: (universe: string) => TerminalSpec[];
  /** Recent team-channel lines for the agent's universe (newest last). */
  teamContext?: (universe: string) => string[];
  /** Max tokens per model turn. */
  maxTokens?: number;
}

/** $ per token, from the current Anthropic price list. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4e-6, output: 20e-6 },
  "claude-opus-5": { input: 5e-6, output: 25e-6 },
  "claude-sonnet-5-5": { input: 2e-6, output: 10e-6 },
  "claude-sonnet-5": { input: 2e-6, output: 10e-6 },
  "claude-haiku-4-5": { input: 1e-6, output: 5e-6 },
  "claude-fable-5-1": { input: 10e-6, output: 50e-6 },
};

export const LIVE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"] as const;

const BUILTIN_TOOLS = ["shell.run", "file.read", "file.write", "file.edit", "file.delete", "web.search", "web.read"];
const GATED_TOOLS = new Set(["shell.run", "file.delete"]);
const SHELL_TIMEOUT_MS = 60_000;
const OUTPUT_CAP = 16_000;

interface Run {
  id: string;
  spec: AgentSpec;
  workspace: string;
  messages: Anthropic.MessageParam[];
  tokens: number;
  usd: number;
  state: AgentState;
  finished: boolean;
  paused: boolean;
  prePauseState?: AgentState;
  pauseWaiters: Array<() => void>;
  abort: AbortController;
  stream?: StreamHandle;
  inbox: string[];
  instructions?: string;
  pendingApproval?: { actionId: string; resolve: (approved: boolean) => void };
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Short, human-readable error text. SDK APIErrors carry a status and the
 * API's error body; everything else falls back to the first message line.
 * Never includes request headers or credentials.
 */
function describeError(err: unknown): string {
  const e = err as { name?: string; status?: number; message?: string; error?: { error?: { message?: string } } };
  const detail = e?.error?.error?.message ?? (e?.message ?? String(err)).split("\n")[0] ?? "unknown error";
  const text = typeof e?.status === "number" ? `${e.name ?? "APIError"} ${e.status}: ${detail}` : detail;
  return truncate(text, 160);
}

export class ClaudeAdapter implements AgentAdapter {
  private runs = new Map<string, Run>();
  private listeners = new Set<(e: DraftEvent) => void>();

  constructor(private opts: ClaudeAdapterOptions) {}

  onEvent(listener: (e: DraftEvent) => void): void {
    this.listeners.add(listener);
  }

  private emit(e: DraftEvent): void {
    for (const l of this.listeners) l(e);
  }

  activeAgentIds(): string[] {
    return [...this.runs.values()].filter((r) => !r.finished).map((r) => r.id);
  }

  start(spec: AgentSpec): string {
    const id = randomUUID().slice(0, 8);
    const run: Run = {
      id,
      spec,
      workspace: workspaceFor(this.opts.workspaceRoot, id),
      messages: [{ role: "user", content: spec.goal }],
      tokens: 0,
      usd: 0,
      state: "idle",
      finished: false,
      paused: false,
      pauseWaiters: [],
      abort: new AbortController(),
      inbox: [],
    };
    this.runs.set(id, run);
    this.emit({ agentId: id, type: "agent.created", payload: { spec } });
    this.setState(run, "idle");
    void this.loop(run);
    return id;
  }

  pause(agentId: string): void {
    const r = this.runs.get(agentId);
    if (!r || r.finished || r.paused) return;
    r.paused = true;
    r.prePauseState = r.state;
    this.setState(r, "paused");
  }

  resume(agentId: string): void {
    const r = this.runs.get(agentId);
    if (!r || r.finished || !r.paused) return;
    r.paused = false;
    this.setState(r, r.prePauseState ?? "thinking");
    const waiters = r.pauseWaiters.splice(0);
    for (const w of waiters) w();
  }

  stop(agentId: string): void {
    const r = this.runs.get(agentId);
    if (!r || r.finished) return;
    this.emit({ agentId, type: "message", payload: { from: "agent", text: "stopping as asked" } });
    this.finish(r, "stopped");
  }

  sendMessage(agentId: string, text: string): void {
    const r = this.runs.get(agentId);
    if (!r || r.finished) return;
    this.emit({ agentId, type: "message", payload: { from: "human", text } });
    r.inbox.push(text);
  }

  setInstructions(agentId: string, text: string): void {
    const r = this.runs.get(agentId);
    if (!r || r.finished) return;
    r.instructions = text;
    this.emit({ agentId, type: "agent.instructions_set", payload: { text } });
    r.inbox.push(`(standing instructions updated) ${text}`);
  }

  deliverTeamMessage(agentId: string, fromName: string, text: string): void {
    const r = this.runs.get(agentId);
    if (!r || r.finished) return;
    r.inbox.push(`[team channel] ${fromName}: ${text}`);
  }

  resolveApproval(agentId: string, actionId: string, approved: boolean): void {
    const r = this.runs.get(agentId);
    if (!r || r.finished || r.pendingApproval?.actionId !== actionId) return;
    const pending = r.pendingApproval;
    r.pendingApproval = undefined;
    this.emit({ agentId, type: "approval.resolved", payload: { actionId, approved } });
    pending.resolve(approved);
  }

  // ---- internals ----

  private setState(r: Run, state: AgentState): void {
    r.state = state;
    this.emit({ agentId: r.id, type: "agent.state_changed", payload: { state } });
  }

  private finish(r: Run, outcome: "completed" | "stopped" | "budget_exceeded" | "error"): void {
    if (r.finished) return;
    r.finished = true;
    r.abort.abort();
    r.stream?.abort();
    // Unblock anything waiting on the human.
    r.pendingApproval?.resolve(false);
    r.pendingApproval = undefined;
    for (const w of r.pauseWaiters.splice(0)) w();
    this.setState(r, outcome === "error" ? "error" : "done");
    this.emit({ agentId: r.id, type: "agent.finished", payload: { outcome } });
  }

  private waitIfPaused(r: Run): Promise<void> {
    if (!r.paused || r.finished) return Promise.resolve();
    return new Promise((resolve) => r.pauseWaiters.push(resolve));
  }

  private customTerminalTools(r: Run): Array<{ terminal: TerminalSpec; tool: string }> {
    const out: Array<{ terminal: TerminalSpec; tool: string }> = [];
    for (const t of this.opts.terminalsFor?.(r.spec.universe) ?? []) {
      for (const tool of t.tools) {
        if (!BUILTIN_TOOLS.includes(tool) && r.spec.allowedTools.includes(tool)) out.push({ terminal: t, tool });
      }
    }
    return out;
  }

  private toolDefs(r: Run): Anthropic.MessageCreateParams["tools"] {
    const allowed = new Set(r.spec.allowedTools);
    const tools: NonNullable<Anthropic.MessageCreateParams["tools"]> = [];
    const custom = (name: string, description: string, props: Record<string, { type: string; description: string }>, required: string[]): Anthropic.Tool => ({
      name,
      description,
      input_schema: { type: "object", properties: props, required, additionalProperties: false },
      strict: true,
    });
    if (allowed.has("shell.run")) {
      tools.push(custom("shell.run", "Run a shell command inside your workspace folder (cwd). Output is truncated to 16KB.", { command: { type: "string", description: "The command line to run" } }, ["command"]));
    }
    if (allowed.has("file.read")) {
      tools.push(custom("file.read", "Read a text file from your workspace.", { path: { type: "string", description: "Path relative to the workspace" } }, ["path"]));
    }
    if (allowed.has("file.write")) {
      tools.push(custom("file.write", "Create or overwrite a text file in your workspace.", { path: { type: "string", description: "Path relative to the workspace" }, content: { type: "string", description: "Full file contents" } }, ["path", "content"]));
    }
    if (allowed.has("file.edit")) {
      tools.push(custom("file.edit", "Replace the first exact occurrence of `find` with `replace` in a workspace file.", { path: { type: "string", description: "Path relative to the workspace" }, find: { type: "string", description: "Exact text to find" }, replace: { type: "string", description: "Replacement text" } }, ["path", "find", "replace"]));
    }
    if (allowed.has("file.delete")) {
      tools.push(custom("file.delete", "Delete a file or folder in your workspace.", { path: { type: "string", description: "Path relative to the workspace" } }, ["path"]));
    }
    for (const { terminal, tool } of this.customTerminalTools(r)) {
      tools.push(custom(
        tool,
        `${terminal.name}: ${terminal.description || "custom terminal"}. Requires: ${terminal.requires.join(", ") || "nothing listed"}. This terminal is not connected yet; calling it records what you would do.`,
        { request: { type: "string", description: "What you want this terminal to do, in detail" } },
        ["request"],
      ));
    }
    tools.push(custom("team.post", "Post a short message to your team channel: hand-offs, questions, findings other agents need. Keep it to one or two sentences.", { text: { type: "string", description: "The message" } }, ["text"]));
    if (r.spec.taskId) {
      tools.push(custom("task.update", "Report progress on your assigned task.", { progress: { type: "integer", description: "0-100" }, note: { type: "string", description: "One line on where things stand" } }, ["progress", "note"]));
    }
    if (allowed.has("web.search") || allowed.has("web.read")) {
      tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 });
    }
    return tools;
  }

  private systemPrompt(r: Run): string {
    const terminals = (this.opts.terminalsFor?.(r.spec.universe) ?? [])
      .map((t) => `- ${t.name} (${t.kind}): ${t.description || "no description"}; tools: ${t.tools.join(", ") || "none"}`)
      .join("\n");
    const team = (this.opts.teamContext?.(r.spec.universe) ?? []).slice(-12);
    return [
      `You are "${r.spec.name}"${r.spec.role ? ` (${r.spec.role})` : ""}, an agent in the "${r.spec.universe}" universe of Agent Arcade.`,
      r.spec.missionId ? `You are part of a team working toward a shared goal. Your assigned task is described in the user's message; other agents handle the other tasks. Use team.post to hand off, ask, or share results, and task.update to report progress.` : "",
      r.instructions ? `Standing instructions from the human (always follow these):\n${r.instructions}` : "",
      team.length ? `Recent team channel:\n${team.map((l) => `- ${l}`).join("\n")}` : "",
      `You work only inside your own workspace folder; all file paths are relative to it and paths outside it are rejected.`,
      `Shell commands and file deletions may need a human's approval; if one is denied, adapt and continue.`,
      `Before each tool call, say in one short sentence what you are about to do. When the goal is complete, give a brief summary and stop.`,
      terminals ? `Terminals in this universe:\n${terminals}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async loop(r: Run): Promise<void> {
    try {
      while (!r.finished) {
        await this.waitIfPaused(r);
        if (r.finished) return;
        this.setState(r, "thinking");

        const params: Anthropic.MessageStreamParams = {
          model: r.spec.model,
          max_tokens: this.opts.maxTokens ?? 16_000,
          system: this.systemPrompt(r),
          tools: this.toolDefs(r),
          messages: r.messages,
        };
        const stream = this.opts.stream(params, r.abort.signal);
        r.stream = stream;
        let msg: Anthropic.Message;
        try {
          msg = await stream.finalMessage();
        } catch (err) {
          if (r.finished || r.abort.signal.aborted) return;
          throw err;
        } finally {
          r.stream = undefined;
        }
        if (r.finished) return;

        this.recordUsage(r, msg.usage);
        if (this.overBudget(r)) {
          this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "budget limit reached" } });
          this.finish(r, "budget_exceeded");
          return;
        }

        // Narrate text and server-side tool use (web search runs on Anthropic's side).
        for (const block of msg.content) {
          if (block.type === "text" && block.text.trim()) {
            this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: block.text.trim() } });
          } else if (block.type === "server_tool_use") {
            const q = (block.input as { query?: string })?.query ?? "";
            this.emit({
              agentId: r.id,
              type: "tool.started",
              payload: {
                tool: "web.search",
                category: "search",
                argsSummary: truncate(q, 80),
                terminalId: this.opts.resolveTerminal?.(r.spec.universe, "web.search", "search"),
              },
            });
          } else if (block.type === "web_search_tool_result") {
            const ok = Array.isArray(block.content);
            const n = Array.isArray(block.content) ? block.content.length : 0;
            this.emit({
              agentId: r.id,
              type: "tool.finished",
              payload: { tool: "web.search", ok, durationMs: 0, resultSummary: ok ? `${n} results` : "search error" },
            });
          }
        }

        r.messages.push({ role: "assistant", content: msg.content });

        if (msg.stop_reason === "refusal") {
          this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "request declined by safety system" } });
          this.finish(r, "error");
          return;
        }
        if (msg.stop_reason === "pause_turn") continue;

        const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (msg.stop_reason === "max_tokens" && toolUses.length > 0) {
          this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "output was cut off (max tokens)" } });
          this.finish(r, "error");
          return;
        }
        if (toolUses.length === 0) {
          this.finish(r, "completed");
          return;
        }

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          await this.waitIfPaused(r);
          if (r.finished) return;
          results.push(await this.runTool(r, tu));
        }
        const content: Anthropic.ContentBlockParam[] = [...results];
        if (r.inbox.length) {
          content.push({ type: "text", text: `Messages from the human while you worked:\n${r.inbox.map((m) => `- ${m}`).join("\n")}` });
          r.inbox = [];
        }
        r.messages.push({ role: "user", content });
      }
    } catch (err) {
      if (r.finished) return;
      this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: `error: ${describeError(err)}` } });
      this.finish(r, "error");
    }
  }

  private recordUsage(r: Run, usage: Anthropic.Usage): void {
    const price = PRICING[r.spec.model] ?? PRICING["claude-opus-5-5"]!;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const inputTokens = usage.input_tokens + cacheWrite + cacheRead;
    const outputTokens = usage.output_tokens;
    const costUsd =
      (usage.input_tokens + cacheWrite * 1.25 + cacheRead * 0.1) * price.input + outputTokens * price.output;
    r.tokens += inputTokens + outputTokens;
    r.usd += costUsd;
    this.emit({ agentId: r.id, type: "usage.updated", payload: { inputTokens, outputTokens, costUsd } });
  }

  private overBudget(r: Run): boolean {
    const b = r.spec.budget;
    return (b.maxTokens !== undefined && r.tokens >= b.maxTokens) || (b.maxUsd !== undefined && r.usd >= b.maxUsd);
  }

  private categoryOf(tool: string): ToolCategory {
    if (tool === "team.post" || tool === "task.update") return "human";
    if (tool === "shell.run") return "shell";
    if (tool.startsWith("file.")) return "files";
    if (tool.startsWith("web.")) return "search";
    return "unknown";
  }

  private describe(tool: string, input: Record<string, unknown>): string {
    const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
    switch (tool) {
      case "shell.run":
        return `Run shell command: ${truncate(s("command"), 120)}`;
      case "file.delete":
        return `Delete: ${s("path")}`;
      default:
        return `${tool}: ${truncate(JSON.stringify(input), 120)}`;
    }
  }

  private argsSummary(tool: string, input: Record<string, unknown>): string {
    const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
    switch (tool) {
      case "shell.run":
        return truncate(s("command"), 80);
      case "file.write":
        return `${s("path")} (${s("content").split("\n").length} lines)`;
      case "file.read":
      case "file.edit":
      case "file.delete":
        return s("path");
      default:
        return truncate(s("request") || JSON.stringify(input), 80);
    }
  }

  private async runTool(r: Run, tu: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
    const input = (typeof tu.input === "object" && tu.input !== null ? tu.input : {}) as Record<string, unknown>;
    const category = this.categoryOf(tu.name);
    const meta = tu.name === "team.post" || tu.name === "task.update";
    const terminalId = meta ? undefined : this.opts.resolveTerminal?.(r.spec.universe, tu.name, category);
    const started = Date.now();

    if (r.spec.approvalRequired && GATED_TOOLS.has(tu.name)) {
      const actionId = randomUUID().slice(0, 8);
      this.setState(r, "awaiting_approval");
      this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "waiting for approval" } });
      this.emit({ agentId: r.id, type: "approval.requested", payload: { actionId, description: this.describe(tu.name, input) } });
      const approved = await new Promise<boolean>((resolve) => {
        r.pendingApproval = { actionId, resolve };
      });
      if (r.finished) return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: "stopped" };
      if (!approved) {
        this.emit({ agentId: r.id, type: "tool.started", payload: { tool: tu.name, category, argsSummary: this.argsSummary(tu.name, input), terminalId } });
        this.emit({ agentId: r.id, type: "tool.finished", payload: { tool: tu.name, ok: false, durationMs: 0, resultSummary: "denied by human" } });
        this.emit({ agentId: r.id, type: "message", payload: { from: "agent", text: "okay, skipping that" } });
        return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: "The human denied this action. Do not retry it; adapt your plan." };
      }
    }

    this.setState(r, "using_tool");
    this.emit({ agentId: r.id, type: "tool.started", payload: { tool: tu.name, category, argsSummary: this.argsSummary(tu.name, input), terminalId } });
    let ok = true;
    let summary = "";
    let content = "";
    try {
      const out = await this.execute(r, tu.name, input);
      ok = out.ok;
      summary = out.summary;
      content = out.content;
    } catch (err) {
      ok = false;
      const text = err instanceof Error ? err.message : String(err);
      summary = truncate(text, 80);
      content = text;
    }
    this.emit({
      agentId: r.id,
      type: "tool.finished",
      payload: { tool: tu.name, ok, durationMs: Date.now() - started, resultSummary: truncate(summary, 120) },
    });
    if (!ok) this.setState(r, "error");
    return { type: "tool_result", tool_use_id: tu.id, is_error: !ok, content: truncate(content, OUTPUT_CAP) };
  }

  private async execute(r: Run, tool: string, input: Record<string, unknown>): Promise<{ ok: boolean; summary: string; content: string }> {
    const str = (k: string) => {
      const v = input[k];
      if (typeof v !== "string") throw new Error(`${k} must be a string`);
      return v;
    };
    switch (tool) {
      case "shell.run":
        return this.runShell(r, str("command"));
      case "file.read": {
        const p = resolveInside(r.workspace, str("path"));
        const text = await fs.readFile(p, "utf8");
        return { ok: true, summary: `${text.length} chars`, content: truncate(text, OUTPUT_CAP) };
      }
      case "file.write": {
        const p = resolveInside(r.workspace, str("path"));
        const text = str("content");
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, text, "utf8");
        return { ok: true, summary: `wrote ${text.split("\n").length} lines`, content: `wrote ${str("path")}` };
      }
      case "file.edit": {
        const p = resolveInside(r.workspace, str("path"));
        const find = str("find");
        const text = await fs.readFile(p, "utf8");
        const idx = text.indexOf(find);
        if (idx < 0) return { ok: false, summary: "text to find not present", content: "`find` text was not found in the file" };
        await fs.writeFile(p, text.slice(0, idx) + str("replace") + text.slice(idx + find.length), "utf8");
        return { ok: true, summary: "edited", content: `edited ${str("path")}` };
      }
      case "file.delete": {
        const p = resolveInside(r.workspace, str("path"));
        if (path.resolve(p) === path.resolve(r.workspace)) throw new SandboxError("refusing to delete the workspace itself");
        await fs.rm(p, { recursive: true, force: false });
        return { ok: true, summary: "deleted", content: `deleted ${str("path")}` };
      }
      case "team.post": {
        const text = str("text").slice(0, 400);
        this.emit({ agentId: r.id, type: "team.message", payload: { universe: r.spec.universe, missionId: r.spec.missionId, fromName: r.spec.name, text } });
        return { ok: true, summary: truncate(text, 60), content: "posted to the team channel" };
      }
      case "task.update": {
        if (!r.spec.taskId) return { ok: false, summary: "no task", content: "you have no assigned task" };
        const progress = Math.max(0, Math.min(99, Number(input["progress"]) || 0));
        const note = str("note").slice(0, 200);
        this.emit({ agentId: r.id, type: "task.updated", payload: { taskId: r.spec.taskId, progress, note } });
        return { ok: true, summary: `${progress}% — ${truncate(note, 50)}`, content: "progress recorded" };
      }
      default: {
        const custom = this.customTerminalTools(r).find((c) => c.tool === tool);
        const name = custom?.terminal.name ?? tool;
        const requires = custom?.terminal.requires.join(", ") || "a connector";
        return {
          ok: false,
          summary: "terminal not connected",
          content: `${name} is not connected yet (requires: ${requires}). Your request was recorded: ${truncate(str("request"), 400)}. Continue with what you can do without it.`,
        };
      }
    }
  }

  private runShell(r: Run, command: string): Promise<{ ok: boolean; summary: string; content: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, { cwd: r.workspace, shell: true, env: childEnv(), timeout: SHELL_TIMEOUT_MS });
      let out = "";
      let err = "";
      child.stdout?.on("data", (d: Buffer) => {
        if (out.length < OUTPUT_CAP) out += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        if (err.length < OUTPUT_CAP) err += d.toString();
      });
      child.on("error", (e) => resolve({ ok: false, summary: e.message, content: e.message }));
      child.on("close", (code, signal) => {
        const ok = code === 0;
        const summary = ok ? `exit 0 · ${truncate(out.trim().split("\n")[0] ?? "", 60)}` : `exit ${code ?? signal}`;
        const content = `exit code: ${code ?? signal}\nstdout:\n${truncate(out, OUTPUT_CAP / 2)}\nstderr:\n${truncate(err, OUTPUT_CAP / 2)}`;
        resolve({ ok, summary, content });
      });
    });
  }
}
