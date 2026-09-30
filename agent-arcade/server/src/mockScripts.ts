/**
 * Scripted "plausible work" for mock agents. A script is a list of steps
 * the MockAdapter plays with randomized timing. Loops let long-running
 * agents keep working until their budget stops them.
 */

import type { AgentOutcome, AgentSpec, TerminalKind, ToolCategory } from "../../shared/src";

export type MsRange = [number, number];

export type Step =
  | { kind: "say"; text: string }
  | { kind: "think"; ms: MsRange; say?: string }
  | {
      kind: "tool";
      tool: string;
      category: ToolCategory;
      args: string;
      ms: MsRange;
      say?: string;
      okResult: string;
      failResult?: string;
      /** 0..1 chance the tool call fails. */
      failChance?: number;
      /** If set (and the spec requires approvals), ask the human first. */
      approval?: string;
    }
  | { kind: "finish"; outcome: AgentOutcome };

export interface MockTerminal {
  name: string;
  description: string;
  kind: TerminalKind;
  tools: string[];
  requires: string[];
}

export interface MockScript {
  spec: AgentSpec;
  steps: Step[];
  /** Terminals this script needs in its universe (created if missing). */
  terminals?: MockTerminal[];
  /** When set, jump back to this step index after the last step (until budget/stop). */
  loopFrom?: number;
  /** After this many consecutive tool failures, give up with outcome "error". */
  giveUpAfterFailures?: number;
}

const bubble = {
  reading: "reading the docs",
  searching: "searching the web",
  coding: "editing some files",
  testing: "running the tests",
  shipping: "wrapping things up",
};

