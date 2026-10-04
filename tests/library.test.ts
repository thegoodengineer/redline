// Using parts beyond the core catalogue: the library index, the validator and the engine.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draft } from "../lib/engine";
import { catalogueText, powerSymbolFor, unusableReason } from "../lib/engine/catalogue";
import { child, children, parse, text } from "../lib/engine/sexp";
import { validate } from "../lib/engine/validate";
import { systemPrompt } from "../lib/model/calls";
import { libraryIndex, symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const index = libraryIndex();
const load = (name: string) => JSON.parse(readFileSync(`examples/${name}.intent.json`, "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const ids = (q: string) => index.search(q, 8).map((e) => e.id);

describe("library index", () => {
  it("indexes the installed libraries", () => {
    expect(index.entries.length).toBeGreaterThan(10000);
    expect(index.get("Timer:NE555P")).toMatchObject({ lib: "Timer", pins: 8, units: 1 });
  });

  it("finds parts by part number", () => {
    expect(ids("NE555 astable LED blinker from 9 V on a 2-pin connector")).toEqual(["Timer:NE555D", "Timer:NE555P"]);
    expect(ids("ATmega328P-A minimal board")[0]).toBe("MCU_Microchip_ATmega:ATmega328P-A");
    expect(ids("an LM7805 regulator")).toContain("Regulator_Linear:LM7805_TO220");
    expect(ids("MIC5317-3.3YM5-TR regulator")).toContain("Regulator_Linear:MIC5317-3.3xM5");
  });

  it("finds generic parts by a word of their name", () => {
    expect(ids("an npn transistor switching a load")[0]).toBe("Device:Q_NPN");
    expect(ids("with a 16 MHz crystal")).toContain("Device:Crystal");
  });

  it("does not treat quantities as part numbers, or return multi-unit symbols", () => {
    expect(ids("a 2-pin connector, 10k and 100nF at 16MHz")).toEqual([]);
    expect(index.search("LM358 amplifier", 20).every((e) => e.units === 1)).toBe(true);
  });

  it("puts looked-up parts and their pins in the prompt", () => {
    const prompt = systemPrompt(lib, ["Timer:NE555P"]);
    expect(prompt).toContain("FOUND IN THE INSTALLED KICAD LIBRARY");
    expect(prompt).toContain("Timer:NE555P | U |");
    expect(prompt).toContain("7=DISCH:input");
    expect(catalogueText(lib)).not.toContain("FOUND IN THE INSTALLED");
  });
});

describe("parts outside the core catalogue", () => {
  it("accepts any single-unit library symbol and rejects the rest with a reason", () => {
    expect(unusableReason("Timer:NE555P", lib)).toBeNull();
    expect(unusableReason("power:GND", lib)).toMatch(/power symbols/);
    expect(unusableReason("Timer:NoSuchChip", lib)).toMatch(/no such symbol/);
    expect(unusableReason("Device:Opamp_Dual", lib)).toMatch(/units/);
  });

  it("names the closest real symbols, with pins, when the model invents one", () => {
    const bad = clone(load("ne555-blinker"));
    bad.parts.find((p: { ref: string }) => p.ref === "U1").libId = "Timer:NE555";
    const v = validate(bad, lib, index);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.findings[0].message).toContain("Closest symbols: Timer:NE555");
    expect(v.findings[0].message).toContain("8=VCC:power_in");
  });

  it("gives the pin table when a pin does not exist", () => {
    const bad = clone(load("ne555-blinker"));
    bad.nets[0].pins.push("U1.9");
    const v = validate(bad, lib);
    expect(!v.ok && v.findings.some((f) => f.code === "unknown_pin" && f.message.includes("7=DISCH:input"))).toBe(true);
  });

  it("requires pins stacked at one point to share a net", () => {
    const bad = clone(load("atmega328p-minimal"));
    // U1.4 and U1.6 are both VCC, drawn at the same point
    bad.nets[0].pins = bad.nets[0].pins.filter((p: string) => p !== "U1.6");
    bad.nets.push({ name: "OTHER", pins: ["U1.6"] });
    const v = validate(bad, lib);
    expect(!v.ok && v.findings.map((f) => f.code)).toContain("stacked_pins");
  });

  it("draws rails that KiCad has a power symbol for", () => {
    expect(powerSymbolFor("+9V", lib)).toBe("power:+9V");
    expect(powerSymbolFor("VBUS", lib)).toBe("power:VBUS");
    expect(powerSymbolFor("LED_A", lib)).toBeUndefined();
    expect(powerSymbolFor("PWR_FLAG", lib)).toBeUndefined();
    const r = draft(load("ne555-blinker"), lib);
    if (!r.ok) throw new Error("did not validate");
    const symbols = children(parse(r.sch), "symbol").map((s) => text(child(s, "lib_id")![1]));
    expect(symbols).toContain("power:+9V");
    expect(symbols).toContain("Timer:NE555P");
  });

  it("chooses labels for a sheet with a large part, wires otherwise", () => {
    const small = draft(load("ne555-blinker"), lib);
    const big = draft(load("atmega328p-minimal"), lib);
    expect(small.ok && small.layout.wiring).toBe("wires");
    expect(big.ok && big.layout.wiring).toBe("labels");
  });
});
