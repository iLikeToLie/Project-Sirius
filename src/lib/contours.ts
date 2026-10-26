export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

/** Values at (x0 + i·dx, y0 + j·dy), stored row-major: values[j * (cols + 1) + i]. */
export interface ScalarGrid { x0: number; y0: number; dx: number; dy: number; cols: number; rows: number; values: Float64Array }

/** A line piece in world metres: [x1, y1, x2, y2]. */
export type Segment = [number, number, number, number];

export function sampleGrid(bounds: Bounds, cols: number, rows: number, fn: (x: number, y: number) => number): ScalarGrid {
  const dx = (bounds.maxX - bounds.minX) / cols;
  const dy = (bounds.maxY - bounds.minY) / rows;
  const values = new Float64Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) values[j * (cols + 1) + i] = fn(bounds.minX + i * dx, bounds.minY + j * dy);
  }
  return { x0: bounds.minX, y0: bounds.minY, dx, dy, cols, rows, values };
}

/** Marching squares. Cells with any missing (nonfinite) corner are unknown and produce no line. */
export function isolineSegments(grid: ScalarGrid, level: number): Segment[] {
  const { x0, y0, dx, dy, cols, rows, values } = grid;
  const segments: Segment[] = [];
  const at = (i: number, j: number) => values[j * (cols + 1) + i];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (!v.every(Number.isFinite)) continue;
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const crossings: number[][] = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const next = (edge + 1) % 4;
        if ((v[edge] < level) !== (v[next] < level)) {
          const t = (level - v[edge]) / (v[next] - v[edge]);
          crossings.push([
            x0 + (corners[edge][0] + t * (corners[next][0] - corners[edge][0])) * dx,
            y0 + (corners[edge][1] + t * (corners[next][1] - corners[edge][1])) * dy,
          ]);
        }
      }
      for (let k = 0; k + 1 < crossings.length; k += 2) segments.push([crossings[k][0], crossings[k][1], crossings[k + 1][0], crossings[k + 1][1]]);
    }
  }
  return segments;
}

const MAX_LEVELS = 200;

/** Multiples of interval within [min, max]; the step grows (×2, ×5, ×10…) if it would exceed 200 lines. */
export function contourLevels(min: number, max: number, interval: number): number[] {
  if (![min, max, interval].every(Number.isFinite) || interval <= 0 || max < min) return [];
  const factors = [1, 2, 5];
  let step = interval;
  for (let n = 0; Math.floor(max / step) - Math.ceil(min / step) + 1 > MAX_LEVELS; n += 1) {
    step = interval * factors[(n + 1) % 3] * 10 ** Math.floor((n + 1) / 3);
  }
  const levels: number[] = [];
  for (let k = Math.ceil(min / step); k * step <= max; k += 1) levels.push(k * step + 0); // + 0 turns −0 into 0
  return levels;
}
