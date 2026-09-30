/**
 * Terminal registry: the places in each universe where agents do work.
 * Every universe gets three defaults (shell, research, files) the first
 * time it is seen; humans add more (image generation, 3D, storefront,
 * ...) through the UI. Tool calls route to the terminal that provides
 * the tool. All changes are published as terminal.* events.
 */

import { randomUUID } from "node:crypto";
import type { DraftEvent, TerminalKind, TerminalSpec, ToolCategory } from "../../shared/src";

export type TerminalDraft = Omit<TerminalSpec, "id" | "universe">;

export const DEFAULT_TERMINALS: TerminalDraft[] = [
  {
    name: "Terminal",
    description: "Run shell commands, builds and tests",
    kind: "shell",
    tools: ["shell.run"],
    requires: [],
  },
  {
    name: "Library",
    description: "Search the web and read documentation",
    kind: "research",
    tools: ["web.search", "web.read"],
    requires: [],
  },
  {
    name: "Workshop",
    description: "Create, edit and delete files in the workspace",
    kind: "files",
    tools: ["file.read", "file.write", "file.edit", "file.delete"],
    requires: [],
  },
];

const CATEGORY_KIND: Record<ToolCategory, TerminalKind> = {
  shell: "shell",
  search: "research",
  files: "files",
  human: "chat",
  unknown: "files",
};

export class TerminalRegistry {
  private terminals = new Map<string, TerminalSpec>();

  constructor(private emit: (e: DraftEvent) => void) {}

  list(): TerminalSpec[] {
    return [...this.terminals.values()];
  }

  inUniverse(universe: string): TerminalSpec[] {
    return this.list().filter((t) => t.universe === universe);
  }

  add(universe: string, draft: TerminalDraft): TerminalSpec {
    const terminal: TerminalSpec = { ...draft, id: randomUUID().slice(0, 8), universe };
    this.terminals.set(terminal.id, terminal);
    this.emit({ agentId: "", type: "terminal.added", payload: { terminal } });
    return terminal;
  }

  remove(terminalId: string): void {
    const t = this.terminals.get(terminalId);
    if (!t) return;
    this.terminals.delete(terminalId);
    this.emit({ agentId: "", type: "terminal.removed", payload: { terminalId, universe: t.universe } });
  }

  /** Seed the defaults the first time a universe shows up. */
  ensureDefaults(universe: string): void {
    if (this.inUniverse(universe).length > 0) return;
    for (const d of DEFAULT_TERMINALS) this.add(universe, d);
  }

  /** Make sure named terminals exist in a universe (used by demo scripts). */
  ensure(universe: string, drafts: TerminalDraft[]): void {
    this.ensureDefaults(universe);
    const have = new Set(this.inUniverse(universe).map((t) => t.name));
    for (const d of drafts) if (!have.has(d.name)) this.add(universe, d);
  }

  /**
   * Which terminal a tool call goes to: the one providing the tool, else
   * the one whose kind matches the tool's category, else the first.
   */
  resolve(universe: string, tool: string, category: ToolCategory): string | undefined {
    const here = this.inUniverse(universe);
    const byTool = here.find((t) => t.tools.includes(tool));
    if (byTool) return byTool.id;
    const byKind = here.find((t) => t.kind === CATEGORY_KIND[category]);
    return (byKind ?? here[0])?.id;
  }
}
