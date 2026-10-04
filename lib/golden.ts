// Golden answers: hand-written reference circuits, and a matcher that tells
// whether a model's intent contains one of them. ERC says a sheet is
// electrically consistent; this says it is the circuit that was asked for.
import type { Intent } from "./engine";

export interface GoldenPart {
  /** Name used inside this golden answer only; the model's refs are free. */
  id: string;
  /** Acceptable library symbols. */
  lib: string[];
  /** Optional check on the part value, e.g. /^10\s*k/i, with a sample value that satisfies it. */
  value?: RegExp;
  sample?: string;
}
export interface GoldenNet {
  /** Required net name, used for rails so polarity can be judged. Other nets may have any name. */
  name?: string;
  pins: string[];
}
/** One acceptable circuit. A prompt has one or more of these (variants). */
export interface Golden {
  parts: GoldenPart[];
  nets: GoldenNet[];
}

export interface GoldenResult {
  /** exact: same parts and connections. superset: the golden circuit is all there, plus extra parts. */
  match: "exact" | "superset" | "mismatch";
  variant?: number;
  extraParts: string[];
  reason?: string;
}

/** Two-terminal parts whose pins 1 and 2 are interchangeable. */
const SYMMETRIC = new Set([
  "Device:R",
  "Device:C",
  "Device:Polyfuse",
  "Switch:SW_Push",
  "Connector_Generic:Conn_01x02",
  "Connector_Generic_MountingPin:Conn_01x02_MountingPin",
]);
const swapPin = (pin: string) => (pin === "1" ? "2" : pin === "2" ? "1" : pin);

function matchOne(intent: Intent, golden: Golden): { ok: true; used: string[] } | { ok: false; reason: string } {
  const netOf = new Map<string, string>();
  for (const n of intent.nets) for (const p of n.pins) netOf.set(p, n.name);

  // Which golden nets each golden part touches, by pin.
  const pinsOf = new Map<string, Array<{ pin: string; net: number }>>();
  golden.nets.forEach((n, i) => {
    for (const p of n.pins) {
      const k = p.indexOf(".");
      const id = p.slice(0, k);
      pinsOf.set(id, [...(pinsOf.get(id) ?? []), { pin: p.slice(k + 1), net: i }]);
    }
  });

  const candidates = golden.parts.map((g) => intent.parts.filter((p) => g.lib.includes(p.libId) && (!g.value || g.value.test(p.value))));
  for (const [i, g] of golden.parts.entries()) {
    const need = golden.parts.filter((o) => o.lib.join() === g.lib.join() && String(o.value) === String(g.value)).length;
    if (candidates[i].length < need) {
      const what = g.lib.map((l) => l.split(":")[1]).join(" or ") + (g.value ? ` with value ${g.value.source}` : "");
      return { ok: false, reason: `needs ${need} × ${what}, found ${candidates[i].length}` };
    }
  }

  const used = new Set<string>();
  const toModel = new Map<number, string>(); // golden net -> model net
  const fromModel = new Map<string, number>();
  let deepest = -1;
  let reason = "the parts are present but their connections do not match";

  const tryPart = (i: number): boolean => {
    if (i === golden.parts.length) return true;
    const g = golden.parts[i];
    for (const part of candidates[i]) {
      if (used.has(part.ref)) continue;
      for (const swap of SYMMETRIC.has(part.libId) ? [false, true] : [false]) {
        const added: number[] = [];
        let ok = true;
        for (const { pin, net } of pinsOf.get(g.id) ?? []) {
          const modelPin = `${part.ref}.${swap ? swapPin(pin) : pin}`;
          const modelNet = netOf.get(modelPin);
          const want = golden.nets[net];
          let why: string | undefined;
          if (modelNet === undefined) why = `${modelPin} is not connected`;
          else if (want.name && modelNet !== want.name) why = `${modelPin} is on ${modelNet}, expected ${want.name}`;
          else if (toModel.has(net) && toModel.get(net) !== modelNet) why = `${modelPin} is on ${modelNet}, expected it on ${toModel.get(net)}`;
          else if (!toModel.has(net) && fromModel.has(modelNet)) why = `${modelNet} joins pins that should be on separate nets`;
          if (why) {
            if (i > deepest) {
              deepest = i;
              reason = why;
            }
            ok = false;
            break;
          }
          if (!toModel.has(net)) {
            toModel.set(net, modelNet!);
            fromModel.set(modelNet!, net);
            added.push(net);
          }
        }
        if (ok) {
          used.add(part.ref);
          if (tryPart(i + 1)) return true;
          used.delete(part.ref);
        }
        for (const net of added) {
          fromModel.delete(toModel.get(net)!);
          toModel.delete(net);
        }
      }
    }
    return false;
  };

  return tryPart(0) ? { ok: true, used: [...used] } : { ok: false, reason };
}

/** Compare an intent with the acceptable circuits for its prompt. */
export function matchGolden(intent: Intent, variants: Golden[]): GoldenResult {
  let best: GoldenResult | undefined;
  let reason = "";
  for (const [i, golden] of variants.entries()) {
    const r = matchOne(intent, golden);
    if (!r.ok) {
      reason ||= r.reason;
      continue;
    }
    const extraParts = intent.parts.map((p) => p.ref).filter((ref) => !r.used.includes(ref));
    const result: GoldenResult = { match: extraParts.length ? "superset" : "exact", variant: i, extraParts };
    if (result.match === "exact") return result;
    best ??= result;
  }
  return best ?? { match: "mismatch", extraParts: [], reason };
}

/** A golden circuit written out as an intent, so the validator and KiCad can check the answer key itself. */
export function goldenToIntent(golden: Golden, title: string): Intent {
  let free = 0;
  const ref = new Map(golden.parts.map((p, i) => [p.id, `X${i + 1}`]));
  const pin = (p: string) => `${ref.get(p.slice(0, p.indexOf(".")))}${p.slice(p.indexOf("."))}`;
  return {
    version: 1,
    title,
    parts: golden.parts.map((p) => ({ ref: ref.get(p.id)!, libId: p.lib[0], value: p.sample ?? p.id, group: "golden" })),
    nets: golden.nets.map((n) => ({ name: n.name ?? `N${++free}`, pins: n.pins.map(pin) })),
    noConnect: [],
    hints: { groupOrder: ["golden"] },
  };
}
