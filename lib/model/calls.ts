// generate and revise: prompt in, validated intent out. One retry on validation failure.
import { catalogueText, Finding, Intent, SymbolLibrary } from "../engine";
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

export function systemPrompt(lib: SymbolLibrary): string {
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
1. Use only libIds from the catalogue below, spelled exactly.
2. ref = the catalogue ref prefix plus a number (R1, R2, C1). Every ref is unique.
3. A pin is "REF.NUMBER" using the pin numbers from the catalogue, never pin names.
4. Every pin of every part appears in exactly one net, or in noConnect. No pin appears twice.
5. Name the rails exactly GND, +5V and +3V3. Other nets get short upper-case names like VIN or LED_A.
6. Power symbols are drawn for you. Never list a power: symbol as a part.
7. group is a short lower-case block name (input, regulator, output). hints.groupOrder lists the groups left to right in signal-flow order.
8. value is the component value (10uF, 330, 1k) or, for connectors and switches, a short function name.
9. Good practice: a regulator needs a capacitor from its input to GND and from its output to GND; every LED needs a series resistor; a regulator's input and output must be different nets. The AMS1117 datasheet asks for 22uF on the output.

CATALOGUE
${catalogueText(lib)}

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
  usage: ModelUsage;
  ms: number;
}

async function callForIntent(provider: ModelProvider, lib: SymbolLibrary, user: string): Promise<IntentCall> {
  const system = systemPrompt(lib);
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
    if (candidate !== undefined) {
      const v = validate(candidate, lib);
      if (v.ok) return { ok: true, intent: v.intent, findings: [], attempts: attempt, usage, ms };
      findings = v.findings;
    }
    prompt = `${user}

Your previous answer was rejected by the validator. Fix every finding and return the full corrected intent.
FINDINGS
${findings.map((f) => `${f.id}. ${f.message}`).join("\n")}
PREVIOUS ANSWER
${reply.text}`;
  }
  return { ok: false, findings, attempts: 2, usage, ms };
}

export function generateIntent(provider: ModelProvider, lib: SymbolLibrary, request: string): Promise<IntentCall> {
  return callForIntent(provider, lib, `CIRCUIT REQUEST\n${request}`);
}

export function reviseIntent(
  provider: ModelProvider,
  lib: SymbolLibrary,
  current: Intent,
  change: string,
): Promise<IntentCall> {
  return callForIntent(
    provider,
    lib,
    `CURRENT INTENT
${JSON.stringify(current)}

CHANGE REQUEST
${change}

Return the full revised intent. Keep every part, ref, value and net that the change does not affect exactly as it is.`,
  );
}
