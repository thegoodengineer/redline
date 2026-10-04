// Intent in, schematic out. Deterministic, no model calls.
import { buildPart, netLookup, netsNeedingFlag } from "./connect";
import { emit, Layout } from "./emit";
import { groupOrder, Intent } from "./intent";
import { place } from "./place";
import { layoutWired, routeWires } from "./wired";
import { powerSymbolFor } from "./catalogue";
import { SymbolLibrary } from "./symbols";
import { Finding, validate } from "./validate";

export type DraftResult =
  | { ok: true; intent: Intent; sch: string; layout: Layout }
  | { ok: false; findings: Finding[] };

export interface DraftOptions {
  /** Add a PWR_FLAG to each undriven power net. On by default. */
  powerFlags?: boolean;
  /** Overrides hints.wiring. Wires fall back to labels when a net cannot be routed. */
  wiring?: "wires" | "labels";
}

export function draft(input: unknown, lib: SymbolLibrary, options: DraftOptions = {}): DraftResult {
  const v = validate(input, lib);
  if (!v.ok) return v;
  const intent = v.intent;

  const netOf = netLookup(intent);
  const allFlags = options.powerFlags === false ? [] : netsNeedingFlag(intent, lib);

  // Wires suit small parts in a row. A sheet with a big part (a microcontroller, a module) or many
  // parts reads better with net labels, so that is the automatic choice there.
  const busy = intent.parts.length > 10 || intent.parts.some((p) => lib.get(p.libId).pins.length > 8);
  if ((options.wiring ?? intent.hints.wiring ?? (busy ? "labels" : "wires")) === "wires") {
    // Rails keep their flag in the island row; other undriven nets get the flag on their wire.
    const wired = layoutWired(intent, lib, netOf);
    const wiring = routeWires(intent, wired.geoms, wired.origins, lib, allFlags.filter((n) => !powerSymbolFor(n, lib)));
    if (wiring) {
      const out = emit(intent, wired.geoms, wired.origins, allFlags.filter((n) => powerSymbolFor(n, lib)), lib, wiring);
      return { ok: true, intent, sch: out.sch, layout: out.layout };
    }
  }
  const geoms = intent.parts.map((p) => buildPart(p, lib.get(p.libId), (pin) => netOf(p.ref, pin), lib));
  const byRef = new Map(geoms.map((g) => [g.ref, g]));
  const columns = groupOrder(intent).map((group) =>
    intent.parts.filter((p) => p.group === group).map((p) => byRef.get(p.ref)!),
  );
  const origins = place(columns);
  const { sch, layout } = emit(intent, geoms, origins, allFlags, lib);
  return { ok: true, intent, sch, layout };
}

export { SymbolLibrary } from "./symbols";
export { catalogueText, missingIds } from "./catalogue";
export type { Intent } from "./intent";
export type { Finding } from "./validate";
export type { Layout } from "./emit";
