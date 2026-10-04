// Difference between two intents, computed in code (never by the model).
import { Intent } from "./engine";

export interface IntentDiff {
  added: string[];
  removed: string[];
  /** Parts present in both whose value, symbol, group or connections differ. */
  changed: Array<{ ref: string; what: string[] }>;
  nets: { added: string[]; removed: string[]; changed: string[] };
  same: boolean;
}

export function diffIntent(before: Intent, after: Intent): IntentDiff {
  const a = new Map(before.parts.map((p) => [p.ref, p]));
  const b = new Map(after.parts.map((p) => [p.ref, p]));
  const connections = (intent: Intent) => {
    const m = new Map<string, string[]>();
    const put = (pin: string, net: string) => {
      const ref = pin.split(".")[0];
      m.set(ref, [...(m.get(ref) ?? []), `${pin.slice(ref.length + 1)}=${net}`]);
    };
    for (const n of intent.nets) for (const p of n.pins) put(p, n.name);
    for (const p of intent.noConnect) put(p, "(no connect)");
    for (const v of m.values()) v.sort();
    return m;
  };
  const ca = connections(before);
  const cb = connections(after);

  const changed: IntentDiff["changed"] = [];
  for (const [ref, pb] of b) {
    const pa = a.get(ref);
    if (!pa) continue;
    const what: string[] = [];
    if (pa.libId !== pb.libId) what.push(`symbol ${pa.libId} -> ${pb.libId}`);
    if (pa.value !== pb.value) what.push(`value ${pa.value} -> ${pb.value}`);
    if (pa.group !== pb.group) what.push(`group ${pa.group} -> ${pb.group}`);
    const before = ca.get(ref) ?? [];
    const now = cb.get(ref) ?? [];
    for (const c of now) if (!before.includes(c)) what.push(`pin ${c.replace("=", " now on ")}`);
    if (what.length) changed.push({ ref, what });
  }

  const na = new Map(before.nets.map((n) => [n.name, [...n.pins].sort().join(",")]));
  const nb = new Map(after.nets.map((n) => [n.name, [...n.pins].sort().join(",")]));
  const diff: IntentDiff = {
    added: [...b.keys()].filter((r) => !a.has(r)),
    removed: [...a.keys()].filter((r) => !b.has(r)),
    changed,
    nets: {
      added: [...nb.keys()].filter((n) => !na.has(n)),
      removed: [...na.keys()].filter((n) => !nb.has(n)),
      changed: [...nb.keys()].filter((n) => na.has(n) && na.get(n) !== nb.get(n)),
    },
    same: false,
  };
  diff.same =
    !diff.added.length &&
    !diff.removed.length &&
    !diff.changed.length &&
    !diff.nets.added.length &&
    !diff.nets.removed.length &&
    !diff.nets.changed.length;
  return diff;
}
