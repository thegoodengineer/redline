// Loads symbol definitions from the installed KiCad .kicad_sym libraries.
// Library coordinates are Y-up; everything exported here is converted to
// sheet orientation (Y-down), relative to the symbol origin.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Node, Str, child, children, head, isList, parse, q, text } from "./sexp";

export type PinDir = "L" | "R" | "U" | "D";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PinDef {
  number: string;
  name: string;
  /** KiCad electrical type: passive, power_in, power_out, input, ... */
  type: string;
  /** Connection point, sheet orientation, relative to the symbol origin. */
  x: number;
  y: number;
  /** Direction pointing away from the body. */
  dir: PinDir;
}

export interface SymbolDef {
  libId: string;
  /** Flattened definition named "Lib:Name", ready for (lib_symbols). */
  embedded: Node[];
  pins: PinDef[];
  /** Graphics bounding box, without pins. */
  body: Box;
  props: Record<string, string>;
  /** Library position of each property, sheet orientation. */
  propAt: Record<string, { x: number; y: number }>;
  power: boolean;
  /** Number of units. Only single-unit symbols can be drawn. */
  units: number;
  inBom: string;
  onBoard: string;
}

export class SymbolNotFoundError extends Error {
  constructor(readonly libId: string, detail: string) {
    super(`symbol ${libId} not found: ${detail}`);
  }
}

