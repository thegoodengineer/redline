// Writes the .kicad_sch text and layout.json. The structure follows a
// schematic saved by KiCad 10 (KiCad's own demos, re-saved with "kicad-cli sch upgrade").
// Same intent, same bytes.
import { createHash } from "node:crypto";
import { powerSymbolFor, PWR_FLAG } from "./catalogue";
import { PartGeometry, powerSymbolAt, textWidth } from "./connect";
import { Intent } from "./intent";
import { ORIGIN_X, snapUp } from "./place";
import type { Wiring } from "./wired";
import { Node, num, q, write } from "./sexp";
import { Box, SymbolDef, SymbolLibrary, unionBox } from "./symbols";

export const SCH_VERSION = "20260306";
export const GENERATOR_VERSION = "10.0";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  paper: "A4" | "A3";
  /** "wires": routed wires and one symbol per rail. "labels": a stub and a label on every pin. */
  wiring: "wires" | "labels";
  sheet: { w: number; h: number };
  /** Bounding box of everything drawn, sheet millimetres. */
  content: Rect;
  /** Per ref: body and pins, plus the full extent with labels and power symbols. */
  parts: Record<string, Rect & { full: Rect }>;
  flags: Array<{ ref: string; net: string } & Rect>;
  /** Every UUID in the file that ERC may point at -> the ref (and pin) it belongs to. */
  uuids: Record<string, { ref: string; pin?: string; net?: string; kind: string }>;
}