export const MOCK_SCRIPTS: MockScript[] = [
  {
    // Finishes successfully after ~2 minutes → shows the "done" flag.
    spec: {
      name: "Scout",
      goal: "Research WebSocket reconnect strategies and summarize them",
      model: "mock-fast",
      allowedTools: ["web.search", "web.read", "file.write"],
      budget: { maxTokens: 50_000 },
      approvalRequired: true,
      universe: "Personal",
    },
    steps: [
      { kind: "say", text: "on it, researching now" },
      { kind: "think", ms: [3000, 6000], say: "planning my search" },
      { kind: "tool", tool: "web.search", category: "search", args: "\"websocket reconnect backoff\"", ms: [5000, 9000], say: bubble.searching, okResult: "8 results, 3 promising" },
      { kind: "tool", tool: "web.read", category: "search", args: "MDN WebSocket guide", ms: [7000, 12000], say: bubble.reading, okResult: "extracted 4 key points" },
      { kind: "think", ms: [4000, 7000], say: "comparing approaches" },
      { kind: "tool", tool: "web.read", category: "search", args: "exponential backoff paper", ms: [6000, 10000], say: bubble.reading, okResult: "jitter matters, noted" },
      { kind: "tool", tool: "file.write", category: "files", args: "notes/reconnect.md (+62 lines)", ms: [6000, 10000], say: "writing my summary", okResult: "summary saved" },
      { kind: "think", ms: [3000, 5000], say: "double checking notes" },
      { kind: "tool", tool: "file.edit", category: "files", args: "notes/reconnect.md (+9 -2)", ms: [4000, 7000], say: "final polish pass", okResult: "typos fixed" },
      { kind: "say", text: "summary ready for you" },
      { kind: "finish", outcome: "completed" },
    ],
  },
  {
    // Loops workshop/terminal work with shell approvals until its token
    // budget stops it → shows approvals, the Mailbox, and budget_exceeded.
    spec: {
      name: "Mason",
      goal: "Refactor the config loader and add tests",
      model: "mock-std",
      allowedTools: ["file.read", "file.edit", "shell.run"],
      budget: { maxTokens: 30_000 },
      approvalRequired: true,
      universe: "Business",
    },
    steps: [
      { kind: "say", text: "starting the refactor" },
      { kind: "think", ms: [4000, 8000], say: "mapping the modules" },
      { kind: "tool", tool: "file.read", category: "files", args: "src/config/*.ts", ms: [5000, 8000], say: "reading the code", okResult: "6 files scanned" },
      { kind: "tool", tool: "file.edit", category: "files", args: "src/config/loader.ts (+41 -80)", ms: [8000, 14000], say: bubble.coding, okResult: "loader simplified" },
      { kind: "tool", tool: "shell.run", category: "shell", args: "npm test -- config", ms: [7000, 12000], say: bubble.testing, okResult: "12 passed", failResult: "2 failed", failChance: 0.25, approval: "Run shell command: npm test -- config" },
      { kind: "think", ms: [4000, 7000], say: "reviewing test output" },
      { kind: "tool", tool: "file.edit", category: "files", args: "test/config.test.ts (+18)", ms: [7000, 12000], say: "adding more tests", okResult: "3 cases added" },
    ],
    loopFrom: 1,
  },
  {
    // Hits repeated failures at the Terminal and eventually gives up
    // → shows the error flicker and a terminal error outcome.
    spec: {
      name: "Patch",
      goal: "Fix the flaky billing integration test",
      model: "mock-std",
      allowedTools: ["file.read", "file.edit", "shell.run"],
      budget: { maxTokens: 40_000 },
      approvalRequired: true,
      universe: "Project Atlas",
    },
    steps: [
      { kind: "say", text: "hunting the flaky test" },
      { kind: "think", ms: [4000, 7000], say: "reading the failure" },
      { kind: "tool", tool: "file.read", category: "files", args: "test/billing.int.ts", ms: [5000, 9000], say: "reading the test", okResult: "suspicious sleep(100) found" },
      { kind: "tool", tool: "file.edit", category: "files", args: "test/billing.int.ts (+6 -3)", ms: [6000, 10000], say: bubble.coding, okResult: "await added" },
      { kind: "tool", tool: "shell.run", category: "shell", args: "npm test -- billing --repeat 5", ms: [9000, 14000], say: bubble.testing, okResult: "5/5 green", failResult: "flaked on run 3", failChance: 0.85, approval: "Run shell command: npm test -- billing --repeat 5" },
      { kind: "think", ms: [4000, 6000], say: "hmm still flaky" },
    ],
    loopFrom: 3,
    giveUpAfterFailures: 3,
  },
  {
    // The product pipeline: research -> images -> 3D -> storefront ->
    // pricing -> marketing -> sales, each at its own terminal.
    spec: {
      name: "Forge",
      goal: "Design, model, list and market a desk lamp product end to end",
      model: "mock-std",
      allowedTools: [
        "web.search",
        "higgsfield.generate_image",
        "shell.run",
        "meshy.text_to_3d",
        "store.create_listing",
        "store.set_price",
        "ads.create_campaign",
        "social.post",
        "crm.log_sale",
      ],
      budget: { maxUsd: 0.5 },
      approvalRequired: true,
      universe: "Product Lab",
    },
    terminals: [
      {
        name: "Higgsfield Studio",
        description: "Generate product images and marketing visuals",
        kind: "image",
        tools: ["higgsfield.generate_image"],
        requires: ["Higgsfield API key"],
      },
      {
        name: "Meshy 3D",
        description: "Turn concepts and images into 3D product models",
        kind: "model3d",
        tools: ["meshy.text_to_3d"],
        requires: ["Meshy API key"],
      },
      {
        name: "Storefront",
        description: "Create product listings and set prices on the shop",
        kind: "store",
        tools: ["store.create_listing", "store.set_price"],
        requires: ["Shop connector"],
      },
      {
        name: "Marketing Desk",
        description: "Run promo campaigns and social posts",
        kind: "marketing",
        tools: ["ads.create_campaign", "social.post"],
        requires: ["Ads + social connectors"],
      },
      {
        name: "Sales Desk",
        description: "Track leads and log sales in the CRM",
        kind: "chat",
        tools: ["crm.log_sale"],
        requires: ["CRM connector"],
      },
    ],
    steps: [
      { kind: "say", text: "starting the product run" },
      { kind: "tool", tool: "web.search", category: "search", args: "\"desk lamp\" trends 2026", ms: [6000, 9000], say: "researching the market", okResult: "3 trends noted" },
      { kind: "think", ms: [3000, 5000], say: "sketching the concept" },
      { kind: "tool", tool: "higgsfield.generate_image", category: "unknown", args: "desk lamp hero shot, studio light", ms: [8000, 12000], say: "rendering concept art", okResult: "4 images generated", failChance: 0.1, failResult: "generation timed out" },
      { kind: "tool", tool: "shell.run", category: "shell", args: "npm run test:render", ms: [5000, 8000], say: "testing the render", okResult: "render checks pass", approval: "Run shell command: npm run test:render" },
      { kind: "tool", tool: "meshy.text_to_3d", category: "unknown", args: "minimal desk lamp, matte finish", ms: [9000, 14000], say: "building the 3D model", okResult: "model exported (glb)", failChance: 0.1, failResult: "mesh generation failed" },
      { kind: "tool", tool: "store.create_listing", category: "unknown", args: "Lumen Desk Lamp", ms: [6000, 9000], say: "publishing the listing", okResult: "listing live", approval: "Publish product listing: Lumen Desk Lamp" },
      { kind: "tool", tool: "store.set_price", category: "unknown", args: "$49.00 (intro $39.00)", ms: [4000, 6000], say: "setting the price", okResult: "price set" },
      { kind: "tool", tool: "ads.create_campaign", category: "unknown", args: "launch promo, $20/day", ms: [6000, 9000], say: "launching the promo", okResult: "campaign running", approval: "Create ad campaign: launch promo, $20/day" },
      { kind: "tool", tool: "social.post", category: "unknown", args: "launch announcement", ms: [4000, 6000], say: "posting the launch", okResult: "posted" },
      { kind: "tool", tool: "crm.log_sale", category: "unknown", args: "first orders", ms: [5000, 8000], say: "logging the sales", okResult: "3 sales logged" },
      { kind: "think", ms: [4000, 6000], say: "reviewing the numbers" },
    ],
    loopFrom: 2,
  },
  {
    // Extra agents for soak testing (MOCK_AGENTS=6).
    spec: {
      name: "Quill",
      goal: "Draft the v2.3 release notes",
      model: "mock-fast",
      allowedTools: ["web.search", "file.write", "git.log"],
      budget: { maxTokens: 60_000 },
      approvalRequired: true,
      universe: "Project Atlas",
    },
    steps: [
      { kind: "say", text: "drafting release notes" },
      { kind: "tool", tool: "git.log", category: "unknown", args: "--since v2.2", ms: [5000, 9000], say: "reading the history", okResult: "38 commits listed" },
      { kind: "think", ms: [5000, 9000], say: "grouping the changes" },
      { kind: "tool", tool: "file.write", category: "files", args: "CHANGELOG.md (+54)", ms: [8000, 13000], say: "writing the draft", okResult: "draft saved" },
      { kind: "tool", tool: "web.search", category: "search", args: "\"keep a changelog\" format", ms: [5000, 8000], say: bubble.searching, okResult: "format confirmed" },
      { kind: "tool", tool: "file.edit", category: "files", args: "CHANGELOG.md (+7 -7)", ms: [6000, 10000], say: "tidying sections", okResult: "sections tidied" },
    ],
    loopFrom: 2,
  },
  {
    spec: {
      name: "Nix",
      goal: "Prune unused dependencies from the web app",
      model: "mock-std",
      allowedTools: ["shell.run", "file.edit", "file.delete"],
      budget: { maxUsd: 0.08 },
      approvalRequired: true,
      universe: "Business",
    },
    steps: [
      { kind: "say", text: "auditing the deps" },
      { kind: "tool", tool: "shell.run", category: "shell", args: "npx depcheck", ms: [7000, 11000], say: "scanning packages", okResult: "4 unused found", approval: "Run shell command: npx depcheck" },
      { kind: "think", ms: [4000, 7000], say: "checking each one" },
      { kind: "tool", tool: "file.delete", category: "files", args: "vendor/old-polyfill.js", ms: [5000, 8000], say: "removing dead code", okResult: "file removed", approval: "Delete file: vendor/old-polyfill.js" },
      { kind: "tool", tool: "file.edit", category: "files", args: "package.json (-4 deps)", ms: [5000, 9000], say: bubble.coding, okResult: "deps removed" },
      { kind: "tool", tool: "shell.run", category: "shell", args: "npm run build", ms: [9000, 14000], say: "verifying the build", okResult: "build green", failResult: "missing module", failChance: 0.2, approval: "Run shell command: npm run build" },
    ],
    loopFrom: 1,
  },
];
