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

/** Departments every Business universe starts with. */
export const BUSINESS_DEPARTMENTS: TerminalDraft[] = [
  { name: "R&D", description: "Research, competitor analysis, reading the literature", kind: "research", tools: ["web.search", "web.read"], requires: [] },
  { name: "Engineering", description: "Build and test software: shell, builds, test runs", kind: "shell", tools: ["shell.run"], requires: [] },
  { name: "Operations", description: "Documents, files, procedures and the day-to-day paperwork", kind: "files", tools: ["file.read", "file.write", "file.edit", "file.delete"], requires: [] },
  { name: "Marketing", description: "Campaigns, announcements, social posts and ad creative", kind: "marketing", tools: ["ads.create_campaign", "social.post"], requires: ["Ad account"] },
  { name: "Sales", description: "Listings, pricing, leads and closing orders", kind: "store", tools: ["store.create_listing", "crm.log_sale"], requires: ["Store / CRM connector"] },
  { name: "Accounting", description: "Budgets, costs, invoices and cash-flow tracking", kind: "data", tools: ["finance.build_budget", "finance.record_invoice"], requires: ["Bookkeeping connector"] },
  { name: "Legal", description: "Contracts, terms, compliance and risk review", kind: "legal", tools: ["legal.review_contract", "legal.draft_terms"], requires: [] },
  { name: "Logistics", description: "Suppliers, inventory, shipping and fulfilment", kind: "logistics", tools: ["logistics.plan_shipment", "logistics.check_inventory"], requires: ["Carrier / inventory connector"] },
];

/** A Personal universe is smaller: a study, a desk and a toolbox. */
export const PERSONAL_DEPARTMENTS: TerminalDraft[] = [
  { name: "Study", description: "Search the web and read up on things", kind: "research", tools: ["web.search", "web.read"], requires: [] },
  { name: "Desk", description: "Notes, plans, lists and documents", kind: "files", tools: ["file.read", "file.write", "file.edit", "file.delete"], requires: [] },
  { name: "Toolbox", description: "Run scripts and commands", kind: "shell", tools: ["shell.run"], requires: [] },
];

export function defaultDepartmentsFor(universe: string): TerminalDraft[] {
  return universe === "Personal" ? PERSONAL_DEPARTMENTS : BUSINESS_DEPARTMENTS;
}

/** Legacy generic set (kept for tests and older databases). */
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

  /** Re-register a terminal loaded from the persisted log (no event). */
  restore(terminal: TerminalSpec): void {
    this.terminals.set(terminal.id, terminal);
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
    for (const d of defaultDepartmentsFor(universe)) this.add(universe, d);
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
