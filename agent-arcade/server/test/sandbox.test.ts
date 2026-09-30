import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveInside, SandboxError, workspaceFor } from "../src/sandbox";

let root: string;
let ws: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-sandbox-"));
  ws = workspaceFor(root, "agent-1");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("workspaceFor", () => {
  it("creates a per-agent folder and strips unsafe id characters", () => {
    const dir = workspaceFor(root, "../evil/../x");
    expect(dir.startsWith(path.resolve(root))).toBe(true);
    expect(path.basename(dir)).toBe("evilx");
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe("resolveInside", () => {
  it("accepts relative paths inside the workspace", () => {
    expect(resolveInside(ws, "notes/todo.md")).toBe(path.join(ws, "notes", "todo.md"));
    expect(resolveInside(ws, "./a.txt")).toBe(path.join(ws, "a.txt"));
  });

  it("rejects .. escapes and absolute paths", () => {
    expect(() => resolveInside(ws, "../other")).toThrow(SandboxError);
    expect(() => resolveInside(ws, "a/../../b")).toThrow(SandboxError);
    expect(() => resolveInside(ws, "/etc/passwd")).toThrow(SandboxError);
    expect(() => resolveInside(ws, "")).toThrow(SandboxError);
  });

  it("rejects symlinks that point outside the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-outside-"));
    const link = path.join(ws, "escape");
    fs.symlinkSync(outside, link, "dir");
    expect(() => resolveInside(ws, "escape/secret.txt")).toThrow(SandboxError);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
