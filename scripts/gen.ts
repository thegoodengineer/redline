// Model in the loop from the terminal.
//   npx tsx scripts/gen.ts <session> "describe the circuit"          -> v1
//   npx tsx scripts/gen.ts <session> --revise "change request"       -> next version from the latest
//   npx tsx scripts/gen.ts <session> --fix                           -> revise with every failing check
import { GemmaProvider } from "../lib/model/provider";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixRequest, generate, listVersions, revise, Turn, versionDir, VersionMeta } from "../lib/session";

function print(turn: Turn) {
  if (!turn.ok) {
    console.log(`REJECTED after ${turn.attempts} attempt(s), nothing written. ${turn.usage.totalTokens} tokens, ${turn.ms} ms`);
    for (const f of turn.findings) console.log(`  ${f.id}. [${f.code}] ${f.message}`);
    return;
  }
  const m = turn.meta;
  console.log(`${m.session} v${m.version} (${m.kind}) "${turn.intent.title}"`);
  console.log(`model:     ${m.model}, ${m.attempts} attempt(s), ${m.ms} ms`);
  console.log(`tokens:    ${m.usage.totalTokens} total (prompt ${m.usage.promptTokens}, output ${m.usage.outputTokens}, thinking ${m.usage.thoughtTokens})`);
  console.log(`bytes:     intent ${m.bytes.intent}, schematic ${m.bytes.schematic}`);
  console.log(`parts:     ${turn.intent.parts.map((p) => `${p.ref}=${p.value}`).join(", ")}`);
  console.log(`nets:      ${turn.intent.nets.map((n) => `${n.name}[${n.pins.join(" ")}]`).join("  ")}`);
  console.log(`ERC (KiCad ${m.erc.kicadVersion}): ${m.erc.errors} errors, ${m.erc.warnings} warnings`);
  for (const c of m.checks) console.log(`  ${c.status.toUpperCase().padEnd(4)} ${c.source.padEnd(4)} ${c.message}`);
  if (m.diff) {
    console.log(`diff:      added [${m.diff.added.join(", ")}] removed [${m.diff.removed.join(", ")}]`);
    for (const c of m.diff.changed) console.log(`           changed ${c.ref}: ${c.what.join("; ")}`);
    console.log(`           nets added [${m.diff.nets.added.join(", ")}] removed [${m.diff.nets.removed.join(", ")}] changed [${m.diff.nets.changed.join(", ")}]`);
  }
}

async function main() {
  const [session, a, b] = process.argv.slice(2);
  if (!session || !a) {
    console.error('usage: tsx scripts/gen.ts <session> "circuit"  |  <session> --revise "change"');
    process.exit(2);
  }
  const provider = new GemmaProvider();
  if (a === "--revise") {
    const latest = listVersions(session).at(-1);
    if (!latest) throw new Error(`session ${session} has no versions yet`);
    print(await revise(session, latest, b, provider));
  } else if (a === "--fix") {
    const latest = listVersions(session).at(-1);
    if (!latest) throw new Error(`session ${session} has no versions yet`);
    const meta: VersionMeta = JSON.parse(readFileSync(join(versionDir(session, latest), "meta.json"), "utf8"));
    const failing = meta.checks.filter((c) => c.status !== "pass");
    if (!failing.length) return console.log(`v${latest} has nothing to fix`);
    console.log(fixRequest(failing) + "\n");
    print(await revise(session, latest, fixRequest(failing), provider));
  } else {
    print(await generate(session, a, provider));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
