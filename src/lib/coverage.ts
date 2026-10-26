import type { LinkInputs } from '../types';
import { isolineSegments, type ScalarGrid } from './contours';
import { toLocalM, type LatLon } from './geo';
import { earthBulgeM, EFFECTIVE_EARTH_RADIUS_M, fresnelRadiusM, knifeEdgeLossDb } from './propagation';
import { calculateLink, SPEED_OF_LIGHT_MPS } from './rf';

export interface CoverageRequest {
  jobId: number; tx: LatLon & { elevationM: number }; rxAglM: number; inputs: LinkInputs;
  maxRangeM: number; radials: number; stepM: number; ground: { origin: LatLon; grid: ScalarGrid };
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
    let missing = !Number.isFinite(req.tx.elevationM) || !Number.isFinite(gridGroundAt(req.ground.grid, tx.xM, tx.yM));
    for (let s = 0; s < steps; s++) {
      const d = (s + 1) * req.stepM, index = r * steps + s;
      const ground = gridGroundAt(req.ground.grid, tx.xM + sx * d, tx.yM + sy * d);
      missing ||= !Number.isFinite(ground);
      if (missing) { unknown[index] = 1; powerDbm[index] = NaN; continue; }
      const rxElevation = ground + req.rxAglM;
      let loss = 0;
      if (edgeD > 0) {
        const ray = req.tx.elevationM + (rxElevation - req.tx.elevationM) * edgeD / d;
        const deficit = edgeGround + earthBulgeM(edgeD, d - edgeD) - ray;
        const fresnel = fresnelRadiusM(edgeD, d - edgeD, wavelength);
        if (deficit > -0.6 * fresnel) loss = knifeEdgeLossDb(deficit * Math.SQRT2 / fresnel);
      }
      powerDbm[index] = basePower - 20 * Math.log10(Math.hypot(d, rxElevation - req.tx.elevationM)) - loss;
      const slope = (ground - req.tx.elevationM) / d - d / (2 * EFFECTIVE_EARTH_RADIUS_M);
      if (slope > horizon) { horizon = slope; edgeD = d; edgeGround = ground; }
    }
  }
  return { jobId: req.jobId, powerDbm, radials: req.radials, steps, stepM: req.stepM, unknown };
}

/** Reprojects nearest polar samples onto the map's existing zone raster. */
export function coverageZones(out: CoverageResult, req: Omit<CoverageRequest, 'jobId'>, raster: ScalarGrid): import('./zones').ZoneResult {
  const { x0, y0, dx, dy, cols, rows } = raster;
  const tx = toLocalM(req.tx, req.ground.origin);
  const classes = new Uint8Array(raster.values.length), interference = new Uint8Array(classes.length);
  const powers = new Float64Array(classes.length).fill(NaN);
  for (let k = 0; k < classes.length; k++) {
    const x = x0 + k % (cols + 1) * dx - tx.xM, y = y0 + Math.floor(k / (cols + 1)) * dy - tx.yM;
    const d = Math.hypot(x, y);
    if (d > out.steps * out.stepM) continue;
    const radial = Math.round((Math.atan2(x, y) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * out.radials) % out.radials;
    const step = Math.max(0, Math.min(out.steps - 1, Math.round(d / out.stepM) - 1));
    const index = radial * out.steps + step, p = out.powerDbm[index];
    if (!out.unknown[index]) powers[k] = p;
    classes[k] = out.unknown[index] || !Number.isFinite(p) ? 255 : p >= req.inputs.sensitivityDbm + req.inputs.fadeMarginTargetDb ? 2 : p >= req.inputs.sensitivityDbm ? 1 : 0;
    interference[k] = !out.unknown[index] && p >= req.inputs.interferenceThresholdDbm ? 1 : 0;
  }
  return { jobId: out.jobId, bounds: { minX: x0, maxX: x0 + cols * dx, minY: y0, maxY: y0 + rows * dy }, cols, rows, cellSizeM: Math.max(dx, dy), classes, interference, powerDbm: Float32Array.from(powers), outlines: {
    sensitivity: isolineSegments({ ...raster, values: powers }, req.inputs.sensitivityDbm),
    required: isolineSegments({ ...raster, values: powers }, req.inputs.sensitivityDbm + req.inputs.fadeMarginTargetDb),
    interference: isolineSegments({ ...raster, values: powers }, req.inputs.interferenceThresholdDbm),
  } };
}
