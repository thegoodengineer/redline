import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateKicad } from "../lib/kicad/cli";
import { Str, child, children, num, parse, q, text, write } from "../lib/engine/sexp";

describe("sexp", () => {
  it("parses atoms, strings and nesting", () => {
    const n = parse('(a 1.27 "two words" (b "x") (b "y"))');
    expect(n[0]).toBe("a");
    expect(n[1]).toBe("1.27");
    expect(n[2]).toBeInstanceOf(Str);
    expect(text(n[2])).toBe("two words");
    expect(children(n, "b").map((b) => text(b[1]))).toEqual(["x", "y"]);
    expect(child(n, "missing")).toBeUndefined();
  });

  it("round-trips escapes", () => {
    const s = 'say "hi"\\ now\nnext';
    const out = write(["p", q(s)]);
    expect(out).toBe('(p "say \\"hi\\"\\\\ now\\nnext")');
    expect(text(parse(out)[1])).toBe(s);
  });

  it("writes one child list per line", () => {
    expect(write(["a", "b", ["c", "1"], ["d", ["e", "2"]]])).toBe("(a b\n\t(c 1)\n\t(d\n\t\t(e 2)\n\t)\n)");
  });

  it("rejects unbalanced input", () => {
    expect(() => parse("(a (b)")).toThrow();
    expect(() => parse("(a))")).toThrow();
    expect(() => parse('(a "open)')).toThrow();
  });

  it("formats millimetres like KiCad", () => {
    expect(num(2.54)).toBe("2.54");
    expect(num(30.480000000000004)).toBe("30.48");
    expect(num(-0)).toBe("0");
    expect(num(10)).toBe("10");
  });

  it("round-trips a demo schematic that ships with KiCad", () => {
    const demo = join(locateKicad().symbolDir, "..", "demos", "simulation", "subsheets", "mainsheet.kicad_sch");
    const first = parse(readFileSync(demo, "utf8"));
    expect(first[0]).toBe("kicad_sch");
    expect(parse(write(first))).toEqual(first);
  });
});
