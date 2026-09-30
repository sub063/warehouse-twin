/**
 * ClaudeAdapter tests with a scripted fake stream — no network, no key.
 * Each "turn" is the Message the model would have returned.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentSpec, DraftEvent } from "../../shared/src";
import { ClaudeAdapter, type StreamFactory } from "../src/claudeAdapter";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-adapter-"));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const spec = (over: Partial<AgentSpec> = {}): AgentSpec => ({
  name: "Live",
  goal: "do the thing",
  model: "claude-opus-5-5",
  allowedTools: ["shell.run", "file.read", "file.write", "file.edit", "file.delete"],
  budget: { maxTokens: 100_000 },
  approvalRequired: true,
  universe: "Test",
  ...over,
});

function turn(content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"] = "tool_use", tokens = 100): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: tokens, output_tokens: tokens, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  } as unknown as Anthropic.Message;
}

const text = (t: string): Anthropic.ContentBlock => ({ type: "text", text: t, citations: null }) as Anthropic.ContentBlock;
const use = (id: string, name: string, input: unknown): Anthropic.ContentBlock =>
  ({ type: "tool_use", id, name, input }) as Anthropic.ContentBlock;

/** Fake stream: hands out scripted turns; records params and supports abort. */
function scripted(turns: Anthropic.Message[], opts: { hang?: boolean; delayMs?: number } = {}) {
  const calls: Anthropic.MessageStreamParams[] = [];
  let aborted = 0;
  const stream: StreamFactory = (params, signal) => {
    // Snapshot: the adapter keeps appending to the same messages array
    // (the real SDK serializes it at request time).
    calls.push({ ...params, messages: structuredClone(params.messages) });
    let rejectFn: (e: Error) => void = () => {};
    const p = new Promise<Anthropic.Message>((resolve, reject) => {
      rejectFn = reject;
      if (opts.hang && turns.length === 0) return; // hang until aborted
      const next = turns.shift();
      if (!next) return reject(new Error("script exhausted"));
      setTimeout(() => resolve(next), opts.delayMs ?? 5);
    });
    signal.addEventListener("abort", () => {
      aborted += 1;
      rejectFn(new Error("aborted"));
    });
    return { finalMessage: () => p, abort: () => { aborted += 1; rejectFn(new Error("aborted")); } };
  };
  return { stream, calls, aborted: () => aborted };
}

function collect(adapter: ClaudeAdapter) {
  const events: DraftEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  return events;
}

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const done = (events: DraftEvent[]) => events.find((e) => e.type === "agent.finished");

