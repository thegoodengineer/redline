import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { demoPayloads } from "@/lib/demo";

export const dynamic = "force-dynamic";

interface EvalResult {
  model: string;
  prompts: number;
  ercCleanFirst: number;
  ercCleanAfterFix: number;
}

function evalResult(): EvalResult | null {
  const file = join(process.cwd(), "data", "eval-results.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Home() {
  // Every number on this page is read from a recorded run, not typed in.
  const first = demoPayloads()[0]?.meta;
  const ev = evalResult();

  return (
    <main className="landing">
      <header className="landing-bar">
        <span className="brand">
          <b>Redline</b>
        </span>
        <nav>
          <Link href="/studio?demo=1">Recorded demo</Link>
          <a href="#how">How it works</a>
        </nav>
      </header>

      <section className="hero">
        <span className="label">KiCad schematics from a description</span>
        <h1>Describe a circuit, get a real KiCad schematic, and fix what ERC finds by chat.</h1>
        <p>
          The model writes a small list of parts and nets. Code places every symbol, and KiCad&apos;s own rule check is
          the judge.
        </p>
        <Link className="btn primary large" href="/studio">
          Open the studio
        </Link>
      </section>

      <figure className="shot">
        <img src="/studio.png" alt="The Redline studio: chat on the left, a KiCad schematic with two marked findings in the centre, checks on the right" width={1440} height={900} />
      </figure>

      <section className="stats landing-stats" aria-label="Numbers from a recorded run">
        <div className="stat">
          <span className="label">Tokens for a first draft</span>
          <span className="value">{first ? fmt(first.usage.totalTokens) : "—"}</span>
          <span className="sub">from API usage metadata</span>
        </div>
        <div className="stat">
          <span className="label">Intent → schematic</span>
          <span className="value">{first ? `${fmt(first.bytes.intent)} → ${fmt(first.bytes.schematic)}` : "—"}</span>
          <span className="sub">{first ? `bytes · ${(first.bytes.schematic / first.bytes.intent).toFixed(1)}× written by code` : "bytes"}</span>
        </div>
        <div className="stat">
          <span className="label">KiCad ERC on that draft</span>
          <span className={`value ${first ? (first.erc.errors ? "fail" : "pass") : ""}`}>{first ? `${first.erc.errors} errors` : "—"}</span>
          <span className="sub">{first ? `${first.erc.warnings} warnings · KiCad ${first.erc.kicadVersion}` : "kicad-cli sch erc"}</span>
        </div>
        <div className="stat">
          <span className="label">ERC-clean first time</span>
          <span className="value">{ev ? `${ev.ercCleanFirst} / ${ev.prompts}` : "—"}</span>
          <span className="sub">{ev ? `${ev.ercCleanAfterFix} / ${ev.prompts} after one fix round` : "run scripts/eval.ts"}</span>
        </div>
      </section>

      <section className="how" id="how">
        <div>
          <span className="label">1 · Intent</span>
          <h2>The model writes parts and nets</h2>
          <p>Gemma 4 returns a small JSON intent: refs, library symbols, values, and which pins share a net. Parts are looked up in your installed KiCad libraries. It never writes a coordinate.</p>
        </div>
        <div>
          <span className="label">2 · Draft</span>
          <h2>Code draws the sheet</h2>
          <p>A deterministic engine reads your installed KiCad libraries, places every symbol on the 1.27 mm grid and writes the .kicad_sch. Same intent, same bytes.</p>
        </div>
        <div>
          <span className="label">3 · Judge</span>
          <h2>KiCad checks it</h2>
          <p>kicad-cli runs ERC and exports the drawing. Findings are marked on the sheet with a Fix button, and every revision is diffed in code.</p>
        </div>
      </section>

      <footer className="landing-foot">
        <span>
          Model: Gemma 4 (gemma-4-31b-it) through the Gemini API,{" "}
          <a href="https://ai.google.dev/gemma/apache_2">Apache 2.0</a>.
        </span>
        <span>
          The intent-then-deterministic-draft idea is credited to <a href="https://github.com/copperheadhq/copperhead">Copperhead</a>.
        </span>
      </footer>
    </main>
  );
}
