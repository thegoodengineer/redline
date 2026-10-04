import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOLDEN } from "../data/golden";
import { Intent } from "../lib/engine";
import { validate } from "../lib/engine/validate";
import { goldenToIntent, matchGolden } from "../lib/golden";
import { checkRules } from "../lib/rules";
import { symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const prompts: string[] = JSON.parse(readFileSync("data/prompts.json", "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** LED indicator with the model's own choice of refs and net names. */
const led: Intent = {
  version: 1,
  title: "LED",
  parts: [
    { ref: "J7", libId: "Connector_Generic:Conn_01x02", value: "PWR", group: "a" },
    { ref: "R3", libId: "Device:R", value: "330", group: "a" },
    { ref: "D9", libId: "Device:LED", value: "GREEN", group: "a" },
  ],
  nets: [
    { name: "+5V", pins: ["J7.1", "R3.2"] },
    { name: "ANODE", pins: ["R3.1", "D9.2"] },
    { name: "GND", pins: ["D9.1", "J7.2"] },
  ],
  noConnect: [],
  hints: { groupOrder: ["a"] },
};

describe("golden answers", () => {
  it("has one answer set per eval prompt", () => {
    expect(GOLDEN.length).toBe(prompts.length);
    expect(GOLDEN.every((v) => v.length > 0)).toBe(true);
  });

  it("every golden circuit is itself a valid intent that passes the design rules", () => {
    GOLDEN.forEach((variants, i) =>
      variants.forEach((g, k) => {
        const intent = goldenToIntent(g, `prompt ${i + 1} variant ${k + 1}`);
        const v = validate(intent, lib);
        expect(v.ok ? [] : v.findings.map((f) => f.message), `prompt ${i + 1} variant ${k + 1}`).toEqual([]);
        expect(checkRules(intent, lib).filter((r) => !r.pass).map((r) => r.message)).toEqual([]);
      }),
    );
  });

  it("every golden circuit matches itself exactly", () => {
    GOLDEN.forEach((variants, i) => variants.forEach((g) => expect(matchGolden(goldenToIntent(g, "x"), variants).match, `prompt ${i + 1}`).toBe("exact")));
  });

  it("ignores ref names, net names and the order of symmetric pins", () => {
    expect(matchGolden(led, GOLDEN[1])).toMatchObject({ match: "exact", extraParts: [] });
  });

  it("accepts the resistor on the ground side of the LED", () => {
    const low = clone(led);
    low.nets = [
      { name: "+5V", pins: ["J7.1", "D9.2"] },
      { name: "K", pins: ["D9.1", "R3.1"] },
      { name: "GND", pins: ["R3.2", "J7.2"] },
    ];
    expect(matchGolden(low, GOLDEN[1]).match).toBe("exact");
  });

  it("rejects a reversed LED, which ERC would pass", () => {
    const reversed = clone(led);
    reversed.nets[1].pins = ["R3.1", "D9.1"];
    reversed.nets[2].pins = ["D9.2", "J7.2"];
    const r = matchGolden(reversed, GOLDEN[1]);
    expect(r.match).toBe("mismatch");
    expect(r.reason).toBeTruthy();
  });

  it("rejects a missing resistor and names what is missing", () => {
    const direct = clone(led);
    direct.parts = direct.parts.filter((p) => p.ref !== "R3");
    direct.nets = [
      { name: "+5V", pins: ["J7.1", "D9.2"] },
      { name: "GND", pins: ["D9.1", "J7.2"] },
    ];
    expect(matchGolden(direct, GOLDEN[1])).toMatchObject({ match: "mismatch", reason: "needs 1 × R, found 0" });
  });

  it("rejects swapped rails", () => {
    const swapped = clone(led);
    swapped.nets[0].name = "GND";
    swapped.nets[2].name = "+5V";
    expect(matchGolden(swapped, GOLDEN[1]).match).toBe("mismatch");
  });

  it("reports extra parts as a superset, not a mismatch", () => {
    const more = clone(led);
    more.parts.push({ ref: "C1", libId: "Device:C", value: "100n", group: "a" });
    more.nets[0].pins.push("C1.1");
    more.nets[2].pins.push("C1.2");
    expect(matchGolden(more, GOLDEN[1])).toMatchObject({ match: "superset", extraParts: ["C1"] });
  });

  it("checks a value the prompt asked for", () => {
    const button = goldenToIntent(GOLDEN[2][0], "button");
    button.parts.find((p) => p.libId === "Device:R")!.value = "10k";
    expect(matchGolden(button, GOLDEN[2]).match).toBe("exact");
    button.parts.find((p) => p.libId === "Device:R")!.value = "4.7k";
    expect(matchGolden(button, GOLDEN[2]).match).toBe("mismatch");
  });

  it("rejects a regulator whose input and output are shorted", () => {
    const reg = goldenToIntent(GOLDEN[0][0], "reg");
    const input = reg.nets.find((n) => n.name === "+5V")!;
    const output = reg.nets.find((n) => n.name === "+3V3")!;
    input.pins.push(...output.pins);
    reg.nets = reg.nets.filter((n) => n !== output);
    expect(matchGolden(reg, GOLDEN[0]).match).toBe("mismatch");
  });
});
