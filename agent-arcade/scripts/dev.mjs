// Runs the server and the client dev server together, so `npm run dev`
// starts the whole app. No dependency needed — just child processes.
import { spawn } from "node:child_process";

const procs = [];

function run(name, args) {
  // On Windows npm is npm.cmd, which Node only runs through a shell.
  const p = spawn("npm", args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  p.on("exit", (code) => {
    // If one side dies, take the other down so the failure is obvious.
    for (const q of procs) if (q !== p && q.exitCode === null) q.kill();
    process.exitCode = code ?? 0;
  });
  procs.push(p);
  return p;
}

run("server", ["run", "dev", "--workspace", "server"]);
run("client", ["run", "dev", "--workspace", "client"]);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const p of procs) if (p.exitCode === null) p.kill();
  });
}
