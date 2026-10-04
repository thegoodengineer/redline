// Records the session the film replays: five live turns with Gemma, each retried
// if the hosted API fails. Output: runs/film/, then copied to demo/ by hand.
// Usage: npx tsx video/record_session.ts
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GemmaProvider } from "../lib/model/provider";
import { RUNS_DIR } from "../lib/runs";
import { Answer, fixRequest, generate, listVersions, revise, Turn, versionDir, VersionMeta } from "../lib/session";

const SESSION = "film";
const provider = new GemmaProvider();

async function step(label: string, run: () => Promise<Turn | Answer>): Promise<Turn | Answer> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const t = await run();
      if ("answer" in t) console.log(`${label}: ANSWER (${t.ms} ms) ${t.answer}`);
      else if (t.ok) {
        const fails = t.meta.checks.filter((c) => c.status !== "pass").map((c) => c.message);
        console.log(`${label}: v${t.meta.version}, ${t.intent.parts.map((p) => p.ref).join(" ")}, ops ${t.meta.ops ?? "-"}, ERC ${t.meta.erc.errors}/${t.meta.erc.warnings}, not passing: ${JSON.stringify(fails)}`);
      } else console.log(`${label}: REJECTED ${t.findings.map((f) => f.message).join("; ")}`);
      return t;
    } catch (e) {
      console.log(`${label}: attempt ${attempt} failed (${String(e instanceof Error ? e.message : e).slice(0, 90)}), waiting 20 s`);
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
  throw new Error(`${label}: gave up after 5 attempts`);
}

async function main() {
  rmSync(join(RUNS_DIR, SESSION), { recursive: true, force: true });
  const latest = () => listVersions(SESSION).at(-1)!;
  await step("1 draft", () => generate(SESSION, "5 V in on a 2-pin connector, an AMS1117-3.3 regulator with input and output capacitors, and 3.3 V out on a 2-pin connector.", provider));
  await step("2 ask", () => revise(SESSION, latest(), "Why does the regulator need a capacitor on its input and on its output?", provider));
  await step("3 edit", () => revise(SESSION, latest(), "Add a green power LED with its series resistor on the 3.3 V output.", provider));
  await step("4 break", () => revise(SESSION, latest(), "Remove the output capacitor.", provider));
  const meta: VersionMeta = JSON.parse(readFileSync(join(versionDir(SESSION, latest()), "meta.json"), "utf8"));
  const failing = meta.checks.filter((c) => c.status === "fail");
  if (!failing.length) throw new Error("step 4 left nothing failing, so there is no fix to show");
  await step("5 fix", () => revise(SESSION, latest(), fixRequest(failing), provider));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
