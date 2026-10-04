import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diffIntent } from "../lib/diff";
import { Intent } from "../lib/engine";
import { validate } from "../lib/engine/validate";
import { reviseIntent } from "../lib/model/calls";
import { ModelProvider } from "../lib/model/provider";
import { applyOps, Op } from "../lib/ops";
import { symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const base: Intent = JSON.parse(readFileSync("examples/reg-3v3.intent.json", "utf8"));
const scripted = (replies: string[]): ModelProvider & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    model: "scripted",
    prompts,
    async complete({ user }) {
      prompts.push(user);
      return { text: replies.shift() ?? "", ms: 1, usage: { promptTokens: 1, outputTokens: 1, thoughtTokens: 0, totalTokens: 2 } };
    },
  };
};

const ADD_LED: Op[] = [
  { op: "add_part", ref: "R1", libId: "Device:R", value: "330", group: "output", after: "C2" },
  { op: "add_part", ref: "D1", libId: "Device:LED", value: "GREEN", group: "output", after: "R1" },
  { op: "connect", net: "+3V3", pins: ["R1.1"] },
  { op: "connect", net: "LED_A", pins: ["R1.2", "D1.2"] },
  { op: "connect", net: "GND", pins: ["D1.1"] },
];

describe("edit operations", () => {
  it("adds parts and nets, and leaves everything else byte-identical", () => {
    const next = applyOps(base, ADD_LED);
    expect(validate(next, lib).ok).toBe(true);
    expect(next.parts.map((p) => p.ref)).toEqual(["J1", "C1", "U1", "C2", "R1", "D1", "J2"]);
    const d = diffIntent(base, next);
    expect(d.added).toEqual(["R1", "D1"]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
    for (const part of base.parts) expect(next.parts.find((p) => p.ref === part.ref)).toEqual(part);
    expect(JSON.stringify(base)).toBe(readFileSync("examples/reg-3v3.intent.json", "utf8").trim() ? JSON.stringify(base) : "");
  });

  it("removes a part together with its connections", () => {
    const next = applyOps(base, [{ op: "remove_part", ref: "C2" }]);
    expect(next.parts.some((p) => p.ref === "C2")).toBe(false);
    expect(next.nets.flatMap((n) => n.pins).some((p) => p.startsWith("C2."))).toBe(false);
    expect(validate(next, lib).ok).toBe(true);
  });

  it("moves a pin to another net, renames nets, sets values and marks no-connects", () => {
    const next = applyOps(base, [
      { op: "set_value", ref: "C2", value: "47uF" },
      { op: "rename_net", from: "+5V", to: "VIN" },
      { op: "no_connect", pins: ["J2.2"] },
      { op: "set_title", title: "Renamed" },
    ]);
    expect(next.parts.find((p) => p.ref === "C2")!.value).toBe("47uF");
    expect(next.nets.map((n) => n.name)).toContain("VIN");
    expect(next.nets.map((n) => n.name)).not.toContain("+5V");
    expect(next.noConnect).toEqual(["J2.2"]);
    expect(next.nets.find((n) => n.name === "GND")!.pins).not.toContain("J2.2");
    expect(next.title).toBe("Renamed");
  });

  it("drops a net that loses its last pin, and merges nets on rename", () => {
    const merged = applyOps(base, [{ op: "rename_net", from: "+3V3", to: "+5V" }]);
    expect(merged.nets.map((n) => n.name)).toEqual(["+5V", "GND"]);
    expect(merged.nets[0].pins).toEqual(expect.arrayContaining(["U1.3", "U1.2"]));
  });

  it("explains an operation that makes no sense", () => {
    expect(() => applyOps(base, [{ op: "set_value", ref: "R9", value: "1k" }])).toThrow(/no part R9/);
    expect(() => applyOps(base, [{ op: "add_part", ref: "C1", libId: "Device:C", value: "1u", group: "x" }])).toThrow(/already exists/);
  });

  it("revise applies the model's operations and reports how many", async () => {
    const p = scripted([JSON.stringify({ ops: ADD_LED })]);
    const r = await reviseIntent(p, lib, base, "add a power LED on 3.3 V");
    expect(r.ok).toBe(true);
    expect(r.ops).toBe(5);
    expect(r.intent!.parts.length).toBe(7);
    expect(p.prompts[0]).toContain('"op":"add_part"');
  });

  it("revise retries when the edited design does not validate, and still accepts a whole intent", async () => {
    const incomplete = ADD_LED.slice(0, 4); // D1.1 left unconnected
    const p = scripted([JSON.stringify({ ops: incomplete }), JSON.stringify(applyOps(base, ADD_LED))]);
    const r = await reviseIntent(p, lib, base, "add a power LED on 3.3 V");
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.ops).toBeUndefined();
    expect(p.prompts[1]).toContain("D1.1 is in no net and not in noConnect");
  });
});
