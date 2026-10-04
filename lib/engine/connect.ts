// Connection without wire routing: every pin gets a short stub that ends in
// a net label, or in a power symbol when the net is GND, +5V or +3V3.
// All coordinates here are local to the part origin, sheet orientation.
import { powerSymbolFor } from "./catalogue";
import { Intent, splitPin } from "./intent";
import { Box, PinDef, PinDir, SymbolDef, SymbolLibrary, unionBox } from "./symbols";

export const GRID = 1.27;
export const STUB = 2.54;
/** Generous width of one character at the 1.27 mm KiCad text size. */
const CHAR_W = 1.2;
const TEXT_HALF_H = 0.9;

export interface TextField {
  text: string;
  x: number;
  y: number;
  justify: "left" | "center" | "right";
}

export interface Attachment {
  pin: PinDef;
  /** "stub" is a bare stub whose wire is drawn by the router (wired mode). */
  kind: "label" | "power" | "nc" | "stub";
  net: string | null;
  /** Stub end. Equal to the pin position for "nc". */
  ex: number;
  ey: number;
  labelAngle?: 0 | 90 | 180 | 270;
  powerLibId?: string;
  rotation?: 0 | 180;
  valueAt?: { x: number; y: number };
}

export interface PartGeometry {
  ref: string;
  libId: string;
  value: string;
  def: SymbolDef;
  /** Mirrored left-to-right so its pins face the parts it connects to. */
  mirror?: boolean;
  reference: TextField;
  valueField: TextField;
  attachments: Attachment[];
  /** Graphics plus pin ends. */
  body: Box;
  /** Everything drawn for this part: body, fields, stubs, labels, power symbols. */
  full: Box;
}

export const VEC: Record<PinDir, { x: number; y: number }> = {
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 },
  U: { x: 0, y: -1 },
  D: { x: 0, y: 1 },
};

export const textWidth = (s: string) => Math.max(1, s.length) * CHAR_W;

export function fieldBox(f: TextField): Box {
  const w = textWidth(f.text);
  const x0 = f.justify === "left" ? f.x : f.justify === "right" ? f.x - w : f.x - w / 2;
  return { x0, y0: f.y - TEXT_HALF_H, x1: x0 + w, y1: f.y + TEXT_HALF_H };
}

export function intersects(a: Box, b: Box): boolean {
  const e = 0.01;
  return a.x0 < b.x1 - e && a.x1 > b.x0 + e && a.y0 < b.y1 - e && a.y1 > b.y0 + e;
}

/**
 * Where the reference and value go: beside the body for vertical two-terminal parts, above it
 * for parts with side pins, and above the top-left corner when the top edge has pins of its own.
 */
export function placeFields(ref: string, value: string, graphics: Box, pins: PinDef[]): { reference: TextField; valueField: TextField } {
  if (!pins.some((p) => p.dir === "L" || p.dir === "R")) {
    const x = graphics.x1 + GRID;
    return { reference: { text: ref, x, y: -GRID, justify: "left" }, valueField: { text: value, x, y: GRID, justify: "left" } };
  }
  if (pins.some((p) => p.dir === "U")) {
    const x = graphics.x0 - 0.5;
    return {
      valueField: { text: value, x, y: graphics.y0 - 1.5, justify: "right" },
      reference: { text: ref, x, y: graphics.y0 - 3.5, justify: "right" },
    };
  }
  const x = (graphics.x0 + graphics.x1) / 2;
  return {
    valueField: { text: value, x, y: graphics.y0 - 1.5, justify: "center" },
    reference: { text: ref, x, y: graphics.y0 - 3.5, justify: "center" },
  };
}

/** Which way a power symbol's graphic points when not rotated. */
export function naturalDir(def: SymbolDef): "U" | "D" {
  return (def.body.y0 + def.body.y1) / 2 > 0 ? "D" : "U";
}

/** Position and extents of a power symbol whose pin sits at (x, y). */
export function powerSymbolAt(def: SymbolDef, x: number, y: number, rotation: 0 | 180, valueText: string) {
  const s = rotation === 180 ? -1 : 1;
  const v = def.propAt.Value ?? { x: 0, y: 0 };
  const valueAt = { x: x + s * v.x, y: y + s * v.y };
  const bx = [x + s * def.body.x0, x + s * def.body.x1];
  const by = [y + s * def.body.y0, y + s * def.body.y1];
  const w = textWidth(valueText);
  const box = unionBox(
    { x0: Math.min(...bx), y0: Math.min(...by), x1: Math.max(...bx), y1: Math.max(...by) },
    { x0: valueAt.x - w / 2, y0: valueAt.y - TEXT_HALF_H, x1: valueAt.x + w / 2, y1: valueAt.y + TEXT_HALF_H },
  );
  return { valueAt, box };
}

