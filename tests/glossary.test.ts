import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glossary } from "../lib/glossary";
import { symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const load = (name: string) => JSON.parse(readFileSync(`examples/${name}.intent.json`, "utf8"));
const terms = (name: string, group: string) => glossary(load(name), lib).filter((g) => g.group === group).map((g) => g.term);
const meaning = (name: string, term: string) => glossary(load(name), lib).find((g) => g.term === term)?.meaning;

describe("glossary", () => {
  it("explains the short forms on the MIC5317 sheet", () => {
    expect(terms("mic5317-3v3", "Parts")).toEqual(["J1, J2, …", "C1, C2, …", "U1, U2, …"]);
    expect(terms("mic5317-3v3", "Rails")).toEqual(["+5V", "+3V3", "GND"]);
    expect(terms("mic5317-3v3", "Pins")).toEqual(expect.arrayContaining(["VIN", "VOUT", "EN", "NC", "GND", "MP"]));
    expect(terms("mic5317-3v3", "Values")).toEqual(["u, uF"]);
    expect(terms("mic5317-3v3", "Marks")).toEqual(["×", "PWR_FLAG"]);
    expect(meaning("mic5317-3v3", "+3V3")).toBe("3.3 V supply rail (the V stands where the decimal point is)");
    expect(meaning("mic5317-3v3", "EN")).toMatch(/enable/);
  });

  it("lists each term once and only terms the sheet uses", () => {
    const g = glossary(load("reg-3v3"), lib);
    expect(new Set(g.map((x) => `${x.group}:${x.term}`)).size).toBe(g.length);
    expect(g.map((x) => x.term)).not.toContain("EN");
    expect(g.map((x) => x.term)).not.toContain("×"); // no unconnected pins on this sheet
  });

  it("covers timer and microcontroller pin names", () => {
    expect(terms("ne555-blinker", "Pins")).toEqual(expect.arrayContaining(["TRIG", "THRES", "DISCH", "CONT", "RST"]));
    expect(terms("ne555-blinker", "Rails")).toContain("+9V");
    expect(terms("atmega328p-minimal", "Pins")).toEqual(expect.arrayContaining(["PB5, PC0, …", "XTAL1, XTAL2", "AREF", "AVCC", "RESET"]));
    expect(terms("atmega328p-minimal", "Values")).toEqual(expect.arrayContaining(["n, nF", "p, pF", "k", "MHz"]));
  });
});
