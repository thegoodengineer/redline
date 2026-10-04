import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draft } from "../lib/engine";
import { Node, child, children, isList, parse, text } from "../lib/engine/sexp";
import { symbolLibrary } from "../lib/runs";

const lib = symbolLibrary();
const load = (name: string) => JSON.parse(readFileSync(`examples/${name}.intent.json`, "utf8"));
const onGrid = (v: number) => Math.abs(v / 1.27 - Math.round(v / 1.27)) < 1e-6;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function codes(input: unknown): string[] {
  const r = draft(input, lib);
  return r.ok ? [] : r.findings.map((f) => f.code);
}

describe("validate", () => {
  const good = load("reg-3v3");

  it("accepts the hand-written example", () => {
    expect(codes(good)).toEqual([]);
  });

  it("numbers findings from 1 and writes nothing", () => {
    const bad = clone(good);
    bad.parts[2].libId = "Regulator_Linear:LM9999";
    bad.nets[0].pins.push("C9.1");
    const r = draft(bad, lib);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.id)).toEqual(r.findings.map((_, i) => i + 1));
    expect("sch" in r).toBe(false);
  });

  it("reports an unknown libId", () => {
    const bad = clone(good);
    bad.parts[2].libId = "Regulator_Linear:LM9999";
    expect(codes(bad)).toContain("unknown_libid");
  });

  it("rejects a power symbol used as a part", () => {
    const bad = clone(good);
    bad.parts.push({ ref: "U2", libId: "power:GND", value: "GND", group: "input" });
    expect(codes(bad)).toContain("unknown_libid");
  });

  it("reports an unknown pin and an unknown ref", () => {
    const bad = clone(good);
    bad.nets[0].pins.push("U1.9", "Q7.1");
    expect(codes(bad)).toEqual(expect.arrayContaining(["unknown_pin", "unknown_ref"]));
  });

  it("reports a duplicate ref", () => {
    const bad = clone(good);
    bad.parts.push({ ...bad.parts[1] });
    expect(codes(bad)).toContain("duplicate_ref");
  });

  it("reports a pin in two nets", () => {
    const bad = clone(good);
    bad.nets[1].pins.push("J1.1");
    expect(codes(bad)).toContain("pin_in_two_nets");
  });

  it("reports a pin in no net and not in noConnect", () => {
    const bad = clone(good);
    bad.nets[2].pins = bad.nets[2].pins.filter((p: string) => p !== "J2.2");
    expect(codes(bad)).toEqual(["pin_unassigned"]);
    bad.noConnect = ["J2.2"];
    expect(codes(bad)).toEqual([]);
  });

  it("reports schema problems, including coordinates", () => {
    const bad = clone(good);
    bad.parts[0].x = 10;
    expect(codes(bad)).toEqual(["schema"]);
    expect(codes({ version: 2 })).toContain("schema");
  });
});

