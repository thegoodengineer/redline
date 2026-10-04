// Wired drafting: parts in a row on a common rail line, nets drawn as real
// wires by a grid router, one power symbol per rail. Returns null when a net
// cannot be routed; the caller then falls back to the label style.
import { powerSymbolFor, PWR_FLAG } from "./catalogue";
import { Attachment, fieldBox, GRID, intersects, naturalDir, PartGeometry, placeFields, powerSymbolAt, STUB, VEC } from "./connect";
import { groupOrder, Intent, splitPin } from "./intent";
import { ORIGIN_X, ORIGIN_Y, snapUp } from "./place";
import { Box, PinDef, PinDir, SymbolDef, SymbolLibrary, unionBox } from "./symbols";

export interface Wiring {
  wires: Array<{ net: string; x0: number; y0: number; x1: number; y1: number }>;
  junctions: Array<{ net: string; x: number; y: number }>;
  powers: Array<{ net: string; libId: string; x: number; y: number; rotation: 0 | 180 }>;
  flagTaps: Array<{ net: string; x: number; y: number }>;
  /** Extents of the wires and the symbols hung on them. */
  box: Box;
}

const FLIP: Record<PinDir, PinDir> = { L: "R", R: "L", U: "U", D: "D" };
const round = (v: number) => Math.round(v * 10000) / 10000;
const gi = (mm: number) => Math.round(mm / GRID);
const mm = (i: number) => round(i * GRID);

// ---------------------------------------------------------------- parts

function buildWiredPart(
  part: { ref: string; libId: string; value: string },
  def: SymbolDef,
  netOf: (pin: string) => string | null,
  mirror: boolean,
): PartGeometry {
  const pins: PinDef[] = def.pins.map((p) => (mirror ? { ...p, x: -p.x || 0, dir: FLIP[p.dir] } : p));
  const graphics: Box = mirror ? { x0: -def.body.x1, y0: def.body.y0, x1: -def.body.x0, y1: def.body.y1 } : def.body;
  let body = graphics;
  for (const p of pins) body = unionBox(body, { x0: p.x, y0: p.y, x1: p.x, y1: p.y });

  const { reference, valueField } = placeFields(part.ref, part.value, graphics, pins);

  let full = unionBox(unionBox(body, fieldBox(reference)), fieldBox(valueField));
  const attachments: Attachment[] = pins.map((pin) => {
    const net = netOf(pin.number);
    if (net === null) return { pin, kind: "nc", net: null, ex: pin.x, ey: pin.y };
    const ex = pin.x + VEC[pin.dir].x * STUB;
    const ey = pin.y + VEC[pin.dir].y * STUB;
    full = unionBox(full, { x0: ex, y0: ey, x1: ex, y1: ey });
    return { pin, kind: "stub", net, ex, ey };
  });
  return { ref: part.ref, libId: part.libId, value: part.value, def, mirror, reference, valueField, attachments, body, full };
}

/** Where this part sits relative to the row's rail line: its top signal pin, or the end of its top stub. */
function railAnchor(g: PartGeometry): number {
  const connected = g.attachments.filter((a) => a.kind === "stub");
  const side = connected.filter((a) => a.pin.dir === "L" || a.pin.dir === "R");
  if (side.length) return Math.min(...side.map((a) => a.pin.y));
  if (connected.length) return Math.min(...connected.map((a) => a.ey));
  return 0;
}

const COLUMN_GAP = 12.7;
const ROW_GAP = 30.48;
const ROW_WIDTH = 235;