export function unionBox(a: Box | undefined, b: Box): Box {
  if (!a) return { ...b };
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** Cut one top-level (symbol "name" ...) block out of a library file without parsing the rest. */
export function extractSymbolText(lib: string, name: string): string | null {
  const needle = `(symbol "${name}"`;
  let i = -1;
  for (;;) {
    i = lib.indexOf(needle, i + 1);
    if (i === -1) return null;
    const after = lib[i + needle.length];
    const topLevel = lib[i - 1] === "\t" && lib[i - 2] === "\n";
    if (topLevel && (after === "\n" || after === "\r" || after === " ")) break;
  }
  let depth = 0;
  let inStr = false;
  for (let j = i; j < lib.length; j++) {
    const c = lib[j];
    if (inStr) {
      if (c === "\\") j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return lib.slice(i, j + 1);
  }
  return null;
}

const DIR_BY_ANGLE: Record<string, PinDir> = { "0": "L", "180": "R", "90": "D", "270": "U" };

export class SymbolLibrary {
  private files = new Map<string, string>();
  private cache = new Map<string, SymbolDef>();

  constructor(readonly dir: string) {}

  has(libId: string): boolean {
    try {
      this.get(libId);
      return true;
    } catch (e) {
      if (e instanceof SymbolNotFoundError) return false;
      throw e;
    }
  }

  get(libId: string): SymbolDef {
    const hit = this.cache.get(libId);
    if (hit) return hit;
    const k = libId.indexOf(":");
    if (k <= 0) throw new SymbolNotFoundError(libId, 'expected "Library:Symbol"');
    const lib = libId.slice(0, k);
    const name = libId.slice(k + 1);
    const def = build(libId, this.flatten(lib, name, libId, 0));
    this.cache.set(libId, def);
    return def;
  }

  private file(lib: string, libId: string): string {
    let t = this.files.get(lib);
    if (t === undefined) {
      const p = join(this.dir, `${lib}.kicad_sym`);
      if (!existsSync(p)) throw new SymbolNotFoundError(libId, `no library file ${p}`);
      t = readFileSync(p, "utf8");
      this.files.set(lib, t);
    }
    return t;
  }

  /** Returns the symbol node with "extends" resolved, still under its bare name. */
  private flatten(lib: string, name: string, libId: string, depth: number): Node[] {
    if (depth > 8) throw new SymbolNotFoundError(libId, "extends chain too deep");
    const src = extractSymbolText(this.file(lib, libId), name);
    if (!src) throw new SymbolNotFoundError(libId, `no symbol "${name}" in ${lib}.kicad_sym`);
    const node = parse(src);
    const ext = child(node, "extends");
    if (!ext) return node;

    const parentName = text(ext[1]);
    const parent = this.flatten(lib, parentName, libId, depth + 1);
    const own = new Map(children(node, "property").map((p) => [text(p[1]), p]));
    const out: Node[] = ["symbol", q(name)];
    const rest = parent.slice(2);
    let lastProp = -1;
    rest.forEach((c, idx) => {
      if (isList(c) && head(c) === "property") lastProp = idx;
    });
    rest.forEach((c, idx) => {
      if (isList(c) && head(c) === "property") {
        const mine = own.get(text(c[1]));
        out.push(mine ?? c);
        own.delete(text(c[1]));
      } else if (isList(c) && head(c) === "symbol") {
        const sub = text(c[1]);
        const renamed = sub.startsWith(parentName + "_") ? name + sub.slice(parentName.length) : sub;
        out.push(["symbol", q(renamed), ...c.slice(2)]);
      } else out.push(c);
      if (idx === lastProp) for (const p of own.values()) out.push(p);
    });
    return out;
  }
}

function build(libId: string, flat: Node[]): SymbolDef {
  const props: Record<string, string> = {};
  const propAt: Record<string, { x: number; y: number }> = {};
  for (const p of children(flat, "property")) {
    const key = text(p[1]);
    props[key] = text(p[2]);
    const at = child(p, "at");
    propAt[key] = { x: Number(text(at?.[1])) || 0, y: -(Number(text(at?.[2])) || 0) || 0 };
  }

  const pins: PinDef[] = [];
  let units = 1;
  let body: Box | undefined;
  const add = (x: number, y: number, r = 0) => {
    body = unionBox(body, { x0: x - r, y0: -y - r, x1: x + r, y1: -y + r });
  };
  const xy = (n: Node[] | undefined) => [Number(text(n?.[1])) || 0, Number(text(n?.[2])) || 0] as const;

  for (const sub of children(flat, "symbol")) {
    const m = /_(\d+)_(\d+)$/.exec(text(sub[1]));
    if (m) units = Math.max(units, Number(m[1]));
    if (!m || Number(m[1]) > 1 || Number(m[2]) > 1) continue; // unit 1, normal body style only
    for (const g of sub.slice(2)) {
      if (!isList(g)) continue;
      switch (head(g)) {
        case "pin": {
          const at = child(g, "at");
          const [x, y] = xy(at);
          const angle = text(at?.[3]) || "0";
          const dir = DIR_BY_ANGLE[angle];
          if (!dir) throw new Error(`${libId}: pin angle ${angle} is not supported`);
          pins.push({
            number: text(child(g, "number")?.[1]),
            name: text(child(g, "name")?.[1]),
            type: text(g[1]),
            x,
            y: -y || 0,
            dir,
          });
          break;
        }
        case "rectangle":
          add(...xy(child(g, "start")));
          add(...xy(child(g, "end")));
          break;
        case "polyline":
        case "bezier":
          for (const p of children(child(g, "pts") ?? [], "xy")) add(...xy(p));
          break;
        case "circle":
          add(...xy(child(g, "center")), Number(text(child(g, "radius")?.[1])) || 0);
          break;
        case "arc":
          for (const k of ["start", "mid", "end"]) add(...xy(child(g, k)));
          break;
      }
    }
  }
  pins.sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
  if (!body) {
    for (const p of pins) body = unionBox(body, { x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  const embedded: Node[] = ["symbol", new Str(libId), ...flat.slice(2)];
  return {
    libId,
    embedded,
    pins,
    body: body ?? { x0: 0, y0: 0, x1: 0, y1: 0 },
    props,
    propAt,
    power: !!child(flat, "power"),
    units,
    inBom: text(child(flat, "in_bom")?.[1]) || "yes",
    onBoard: text(child(flat, "on_board")?.[1]) || "yes",
  };
}
