import type { LinkInputs } from '../types';
import type { ScalarGrid } from './contours';
import { computeCoverage, coverageStepM, reprojectPowers } from './coverage';
import { toLocalM, type LatLon } from './geo';
import { calculateLink } from './rf';
import { MAX_SENSORS } from './sensors';

export interface MultiFieldRequest {
  jobId: number;
  raster: ScalarGrid;
  rayGround: ScalarGrid;
  origin: LatLon;
  mode: 'free-space' | 'terrain';
  rxAglM: number;
  /** ownBuildingM: the height of a street-level source's own building, which its rays ignore. */
  sources: (LatLon & { elevationM: number; inputs: LinkInputs; ownBuildingM?: number })[];
  /** Building heights on the rayGround nodes, terrain mode only; receivers on roofs stand on them. */
  rayBuildings?: ScalarGrid;
  rxOnRoof?: boolean;
  /** Callers use 360 normally, or 180 while dragging. */
  radials: number;
}

export interface MultiFieldResult { jobId: number; powers: Float32Array[] }

/** One received-power raster per source, in request order. Combining fields needs no new sweep. */
export function computeMultiField(req: MultiFieldRequest): MultiFieldResult {
  if (req.sources.length > MAX_SENSORS) throw new Error(`At most ${MAX_SENSORS} field sources are supported`);
  if (!Number.isInteger(req.radials) || req.radials < 1 || req.radials > 1440) throw new Error('Invalid field radials');
  const { raster } = req;
  const powers = req.sources.map(source => {
    const tx = toLocalM(source, req.origin);
    const field = new Float32Array(raster.values.length).fill(NaN);
    if (![tx.xM, tx.yM, source.elevationM, req.rxAglM].every(Number.isFinite)) return field;
    if (req.mode === 'terrain') {
      // Reach all four view corners, including when the source is off-screen.
      const maxRangeM = Math.max(30, ...[raster.x0, raster.x0 + raster.cols * raster.dx].flatMap(x =>
        [raster.y0, raster.y0 + raster.rows * raster.dy].map(y => Math.hypot(x - tx.xM, y - tx.yM))));
      const out = computeCoverage({ jobId: req.jobId, tx: source, rxAglM: req.rxAglM, inputs: source.inputs,
        maxRangeM, radials: req.radials, stepM: coverageStepM(maxRangeM, !!req.rayBuildings), ground: { origin: req.origin, grid: req.rayGround },
        buildings: req.rayBuildings && { grid: req.rayBuildings, rxOnRoof: req.rxOnRoof ?? true, txOwnM: source.ownBuildingM ?? 0 } });
      return Float32Array.from(reprojectPowers(out, tx, raster));
    }
    const basePower = calculateLink({ ...source.inputs, distanceM: 1 }).receivedPowerDbm;
    for (let k = 0; k < field.length; k++) {
      const x = raster.x0 + k % (raster.cols + 1) * raster.dx;
      const y = raster.y0 + Math.floor(k / (raster.cols + 1)) * raster.dy;
      const ground = raster.values[k];
      const distance = Math.hypot(x - tx.xM, y - tx.yM, ground + req.rxAglM - source.elevationM);
      if (Number.isFinite(ground) && distance > 0) field[k] = basePower - 20 * Math.log10(distance);
    }
    return field;
  });
  return { jobId: req.jobId, powers };
}