export function stableUuid(seed: string): string {
  const h = createHash("sha1").update(seed).digest("hex");
  const variant = "89ab"[parseInt(h[16], 16) & 3];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const rect = (b: Box): Rect => ({
  x: round(b.x0),
  y: round(b.y0),
  w: round(b.x1 - b.x0),
  h: round(b.y1 - b.y0),
});
const round = (v: number) => Math.round(v * 10000) / 10000;
const shift = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

const at = (x: number, y: number, angle?: number): Node[] =>
  angle === undefined ? ["at", num(x), num(y)] : ["at", num(x), num(y), String(angle)];

function effects(justify?: string[]): Node[] {
  const e: Node[] = ["effects", ["font", ["size", "1.27", "1.27"]]];
  if (justify) e.push(["justify", ...justify]);
  return e;
}

function property(name: string, value: string, x: number, y: number, o: { hide?: boolean; justify?: "left" | "center" | "right" } = {}): Node[] {
  const p: Node[] = ["property", q(name), q(value), at(x, y, 0)];
  if (o.hide) p.push(["hide", "yes"]);
  p.push(["show_name", "no"], ["do_not_autoplace", "no"], effects(o.justify && o.justify !== "center" ? [o.justify] : undefined));
  return p;
}

export function emit(
  intent: Intent,
  geoms: PartGeometry[],
  origins: Map<string, { x: number; y: number }>,
  flagNets: string[],
  lib: SymbolLibrary,
  wiring?: Wiring,
  project = "design",
): { sch: string; layout: Layout } {
  const root = stableUuid(`root:${intent.title}`);
  const used = new Set<string>();
  const wires: Node[] = [];
  const labels: Node[] = [];
  const noConnects: Node[] = [];
  const junctions: Node[] = [];
  const drawings: Node[] = [];
  let flagCount = 0;
  const symbols: Node[] = [];
  const uuids: Layout["uuids"] = {};
  const parts: Layout["parts"] = {};
  const flags: Layout["flags"] = [];
  let content: Box | undefined;
  let pwr = 0;

  const id = (seed: string, owner: Layout["uuids"][string]) => {
    const u = stableUuid(seed);
    uuids[u] = owner;
    return u;
  };

  const symbol = (o: {
    def: SymbolDef;
    x: number;
    y: number;
    rotation: number;
    mirror?: boolean;
    ref: string;
    value: string;
    refAt: { x: number; y: number; justify?: "left" | "center" | "right" };
    valueAt: { x: number; y: number; justify?: "left" | "center" | "right" };
    hideRef: boolean;
    seed: string;
    owner: { ref: string; net?: string; kind: string };
  }): Node[] => {
    used.add(o.def.libId);
    const n: Node[] = [
      "symbol",
      ["lib_id", q(o.def.libId)],
      at(o.x, o.y, o.rotation),
      ...(o.mirror ? [["mirror", "y"] as Node[]] : []),
      ["unit", "1"],
      ["body_style", "1"],
      ["exclude_from_sim", "no"],
      ["in_bom", o.def.inBom],
      ["on_board", o.def.onBoard],
      ["in_pos_files", "yes"],
      ["dnp", "no"],
      ["uuid", q(id(`sym:${o.seed}`, o.owner))],
      property("Reference", o.ref, o.refAt.x, o.refAt.y, { hide: o.hideRef, justify: o.refAt.justify }),
      property("Value", o.value, o.valueAt.x, o.valueAt.y, { justify: o.valueAt.justify }),
      property("Footprint", o.def.props.Footprint ?? "", o.x, o.y, { hide: true }),
      property("Datasheet", o.def.props.Datasheet ?? "", o.x, o.y, { hide: true }),
      property("Description", o.def.props.Description ?? "", o.x, o.y, { hide: true }),
    ];
    for (const pin of o.def.pins) {
      n.push(["pin", q(pin.number), ["uuid", q(id(`pin:${o.seed}:${pin.number}`, { ...o.owner, pin: pin.number }))]]);
    }
    n.push(["instances", ["project", q(project), ["path", q(`/${root}`), ["reference", q(o.ref)], ["unit", "1"]]]]);
    return n;
  };

  const wire = (x0: number, y0: number, x1: number, y1: number, seed: string, owner: Layout["uuids"][string]) =>
    wires.push([
      "wire",
      ["pts", ["xy", num(x0), num(y0)], ["xy", num(x1), num(y1)]],
      ["stroke", ["width", "0"], ["type", "default"]],
      ["uuid", q(id(`wire:${seed}`, owner))],
    ]);

  const label = (name: string, x: number, y: number, angle: 0 | 90 | 180 | 270, seed: string, owner: Layout["uuids"][string]) =>
    labels.push([
      "label",
      q(name),
      at(x, y, angle),
      effects([angle === 180 || angle === 270 ? "right" : "left", "bottom"]),
      ["uuid", q(id(`label:${seed}`, owner))],
    ]);

  const powerSymbol = (libId: string, net: string, x: number, y: number, rotation: 0 | 180, seed: string, ownerRef: string) => {
    const def = lib.get(libId);
    const { valueAt } = powerSymbolAt(def, x, y, rotation, net);
    pwr++;
    symbols.push(
      symbol({
        def,
        x,
        y,
        rotation,
        ref: `#PWR${String(pwr).padStart(2, "0")}`,
        value: net,
        refAt: { x, y },
        valueAt,
        hideRef: true,
        seed: `pwr:${seed}`,
        owner: { ref: ownerRef, net, kind: "power" },
      }),
    );
  };

  for (const g of geoms) {
    const o = origins.get(g.ref)!;
    symbols.push(
      symbol({
        def: g.def,
        x: o.x,
        y: o.y,
        rotation: 0,
        mirror: g.mirror,
        ref: g.ref,
        value: g.value,
        refAt: { x: o.x + g.reference.x, y: o.y + g.reference.y, justify: g.reference.justify },
        valueAt: { x: o.x + g.valueField.x, y: o.y + g.valueField.y, justify: g.valueField.justify },
        hideRef: false,
        seed: g.ref,
        owner: { ref: g.ref, kind: "symbol" },
      }),
    );
    for (const a of g.attachments) {
      const seed = `${g.ref}:${a.pin.number}`;
      const owner = { ref: g.ref, pin: a.pin.number, net: a.net ?? undefined };
      const px = o.x + a.pin.x;
      const py = o.y + a.pin.y;
      if (a.kind === "nc") {
        noConnects.push(["no_connect", at(px, py), ["uuid", q(id(`nc:${seed}`, { ...owner, kind: "no_connect" }))]]);
        continue;
      }
      if (a.kind === "stub") continue; // drawn by the router
      wire(px, py, o.x + a.ex, o.y + a.ey, seed, { ...owner, kind: "wire" });
      if (a.kind === "label") label(a.net!, o.x + a.ex, o.y + a.ey, a.labelAngle!, seed, { ...owner, kind: "label" });
      else powerSymbol(a.powerLibId!, a.net!, o.x + a.ex, o.y + a.ey, a.rotation!, seed, g.ref);
    }
    const full = shift(g.full, o.x, o.y);
    parts[g.ref] = { ...rect(shift(g.body, o.x, o.y)), full: rect(full) };
    content = unionBox(content, full);
  }

  const flagDef = lib.get(PWR_FLAG);
  /** A PWR_FLAG with its pin at (x, y). */
  const flagSymbol = (net: string, x: number, y: number) => {
    const owner = { ref: `#FLG${String(++flagCount).padStart(2, "0")}`, net };
    const flag = powerSymbolAt(flagDef, x, y, 0, "PWR_FLAG");
    symbols.push(
      symbol({
        def: flagDef,
        x,
        y,
        rotation: 0,
        ref: owner.ref,
        value: "PWR_FLAG",
        refAt: { x, y },
        valueAt: flag.valueAt,
        hideRef: true,
        seed: `flag:${net}`,
        owner: { ...owner, kind: "flag" },
      }),
    );
    return { owner, box: flag.box };
  };

  // Routed wires, junctions, and the symbols hung on them.
  if (wiring) {
    const refOf = (net: string) => intent.nets.find((n) => n.name === net)?.pins[0].split(".")[0] ?? "";
    for (const w of wiring.wires) {
      wire(w.x0, w.y0, w.x1, w.y1, `net:${w.net}:${num(w.x0)},${num(w.y0)},${num(w.x1)},${num(w.y1)}`, { ref: refOf(w.net), net: w.net, kind: "wire" });
    }
    for (const j of wiring.junctions) {
      junctions.push([
        "junction",
        at(j.x, j.y),
        ["diameter", "0"],
        ["color", "0", "0", "0", "0"],
        ["uuid", q(id(`junction:${j.net}:${num(j.x)},${num(j.y)}`, { ref: refOf(j.net), net: j.net, kind: "junction" }))],
      ]);
    }
    for (const p of wiring.powers) powerSymbol(p.libId, p.net, p.x, p.y, p.rotation, `net:${p.net}`, refOf(p.net));
    for (const f of wiring.flagTaps) {
      const { owner, box } = flagSymbol(f.net, f.x, f.y);
      flags.push({ ref: owner.ref, net: f.net, ...rect(box) });
    }
    content = unionBox(content, wiring.box);
  }

  // One PWR_FLAG island per undriven power rail, in a row under the parts.
  if (flagNets.length) {
    const y = snapUp((content?.y1 ?? ORIGIN_X) + 12.7);
    flagNets.forEach((net, i) => {
      const x = ORIGIN_X + i * 30.48;
      const ax = x + 10.16;
      const flag = flagSymbol(net, x, y);
      const owner = flag.owner;
      wire(x, y, ax, y, `flag:${net}`, { ...owner, kind: "wire" });
      let box = flag.box;
      const powerLibId = powerSymbolFor(net, lib);
      if (powerLibId) {
        powerSymbol(powerLibId, net, ax, y, 0, `flag:${net}`, owner.ref);
        box = unionBox(box, powerSymbolAt(lib.get(powerLibId), ax, y, 0, net).box);
      } else {
        label(net, ax, y, 0, `flag:${net}`, { ...owner, kind: "label" });
        box = unionBox(box, { x0: ax, y0: y - 1.9, x1: ax + textWidth(net) + 0.5, y1: y + 0.3 });
      }
      flags.push({ ref: owner.ref, net, ...rect(box) });
      content = unionBox(content, box);
    });
  }

  // Wired sheets get a frame and the title, like a hand-drawn block.
  if (wiring && content) {
    const f = { x0: content.x0 - 7.62, y0: content.y0 - 7.62, x1: content.x1 + 7.62, y1: content.y1 + 7.62 };
    drawings.push([
      "rectangle",
      ["start", num(f.x0), num(f.y0)],
      ["end", num(f.x1), num(f.y1)],
      ["stroke", ["width", "0"], ["type", "solid"]],
      ["fill", ["type", "none"]],
      ["uuid", q(stableUuid("frame"))],
    ]);
    drawings.push([
      "text",
      q(intent.title),
      ["exclude_from_sim", "no"],
      at(f.x0, f.y0 - 2.54, 0),
      ["effects", ["font", ["size", "1.778", "1.778"]], ["justify", "left", "bottom"]],
      ["uuid", q(stableUuid("title"))],
    ]);
    content = { x0: f.x0, y0: f.y0 - 5.5, x1: Math.max(f.x1, f.x0 + intent.title.length * 1.7), y1: f.y1 };
  }

  const box = content ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  const paper: Layout["paper"] = box.x1 + 20 > 297 || box.y1 + 20 > 210 ? "A3" : "A4";
  const libSymbols: Node[] = ["lib_symbols", ...[...used].sort().map((libId) => lib.get(libId).embedded)];

  const file: Node[] = [
    "kicad_sch",
    ["version", SCH_VERSION],
    ["generator", q("redline")],
    ["generator_version", q(GENERATOR_VERSION)],
    ["uuid", q(root)],
    ["paper", q(paper)],
    ["title_block", ["title", q(intent.title)]],
    libSymbols,
    ...drawings,
    ...junctions,
    ...noConnects,
    ...wires,
    ...labels,
    ...symbols,
    ["sheet_instances", ["path", q("/"), ["page", q("1")]]],
    ["embedded_fonts", "no"],
  ];

  return {
    sch: write(file) + "\n",
    layout: {
      paper,
      wiring: wiring ? "wires" : "labels",
      sheet: paper === "A4" ? { w: 297, h: 210 } : { w: 420, h: 297 },
      content: rect(box),
      parts,
      flags,
      uuids,
    },
  };
}
