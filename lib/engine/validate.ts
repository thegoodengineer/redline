// Structural checks on an intent. Any finding here means nothing is written.
import { pinTable, unusableReason } from "./catalogue";
import type { LibraryIndex } from "./library-index";
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
    | "stacked_pins"
    | "duplicate_net";
  message: string;
  ref?: string;
  pin?: string;
  net?: string;
}

export type ValidateResult = { ok: true; intent: Intent } | { ok: false; findings: Finding[] };

/** `index` is optional; with it, a finding about an unknown symbol names the closest real ones and their pins. */
export function validate(input: unknown, lib: SymbolLibrary, index?: LibraryIndex): ValidateResult {
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
  const libOf = new Map<string, string>();
  for (const part of intent.parts) {
    if (pinsOf.has(part.ref)) {
      add({ code: "duplicate_ref", ref: part.ref, message: `ref ${part.ref} is used by more than one part` });
      continue;
    }
    const why = unusableReason(part.libId, lib);
    if (why) {
      const close = (index?.suggest(part.libId) ?? []).filter((e) => unusableReason(e.id, lib) === null);
      add({
        code: "unknown_libid",
        ref: part.ref,
        message:
          `${part.ref}: libId "${part.libId}" cannot be used: ${why}` +
          (close.length ? `. Closest symbols: ${close.map((e) => `${e.id} [${pinTable(e.id, lib)}]`).join("; ")}` : ""),
      });
      pinsOf.set(part.ref, new Set());
      continue;
    }
    pinsOf.set(part.ref, new Set(lib.get(part.libId).pins.map((p) => p.number)));
    libOf.set(part.ref, part.libId);
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
        message: `${p} in ${net}: ${ref} has no pin ${pin}. ${libOf.get(ref)} pins are ${pinTable(libOf.get(ref)!, lib)}`,
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

  // Pins drawn on top of each other in the symbol are one point on the sheet, so they must share a net.
  for (const part of intent.parts) {
    if (badParts.has(part.ref) || !libOf.has(part.ref)) continue;
    const at = new Map<string, string[]>();
    for (const p of lib.get(part.libId).pins) at.set(`${p.x},${p.y}`, [...(at.get(`${p.x},${p.y}`) ?? []), p.number]);
    for (const stack of at.values()) {
      const nets = new Set(stack.map((n) => where.get(`${part.ref}.${n}`)));
      if (stack.length > 1 && nets.size > 1) {
        add({
          code: "stacked_pins",
          ref: part.ref,
          message: `${part.ref} pins ${stack.join(", ")} are drawn at the same point in the symbol and must all be on the same net`,
        });
      }
    }
  }

  return findings.length ? { ok: false, findings } : { ok: true, intent };
}
