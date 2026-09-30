/**
 * .env loading for live mode. The API key is read from the environment
 * (or an agent-arcade/.env file) and only ever handed to the Anthropic
 * client — it is never logged, echoed to clients, or passed to shell
 * commands agents run.
 */

import fs from "node:fs";
import path from "node:path";

const KEY = "ANTHROPIC_API_KEY";

/** Load the first .env found in cwd or its parent (workspace root). */
export function loadEnv(): void {
  for (const dir of [process.cwd(), path.resolve(process.cwd(), "..")]) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        // Unreadable .env: treat as absent. Never print its contents.
      }
      return;
    }
  }
}

export function hasApiKey(): boolean {
  return typeof process.env[KEY] === "string" && process.env[KEY]!.trim().length > 0;
}

/** Environment for agent shell commands: everything except our secrets. */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("ANTHROPIC_")) continue;
    env[k] = v;
  }
  return env;
}