function placeRows(geoms: PartGeometry[]): Map<string, { x: number; y: number }> {
  const rows: PartGeometry[][] = [[]];
  let width = 0;
  for (const g of geoms) {
    const w = g.full.x1 - g.full.x0 + COLUMN_GAP;
    if (width + w > ROW_WIDTH && rows.at(-1)!.length) {
      rows.push([]);
      width = 0;
    }
    rows.at(-1)!.push(g);
    width += w;
  }
  const origins = new Map<string, { x: number; y: number }>();
  let top = ORIGIN_Y;
  for (const row of rows) {
    const rail = snapUp(top + Math.max(...row.map((g) => railAnchor(g) - g.full.y0)));
    let left = ORIGIN_X;
    let bottom = rail;
    for (const g of row) {
      const x = snapUp(left - g.full.x0);
      const y = round(rail - railAnchor(g));
      origins.set(g.ref, { x, y });
      left = x + g.full.x1 + COLUMN_GAP;
      bottom = Math.max(bottom, y + g.full.y1);
    }
    top = bottom + ROW_GAP;
  }
  return origins;
}

// ---------------------------------------------------------------- router

interface Cell {
  h?: string;
  v?: string;
  node?: string;
}

const K = 100000;
const key = (x: number, y: number) => x * K + y;

