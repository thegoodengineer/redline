// Placement: one column per group, left to right; parts stacked top to
// bottom inside a column. Every origin lands on the 1.27 mm grid.
import { GRID, PartGeometry } from "./connect";

export const ORIGIN_X = 30.48;
export const ORIGIN_Y = 30.48;
const GAP_X = 10.16;
const GAP_Y = 7.62;

export function snapUp(v: number): number {
  return Math.round(Math.ceil(v / GRID - 1e-6) * GRID * 10000) / 10000;
}

export function place(columns: PartGeometry[][]): Map<string, { x: number; y: number }> {
  const origins = new Map<string, { x: number; y: number }>();
  let left = ORIGIN_X;
  for (const column of columns) {
    if (!column.length) continue;
    const x = snapUp(left + Math.max(...column.map((g) => -g.full.x0)));
    let top = ORIGIN_Y;
    for (const g of column) {
      const y = snapUp(top - g.full.y0);
      origins.set(g.ref, { x, y });
      top = y + g.full.y1 + GAP_Y;
    }
    left = x + Math.max(...column.map((g) => g.full.x1)) + GAP_X;
  }
  return origins;
}
