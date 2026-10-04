// A session is a chain of versions: generate makes v1, each revise makes the next.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffIntent, IntentDiff } from "./diff";
import { Finding, Intent, Layout } from "./engine";
import { ErcReport } from "./kicad/cli";
import { generateIntent, IntentCall, reviseIntent } from "./model/calls";
import { ModelProvider, ModelUsage } from "./model/provider";
import { checkRules, RuleResult } from "./rules";
import { libraryIndex, RUNS_DIR, runDraft, symbolLibrary } from "./runs";

export interface Check {
  id: string;
  source: "erc" | "rule";
  status: "pass" | "fail" | "warn";
  type: string;
  message: string;
  refs: string[];
}

export interface VersionMeta {
  session: string;
  version: number;
  kind: "generate" | "revise" | "manual";
  request: string;
  model: string;
  attempts: number;
  /** Edit operations the model returned for this revision. */
  ops?: number;
  /** Set when the engineer undid this change; it is then hidden from the version strip. */
  undone?: boolean;
  usage: ModelUsage;
  ms: number;
  bytes: { intent: number; schematic: number };
  erc: { errors: number; warnings: number; kicadVersion: string };
  checks: Check[];
  diff?: IntentDiff;
}

export type Turn =
  | { ok: true; meta: VersionMeta; intent: Intent; layout: Layout }
  | { ok: false; reason: "validation"; findings: Finding[]; attempts: number; usage: ModelUsage; ms: number };

export function assertSession(session: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(session)) throw new Error(`bad session id "${session}"`);
  return session;
}

export function versionDir(session: string, version: number): string {
  return join(RUNS_DIR, assertSession(session), `v${version}`);
}

export function listVersions(session: string): number[] {
  const dir = join(RUNS_DIR, assertSession(session));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => /^v(\d+)$/.exec(d))
    .filter((m): m is RegExpExecArray => !!m && existsSync(join(dir, m[0], "meta.json")))
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

export function loadIntent(session: string, version: number): Intent {
  return JSON.parse(readFileSync(join(versionDir(session, version), "intent.json"), "utf8"));
}

/** ERC violations and design rules as one list. Refs come from layout.json's UUID map. */
export function buildChecks(erc: ErcReport, layout: Layout, rules: RuleResult[]): Check[] {
  const checks: Check[] = [];
  erc.violations.forEach((v, i) => {
    const refs = [...new Set(v.items.map((item) => layout.uuids[item.uuid]?.ref).filter((r): r is string => !!r))];
    const where = v.items.map((item) => {
      const o = layout.uuids[item.uuid];
      return o ? `${o.ref}${o.pin && o.kind !== "power" && o.kind !== "flag" ? "." + o.pin : ""}${o.net ? ` (${o.net})` : ""}` : item.description;
    });
    checks.push({
      id: `erc-${i + 1}`,
      source: "erc",
      status: v.severity === "error" ? "fail" : "warn",
      type: v.type,
      message: `${v.description}: ${[...new Set(where)].join(", ")}`,
      refs,
    });
  });
  if (!erc.violations.length) {
    checks.push({ id: "erc-clean", source: "erc", status: "pass", type: "erc", message: "ERC: 0 violations", refs: [] });
  }
  rules.forEach((r, i) => {
    checks.push({
      id: `rule-${i + 1}`,
      source: "rule",
      status: r.pass ? "pass" : "fail",
      type: r.rule,
      message: r.message,
      refs: r.refs,
    });
  });
  return checks;
}

async function commit(
  session: string,
  kind: VersionMeta["kind"],
  request: string,
  model: string,
  call: Pick<IntentCall, "attempts" | "usage" | "ms" | "ops"> & { intent: Intent },
  previous?: Intent,
): Promise<Turn> {
  const version = (listVersions(session).at(-1) ?? 0) + 1;
  const run = await runDraft(call.intent, session, version);
  if (!run.ok) return { ok: false, reason: "validation", findings: run.findings, attempts: call.attempts, usage: call.usage, ms: call.ms };
  const meta: VersionMeta = {
    session,
    version,
    kind,
    request,
    model,
    attempts: call.attempts,
    ops: call.ops,
    usage: call.usage,
    ms: call.ms,
    bytes: run.bytes,
    erc: { errors: run.erc.errors, warnings: run.erc.warnings, kicadVersion: run.erc.kicadVersion },
    checks: buildChecks(run.erc, run.layout, checkRules(run.intent, symbolLibrary())),
    diff: previous ? diffIntent(previous, run.intent) : undefined,
  };
  writeFileSync(join(run.dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  return { ok: true, meta, intent: run.intent, layout: run.layout };
}

export async function generate(session: string, request: string, provider: ModelProvider): Promise<Turn> {
  assertSession(session);
  const call = await generateIntent(provider, symbolLibrary(), request, libraryIndex());
  if (!call.ok || !call.intent) {
    return { ok: false, reason: "validation", findings: call.findings, attempts: call.attempts, usage: call.usage, ms: call.ms };
  }
  return commit(session, "generate", request, provider.model, { ...call, intent: call.intent });
}

export async function revise(session: string, fromVersion: number, change: string, provider: ModelProvider): Promise<Turn> {
  const current = loadIntent(session, fromVersion);
  const call = await reviseIntent(provider, symbolLibrary(), current, change, libraryIndex());
  if (!call.ok || !call.intent) {
    return { ok: false, reason: "validation", findings: call.findings, attempts: call.attempts, usage: call.usage, ms: call.ms };
  }
  return commit(session, "revise", change, provider.model, { ...call, intent: call.intent }, current);
}

/** Undo a change: the version stays on disk but is marked and no longer shown. */
export function undoVersion(session: string, version: number): VersionMeta {
  const file = join(versionDir(session, version), "meta.json");
  const meta: VersionMeta = JSON.parse(readFileSync(file, "utf8"));
  if (meta.kind === "generate") throw new Error("The first draft cannot be undone; start a new session instead.");
  meta.undone = true;
  writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

/** Text sent to revise when the user presses "Fix this" on a check. */
export function fixRequest(checks: Check[]): string {
  return `Fix ${checks.length === 1 ? "this finding" : "these findings"} with the smallest change:\n${checks
    .map((c, i) => `${i + 1}. [${c.source === "erc" ? "KiCad ERC" : "design rule"} ${c.type}] ${c.message}`)
    .join("\n")}`;
}
