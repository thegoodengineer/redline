// Model-call logic with a scripted provider: no network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diffIntent } from "../lib/diff";
import { Intent } from "../lib/engine";
import { extractJson, generateIntent, reviseIntent, systemPrompt } from "../lib/model/calls";
import { ModelProvider } from "../lib/model/provider";
import { checkRules } from "../lib/rules";
import { symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const good: Intent = JSON.parse(readFileSync("examples/reg-3v3.intent.json", "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function scripted(replies: string[]): ModelProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    model: "scripted",
    prompts,
    async complete({ user }) {
      prompts.push(user);
      const text = replies.shift();
      if (text === undefined) throw new Error("no more scripted replies");
      return { text, ms: 5, usage: { promptTokens: 100, outputTokens: 50, thoughtTokens: 10, totalTokens: 160 } };
    },
  };
}

describe("extractJson", () => {
  it("reads fenced, bare and prose-wrapped JSON", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
    expect(extractJson('Here you go:\n{"a": {"b": 2}}\nDone.')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("sorry, no")).toThrow();
  });
});

describe("model calls", () => {
  it("puts the generated catalogue in the system prompt", () => {
    const s = systemPrompt(lib);
    expect(s).toContain("Regulator_Linear:AMS1117-3.3 | U |");
    expect(s).toContain("3=VI:power_in");
  });

  it("accepts a valid first answer", async () => {
    const p = scripted(["```json\n" + JSON.stringify(good) + "\n```"]);
    const r = await generateIntent(p, lib, "5 V to 3.3 V");
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.usage.totalTokens).toBe(160);
  });

  it("retries once with the numbered findings, and sums usage", async () => {
    const bad = clone(good);
    bad.nets[2].pins = bad.nets[2].pins.filter((x) => x !== "J2.2");
    bad.nets[1].pins.push("J1.1"); // a pin on two nets needs the model's judgement, so it gets a retry
    const p = scripted([JSON.stringify(bad), JSON.stringify(good)]);
    const r = await generateIntent(p, lib, "5 V to 3.3 V");
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.usage.totalTokens).toBe(320);
    expect(p.prompts[1]).toContain("J2.2 is in no net and not in noConnect");
    expect(p.prompts[1]).toContain("J1.1 is in both +5V and +3V3");
  });

  it("drafts and flags instead of refusing when code can settle the problems", async () => {
    // unused pin: repaired at once, with no second model call
    const unused = clone(good);
    unused.nets[2].pins = unused.nets[2].pins.filter((x) => x !== "J2.2");
    const p1 = scripted([JSON.stringify(unused)]);
    const r1 = await generateIntent(p1, lib, "5 V to 3.3 V");
    expect(r1.ok).toBe(true);
    expect(r1.attempts).toBe(1);
    expect(r1.intent!.noConnect).toEqual(["J2.2"]);
    expect(r1.repairs!.map((r) => r.message)).toEqual(["J2: 1 pin the model did not mention was marked no-connect (2)"]);

    // a pin on two nets: the model gets its retry first, then code keeps the first net
    const twice = clone(good);
    twice.nets[1].pins.push("J1.1", "Q9.1", "U1.7");
    const p2 = scripted([JSON.stringify(twice), JSON.stringify(twice)]);
    const r2 = await generateIntent(p2, lib, "5 V to 3.3 V");
    expect(r2.ok).toBe(true);
    expect(r2.attempts).toBe(2);
    expect(r2.intent!.nets.find((n) => n.name === "+3V3")!.pins).toEqual(good.nets[1].pins);
    expect(r2.repairs!.map((r) => r.message)).toEqual([
      "J1.1 was on both +5V and +3V3; it was kept on +5V",
      "Q9.1 was dropped from +3V3: there is no part Q9",
      "U1.7 was dropped from +3V3: U1 has no pin 7",
    ]);
  });

  it("still refuses a symbol that does not exist", async () => {
    const bad = clone(good);
    bad.parts[2].libId = "Regulator_Linear:NoSuchRegulator";
    const p = scripted([JSON.stringify(bad), JSON.stringify(bad)]);
    const r = await generateIntent(p, lib, "anything");
    expect(r.ok).toBe(false);
    expect(r.findings[0].code).toBe("unknown_libid");
  });

  it("gives up after one retry and returns the findings", async () => {
    const p = scripted(["not json", '{"version": 1}']);
    const r = await generateIntent(p, lib, "anything");
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(p.prompts.length).toBe(2);
  });

  it("revise sends the current intent and the change", async () => {
    const p = scripted([JSON.stringify(good)]);
    await reviseIntent(p, lib, good, "make C2 47uF");
    expect(p.prompts[0]).toContain('"ref":"C2"');
    expect(p.prompts[0]).toContain("make C2 47uF");
  });
});

