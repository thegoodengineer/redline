// Writes the .kicad_sch text and layout.json. The structure follows a
// schematic saved by KiCad 10 (KiCad's own demos, re-saved with "kicad-cli sch upgrade").
// Same intent, same bytes.
import { createHash } from "node:crypto";
import { POWER_NETS, PWR_FLAG } from "./catalogue";
import { PartGeometry, powerSymbolAt, textWidth } from "./connect";
import { Intent } from "./intent";
import { ORIGIN_X, snapUp } from "./place";
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

function property(name: string, value: string, x: number, y: number, o: { hide?: boolean; left?: boolean } = {}): Node[] {
  const p: Node[] = ["property", q(name), q(value), at(x, y, 0)];
  if (o.hide) p.push(["hide", "yes"]);
  p.push(["show_name", "no"], ["do_not_autoplace", "no"], effects(o.left ? ["left"] : undefined));
  return p;
}

export function emit(
  intent: Intent,
  geoms: PartGeometry[],
  origins: Map<string, { x: number; y: number }>,
  flagNets: string[],
  lib: SymbolLibrary,
  project = "design",
): { sch: string; layout: Layout } {
  const root = stableUuid(`root:${intent.title}`);
  const used = new Set<string>();
  const wires: Node[] = [];
  const labels: Node[] = [];
  const noConnects: Node[] = [];
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
    ref: string;
    value: string;
    refAt: { x: number; y: number; left?: boolean };
    valueAt: { x: number; y: number; left?: boolean };
    hideRef: boolean;
    seed: string;
    owner: { ref: string; net?: string; kind: string };
  }): Node[] => {
    used.add(o.def.libId);
    const n: Node[] = [
      "symbol",
      ["lib_id", q(o.def.libId)],
      at(o.x, o.y, o.rotation),
      ["unit", "1"],
      ["body_style", "1"],
      ["exclude_from_sim", "no"],
      ["in_bom", o.def.inBom],
      ["on_board", o.def.onBoard],
      ["in_pos_files", "yes"],
      ["dnp", "no"],
      ["uuid", q(id(`sym:${o.seed}`, o.owner))],
      property("Reference", o.ref, o.refAt.x, o.refAt.y, { hide: o.hideRef, left: o.refAt.left }),
      property("Value", o.value, o.valueAt.x, o.valueAt.y, { left: o.valueAt.left }),
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

  const label = (name: string, x: number, y: number, angle: 0 | 180, seed: string, owner: Layout["uuids"][string]) =>
    labels.push([
      "label",
      q(name),
      at(x, y, angle),
      effects([angle === 180 ? "right" : "left", "bottom"]),
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
        ref: g.ref,
        value: g.value,
        refAt: { x: o.x + g.reference.x, y: o.y + g.reference.y, left: g.reference.justify === "left" },
        valueAt: { x: o.x + g.valueField.x, y: o.y + g.valueField.y, left: g.valueField.justify === "left" },
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
      wire(px, py, o.x + a.ex, o.y + a.ey, seed, { ...owner, kind: "wire" });
      if (a.kind === "label") label(a.net!, o.x + a.ex, o.y + a.ey, a.labelAngle!, seed, { ...owner, kind: "label" });
      else powerSymbol(a.powerLibId!, a.net!, o.x + a.ex, o.y + a.ey, a.rotation!, seed, g.ref);
    }
    const full = shift(g.full, o.x, o.y);
    parts[g.ref] = { ...rect(shift(g.body, o.x, o.y)), full: rect(full) };
    content = unionBox(content, full);
  }

  // One PWR_FLAG island per undriven power net, in a row under the parts.
  if (flagNets.length) {
    const flagDef = lib.get(PWR_FLAG);
    const y = snapUp((content?.y1 ?? ORIGIN_X) + 12.7);
    flagNets.forEach((net, i) => {
      const x = ORIGIN_X + i * 30.48;
      const ax = x + 10.16;
      const owner = { ref: `#FLG${String(i + 1).padStart(2, "0")}`, net };
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
      wire(x, y, ax, y, `flag:${net}`, { ...owner, kind: "wire" });
      let box = flag.box;
      const powerLibId = POWER_NETS[net];
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
      sheet: paper === "A4" ? { w: 297, h: 210 } : { w: 420, h: 297 },
      content: rect(box),
      parts,
      flags,
      uuids,
    },
  };
}