export function buildPart(
  part: { ref: string; libId: string; value: string },
  def: SymbolDef,
  netOf: (pinNumber: string) => string | null,
  lib: SymbolLibrary,
): PartGeometry {
  let body = def.body;
  for (const p of def.pins) body = unionBox(body, { x0: p.x, y0: p.y, x1: p.x, y1: p.y });

  const { reference, valueField } = placeFields(part.ref, part.value, def.body, def.pins);

  // Fields get side clearance so a neighbouring label or power symbol never sits flush against them.
  const padded = (b: Box): Box => ({ ...b, x0: b.x0 - 2.5, x1: b.x1 + 2.5 });
  const placed: Box[] = [body, fieldBox(reference), fieldBox(valueField)];
  const obstacles: Box[] = [body, padded(fieldBox(reference)), padded(fieldBox(valueField))];
  const attachments: Attachment[] = [];

  const geometry = (pin: PinDef, net: string, len: number) => {
    const v = VEC[pin.dir];
    const ex = pin.x + v.x * len;
    const ey = pin.y + v.y * len;
    const wire: Box = {
      x0: Math.min(pin.x, ex) - (v.x ? 0 : 0.1),
      y0: Math.min(pin.y, ey) - (v.y ? 0 : 0.1),
      x1: Math.max(pin.x, ex) + (v.x ? 0 : 0.1),
      y1: Math.max(pin.y, ey) + (v.y ? 0 : 0.1),
    };
    const powerLibId = powerSymbolFor(net, lib);
    if (powerLibId) {
      const pdef = lib.get(powerLibId);
      const natural = naturalDir(pdef);
      const rotation: 0 | 180 =
        (pin.dir === "U" && natural === "D") || (pin.dir === "D" && natural === "U") ? 180 : 0;
      const { valueAt, box } = powerSymbolAt(pdef, ex, ey, rotation, net);
      const att: Attachment = { pin, kind: "power", net, ex, ey, powerLibId, rotation, valueAt };
      return { att, boxes: [wire, box] };
    }
    // Labels are horizontal text, running left only from a left-facing pin. A part with several
    // pins along its top or bottom edge gets vertical labels there so they cannot overlap.
    const crowded = (pin.dir === "U" || pin.dir === "D") && def.pins.filter((p) => p.dir === pin.dir).length > 1;
    const labelAngle: 0 | 90 | 180 | 270 = crowded ? (pin.dir === "U" ? 90 : 270) : pin.dir === "L" ? 180 : 0;
    const w = textWidth(net) + 0.5;
    const box: Box =
      labelAngle === 180
        ? { x0: ex - w, y0: ey - 1.9, x1: ex, y1: ey + 0.3 }
        : labelAngle === 0
          ? { x0: ex, y0: ey - 1.9, x1: ex + w, y1: ey + 0.3 }
          : labelAngle === 90
            ? { x0: ex - 1.9, y0: ey - w, x1: ex + 0.3, y1: ey }
            : { x0: ex - 1.9, y0: ey, x1: ex + 0.3, y1: ey + w };
    const att: Attachment = { pin, kind: "label", net, ex, ey, labelAngle };
    return { att, boxes: [wire, box] };
  };

  const byPosition = (a: PinDef, b: PinDef) => a.y - b.y || a.x - b.x;
  const connected = def.pins.filter((p) => netOf(p.number) !== null);
  const isPower = (p: PinDef) => powerSymbolFor(netOf(p.number), lib) !== undefined;
  // Labels first, then power symbols, so a power symbol steps outward past a neighbour's label.
  const order = [
    ...connected.filter((p) => !isPower(p)).sort(byPosition),
    ...connected.filter(isPower).sort(byPosition),
  ];
  const drawn = new Set<string>();
  for (const pin of order) {
    const net = netOf(pin.number)!;
    // Pins stacked at one point share whatever is drawn for the first of them.
    const point = `${pin.x},${pin.y},${net}`;
    if (drawn.has(point)) {
      attachments.push({ pin, kind: "stub", net, ex: pin.x, ey: pin.y });
      continue;
    }
    drawn.add(point);
    let chosen = geometry(pin, net, STUB);
    for (let k = 0; k < 12; k++) {
      const g = geometry(pin, net, STUB + k * STUB);
      if (!g.boxes.some((b) => obstacles.some((p) => intersects(b, p)))) {
        chosen = g;
        break;
      }
    }
    attachments.push(chosen.att);
    placed.push(...chosen.boxes);
    obstacles.push(...chosen.boxes);
  }
  for (const pin of def.pins) {
    if (netOf(pin.number) === null) {
      attachments.push({ pin, kind: "nc", net: null, ex: pin.x, ey: pin.y });
      placed.push({ x0: pin.x - 0.7, y0: pin.y - 0.7, x1: pin.x + 0.7, y1: pin.y + 0.7 });
    }
  }
  attachments.sort((a, b) => a.pin.number.localeCompare(b.pin.number, "en", { numeric: true }));

  let full: Box | undefined;
  for (const b of placed) full = unionBox(full, b);
  return { ref: part.ref, libId: part.libId, value: part.value, def, reference, valueField, attachments, body, full: full! };
}

/** Pin -> net lookup for a validated intent. Pins listed in noConnect map to null. */
export function netLookup(intent: Intent): (ref: string, pin: string) => string | null {
  const map = new Map<string, string>();
  for (const net of intent.nets) for (const p of net.pins) map.set(p, net.name);
  return (ref, pin) => map.get(`${ref}.${pin}`) ?? null;
}

/**
 * Nets that ERC would report as undriven: they have a power input (a power
 * symbol counts as one) and no power output pin. Each gets one PWR_FLAG.
 */
export function netsNeedingFlag(intent: Intent, lib: SymbolLibrary): string[] {
  const libIdOf = new Map(intent.parts.map((p) => [p.ref, p.libId]));
  const out: string[] = [];
  for (const net of intent.nets) {
    const types = net.pins.map((p) => {
      const { ref, pin } = splitPin(p);
      return lib.get(libIdOf.get(ref)!).pins.find((d) => d.number === pin)!.type;
    });
    const needsDriver = powerSymbolFor(net.name, lib) !== undefined || types.includes("power_in");
    if (needsDriver && !types.includes("power_out")) out.push(net.name);
  }
  return out;
}
