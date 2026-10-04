import { describe, expect, it } from "vitest";
import { ALL_IDS, catalogueText, missingIds } from "../lib/engine/catalogue";
import { child, children, text } from "../lib/engine/sexp";
import { symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const onGrid = (v: number) => Math.abs(v / 1.27 - Math.round(v / 1.27)) < 1e-6;

describe("symbols", () => {
  it("finds every catalogue id in the installed libraries", () => {
    expect(missingIds(lib)).toEqual([]);
  });

  it("resolves the AMS1117-3.3 extends chain", () => {
    const d = lib.get("Regulator_Linear:AMS1117-3.3");
    expect(child(d.embedded, "extends")).toBeUndefined();
    expect(text(d.embedded[1])).toBe("Regulator_Linear:AMS1117-3.3");
    expect(d.pins.map((p) => `${p.number}=${p.name}:${p.type}`)).toEqual([
      "1=GND:power_in",
      "2=VO:power_out",
      "3=VI:power_in",
    ]);
    expect(d.props.Value).toBe("AMS1117-3.3");
    const subs = children(d.embedded, "symbol").map((s) => text(s[1]));
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.startsWith("AMS1117-3.3_"))).toBe(true);
  });

  it("reads pin positions in sheet orientation", () => {
    const c = lib.get("Device:C");
    expect(c.pins.map((p) => [p.number, p.x, p.y, p.dir])).toEqual([
      ["1", 0, -3.81, "U"],
      ["2", 0, 3.81, "D"],
    ]);
    const j = lib.get("Connector_Generic:Conn_01x02");
    expect(j.pins.every((p) => p.dir === "L")).toBe(true);
  });

  it("keeps every pin on the 1.27 mm grid", () => {
    for (const id of ALL_IDS) {
      for (const p of lib.get(id).pins) expect(onGrid(p.x) && onGrid(p.y), `${id} pin ${p.number}`).toBe(true);
    }
  });

  it("marks power symbols", () => {
    expect(lib.get("power:GND").power).toBe(true);
    expect(lib.get("power:PWR_FLAG").pins[0].type).toBe("power_out");
    expect(lib.get("Device:R").power).toBe(false);
  });

  it("reports unknown symbols", () => {
    expect(lib.has("Device:NoSuchPart")).toBe(false);
    expect(lib.has("NoSuchLib:R")).toBe(false);
  });

  it("generates catalogue text from the library", () => {
    const t = catalogueText(lib);
    expect(t).toContain("Regulator_Linear:AMS1117-3.3 | U |");
    expect(t).toContain("1=GND:power_in, 2=VO:power_out, 3=VI:power_in");
    expect(t).toContain("1=K:passive, 2=A:passive");
  });
});
