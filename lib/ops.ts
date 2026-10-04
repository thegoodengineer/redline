// Small edits. For a change request the model returns a short list of
// operations instead of the whole design, and code applies them. Anything the
// operations do not mention cannot change.
import { z } from "zod";
import type { Intent } from "./engine";

const REF = z.string().regex(/^[A-Z]+[0-9]+$/, 'ref must look like "U1"');
const PIN = z.string().regex(/^[A-Z]+[0-9]+\.[A-Za-z0-9+~_-]+$/, 'pin must look like "U1.3"');
const NET = z.string().regex(/^[A-Za-z0-9+_~/-]+$/, "net name has unsupported characters").max(24);

export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_part"), ref: REF, libId: z.string().min(3), value: z.string().min(1).max(40), group: z.string().min(1).max(40), after: REF.optional() }).strict(),
  z.object({ op: z.literal("remove_part"), ref: REF }).strict(),
  z.object({ op: z.literal("set_value"), ref: REF, value: z.string().min(1).max(40) }).strict(),
  z.object({ op: z.literal("set_symbol"), ref: REF, libId: z.string().min(3) }).strict(),
  z.object({ op: z.literal("connect"), net: NET, pins: z.array(PIN).min(1) }).strict(),
  z.object({ op: z.literal("no_connect"), pins: z.array(PIN).min(1) }).strict(),
  z.object({ op: z.literal("rename_net"), from: NET, to: NET }).strict(),
  z.object({ op: z.literal("set_title"), title: z.string().min(1).max(80) }).strict(),
]);
export type Op = z.infer<typeof OpSchema>;
export const OpsSchema = z.object({ ops: z.array(OpSchema).min(1).max(80) }).strict();

export const OPS_HELP = `Return {"ops": [ ... ]} with only the operations needed, applied in order:
- {"op":"add_part","ref":"R5","libId":"Device:R","value":"10k","group":"output","after":"R4"}   ("after" is optional: draw it right after that part)
- {"op":"remove_part","ref":"C2"}                      (its pins leave their nets)
- {"op":"set_value","ref":"C1","value":"22uF"}
- {"op":"set_symbol","ref":"U1","libId":"Regulator_Linear:LM7805_TO220"}   (then reconnect its pins with "connect")
- {"op":"connect","net":"+5V","pins":["R5.1","U1.3"]}  (moves each pin onto that net, creating the net if needed)
- {"op":"no_connect","pins":["J2.2"]}
- {"op":"rename_net","from":"VIN","to":"+12V"}
- {"op":"set_title","title":"New title"}
Every pin of a part you add must end up in a net or in no_connect. Do not repeat anything that stays the same.`;

/** Apply operations to an intent. Throws with a message the model can act on if an operation makes no sense. */
export function applyOps(current: Intent, ops: Op[]): Intent {
  const intent: Intent = JSON.parse(JSON.stringify(current));
  const detach = (pin: string) => {
    for (const net of intent.nets) net.pins = net.pins.filter((p) => p !== pin);
    intent.noConnect = intent.noConnect.filter((p) => p !== pin);
  };
  const detachPart = (ref: string) => {
    for (const net of intent.nets) net.pins = net.pins.filter((p) => !p.startsWith(`${ref}.`));
    intent.noConnect = intent.noConnect.filter((p) => !p.startsWith(`${ref}.`));
  };
  const find = (ref: string, op: string) => {
    const part = intent.parts.find((p) => p.ref === ref);
    if (!part) throw new Error(`${op}: there is no part ${ref}`);
    return part;
  };

  ops.forEach((o, i) => {
    const n = `op ${i + 1} (${o.op})`;
    switch (o.op) {
      case "add_part": {
        if (intent.parts.some((p) => p.ref === o.ref)) throw new Error(`${n}: ref ${o.ref} already exists`);
        const part = { ref: o.ref, libId: o.libId, value: o.value, group: o.group };
        const at = o.after ? intent.parts.findIndex((p) => p.ref === o.after) : -1;
        if (at >= 0) intent.parts.splice(at + 1, 0, part);
        else intent.parts.push(part);
        break;
      }
      case "remove_part":
        find(o.ref, n);
        intent.parts = intent.parts.filter((p) => p.ref !== o.ref);
        detachPart(o.ref);
        break;
      case "set_value":
        find(o.ref, n).value = o.value;
        break;
      case "set_symbol":
        // A different symbol has different pins, so the old connections are dropped.
        find(o.ref, n).libId = o.libId;
        detachPart(o.ref);
        break;
      case "connect": {
        for (const pin of o.pins) detach(pin);
        let net = intent.nets.find((x) => x.name === o.net);
        if (!net) intent.nets.push((net = { name: o.net, pins: [] }));
        net.pins.push(...o.pins.filter((p) => !net!.pins.includes(p)));
        break;
      }
      case "no_connect":
        for (const pin of o.pins) {
          detach(pin);
          intent.noConnect.push(pin);
        }
        break;
      case "rename_net": {
        const net = intent.nets.find((x) => x.name === o.from);
        if (!net) throw new Error(`${n}: there is no net ${o.from}`);
        const target = intent.nets.find((x) => x.name === o.to);
        if (target && target !== net) {
          target.pins.push(...net.pins);
          intent.nets = intent.nets.filter((x) => x !== net);
        } else net.name = o.to;
        break;
      }
      case "set_title":
        intent.title = o.title;
        break;
    }
  });

  intent.nets = intent.nets.filter((net) => net.pins.length > 0);
  const groups = new Set(intent.parts.map((p) => p.group));
  intent.hints.groupOrder = [...intent.hints.groupOrder.filter((g) => groups.has(g)), ...[...groups].filter((g) => !intent.hints.groupOrder.includes(g))];
  return intent;
}
