// generate and revise: prompt in, validated intent out. One retry on validation failure.
import { catalogueText, Finding, Intent, SymbolLibrary } from "../engine";
import { isCataloguePart } from "../engine/catalogue";
import type { LibraryIndex } from "../engine/library-index";
import { applyOps, OPS_HELP, OpsSchema } from "../ops";
import { repair, Repair } from "../engine/repair";
import { validate } from "../engine/validate";
import { addUsage, ModelProvider, ModelUsage, NO_USAGE } from "./provider";

const EXAMPLE = {
  version: 1,
  title: "5 V power indicator",
  parts: [
    { ref: "J1", libId: "Connector_Generic:Conn_01x02", value: "5V_IN", group: "input" },
    { ref: "R1", libId: "Device:R", value: "1k", group: "indicator" },
    { ref: "D1", libId: "Device:LED", value: "GREEN", group: "indicator" },
  ],
  nets: [
    { name: "+5V", pins: ["J1.1", "R1.1"] },
    { name: "LED_A", pins: ["R1.2", "D1.2"] },
    { name: "GND", pins: ["D1.1", "J1.2"] },
  ],
  noConnect: [],
  hints: { groupOrder: ["input", "indicator"] },
};

export function systemPrompt(lib: SymbolLibrary, found: string[] = []): string {
  return `You are a hardware engineer. You describe a circuit as a JSON "intent". A program draws the KiCad schematic from it, so you never write coordinates, wires or symbols.

OUTPUT
Return exactly one JSON object and nothing else: no prose, no markdown fence.

SHAPE
{ "version": 1, "title": string,
  "parts": [{ "ref": "U1", "libId": "Library:Symbol", "value": string, "group": string }],
  "nets":  [{ "name": string, "pins": ["U1.3", "C1.1"] }],
  "noConnect": ["J2.2"],
  "hints": { "groupOrder": [string] } }

RULES
1. Prefer libIds from the catalogue below, spelled exactly. If the request needs a part that is not listed, you may use any other single-unit symbol from the standard KiCad libraries by its exact "Library:Symbol" id and its real pin numbers; the validator will correct you if it does not exist. Never use multi-unit symbols (dual or quad op-amps, logic gates).
2. ref = the catalogue ref prefix plus a number (R1, R2, C1). Every ref is unique.
3. A pin is "REF.NUMBER" using the pin numbers from the catalogue, never pin names.
4. Every pin of every part appears in exactly one net, or in noConnect. No pin appears twice. Pins of type no_connect and unused mounting pins go in noConnect.
5. Name supply rails after KiCad power symbols: GND, +5V, +3V3, +12V, +9V, VCC, VBUS, +BATT. Other nets get short upper-case names like VIN or LED_A.
6. Power symbols are drawn for you. Never list a power: symbol as a part.
7. group is a short lower-case block name (input, regulator, output). hints.groupOrder lists the groups left to right in signal-flow order. List parts in signal-flow order too (input connector, input capacitor, regulator, output capacitor, output connector): they are drawn left to right in that order and joined with wires.
8. value is the component value (10uF, 330, 1k) or, for connectors and switches, a short function name.
9. Good practice: a regulator needs a capacitor from its input to GND and from its output to GND; every LED needs a series resistor; a regulator's input and output must be different nets. The AMS1117 datasheet asks for 22uF on the output; the MIC5317 needs 1uF on input and output.

CATALOGUE
${catalogueText(lib, found)}

EXAMPLE (a different circuit, for the format only)
${JSON.stringify(EXAMPLE)}`;
}

/** Pull the JSON object out of a model reply that may be fenced or have stray prose around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error("no JSON object in the reply");
  return JSON.parse(body.slice(a, b + 1));
}

export interface IntentCall {
  ok: boolean;
  intent?: Intent;
  /** Validation findings of the last attempt when ok is false. */
  findings: Finding[];
  /** 1, or 2 when the first answer failed validation. */
  attempts: number;
  /** For a revision: how many edit operations the model returned (undefined if it sent a whole intent). */
  ops?: number;
  /** Structural problems that code settled so the sheet could be drawn. Shown to the engineer as warnings. */
  repairs?: Repair[];
  usage: ModelUsage;
  ms: number;
}

