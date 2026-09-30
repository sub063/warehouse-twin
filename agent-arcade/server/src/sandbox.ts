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