describe("draft", () => {
  for (const [name, wiring] of [
    ["reg-3v3", "labels"],
    ["led-button", "labels"],
    ["reg-3v3", "wires"],
    ["led-button", "wires"],
    ["mic5317-3v3", "wires"],
    ["ne555-blinker", "wires"],
    ["atmega328p-minimal", "labels"],
  ] as const) {
    const r = draft(load(name), lib, { wiring });
    if (!r.ok) throw new Error(`${name} did not validate`);
    const root = parse(r.sch);

    it(`${name} (${wiring}): same intent, same bytes`, () => {
      const again = draft(load(name), lib, { wiring });
      expect(r.layout.wiring).toBe(wiring);
      expect(again.ok && again.sch === r.sch).toBe(true);
      expect(again.ok && JSON.stringify(again.layout) === JSON.stringify(r.layout)).toBe(true);
    });

    it(`${name} (${wiring}): every connection point is on the 1.27 mm grid`, () => {
      const points: number[] = [];
      const at = (n: Node[]) => {
        const a = child(n, "at")!;
        points.push(Number(text(a[1])), Number(text(a[2])));
      };
      for (const k of ["symbol", "label", "no_connect", "junction"]) children(root, k).forEach(at);
      for (const w of children(root, "wire")) {
        for (const p of children(child(w, "pts")!, "xy")) points.push(Number(text(p[1])), Number(text(p[2])));
      }
      expect(points.length).toBeGreaterThan(10);
      expect(points.filter((p) => !onGrid(p))).toEqual([]);
    });

    it(`${name} (${wiring}): parts do not overlap and layout covers every ref`, () => {
      const refs = r.intent.parts.map((p) => p.ref);
      expect(Object.keys(r.layout.parts).sort()).toEqual([...refs].sort());
      const boxes = [
        ...refs.map((ref) => ({ ref, ...r.layout.parts[ref].full })),
        ...r.layout.flags.map((f) => ({ ...f, ref: `flag ${f.net}` })),
      ];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(apart, `${a.ref} overlaps ${b.ref}`).toBe(true);
        }
      }
    });

    it(`${name} (${wiring}): UUIDs are unique and mapped in layout.json`, () => {
      const seen: string[] = [];
      const walk = (n: Node) => {
        if (!isList(n)) return;
        if (n[0] === "uuid") seen.push(text(n[1]));
        n.forEach(walk);
      };
      walk(root);
      expect(new Set(seen).size).toBe(seen.length);
      const unmapped = seen.filter((u) => !r.layout.uuids[u]);
      const drawn = ["rectangle", "text"].flatMap((k) => children(root, k).map((n) => text(child(n, "uuid")![1])));
      // only the sheet's own UUID and the frame and title are not tied to a part
      expect(unmapped.sort()).toEqual([text(child(root, "uuid")![1]), ...drawn].sort());
    });
  }

  it("labels mode: power symbols on every rail pin and one PWR_FLAG per undriven rail", () => {
    const r = draft(load("reg-3v3"), lib, { wiring: "labels" });
    if (!r.ok) throw new Error("did not validate");
    const ids = children(parse(r.sch), "symbol").map((s) => text(child(s, "lib_id")![1]));
    expect(ids.filter((i) => i === "power:GND").length).toBe(5 + 1); // five pins plus the flag island
    expect(ids.filter((i) => i === "power:+5V").length).toBe(3 + 1);
    expect(ids.filter((i) => i === "power:+3V3").length).toBe(3); // driven by U1 VO, no flag
    expect(r.layout.flags.map((f) => f.net)).toEqual(["+5V", "GND"]);
    expect(children(parse(r.sch), "label").length).toBe(0);
  });

  it("wires mode: one symbol per rail, wires and junctions instead of labels, frame and title", () => {
    const r = draft(load("mic5317-3v3"), lib);
    if (!r.ok) throw new Error("did not validate");
    expect(r.layout.wiring).toBe("wires");
    const root = parse(r.sch);
    const ids = children(root, "symbol").map((s) => text(child(s, "lib_id")![1]));
    expect(ids.filter((i) => i === "power:+5V").length).toBe(1 + 1); // one on the rail, one on the flag island
    expect(ids.filter((i) => i === "power:+3V3").length).toBe(1);
    expect(ids.filter((i) => i === "power:GND").length).toBe(1 + 1);
    expect(children(root, "label").length).toBe(0);
    expect(children(root, "junction").length).toBeGreaterThan(3);
    expect(children(root, "no_connect").length).toBe(3);
    expect(children(root, "rectangle").length).toBe(1);
    expect(children(root, "text").map((t) => text(t[1]))).toEqual(["+5 TO +3V3 regulator"]);
    // the input connector is mirrored so its pins face the regulator
    const j1 = children(root, "symbol").find((s) => children(s, "property").some((p) => text(p[2]) === "J1"))!;
    expect(child(j1, "mirror")).toBeDefined();
  });

  it("wires mode: wires of different nets never share a point except at plain crossings", () => {
    for (const name of ["reg-3v3", "led-button", "mic5317-3v3", "ne555-blinker"]) {
      const r = draft(load(name), lib);
      if (!r.ok) throw new Error("did not validate");
      const ends = new Map<string, Set<string>>();
      for (const w of children(parse(r.sch), "wire")) {
        const net = r.layout.uuids[text(child(w, "uuid")![1])].net ?? "?";
        for (const p of children(child(w, "pts")!, "xy")) {
          const k = text(p[1]) + "," + text(p[2]);
          ends.set(k, (ends.get(k) ?? new Set()).add(net));
        }
      }
      const shared = [...ends].filter(([, nets]) => nets.size > 1).map(([k]) => k);
      expect(shared, name).toEqual([]);
    }
  });

  it("labels mode: marks no-connect pins and labels other nets", () => {
    const r = draft(load("led-button"), lib, { wiring: "labels" });
    if (!r.ok) throw new Error("did not validate");
    const root = parse(r.sch);
    expect(children(root, "no_connect").length).toBe(1);
    const names = children(root, "label").map((l) => text(l[1]));
    expect(names.filter((n) => n === "BTN").length).toBe(3);
    expect(names).not.toContain("GND");
  });
});