/** `current` is set for a revision: the model may then answer with edit operations instead of a whole intent. */
async function callForIntent(provider: ModelProvider, lib: SymbolLibrary, user: string, found: string[], index?: LibraryIndex, current?: Intent): Promise<IntentCall> {
  const system = systemPrompt(lib, found);
  let usage = NO_USAGE;
  let ms = 0;
  let findings: Finding[] = [];
  let prompt = user;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await provider.complete({ system, user: prompt });
    usage = addUsage(usage, reply.usage);
    ms += reply.ms;
    let candidate: unknown;
    try {
      candidate = extractJson(reply.text);
    } catch (e) {
      findings = [{ id: 1, code: "schema", message: `reply is not valid JSON: ${e instanceof Error ? e.message : e}` }];
      candidate = undefined;
    }
    let ops: number | undefined;
    if (candidate !== undefined && current && typeof candidate === "object" && candidate !== null && "ops" in candidate) {
      // Edit operations: apply them in code to the current intent, then validate the result as usual.
      const parsed = OpsSchema.safeParse(candidate);
      if (!parsed.success) {
        findings = parsed.error.issues.map((issue, i) => ({ id: i + 1, code: "schema" as const, message: `${issue.path.join(".")}: ${issue.message}` }));
        candidate = undefined;
      } else {
        try {
          ops = parsed.data.ops.length;
          candidate = applyOps(current, parsed.data.ops);
        } catch (e) {
          findings = [{ id: 1, code: "schema", message: e instanceof Error ? e.message : String(e) }];
          candidate = undefined;
        }
      }
    }
    if (candidate !== undefined) {
      const v = validate(candidate, lib, index);
      if (v.ok) return { ok: true, intent: v.intent, findings: [], attempts: attempt, ops, usage, ms };
      findings = v.findings;
      // Draft it and flag it: unused pins need no second model call, and after the retry anything
      // code can settle is settled rather than refusing to draw.
      const onlyUnusedPins = findings.every((f) => f.code === "pin_unassigned");
      if (onlyUnusedPins || attempt === 2) {
        const fixed = repair(candidate, lib);
        if (fixed) return { ok: true, intent: fixed.intent, findings: [], attempts: attempt, ops, repairs: fixed.repairs, usage, ms };
      }
    }
    prompt = `${user}

Your previous answer was rejected by the validator. Fix every finding and return ${current ? "the full corrected list of ops (they are applied to the CURRENT INTENT above, not to your previous answer)" : "the full corrected intent"}.
FINDINGS
${findings.map((f) => `${f.id}. ${f.message}`).join("\n")}
PREVIOUS ANSWER
${reply.text}`;
  }
  return { ok: false, findings, attempts: 2, usage, ms };
}

/** Symbols in the installed libraries that fit the words of a request. */
function lookUp(index: LibraryIndex | undefined, text: string): string[] {
  return index ? index.search(text, 10).map((e) => e.id) : [];
}

export function generateIntent(provider: ModelProvider, lib: SymbolLibrary, request: string, index?: LibraryIndex): Promise<IntentCall> {
  return callForIntent(provider, lib, `CIRCUIT REQUEST\n${request}`, lookUp(index, request), index);
}

export function reviseIntent(
  provider: ModelProvider,
  lib: SymbolLibrary,
  current: Intent,
  change: string,
  index?: LibraryIndex,
): Promise<IntentCall> {
  // Keep the pin tables of the parts already on the sheet, and look up anything the change names.
  const inUse = current.parts.map((p) => p.libId).filter((id) => !isCataloguePart(id));
  return callForIntent(
    provider,
    lib,
    `CURRENT INTENT
${JSON.stringify(current)}

CHANGE REQUEST
${change}

For a change request do not return the whole intent. ${OPS_HELP}`,
    [...new Set([...inUse, ...lookUp(index, change)])],
    index,
    current,
  );
}