describe("ClaudeAdapter", () => {
  it("writes files inside the workspace, narrates, and finishes when the model stops", async () => {
    const s = scripted([
      turn([text("Creating the notes file."), use("t1", "file.write", { path: "notes/hello.md", content: "hi\nthere" })]),
      turn([text("All done.")], "end_turn"),
    ]);
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root, resolveTerminal: () => "term-files" });
    const events = collect(adapter);
    const id = adapter.start(spec());
    await until(() => Boolean(done(events)));

    expect(fs.readFileSync(path.join(root, id, "notes", "hello.md"), "utf8")).toBe("hi\nthere");
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("agent.created");
    expect(events.some((e) => e.type === "message" && e.payload.from === "agent" && e.payload.text === "Creating the notes file.")).toBe(true);
    const started = events.find((e) => e.type === "tool.started");
    expect(started?.type === "tool.started" && started.payload).toMatchObject({ tool: "file.write", category: "files", terminalId: "term-files" });
    const finished = events.find((e) => e.type === "tool.finished");
    expect(finished?.type === "tool.finished" && finished.payload.ok).toBe(true);
    expect(done(events)?.type === "agent.finished" && done(events)!.payload).toEqual({ outcome: "completed" });
    // Second turn carried the tool_result back to the model.
    const second = s.calls[1]!.messages.at(-1)!;
    expect(second.role).toBe("user");
    expect((second.content as Anthropic.ToolResultBlockParam[])[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", is_error: false });
    // Usage was reported with a cost.
    const usage = events.find((e) => e.type === "usage.updated");
    expect(usage?.type === "usage.updated" && usage.payload.costUsd).toBeGreaterThan(0);
  });

  it("rejects paths outside the workspace and tells the model", async () => {
    const s = scripted([
      turn([use("t1", "file.write", { path: "../../escape.txt", content: "x" })]),
      turn([text("ok")], "end_turn"),
    ]);
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    adapter.start(spec());
    await until(() => Boolean(done(events)));
    expect(fs.existsSync(path.resolve(root, "..", "escape.txt"))).toBe(false);
    const fin = events.find((e) => e.type === "tool.finished");
    expect(fin?.type === "tool.finished" && fin.payload.ok).toBe(false);
    const result = (s.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain("escapes the workspace");
  });

  it("gates shell commands on approval: approved runs, denied is skipped", async () => {
    const s = scripted([
      turn([use("t1", "shell.run", { command: "echo approved-run" })]),
      turn([use("t2", "shell.run", { command: "echo should-not-run" })]),
      turn([text("done")], "end_turn"),
    ]);
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    const id = adapter.start(spec());

    await until(() => events.some((e) => e.type === "approval.requested"));
    const req1 = events.find((e) => e.type === "approval.requested")!;
    expect(req1.type === "approval.requested" && req1.payload.description).toContain("echo approved-run");
    expect(events.at(-1)?.type === "approval.requested" || events.some((e) => e.type === "agent.state_changed" && e.payload.state === "awaiting_approval")).toBe(true);
    adapter.resolveApproval(id, req1.type === "approval.requested" ? req1.payload.actionId : "", true);

    await until(() => events.filter((e) => e.type === "approval.requested").length === 2);
    const fin1 = events.find((e) => e.type === "tool.finished");
    expect(fin1?.type === "tool.finished" && fin1.payload.ok).toBe(true);
    const res1 = (s.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(String(res1.content)).toContain("approved-run");

    const req2 = events.filter((e) => e.type === "approval.requested")[1]!;
    adapter.resolveApproval(id, req2.type === "approval.requested" ? req2.payload.actionId : "", false);
    await until(() => Boolean(done(events)));
    const fins = events.filter((e) => e.type === "tool.finished");
    expect(fins[1]?.type === "tool.finished" && fins[1].payload.resultSummary).toBe("denied by human");
    const res2 = (s.calls[2]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(res2.is_error).toBe(true);
    expect(events.some((e) => e.type === "approval.resolved" && e.payload.approved === false)).toBe(true);
  });

  it("does not gate shell when approvalRequired is off", async () => {
    const s = scripted([turn([use("t1", "shell.run", { command: "echo free" })]), turn([text("done")], "end_turn")]);
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    adapter.start(spec({ approvalRequired: false }));
    await until(() => Boolean(done(events)));
    expect(events.some((e) => e.type === "approval.requested")).toBe(false);
    const res = (s.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(String(res.content)).toContain("free");
  });

  it("stop() aborts the in-flight model call and finishes as stopped", async () => {
    const s = scripted([], { hang: true });
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    const id = adapter.start(spec());
    await until(() => s.calls.length === 1);
    adapter.stop(id);
    await until(() => Boolean(done(events)));
    expect(s.aborted()).toBeGreaterThan(0);
    expect(done(events)?.type === "agent.finished" && done(events)!.payload.outcome).toBe("stopped");
    // No error event after the abort.
    expect(events.filter((e) => e.type === "agent.finished")).toHaveLength(1);
  });

  it("pause holds tool execution and the next model turn until resume", async () => {
    const s = scripted(
      [turn([use("t1", "file.write", { path: "a.txt", content: "1" })]), turn([text("done")], "end_turn")],
      { delayMs: 120 }, // slow turns so pause() lands while the first is in flight
    );
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    const id = adapter.start(spec());
    await until(() => s.calls.length === 1);
    adapter.pause(id);
    await until(() => events.some((e) => e.type === "agent.state_changed" && e.payload.state === "paused"));
    await new Promise((r) => setTimeout(r, 80));
    // The model turn already in flight completes, but nothing runs after it.
    expect(events.some((e) => e.type === "tool.started")).toBe(false);
    expect(s.calls.length).toBe(1);
    adapter.resume(id);
    await until(() => Boolean(done(events)));
    expect(events.some((e) => e.type === "tool.finished" && e.payload.ok)).toBe(true);
    expect(s.calls.length).toBe(2);
  });

  it("delivers human messages to the model on the next turn", async () => {
    const s = scripted([
      turn([use("t1", "file.write", { path: "a.txt", content: "1" })]),
      turn([text("done")], "end_turn"),
    ]);
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    const id = adapter.start(spec());
    adapter.sendMessage(id, "prefer tabs please");
    await until(() => Boolean(done(events)));
    const content = s.calls[1]!.messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    const note = content.find((b) => b.type === "text") as Anthropic.TextBlockParam | undefined;
    expect(note?.text).toContain("prefer tabs please");
    expect(events.some((e) => e.type === "message" && e.payload.from === "human")).toBe(true);
  });

  it("stops with budget_exceeded when tokens run out", async () => {
    const s = scripted([turn([use("t1", "file.write", { path: "a.txt", content: "1" })], "tool_use", 5000)]);
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    adapter.start(spec({ budget: { maxTokens: 1000 } }));
    await until(() => Boolean(done(events)));
    expect(done(events)?.type === "agent.finished" && done(events)!.payload.outcome).toBe("budget_exceeded");
    expect(events.some((e) => e.type === "tool.started")).toBe(false);
  });

  it("advertises custom terminal tools and answers 'not connected' when called", async () => {
    const s = scripted([
      turn([use("t1", "meshy.text_to_3d", { request: "a lamp" })]),
      turn([text("done")], "end_turn"),
    ]);
    const adapter = new ClaudeAdapter({
      stream: s.stream,
      workspaceRoot: root,
      terminalsFor: () => [
        { id: "m", universe: "Test", name: "Meshy 3D", description: "3D models", kind: "model3d", tools: ["meshy.text_to_3d"], requires: ["Meshy API key"] },
      ],
      resolveTerminal: () => "m",
    });
    const events = collect(adapter);
    adapter.start(spec({ allowedTools: ["meshy.text_to_3d"] }));
    await until(() => Boolean(done(events)));
    const toolNames = (s.calls[0]!.tools ?? []).map((t) => (t as { name: string }).name);
    expect(toolNames).toEqual(["meshy.text_to_3d", "team.post"]);
    const started = events.find((e) => e.type === "tool.started");
    expect(started?.type === "tool.started" && started.payload.terminalId).toBe("m");
    const res = (s.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(String(res.content)).toContain("not connected");
    expect(String(res.content)).toContain("Meshy API key");
  });

  it("finishes with an error when the API call fails, without leaking secrets", async () => {
    const s = scripted([]);
    const adapter = new ClaudeAdapter({ stream: s.stream, workspaceRoot: root });
    const events = collect(adapter);
    adapter.start(spec());
    await until(() => Boolean(done(events)));
    expect(done(events)?.type === "agent.finished" && done(events)!.payload.outcome).toBe("error");
    const msg = events.find((e) => e.type === "message" && e.payload.text.startsWith("error:"));
    expect(msg).toBeDefined();
  });
});
