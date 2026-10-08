import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const cfg = JSON.parse(readFileSync(".local/test-config.json", "utf8"));
const child = spawn(process.execPath, ["dist/main.js"], {
  cwd: "apps/api",
  env: { ...process.env, ...cfg },
  stdio: "inherit",
});
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