class MinHeap {
  private items: Array<[number, number, number]> = []; // cost, sequence, state
  private seq = 0;
  get size() {
    return this.items.length;
  }
  push(cost: number, state: number) {
    const a = this.items;
    a.push([cost, this.seq++, state]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] < a[i][0] || (a[p][0] === a[i][0] && a[p][1] < a[i][1])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let m = i;
        for (const c of [2 * i + 1, 2 * i + 2]) {
          if (c < a.length && (a[c][0] < a[m][0] || (a[c][0] === a[m][0] && a[c][1] < a[m][1]))) m = c;
        }
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DX = [0, 1, -1, 0, 0];
const DY = [0, 0, 0, 1, -1];
const OPPOSITE = [0, 2, 1, 4, 3];
const TURN_COST = 4;
const CROSS_COST = 8;

export function routeWires(
  intent: Intent,
  geoms: PartGeometry[],
  origins: Map<string, { x: number; y: number }>,
  lib: SymbolLibrary,
  tapFlagNets: string[],
): Wiring | null {
  // Obstacles: bodies with one grid step of clearance, and field text.
  const hard: Box[] = [];
  const blocked = new Set<number>();
  const block = (b: Box, pad: number) => {
    for (let x = Math.ceil((b.x0 - pad) / GRID - 1e-6); x <= Math.floor((b.x1 + pad) / GRID + 1e-6); x++) {
      for (let y = Math.ceil((b.y0 - pad) / GRID - 1e-6); y <= Math.floor((b.y1 + pad) / GRID + 1e-6); y++) blocked.add(key(x, y));
    }
  };
  let extent: Box | undefined;
  const shift = (b: Box, o: { x: number; y: number }): Box => ({ x0: b.x0 + o.x, y0: b.y0 + o.y, x1: b.x1 + o.x, y1: b.y1 + o.y });
  for (const g of geoms) {
    const o = origins.get(g.ref)!;
    const body = shift(g.body, o);
    const fields = [g.reference, g.valueField].map((f) => fieldBox({ ...f, x: f.x + o.x, y: f.y + o.y }));
    hard.push(body, ...fields);
    block(body, GRID + 0.01);
    for (const f of fields) block(f, 0.4);
    extent = unionBox(extent, shift(g.full, o));
  }
  if (!extent) return null;
  const bx0 = gi(extent.x0) - 10;
  const bx1 = gi(extent.x1) + 10;
  const by0 = gi(extent.y0) - 8;
  const by1 = gi(extent.y1) + 12;
  const H = by1 - by0 + 1;

  const cells = new Map<number, Cell>();
  const cell = (k: number) => {
    let c = cells.get(k);
    if (!c) cells.set(k, (c = {}));
    return c;
  };
  const edges = new Map<string, Set<string>>();
  const addEdge = (net: string, ax: number, ay: number, bx: number, by: number) => {
    const [p, q] = ax < bx || (ax === bx && ay < by) ? [[ax, ay], [bx, by]] : [[bx, by], [ax, ay]];
    let set = edges.get(net);
    if (!set) edges.set(net, (set = new Set()));
    set.add(`${p[0]},${p[1]},${q[0]},${q[1]}`);
  };
  /** Record a path of adjacent cells for a net. Ends and corners become nodes that nothing may cross. */
  const addPath = (net: string, path: Array<[number, number]>, allNodes = false) => {
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      const use = ay === by ? "h" : "v";
      cell(key(ax, ay))[use] = net;
      cell(key(bx, by))[use] = net;
      addEdge(net, ax, ay, bx, by);
    }
    path.forEach(([x, y], i) => {
      const corner = i > 0 && i + 1 < path.length && (path[i - 1][0] === x) !== (path[i + 1][0] === x);
      if (allNodes || i === 0 || i === path.length - 1 || corner) cell(key(x, y)).node = net;
    });
  };

  // Seed every connected pin's stub.
  interface Terminal {
    net: string;
    stub: Array<[number, number]>;
  }
  const terminals = new Map<string, Terminal[]>();
  const stubEnds = new Set<number>();
  for (const g of geoms) {
    const o = origins.get(g.ref)!;
    for (const a of g.attachments) {
      if (a.kind !== "stub" || !a.net) continue;
      const px = gi(o.x + a.pin.x);
      const py = gi(o.y + a.pin.y);
      const v = VEC[a.pin.dir];
      const stub: Array<[number, number]> = [[px, py], [px + v.x, py + v.y], [px + 2 * v.x, py + 2 * v.y]];
      addPath(a.net, stub, true);
      stubEnds.add(key(stub[2][0], stub[2][1]));
      terminals.set(a.net, [...(terminals.get(a.net) ?? []), { net: a.net, stub }]);
    }
  }

  const foreign = (c: Cell | undefined, net: string) =>
    !!c && ((c.h !== undefined && c.h !== net) || (c.v !== undefined && c.v !== net) || (c.node !== undefined && c.node !== net));

  /** Shortest path from a stub end to any cell of the net's tree. Dijkstra over (cell, direction). */
  const connect = (net: string, from: [number, number], tree: Set<number>): Array<[number, number]> | null => {
    const stateOf = (x: number, y: number, d: number, straight: number) => (((x - bx0) * H + (y - by0)) * 5 + d) * 2 + straight;
    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    const heap = new MinHeap();
    const start = stateOf(from[0], from[1], 0, 0);
    dist.set(start, 0);
    heap.push(0, start);
    while (heap.size) {
      const [cost, , state] = heap.pop();
      if (cost > (dist.get(state) ?? Infinity)) continue;
      const straight = state & 1;
      const d = (state >> 1) % 5;
      const xy = Math.floor((state >> 1) / 5);
      const x = Math.floor(xy / H) + bx0;
      const y = (xy % H) + by0;
      for (let nd = 1; nd <= 4; nd++) {
        if (d && (nd === OPPOSITE[d] || (straight && nd !== d))) continue;
        const nx = x + DX[nd];
        const ny = y + DY[nd];
        if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
        const k = key(nx, ny);
        const c = cells.get(k);
        let step = 1 + (d && nd !== d ? TURN_COST : 0);
        let nextStraight = 0;
        if (tree.has(k)) {
          if (foreign(c, net)) continue; // never join where another net crosses
          const path: Array<[number, number]> = [[nx, ny], [x, y]];
          for (let s = state; prev.has(s); ) {
            s = prev.get(s)!;
            const q = Math.floor((s >> 1) / 5);
            path.push([Math.floor(q / H) + bx0, (q % H) + by0]);
          }
          return path.reverse();
        }
        if (c && (c.h !== undefined || c.v !== undefined || c.node !== undefined)) {
          // Only a straight, perpendicular crossing of another net's plain wire is allowed.
          const horizontal = nd <= 2;
          const crossable = c.node === undefined && (horizontal ? c.h === undefined && c.v !== undefined && c.v !== net : c.v === undefined && c.h !== undefined && c.h !== net);
          if (!crossable) continue;
          step += CROSS_COST;
          nextStraight = 1;
        } else if (blocked.has(k)) continue;
        const ns = stateOf(nx, ny, nd, nextStraight);
        const nc = cost + step;
        if (nc < (dist.get(ns) ?? Infinity)) {
          dist.set(ns, nc);
          prev.set(ns, state);
          heap.push(nc, ns);
        }
      }
    }
    return null;
  };

  // Small nets first, so rails that must go around get the leftover channels.
  const order = [...intent.nets].sort((a, b) => a.pins.length - b.pins.length);
  for (const net of order) {
    const terms = [...(terminals.get(net.name) ?? [])].sort((a, b) => a.stub[2][0] - b.stub[2][0] || a.stub[2][1] - b.stub[2][1]);
    if (terms.length < 2) continue;
    const tree = new Set(terms[0].stub.map(([x, y]) => key(x, y)));
    for (const t of terms.slice(1)) {
      if (tree.has(key(t.stub[2][0], t.stub[2][1]))) continue; // a pin stacked on one already connected
      const path = connect(net.name, t.stub[2], tree);
      if (!path) return null;
      addPath(net.name, path);
      for (const [x, y] of [...path, ...t.stub]) tree.add(key(x, y));
    }
  }

  // Hang one symbol on a net: a power symbol on a rail, or a PWR_FLAG on an undriven net.
  const taken: Box[] = [];
  const tap = (net: string, def: SymbolDef, text: string) => {
    const dir = naturalDir(def);
    const s = dir === "U" ? -1 : 1;
    const points = new Map<number, [number, number]>();
    for (const e of edges.get(net) ?? []) {
      const [ax, ay, bx, by] = e.split(",").map(Number);
      points.set(key(ax, ay), [ax, ay]);
      points.set(key(bx, by), [bx, by]);
    }
    const xs = [...points.values()].map((p) => p[0]).sort((a, b) => a - b);
    const median = xs[Math.floor(xs.length / 2)] ?? 0;
    const free = (x: number, y: number) => !blocked.has(key(x, y)) && !cells.has(key(x, y));
    let best: { x: number; y: number; box: Box; score: number[] } | undefined;
    for (const [x, y] of points.values()) {
      if (foreign(cells.get(key(x, y)), net) || !free(x, y + s) || !free(x, y + 2 * s)) continue;
      const { box } = powerSymbolAt(def, mm(x), mm(y + 2 * s), 0, text);
      if ([...hard, ...taken].some((b) => intersects(box, b))) continue;
      let clear = true;
      for (let cx = Math.ceil(box.x0 / GRID); cx <= Math.floor(box.x1 / GRID) && clear; cx++) {
        for (let cy = Math.ceil(box.y0 / GRID); cy <= Math.floor(box.y1 / GRID); cy++) {
          if (cells.has(key(cx, cy)) && !(cx === x && (cy === y + s || cy === y + 2 * s))) clear = false;
        }
      }
      if (!clear) continue;
      // Furthest along the symbol's direction, then on an existing branch point, then near the middle.
      const score = [s * y * -1, stubEnds.has(key(x, y)) ? 0 : 1, Math.abs(x - median), x];
      if (!best || better(score, best.score)) best = { x, y, box, score };
    }
    if (!best) return null;
    addPath(net, [[best.x, best.y], [best.x, best.y + s], [best.x, best.y + 2 * s]], true);
    taken.push(best.box);
    return { x: mm(best.x), y: mm(best.y + 2 * s), box: best.box };
  };

  const wiring: Wiring = { wires: [], junctions: [], powers: [], flagTaps: [], box: extent };
  for (const net of intent.nets) {
    const libId = powerSymbolFor(net.name, lib);
    if (libId && edges.has(net.name)) {
      const t = tap(net.name, lib.get(libId), net.name);
      if (!t) return null;
      wiring.powers.push({ net: net.name, libId, x: t.x, y: t.y, rotation: 0 });
      wiring.box = unionBox(wiring.box, t.box);
    }
  }
  for (const net of tapFlagNets) {
    if (!edges.has(net)) return null;
    const t = tap(net, lib.get(PWR_FLAG), "PWR_FLAG");
    if (!t) return null;
    wiring.flagTaps.push({ net, x: t.x, y: t.y });
    wiring.box = unionBox(wiring.box, t.box);
  }

  // Unit edges -> straight wires, split at every junction.
  for (const net of intent.nets) {
    const set = edges.get(net.name);
    if (!set) continue;
    const degree = new Map<number, number>();
    const list = [...set].map((e) => e.split(",").map(Number));
    for (const [ax, ay, bx, by] of list) {
      degree.set(key(ax, ay), (degree.get(key(ax, ay)) ?? 0) + 1);
      degree.set(key(bx, by), (degree.get(key(bx, by)) ?? 0) + 1);
    }
    for (const horizontal of [true, false]) {
      const run = list
        .filter(([ax, ay, bx, by]) => (horizontal ? ay === by : ax === bx))
        .map(([ax, ay]) => (horizontal ? [ay, ax] : [ax, ay])) // [line, position of the edge's low end]
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let i = 0;
      while (i < run.length) {
        const line = run[i][0];
        const startPos = run[i][1];
        let end = startPos + 1;
        while (
          i + 1 < run.length &&
          run[i + 1][0] === line &&
          run[i + 1][1] === end &&
          (degree.get(horizontal ? key(end, line) : key(line, end)) ?? 0) < 3
        ) {
          i++;
          end++;
        }
        i++;
        wiring.wires.push(
          horizontal
            ? { net: net.name, x0: mm(startPos), y0: mm(line), x1: mm(end), y1: mm(line) }
            : { net: net.name, x0: mm(line), y0: mm(startPos), x1: mm(line), y1: mm(end) },
        );
      }
    }
    for (const [k, n] of degree) {
      if (n >= 3) wiring.junctions.push({ net: net.name, x: mm(Math.floor(k / K)), y: mm(k - Math.floor(k / K) * K) });
    }
    for (const [ax, ay, bx, by] of list) {
      wiring.box = unionBox(wiring.box, { x0: mm(Math.min(ax, bx)), y0: mm(Math.min(ay, by)), x1: mm(Math.max(ax, bx)), y1: mm(Math.max(ay, by)) });
    }
  }
  return wiring;
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// ---------------------------------------------------------------- entry

export function layoutWired(intent: Intent, lib: SymbolLibrary, netOf: (ref: string, pin: string) => string | null) {
  // One column per part, in group order.
  const ordered = groupOrder(intent).flatMap((group) => intent.parts.filter((p) => p.group === group));
  const column = new Map(ordered.map((p, i) => [p.ref, i]));

  // A part whose side pins all face away from the parts it connects to is mirrored.
  const neighbours = new Map<string, number[]>();
  for (const net of intent.nets) {
    const refs = [...new Set(net.pins.map((p) => splitPin(p).ref))];
    for (const r of refs) neighbours.set(r, [...(neighbours.get(r) ?? []), ...refs.filter((o) => o !== r).map((o) => column.get(o)!)]);
  }
  const geoms = ordered.map((p) => {
    const def = lib.get(p.libId);
    const side = def.pins.filter((pin) => (pin.dir === "L" || pin.dir === "R") && netOf(p.ref, pin.number) !== null);
    const others = neighbours.get(p.ref) ?? [];
    let mirror = false;
    if (side.length && others.length && side.every((pin) => pin.dir === side[0].dir)) {
      const mean = others.reduce((a, b) => a + b, 0) / others.length;
      const me = column.get(p.ref)!;
      mirror = (side[0].dir === "L" && mean > me) || (side[0].dir === "R" && mean < me);
    }
    return buildWiredPart(p, def, (pin) => netOf(p.ref, pin), mirror);
  });
  return { geoms, origins: placeRows(geoms) };
}
