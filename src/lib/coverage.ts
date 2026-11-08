import type { LinkInputs } from '../types';
import { isolineSegments, type ScalarGrid } from './contours';
import { toLocalM, type LatLon } from './geo';
import { earthBulgeM, EFFECTIVE_EARTH_RADIUS_M, fresnelRadiusM, knifeEdgeLossDb } from './propagation';
import { calculateLink, SPEED_OF_LIGHT_MPS } from './rf';

export interface CoverageRequest {
  jobId: number; tx: LatLon & { elevationM: number }; rxAglM: number; inputs: LinkInputs;
  maxRangeM: number; radials: number; stepM: number; ground: { origin: LatLon; grid: ScalarGrid };
  /** Building heights above ground on the same nodes as the ground grid; absent when buildings are off. */
  buildings?: { grid: ScalarGrid; rxOnRoof: boolean; /** A street-level transmitter's own building height, skipped near it; 0 for none or a roof mount. */ txOwnM: number };
}
export interface CoverageResult {
  jobId: number; powerDbm: Float32Array; radials: number; steps: number; stepM: number; unknown: Uint8Array;
}

export function gridGroundAt(grid: ScalarGrid, x: number, y: number): number {
  const fx = (x - grid.x0) / grid.dx, fy = (y - grid.y0) / grid.dy;
  if (fx < 0 || fy < 0 || fx > grid.cols || fy > grid.rows) return NaN;
  const i = Math.min(grid.cols - 1, Math.floor(fx)), j = Math.min(grid.rows - 1, Math.floor(fy));
  const a = fx - i, b = fy - j, k = j * (grid.cols + 1) + i;
  const v = grid.values;
  return (v[k] * (1 - a) + v[k + 1] * a) * (1 - b) + (v[k + grid.cols + 1] * (1 - a) + v[k + grid.cols + 2] * a) * b;
}

/**
 * Ground just outside the grid takes the nearest edge value, within `slack` metres. Each map cell
 * reads its nearest ray step, whose sample can lie up to half a step beyond the grid; without this
 * those cells at the map edge would read as unknown ground.
 */
export function gridGroundNear(grid: ScalarGrid, x: number, y: number, slack: number): number {
  const clamp = (v: number, lo: number, hi: number) => (v < lo - slack || v > hi + slack ? NaN : Math.min(hi, Math.max(lo, v)));
  const cx = clamp(x, grid.x0, grid.x0 + grid.cols * grid.dx), cy = clamp(y, grid.y0, grid.y0 + grid.rows * grid.dy);
  return Number.isNaN(cx) || Number.isNaN(cy) ? NaN : gridGroundAt(grid, cx, cy);
}

/** Ray step: 30 m, or 5 m with buildings so a block is not stepped over; at most 400 (or 2,000) steps. */
export const coverageStepM = (maxRangeM: number, buildings: boolean) => buildings ? Math.max(5, maxRangeM / 2000) : Math.max(30, maxRangeM / 400);