describe("design rules", () => {
  const status = (i: Intent) => Object.fromEntries(checkRules(i, lib).map((r) => [r.rule, r.pass]));

  it("passes the hand-written regulator", () => {
    expect(status(good)).toEqual({ reg_input_cap: true, reg_output_cap: true, reg_rails_differ: true });
  });

  it("fails when the output capacitor is missing", () => {
    const i = clone(good);
    i.parts = i.parts.filter((p) => p.ref !== "C2");
    i.nets.forEach((n) => (n.pins = n.pins.filter((p) => !p.startsWith("C2."))));
    const r = checkRules(i, lib).find((x) => x.rule === "reg_output_cap")!;
    expect(r.pass).toBe(false);
    expect(r.refs).toEqual(["U1"]);
    expect(status(i).reg_input_cap).toBe(true);
  });

  it("fails when input and output share a net", () => {
    const i = clone(good);
    i.nets[0].pins.push(...i.nets[1].pins);
    i.nets.splice(1, 1);
    expect(status(i).reg_rails_differ).toBe(false);
  });

  it("checks every LED for a series resistor", () => {
    const led: Intent = JSON.parse(readFileSync("examples/led-button.intent.json", "utf8"));
    expect(status(led)).toEqual({ led_series_resistor: true });
    const direct = clone(led);
    // LED anode straight on the rail, resistor left dangling on its own net
    direct.nets.find((n) => n.name === "+5V")!.pins.push("D2.2");
    direct.nets.find((n) => n.name === "LED_A")!.pins = ["R1.2"];
    expect(status(direct)).toEqual({ led_series_resistor: false });
    // a switch between the resistor and the LED is still a series path
    const viaSwitch = clone(led);
    viaSwitch.nets = [
      { name: "+5V", pins: ["J1.1", "F1.1", "D1.1", "R1.1", "R2.1", "J2.1"] },
      { name: "A", pins: ["R1.2", "SW1.1"] },
      { name: "B", pins: ["SW1.2", "D2.2"] },
      { name: "GND", pins: ["D2.1", "J1.2", "F1.2", "D1.2", "R2.2"] },
    ];
    viaSwitch.noConnect = ["J2.2"];
    expect(status(viaSwitch)).toEqual({ led_series_resistor: true });
  });
});

describe("diff", () => {
  it("reports nothing for identical intents", () => {
    expect(diffIntent(good, clone(good)).same).toBe(true);
  });

  it("reports added, removed and changed parts and nets", () => {
    const next = clone(good);
    next.parts.find((p) => p.ref === "C2")!.value = "47uF";
    next.parts = next.parts.filter((p) => p.ref !== "J2");
    next.nets.forEach((n) => (n.pins = n.pins.filter((p) => !p.startsWith("J2."))));
    next.parts.push({ ref: "R1", libId: "Device:R", value: "330", group: "output" });
    next.parts.push({ ref: "D1", libId: "Device:LED", value: "GREEN", group: "output" });
    next.nets.find((n) => n.name === "+3V3")!.pins.push("R1.1");
    next.nets.find((n) => n.name === "GND")!.pins.push("D1.1");
    next.nets.push({ name: "LED_A", pins: ["R1.2", "D1.2"] });
    const d = diffIntent(good, next);
    expect(d.added).toEqual(["R1", "D1"]);
    expect(d.removed).toEqual(["J2"]);
    expect(d.changed).toEqual([{ ref: "C2", what: ["value 22uF -> 47uF"] }]);
    expect(d.nets).toEqual({ added: ["LED_A"], removed: [], changed: ["+3V3", "GND"] });
    expect(d.same).toBe(false);
  });
});
