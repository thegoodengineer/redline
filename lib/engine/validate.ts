// Structural checks on an intent. Any finding here means nothing is written.
import { isCataloguePart } from "./catalogue";
import { Intent, IntentSchema, splitPin } from "./intent";
import { SymbolLibrary } from "./symbols";

export interface Finding {
  id: number;
  code:
    | "schema"
    | "unknown_libid"
    | "duplicate_ref"
    | "unknown_ref"
    | "unknown_pin"
    | "pin_in_two_nets"
    | "pin_unassigned"
    | "duplicate_net";
  message: string;
  ref?: string;
  pin?: string;
  net?: string;
}

export type ValidateResult = { ok: true; intent: Intent } | { ok: false; findings: Finding[] };

export function validate(input: unknown, lib: SymbolLibrary): ValidateResult {
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "id">) => findings.push({ id: findings.length + 1, ...f });

  const parsed = IntentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add({ code: "schema", message: `${issue.path.join(".") || "(root)"}: ${issue.message}` });
    }
    return { ok: false, findings };
  }
  const intent = parsed.data;

  const pinsOf = new Map<string, Set<string>>();
  for (const part of intent.parts) {
    if (pinsOf.has(part.ref)) {
      add({ code: "duplicate_ref", ref: part.ref, message: `ref ${part.ref} is used by more than one part` });
      continue;
    }
    if (!isCataloguePart(part.libId) || !lib.has(part.libId)) {
      add({
        code: "unknown_libid",
        ref: part.ref,
        message: `${part.ref}: libId "${part.libId}" is not in the catalogue`,
      });
      pinsOf.set(part.ref, new Set());
      continue;
    }
    pinsOf.set(part.ref, new Set(lib.get(part.libId).pins.map((p) => p.number)));
  }
  const badParts = new Set(findings.filter((f) => f.code === "unknown_libid").map((f) => f.ref));

  const seenNet = new Set<string>();
  const where = new Map<string, string>(); // "U1.3" -> net name or "noConnect"
  const use = (p: string, net: string) => {
    const { ref, pin } = splitPin(p);
    const known = pinsOf.get(ref);
    if (!known) {
      add({ code: "unknown_ref", ref, pin, net, message: `${p} in ${net}: no part with ref ${ref}` });
      return;
    }
    if (!badParts.has(ref) && !known.has(pin)) {
      add({
        code: "unknown_pin",
        ref,
        pin,
        net,
        message: `${p} in ${net}: ${ref} has no pin ${pin} (pins: ${[...known].join(", ")})`,
      });
      return;
    }
    const prev = where.get(p);
    if (prev !== undefined) {
      add({ code: "pin_in_two_nets", ref, pin, net, message: `${p} is in both ${prev} and ${net}` });
      return;
    }
    where.set(p, net);
  };

  for (const net of intent.nets) {
    if (seenNet.has(net.name)) {
      add({ code: "duplicate_net", net: net.name, message: `net ${net.name} is listed more than once` });
    }
    seenNet.add(net.name);
    for (const p of net.pins) use(p, net.name);
  }
  for (const p of intent.noConnect) use(p, "noConnect");

  for (const part of intent.parts) {
    if (badParts.has(part.ref)) continue;
    for (const pin of pinsOf.get(part.ref) ?? []) {
      if (!where.has(`${part.ref}.${pin}`)) {
        add({
          code: "pin_unassigned",
          ref: part.ref,
          pin,
          message: `${part.ref}.${pin} is in no net and not in noConnect`,
        });
      }
    }
  }

  return findings.length ? { ok: false, findings } : { ok: true, intent };
}
