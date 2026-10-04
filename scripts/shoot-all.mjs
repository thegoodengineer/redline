// Screenshot every page at 1440, 1024 and 400 px. The dev server must be running.
// Usage: node scripts/shoot-all.mjs
import { execFileSync } from "node:child_process";

const pages = [
  ["landing", "/"],
  ["studio-empty", "/studio"],
  ["demo-start", "/studio?demo=1"],
  ["demo-v2", "/studio?demo=1&start=2"],
  ["demo-v3", "/studio?demo=1&start=3"],
  ["not-found", "/no-such-page"],
];
for (const [name, path] of pages) {
  process.stdout.write(execFileSync("node", ["scripts/shots.mjs", name, path], { encoding: "utf8" }));
}
