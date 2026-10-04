// Score the drafts of the last eval run against the golden answers. No model calls:
// it reads the intents that run saved under runs/ and updates data/eval-results.json.
// Usage: npx tsx scripts/golden.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { GOLDEN } from "../data/golden";
import { matchGolden } from "../lib/golden";
import { listVersions, loadIntent } from "../lib/session";

const file = "data/eval-results.json";
const result = JSON.parse(readFileSync(file, "utf8"));
const show = (g: ReturnType<typeof matchGolden>) =>
  g.match + (g.reason ? ` (${g.reason})` : "") + (g.extraParts.length ? `, extra parts ${g.extraParts.join(", ")}` : "");

let scored = 0;
for (const [i, row] of result.rows.entries()) {
  const versions = existsSync(`runs/${row.session}`) ? listVersions(row.session) : [];
  if (!versions.length || !GOLDEN[i]) {
    console.log(`[${i + 1}] no saved draft to score`);
    continue;
  }
  scored++;
  row.golden = matchGolden(loadIntent(row.session, 1), GOLDEN[i]);
  if (versions.length > 1) row.goldenAfterFix = matchGolden(loadIntent(row.session, versions.at(-1)!), GOLDEN[i]);
  console.log(`[${i + 1}] ${row.prompt.slice(0, 70)}…`);
  console.log(`      first: ${show(row.golden)}${row.goldenAfterFix ? `   after fix: ${show(row.goldenAfterFix)}` : ""}`);
}

const rows = result.rows as Array<{ golden?: ReturnType<typeof matchGolden>; goldenAfterFix?: ReturnType<typeof matchGolden> }>;
result.goldenFirst = rows.filter((r) => r.golden && r.golden.match !== "mismatch").length;
result.goldenExactFirst = rows.filter((r) => r.golden?.match === "exact").length;
result.goldenAfterFix = rows.filter((r) => {
  const g = r.goldenAfterFix ?? r.golden;
  return g && g.match !== "mismatch";
}).length;
writeFileSync(file, JSON.stringify(result, null, 2) + "\n");

console.log(`\nscored ${scored} of ${rows.length} drafts`);
console.log(`matches the golden answer first time: ${result.goldenFirst}/${rows.length} (${result.goldenExactFirst} exact, the rest with extra parts)`);
console.log(`matches the golden answer after fix:  ${result.goldenAfterFix}/${rows.length}`);
