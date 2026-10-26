import { type Bounds, isolineSegments, type ScalarGrid, type Segment } from './contours';

export interface ZoneRequest {
  jobId: number;
  /** Ground elevation over the view in local metres; NaN where unknown. */
  ground: ScalarGrid;
  tx: { xM: number; yM: number; elevationM: number };
  rxAglM: number;
  slant: { sensitivityM: number; requiredM: number; interferenceM: number };
}

export const ZONE = { none: 0, weak: 1, acceptable: 2, unknown: 255 } as const;

export interface ZoneResult {
  jobId: number;
  bounds: Bounds;
  cols: number;
  rows: number;
  cellSizeM: number;
  /** Per grid node, row-major like ScalarGrid. */
  classes: Uint8Array;
  interference: Uint8Array;
  /** Received power per grid node in dBm (terrain coverage only); NaN where unknown or out of range. */
  powerDbm?: Float32Array;
  outlines: { sensitivity: Segment[]; required: Segment[]; interference: Segment[] };
}

/**
 * Free-space range zones of one transmitter for a receiver of the given height above ground:
 * each grid node is a candidate receiver position, classified by its 3D separation from Tx
 * against the threshold slant ranges. Terrain does not block the signal here.
 */
export function computeZones({ jobId, ground, tx, rxAglM, slant }: ZoneRequest): ZoneResult {
  const { x0, y0, dx, dy, cols, rows, values } = ground;
  const separation = new Float64Array(values.length);
  const classes = new Uint8Array(values.length);
  const interference = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const g = values[index];
    if (!Number.isFinite(g)) { separation[index] = NaN; classes[index] = ZONE.unknown; continue; }
    const x = x0 + (index % (cols + 1)) * dx;
    const y = y0 + Math.floor(index / (cols + 1)) * dy;
    const d = Math.hypot(x - tx.xM, y - tx.yM, g + rxAglM - tx.elevationM);
    separation[index] = d;
    classes[index] = d <= slant.requiredM ? ZONE.acceptable : d <= slant.sensitivityM ? ZONE.weak : ZONE.none;
    interference[index] = d <= slant.interferenceM ? 1 : 0;
  }
  const grid: ScalarGrid = { ...ground, values: separation };
  const outline = (range: number) => (Number.isFinite(range) ? isolineSegments(grid, range) : []);
  return {
    jobId,
    bounds: { minX: x0, maxX: x0 + cols * dx, minY: y0, maxY: y0 + rows * dy },
    cols,
    rows,
    cellSizeM: Math.max(dx, dy),
    classes,
    interference,
    outlines: { sensitivity: outline(slant.sensitivityM), required: outline(slant.requiredM), interference: outline(slant.interferenceM) },
  };
}
