/**
 * Workspace sandboxing for real agents. Each agent gets its own folder
 * under ./workspaces/<agentId>; every file path a model supplies is
 * resolved against that folder and rejected if it escapes it (via "..",
 * an absolute path, or a symlink pointing outside).
 */

import fs from "node:fs";
import path from "node:path";

export class SandboxError extends Error {}

export function workspaceFor(root: string, agentId: string): string {
  const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, "");
  const dir = path.resolve(root, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve `p` inside `workspace`, throwing SandboxError if it escapes.
 * Lexical check first, then a realpath check on the deepest existing
 * ancestor so symlinks can't tunnel out.
 */
export function resolveInside(workspace: string, p: string): string {
  if (typeof p !== "string" || p.trim() === "") throw new SandboxError("path is required");
  if (p.includes("\0")) throw new SandboxError("invalid path");
  const root = path.resolve(workspace);
  const target = path.resolve(root, p);
  const rel = path.relative(root, target);
  if (rel === "" ) return target;
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new SandboxError(`path escapes the workspace: ${p}`);
  }
  // Follow symlinks in whatever part of the path already exists.
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realRoot = fs.realpathSync(root);
  const realProbe = fs.realpathSync(probe);
  const relReal = path.relative(realRoot, realProbe);
  if (relReal === ".." || relReal.startsWith(".." + path.sep) || path.isAbsolute(relReal)) {
    throw new SandboxError(`path escapes the workspace (symlink): ${p}`);
  }
  return target;
}

export interface ListedFile {
  path: string;
  size: number;
  mtime: number;
}

/** Every regular file under `workspace` (relative, forward slashes), capped. */
export function listWorkspace(workspace: string, cap = 500): ListedFile[] {
  const out: ListedFile[] = [];
  if (!fs.existsSync(workspace)) return out;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= cap) return;
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        const st = fs.statSync(full);
        out.push({ path: path.relative(workspace, full).split(path.sep).join("/"), size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  walk(workspace);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Read a text file inside the workspace, capped at `maxBytes`. */
export function readInside(workspace: string, p: string, maxBytes = 200_000): { content: string; truncated: boolean } {
  const full = resolveInside(workspace, p);
  const st = fs.statSync(full);
  if (!st.isFile()) throw new SandboxError("not a file");
  const fd = fs.openSync(full, "r");
  try {
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    if (buf.includes(0)) throw new SandboxError("binary file");
    return { content: buf.toString("utf8"), truncated: st.size > maxBytes };
  } finally {
    fs.closeSync(fd);
  }
}
