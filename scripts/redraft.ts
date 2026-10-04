// Re-run the engine and kicad-cli on every stored version of a session, keeping
// the recorded model usage. No model calls. Use after changing the engine.
// Usage: npx tsx scripts/redraft.ts <session>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRules } from "../lib/rules";
import { runDraft, symbolLibrary } from "../lib/runs";
import { buildChecks, listVersions, loadIntent, versionDir, VersionMeta } from "../lib/session";

async function main() {
  const session = process.argv[2];
  if (!session) throw new Error("usage: tsx scripts/redraft.ts <session>");
  for (const v of listVersions(session)) {
    const metaPath = join(versionDir(session, v), "meta.json");
    const meta: VersionMeta = JSON.parse(readFileSync(metaPath, "utf8"));
    const run = await runDraft(loadIntent(session, v), session, v);
    if (!run.ok) throw new Error(`v${v} no longer validates: ${run.findings.map((f) => f.message).join("; ")}`);
    meta.bytes = run.bytes;
    meta.erc = { errors: run.erc.errors, warnings: run.erc.warnings, kicadVersion: run.erc.kicadVersion };
    meta.checks = buildChecks(run.erc, run.layout, checkRules(run.intent, symbolLibrary()));
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    console.log(`${session} v${v}: ERC ${run.erc.errors} errors, ${run.erc.warnings} warnings, ${meta.checks.filter((c) => c.status !== "pass").length} failing checks`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
