// Intent in, schematic out. Deterministic, no model calls.
import { buildPart, netLookup, netsNeedingFlag } from "./connect";
import { emit, Layout } from "./emit";
import { groupOrder, Intent } from "./intent";
import { place } from "./place";
import { SymbolLibrary } from "./symbols";
import { Finding, validate } from "./validate";

export type DraftResult =
  | { ok: true; intent: Intent; sch: string; layout: Layout }
  | { ok: false; findings: Finding[] };

export interface DraftOptions {
  /** Add a PWR_FLAG to each undriven power net. On by default. */
  powerFlags?: boolean;
}

export function draft(input: unknown, lib: SymbolLibrary, options: DraftOptions = {}): DraftResult {
  const v = validate(input, lib);
  if (!v.ok) return v;
  const intent = v.intent;

  const netOf = netLookup(intent);
  const geoms = intent.parts.map((p) => buildPart(p, lib.get(p.libId), (pin) => netOf(p.ref, pin), lib));
  const byRef = new Map(geoms.map((g) => [g.ref, g]));
  const columns = groupOrder(intent).map((group) =>
    intent.parts.filter((p) => p.group === group).map((p) => byRef.get(p.ref)!),
  );
  const origins = place(columns);
  const flagNets = options.powerFlags === false ? [] : netsNeedingFlag(intent, lib);
  const { sch, layout } = emit(intent, geoms, origins, flagNets, lib);
  return { ok: true, intent, sch, layout };
}

export { SymbolLibrary } from "./symbols";
export { catalogueText, missingIds } from "./catalogue";
export type { Intent } from "./intent";
export type { Finding } from "./validate";
export type { Layout } from "./emit";
