// Draft it and flag it. When the model's intent has structural problems that
// code can settle on its own, repair them and say exactly what was done, so
// the engineer gets a sheet to correct instead of a refusal.
import { unusableReason } from "./catalogue";
import { Intent, IntentSchema, splitPin } from "./intent";
import { SymbolLibrary } from "./symbols";
import { validate } from "./validate";

export interface Repair {
  message: string;
  refs: string[];
}

/** Returns the repaired intent and what was changed, or null when it cannot be made drawable. */
export function repair(input: unknown, lib: SymbolLibrary): { intent: Intent; repairs: Repair[] } | null {
  const parsed = IntentSchema.safeParse(input);
  if (!parsed.success) return null;
  const intent = parsed.data;
  const repairs: Repair[] = [];

  // Parts: a symbol that does not exist cannot be drawn; a repeated ref keeps its first part.
  const pinsOf = new Map<string, Set<string>>();
  const parts: Intent["parts"] = [];
  for (const part of intent.parts) {
    if (unusableReason(part.libId, lib)) return null;
    if (pinsOf.has(part.ref)) {
      repairs.push({ message: `${part.ref} was listed twice; the second one (${part.value}) was dropped`, refs: [part.ref] });
      continue;
    }
    pinsOf.set(part.ref, new Set(lib.get(part.libId).pins.map((p) => p.number)));
    parts.push(part);
  }

  // Nets: merge repeated names, drop pins that do not exist, keep a pin on the first net that claims it.
  const where = new Map<string, string>();
  const nets = new Map<string, string[]>();
  for (const net of intent.nets) {
    const pins = nets.get(net.name) ?? [];
    nets.set(net.name, pins);
    for (const p of net.pins) {
      const { ref, pin } = splitPin(p);
      if (!pinsOf.has(ref)) {
        repairs.push({ message: `${p} was dropped from ${net.name}: there is no part ${ref}`, refs: [] });
      } else if (!pinsOf.get(ref)!.has(pin)) {
        repairs.push({ message: `${p} was dropped from ${net.name}: ${ref} has no pin ${pin}`, refs: [ref] });
      } else if (where.has(p)) {
        if (where.get(p) !== net.name) repairs.push({ message: `${p} was on both ${where.get(p)} and ${net.name}; it was kept on ${where.get(p)}`, refs: [ref] });
      } else {
        where.set(p, net.name);
        pins.push(p);
      }
    }
  }

  const noConnect: string[] = [];
  for (const p of intent.noConnect) {
    const { ref, pin } = splitPin(p);
    if (pinsOf.get(ref)?.has(pin) && !where.has(p)) {
      where.set(p, "noConnect");
      noConnect.push(p);
    }
  }

  // Pins the model never mentioned are marked unused, one note per part.
  for (const part of parts) {
    const unused = [...pinsOf.get(part.ref)!].filter((pin) => !where.has(`${part.ref}.${pin}`));
    if (!unused.length) continue;
    for (const pin of unused) noConnect.push(`${part.ref}.${pin}`);
    repairs.push({
      message: `${part.ref}: ${unused.length} pin${unused.length === 1 ? "" : "s"} the model did not mention ${unused.length === 1 ? "was" : "were"} marked no-connect (${unused.join(", ")})`,
      refs: [part.ref],
    });
  }

  const repaired: Intent = {
    ...intent,
    parts,
    nets: [...nets].filter(([, pins]) => pins.length > 0).map(([name, pins]) => ({ name, pins })),
    noConnect,
  };
  const check = validate(repaired, lib);
  return check.ok ? { intent: check.intent, repairs } : null;
}