/** Incremental horizon edge: constant work per receiver, without rebuilding each path profile. */
export function computeCoverage(req: CoverageRequest): CoverageResult {
  if (!Number.isInteger(req.radials) || req.radials < 1 || req.radials > 1440 || !Number.isFinite(req.stepM) || req.stepM <= 0 || !Number.isFinite(req.maxRangeM) || req.maxRangeM <= 0) throw new Error('Invalid coverage dimensions');
  const steps = Math.ceil(req.maxRangeM / req.stepM);
  if (steps * req.radials > 2_000_000) throw new Error('Coverage grid too large');
  const powerDbm = new Float32Array(req.radials * steps), unknown = new Uint8Array(powerDbm.length);
  const basePower = calculateLink({ ...req.inputs, distanceM: 1 }).receivedPowerDbm;
  const wavelength = SPEED_OF_LIGHT_MPS / (req.inputs.frequencyGhz * 1e9);
  const tx = toLocalM(req.tx, req.ground.origin);
  for (let r = 0; r < req.radials; r++) {
    const angle = r * 2 * Math.PI / req.radials, sx = Math.sin(angle), sy = Math.cos(angle);
    let horizon = -Infinity, edgeD = 0, edgeGround = 0;
    // A street-level transmitter's own building does not block its rays: skip the run at its height.
    let ownBuilding = (req.buildings?.txOwnM ?? 0) > 0;
    let missing = !Number.isFinite(req.tx.elevationM) || !Number.isFinite(gridGroundAt(req.ground.grid, tx.xM, tx.yM));
    for (let s = 0; s < steps; s++) {
      const d = (s + 1) * req.stepM, index = r * steps + s;
      const ground = gridGroundNear(req.ground.grid, tx.xM + sx * d, tx.yM + sy * d, req.stepM * 0.51);
      missing ||= !Number.isFinite(ground);
      if (missing) { unknown[index] = 1; powerDbm[index] = NaN; continue; }
      let building = req.buildings ? gridGroundNear(req.buildings.grid, tx.xM + sx * d, tx.yM + sy * d, req.stepM * 0.51) : 0;
      if (!Number.isFinite(building) || building < 0.5) { building = 0; ownBuilding = false; }
      else if (ownBuilding && Math.abs(building - req.buildings!.txOwnM) < 1) building = 0;
      else ownBuilding = false;
      const surface = ground + building;
      const rxElevation = (req.buildings?.rxOnRoof ? surface : ground) + req.rxAglM;
      let loss = 0;
      if (edgeD > 0) {
        const ray = req.tx.elevationM + (rxElevation - req.tx.elevationM) * edgeD / d;
        const deficit = edgeGround + earthBulgeM(edgeD, d - edgeD) - ray;
        const fresnel = fresnelRadiusM(edgeD, d - edgeD, wavelength);
        if (deficit > -0.6 * fresnel) loss = knifeEdgeLossDb(deficit * Math.SQRT2 / fresnel);
      }
      powerDbm[index] = basePower - 20 * Math.log10(Math.hypot(d, rxElevation - req.tx.elevationM)) - loss;
      const slope = (surface - req.tx.elevationM) / d - d / (2 * EFFECTIVE_EARTH_RADIUS_M);
      if (slope > horizon) { horizon = slope; edgeD = d; edgeGround = surface; }
    }
  }
  return { jobId: req.jobId, powerDbm, radials: req.radials, steps, stepM: req.stepM, unknown };
}

/** Nearest polar samples per raster node; NaN for unknown or out-of-range paths. */
export function reprojectPowers(out: CoverageResult, source: { xM: number; yM: number }, raster: ScalarGrid): Float64Array {
  const { x0, y0, dx, dy, cols } = raster;
  const powers = new Float64Array(raster.values.length).fill(NaN);
  for (let k = 0; k < powers.length; k++) {
    const x = x0 + k % (cols + 1) * dx - source.xM, y = y0 + Math.floor(k / (cols + 1)) * dy - source.yM;
    const d = Math.hypot(x, y);
    if (d > out.steps * out.stepM) continue;
    const radial = Math.round((Math.atan2(x, y) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * out.radials) % out.radials;
    const step = Math.max(0, Math.min(out.steps - 1, Math.round(d / out.stepM) - 1));
    const index = radial * out.steps + step;
    if (!out.unknown[index]) powers[k] = out.powerDbm[index];
  }
  return powers;
}

/** Reprojects nearest polar samples onto the map's existing zone raster. */
export function coverageZones(out: CoverageResult, req: Omit<CoverageRequest, 'jobId'>, raster: ScalarGrid, withOutlines = true): import('./zones').ZoneResult {
  const { x0, y0, dx, dy, cols, rows } = raster;
  const tx = toLocalM(req.tx, req.ground.origin);
  const classes = new Uint8Array(raster.values.length), interference = new Uint8Array(classes.length);
  const powers = reprojectPowers(out, tx, raster);
  for (let k = 0; k < classes.length; k++) {
    const x = x0 + k % (cols + 1) * dx - tx.xM, y = y0 + Math.floor(k / (cols + 1)) * dy - tx.yM;
    // Preserve the existing clear class outside the sweep, distinct from unknown paths within it.
    if (Math.hypot(x, y) > out.steps * out.stepM) continue;
    const p = powers[k];
    classes[k] = !Number.isFinite(p) ? 255 : p >= req.inputs.sensitivityDbm + req.inputs.fadeMarginTargetDb ? 2 : p >= req.inputs.sensitivityDbm ? 1 : 0;
    interference[k] = p >= req.inputs.interferenceThresholdDbm ? 1 : 0;
  }
  return { jobId: out.jobId, bounds: { minX: x0, maxX: x0 + cols * dx, minY: y0, maxY: y0 + rows * dy }, cols, rows, cellSizeM: Math.max(dx, dy), classes, interference, powerDbm: Float32Array.from(powers), outlines: !withOutlines ? { sensitivity: [], required: [], interference: [] } : {
    sensitivity: isolineSegments({ ...raster, values: powers }, req.inputs.sensitivityDbm),
    required: isolineSegments({ ...raster, values: powers }, req.inputs.sensitivityDbm + req.inputs.fadeMarginTargetDb),
    interference: isolineSegments({ ...raster, values: powers }, req.inputs.interferenceThresholdDbm),
  } };
}
