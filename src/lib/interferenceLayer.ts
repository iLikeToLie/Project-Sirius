import type { LinkInputs, MapScenario, Sensor } from '../types';
import { isolineSegments, type ScalarGrid } from './contours';
import { buildingsOf } from './buildings';
import type { GroundAt } from './elevation';
import { effectiveMarginDb, placementAllowance, placementClass, PLACEMENT, sumDbm, usesAggregate } from './interference';
import type { MultiFieldRequest, MultiFieldResult } from './multiField';
import { groundOf, pairLinkInputs, resolveDesiredTxs, type PairResult } from './sensors';
import { ZONE, type ZoneResult } from './zones';

/** The building a street-mounted sensor stands in, whose height its coverage rays skip; 0 otherwise. */
export const streetBuildingM = (s: Sensor, groundAt: GroundAt) => s.mount === 'street' ? buildingsOf(groundAt)?.(s) ?? 0 : 0;

export function referenceReceiver(map: MapScenario, selected: Sensor | null, zoneRx: Sensor | null): Sensor | null {
  return selected?.role === 'rx' ? selected : zoneRx ?? map.sensors.find(s => s.role === 'rx') ?? null;
}

export function interferenceSources(map: MapScenario, shared: LinkInputs, rx: Sensor, groundAt: GroundAt): MultiFieldRequest['sources'] {
  const desired = new Set(resolveDesiredTxs(map, rx, groundAt).map(s => s.id));
  return map.sensors.filter(s => s.role === 'tx' && !desired.has(s.id)).map(tx => {
    const ground = groundOf(tx, groundAt, map.useTerrainElevation);
    return { lat: tx.lat, lon: tx.lon, elevationM: ground === null ? NaN : ground + tx.aglM, ownBuildingM: streetBuildingM(tx, groundAt),
      inputs: pairLinkInputs(map, shared, tx, rx, 1).inputs };
  });
}

export function placementPlan(map: MapScenario, shared: LinkInputs, tx: Sensor, groundAt: GroundAt, pairs: PairResult[]) {
  const receivers = map.sensors.filter(s => s.role === 'rx');
  const served = receivers.filter(rx => resolveDesiredTxs(map, rx, groundAt).some(s => s.id === tx.id));
  const servedIds = new Set(served.map(s => s.id));
  const victims = receivers.filter(rx => !servedIds.has(rx.id)).map(rx => ({ rx,
    limitDbm: placementAllowance(map, rx, tx.id, pairs, effectiveMarginDb(map, rx)),
    thresholdDbm: placementAllowance(map, rx, tx.id, pairs, 0),
    // Raw interference threshold equality is flagged even at zero margin;
    // equality at a lower, C/I-derived allowance remains safe.
    exclusiveThresholdDbm: placementAllowance(map, rx, tx.id, pairs, 0, true),
  }));
  // Reverse the geometry only: power, gains, channel rejection and losses retain Tx-to-Rx roles.
  const sources = [...victims.map(v => v.rx), ...served].map(rx => {
    const ground = groundOf(rx, groundAt, map.useTerrainElevation);
    return { lat: rx.lat, lon: rx.lon, elevationM: ground === null ? NaN : ground + rx.aglM, ownBuildingM: streetBuildingM(rx, groundAt),
      inputs: pairLinkInputs(map, shared, tx, rx, 1).inputs };
  });
  return { victims, served, sources };
}

/** Returned when the map shows a gradient, which draws no band edges. */
const NO_OUTLINES: ZoneResult['outlines'] = { sensitivity: [], required: [], interference: [] };

export function placementZones(plan: ReturnType<typeof placementPlan>, raster: ScalarGrid, out: MultiFieldResult, withOutlines = true): ZoneResult {
  const classes = new Uint8Array(raster.values.length);
  // One scratch record per path, refilled per node; placementClass only reads them.
  const victims = plan.victims.map(v => ({ ...v, powerDbm: NaN }));
  const served = plan.served.map(rx => ({ requiredDbm: rx.sensitivityDbm + rx.fadeMarginTargetDb, powerDbm: NaN }));
  for (let k = 0; k < classes.length; k++) {
    if (!Number.isFinite(raster.values[k])) { classes[k] = PLACEMENT.unknown; continue; }
    for (let i = 0; i < victims.length; i++) victims[i].powerDbm = out.powers[i]?.[k] ?? NaN;
    for (let i = 0; i < served.length; i++) served[i].powerDbm = out.powers[victims.length + i]?.[k] ?? NaN;
    classes[k] = placementClass(victims, served);
  }
  return { jobId: out.jobId, cols: raster.cols, rows: raster.rows, cellSizeM: Math.max(raster.dx, raster.dy),
    bounds: { minX: raster.x0, maxX: raster.x0 + raster.cols * raster.dx, minY: raster.y0, maxY: raster.y0 + raster.rows * raster.dy },
    classes, interference: new Uint8Array(classes.length), outlines: withOutlines ? placementOutlines(raster, classes) : NO_OUTLINES };
}

/** Band edges for the placement layer: Recommended (green), Safe or better (yellow), and the Unsafe edge (red). */
function placementOutlines(raster: ScalarGrid, classes: Uint8Array): ZoneResult['outlines'] {
  const rank = { ...raster, values: Float64Array.from(classes, c => c === PLACEMENT.unknown ? NaN : c) };
  return {
    required: isolineSegments(rank, PLACEMENT.recommended - 0.5),
    sensitivity: isolineSegments(rank, PLACEMENT.safe - 0.5),
    interference: isolineSegments(rank, PLACEMENT.marginal - 0.5),
  };
}

/** Unknown paths remain hatched: a partial sum cannot establish a safe placement. */
export function interferenceZones(map: MapScenario, rx: Sensor, raster: ScalarGrid, out: MultiFieldResult, withOutlines = true): ZoneResult {
  const classes = new Uint8Array(raster.values.length), interference = new Uint8Array(classes.length);
  const powerDbm = new Float32Array(classes.length);
  const aggregate = usesAggregate(map, rx), threshold = rx.interferenceThresholdDbm;
  const limit = threshold - effectiveMarginDb(map, rx);
  const powers: number[] = new Array(out.powers.length);
  for (let k = 0; k < classes.length; k++) {
    let known = Number.isFinite(raster.values[k]);
    for (let i = 0; i < powers.length; i++) { powers[i] = out.powers[i][k]; known &&= Number.isFinite(powers[i]); }
    if (!known) { classes[k] = ZONE.unknown; powerDbm[k] = NaN; continue; }
    const power = aggregate ? sumDbm(powers) : powers.reduce((max, p) => Math.max(max, p), -Infinity);
    powerDbm[k] = power;
    interference[k] = power >= threshold ? 1 : 0;
    classes[k] = power >= limit && power < threshold ? ZONE.weak : ZONE.none;
  }
  const levels = withOutlines ? { ...raster, values: Float64Array.from(powerDbm) } : raster;
  return { jobId: out.jobId, cols: raster.cols, rows: raster.rows, cellSizeM: Math.max(raster.dx, raster.dy),
    bounds: { minX: raster.x0, maxX: raster.x0 + raster.cols * raster.dx, minY: raster.y0, maxY: raster.y0 + raster.rows * raster.dy },
    classes, interference, powerDbm, outlines: withOutlines ? {
      required: [],
      // The protected-margin edge only differs from the interference edge when a margin is set.
      sensitivity: limit < threshold ? isolineSegments(levels, limit) : [],
      interference: isolineSegments(levels, threshold),
    } : NO_OUTLINES };
}
