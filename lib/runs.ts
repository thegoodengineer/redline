// One version of one session on disk: runs/<session>/v<n>/
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { draft, Finding, Intent, Layout, SymbolLibrary } from "./engine";
import { CliResult, ErcReport, exportSvg, locateKicad, runErc } from "./kicad/cli";

export const RUNS_DIR = join(process.cwd(), "runs");

let library: SymbolLibrary | undefined;
export function symbolLibrary(): SymbolLibrary {
  if (!library) library = new SymbolLibrary(locateKicad().symbolDir);
  return library;
}

export type RunResult =
  | {
      ok: true;
      dir: string;
      intent: Intent;
      layout: Layout;
      erc: ErcReport;
      bytes: { intent: number; schematic: number };
      cli: CliResult[];
    }
  | { ok: false; findings: Finding[] };

/** Validate, draft, write the files, then let kicad-cli judge them. Nothing is written if validation fails. */
export async function runDraft(input: unknown, session: string, version: number): Promise<RunResult> {
  const result = draft(input, symbolLibrary());
  if (!result.ok) return result;

  const dir = join(RUNS_DIR, session, `v${version}`);
  mkdirSync(dir, { recursive: true });
  const intentText = JSON.stringify(result.intent, null, 2) + "\n";
  const schPath = join(dir, "design.kicad_sch");
  writeFileSync(join(dir, "intent.json"), intentText);
  writeFileSync(schPath, result.sch);
  writeFileSync(join(dir, "layout.json"), JSON.stringify(result.layout, null, 2) + "\n");

  const erc = await runErc(schPath, join(dir, "erc.json"));
  const svg = await exportSvg(schPath, dir);
  return {
    ok: true,
    dir,
    intent: result.intent,
    layout: result.layout,
    erc: erc.report,
    bytes: { intent: Buffer.byteLength(intentText), schematic: Buffer.byteLength(result.sch) },
    cli: [erc.cli, svg.cli],
  };
}
