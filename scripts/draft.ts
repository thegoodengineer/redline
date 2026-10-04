// Draft an intent file without any model call.
// Usage: npx tsx scripts/draft.ts examples/reg-3v3.intent.json [session]
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { locateKicad } from "../lib/kicad/cli";
import { runDraft } from "../lib/runs";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/draft.ts <intent.json> [session]");
    process.exit(2);
  }
  const session = process.argv[3] ?? basename(file).replace(/\.intent\.json$|\.json$/, "");
  const paths = locateKicad();
  console.log(`kicad-cli:  ${paths.cli}`);
  console.log(`symbols:    ${paths.symbolDir}`);

  const result = await runDraft(JSON.parse(readFileSync(file, "utf8")), session, 1);
  if (!result.ok) {
    console.log(`\nVALIDATION FAILED, nothing written (${result.findings.length} findings)`);
    for (const f of result.findings) console.log(`  ${f.id}. [${f.code}] ${f.message}`);
    process.exit(1);
  }

  for (const c of result.cli) {
    console.log(`\n> kicad-cli ${c.args.join(" ")}`);
    console.log((c.stdout + c.stderr).trim());
    console.log(`exit ${c.code}`);
  }
  console.log(`\nrun dir:    ${result.dir}`);
  console.log(`intent:     ${result.bytes.intent} bytes`);
  console.log(`schematic:  ${result.bytes.schematic} bytes`);
  console.log(`paper:      ${result.layout.paper}, content ${result.layout.content.w} x ${result.layout.content.h} mm`);
  console.log(`ERC (KiCad ${result.erc.kicadVersion}): ${result.erc.errors} errors, ${result.erc.warnings} warnings`);
  for (const v of result.erc.violations) {
    const owners = v.items.map((i) => {
      const o = result.layout.uuids[i.uuid];
      return o ? `${o.ref}${o.pin ? "." + o.pin : ""}` : i.description;
    });
    console.log(`  [${v.severity}] ${v.type}: ${v.description} (${owners.join(", ")})`);
  }
  process.exit(result.erc.errors ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
