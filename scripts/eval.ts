// Eval: draft every prompt in data/prompts.json with live Gemma, then give each
// draft that is not clean one fix round. Prints how many are ERC-clean first
// time and after the fix round, and writes data/eval-results.json.
// Usage: npx tsx scripts/eval.ts [--limit N] [--delay seconds]
import { readFileSync, writeFileSync } from "node:fs";
import { GOLDEN } from "../data/golden";
import { GoldenResult, matchGolden } from "../lib/golden";
import { GemmaProvider } from "../lib/model/provider";
import { fixRequest, generate, revise, Turn } from "../lib/session";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

interface Row {
  prompt: string;
  session: string;
  first: { drafted: boolean; ercErrors: number | null; ercWarnings: number | null; ruleFailures: number | null; validationRetry: boolean; tokens: number; ms: number };
  fixRound: null | { drafted: boolean; ercErrors: number | null; ercWarnings: number | null; ruleFailures: number | null; tokens: number; ms: number };
  /** Does the draft contain the hand-written reference circuit for this prompt? */
  golden?: GoldenResult;
  goldenAfterFix?: GoldenResult;
  error?: string;
}

const summarize = (t: Turn) => ({
  drafted: t.ok,
  ercErrors: t.ok ? t.meta.erc.errors : null,
  ercWarnings: t.ok ? t.meta.erc.warnings : null,
  ruleFailures: t.ok ? t.meta.checks.filter((c) => c.source === "rule" && c.status === "fail").length : null,
  tokens: t.ok ? t.meta.usage.totalTokens : t.usage.totalTokens,
  ms: t.ok ? t.meta.ms : t.ms,
});
const ercClean = (s: { drafted: boolean; ercErrors: number | null; ercWarnings: number | null } | null) =>
  !!s && s.drafted && s.ercErrors === 0 && s.ercWarnings === 0;
const allClean = (s: Row["first"] | Row["fixRound"]) => ercClean(s) && s!.ruleFailures === 0;

/** One model turn; an API failure (after the provider's own retries) is retried once after a pause. */
async function attempt(fn: () => Promise<Turn>): Promise<Turn> {
  try {
    return await fn();
  } catch (e) {
    console.log(`    API error, waiting 30 s and trying once more: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    await sleep(30);
    return fn();
  }
}

async function main() {
  const prompts: string[] = JSON.parse(readFileSync("data/prompts.json", "utf8"));
  const limit = arg("--limit", prompts.length);
  const delay = arg("--delay", 5);
  const provider = new GemmaProvider();
  const stamp = Date.now().toString(36);
  const rows: Row[] = [];

  for (const [i, prompt] of prompts.slice(0, limit).entries()) {
    const session = `eval-${stamp}-${i + 1}`;
    console.log(`\n[${i + 1}/${Math.min(limit, prompts.length)}] ${prompt}`);
    const row: Row = { prompt, session, first: { drafted: false, ercErrors: null, ercWarnings: null, ruleFailures: null, validationRetry: false, tokens: 0, ms: 0 }, fixRound: null };
    rows.push(row);
    try {
      const first = await attempt(() => generate(session, prompt, provider));
      row.first = { ...summarize(first), validationRetry: (first.ok ? first.meta.attempts : first.attempts) > 1 };
      if (first.ok && GOLDEN[i]) row.golden = matchGolden(first.intent, GOLDEN[i]);
      if (row.golden) console.log(`    golden: ${row.golden.match}${row.golden.reason ? " (" + row.golden.reason + ")" : ""}${row.golden.extraParts.length ? " extra parts " + row.golden.extraParts.join(", ") : ""}`);
      console.log(
        first.ok
          ? `    first: ERC ${first.meta.erc.errors} errors, ${first.meta.erc.warnings} warnings, ${row.first.ruleFailures} rule failures, ${row.first.tokens} tokens, ${(row.first.ms / 1000).toFixed(0)} s`
          : `    first: rejected by the validator (${first.findings.map((f) => f.message).join("; ").slice(0, 200)})`,
      );
      if (!allClean(row.first)) {
        await sleep(delay);
        const failing = first.ok ? first.meta.checks.filter((c) => c.status !== "pass") : [];
        const fixed = await attempt(() => (first.ok ? revise(session, 1, fixRequest(failing), provider) : generate(session, prompt, provider)));
        row.fixRound = summarize(fixed);
        if (fixed.ok && GOLDEN[i]) row.goldenAfterFix = matchGolden(fixed.intent, GOLDEN[i]);
        console.log(
          fixed.ok
            ? `    fix:   ERC ${fixed.meta.erc.errors} errors, ${fixed.meta.erc.warnings} warnings, ${row.fixRound.ruleFailures} rule failures`
            : `    fix:   rejected by the validator`,
        );
      }
    } catch (e) {
      row.error = String(e instanceof Error ? e.message : e).slice(0, 300);
      console.log(`    ERROR: ${row.error}`);
    }
    await sleep(delay);
  }

  const n = rows.length;
  const final = (r: Row) => r.fixRound ?? r.first;
  const result = {
    model: provider.model,
    date: new Date().toISOString(),
    prompts: n,
    ercCleanFirst: rows.filter((r) => ercClean(r.first)).length,
    ercCleanAfterFix: rows.filter((r) => ercClean(r.first) || ercClean(r.fixRound)).length,
    ercAndRulesCleanFirst: rows.filter((r) => allClean(r.first)).length,
    ercAndRulesCleanAfterFix: rows.filter((r) => allClean(final(r))).length,
    goldenFirst: rows.filter((r) => r.golden && r.golden.match !== "mismatch").length,
    goldenExactFirst: rows.filter((r) => r.golden?.match === "exact").length,
    goldenAfterFix: rows.filter((r) => { const g = r.goldenAfterFix ?? r.golden; return g && g.match !== "mismatch"; }).length,
    apiErrors: rows.filter((r) => r.error).length,
    rows,
  };
  writeFileSync("data/eval-results.json", JSON.stringify(result, null, 2) + "\n");

  console.log(`\n================ EVAL (${result.model}, ${n} prompts) ================`);
  console.log(`ERC-clean first time:              ${result.ercCleanFirst}/${n}`);
  console.log(`ERC-clean after one fix round:     ${result.ercCleanAfterFix}/${n}`);
  console.log(`ERC + design rules clean first:    ${result.ercAndRulesCleanFirst}/${n}`);
  console.log(`ERC + design rules clean after fix: ${result.ercAndRulesCleanAfterFix}/${n}`);
  console.log(`matches the golden answer first:   ${result.goldenFirst}/${n} (${result.goldenExactFirst} exact, the rest with extra parts)`);
  console.log(`matches the golden answer after fix: ${result.goldenAfterFix}/${n}`);
  console.log(`prompts lost to API errors:        ${result.apiErrors}/${n}`);
  console.log(`written: data/eval-results.json`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
