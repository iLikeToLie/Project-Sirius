import type { LinkInputs, MapScenario, Sensor } from '../types';
import { isolineSegments, type ScalarGrid } from './contours';
import type { GroundAt } from './elevation';
import { effectiveMarginDb, placementAllowance, placementClass, PLACEMENT, sumDbm, usesAggregate } from './interference';
import type { MultiFieldRequest, MultiFieldResult } from './multiField';
import { groundOf, pairLinkInputs, resolveDesiredTxs, type PairResult } from './sensors';
import { ZONE, type ZoneResult } from './zones';

export function referenceReceiver(map: MapScenario, selected: Sensor | null, zoneRx: Sensor | null): Sensor | null {
  return selected?.role === 'rx' ? selected : zoneRx ?? map.sensors.find(s => s.role === 'rx') ?? null;
}

export function interferenceSources(map: MapScenario, shared: LinkInputs, rx: Sensor, groundAt: GroundAt): MultiFieldRequest['sources'] {
  const desired = new Set(resolveDesiredTxs(map, rx, groundAt).map(s => s.id));
  return map.sensors.filter(s => s.role === 'tx' && !desired.has(s.id)).map(tx => {
    const ground = groundOf(tx, groundAt, map.useTerrainElevation);
    return { lat: tx.lat, lon: tx.lon, elevationM: ground === null ? NaN : ground + tx.aglM,
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
    return { lat: rx.lat, lon: rx.lon, elevationM: ground === null ? NaN : ground + rx.aglM,
      inputs: pairLinkInputs(map, shared, tx, rx, 1).inputs };
  });
  return { victims, served, sources };
}

export function placementZones(plan: ReturnType<typeof placementPlan>, raster: ScalarGrid, out: MultiFieldResult): ZoneResult {
  const classes = new Uint8Array(raster.values.length);
  for (let k = 0; k < classes.length; k++) {
    classes[k] = !Number.isFinite(raster.values[k]) ? PLACEMENT.unknown : placementClass(
      plan.victims.map((v, i) => ({ ...v, powerDbm: out.powers[i]?.[k] ?? NaN })),
      plan.served.map((rx, i) => ({ requiredDbm: rx.sensitivityDbm + rx.fadeMarginTargetDb,
        powerDbm: out.powers[plan.victims.length + i]?.[k] ?? NaN })),
    );
  }
  return { jobId: out.jobId, cols: raster.cols, rows: raster.rows, cellSizeM: Math.max(raster.dx, raster.dy),
    bounds: { minX: raster.x0, maxX: raster.x0 + raster.cols * raster.dx, minY: raster.y0, maxY: raster.y0 + raster.rows * raster.dy },
    classes, interference: new Uint8Array(classes.length), outlines: placementOutlines(raster, classes) };
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
export function interferenceZones(map: MapScenario, rx: Sensor, raster: ScalarGrid, out: MultiFieldResult): ZoneResult {
  const classes = new Uint8Array(raster.values.length), interference = new Uint8Array(classes.length);
  const powerDbm = new Float32Array(classes.length);
  const aggregate = usesAggregate(map, rx), threshold = rx.interferenceThresholdDbm;
  const limit = threshold - effectiveMarginDb(map, rx);
  for (let k = 0; k < classes.length; k++) {
    const powers = out.powers.map(p => p[k]);
    if (!Number.isFinite(raster.values[k]) || powers.some(p => !Number.isFinite(p))) {
      classes[k] = ZONE.unknown; powerDbm[k] = NaN; continue;
    }
    const power = aggregate ? sumDbm(powers) : powers.reduce((max, p) => Math.max(max, p), -Infinity);
    powerDbm[k] = power;
    interference[k] = power >= threshold ? 1 : 0;
    classes[k] = power >= limit && power < threshold ? ZONE.weak : ZONE.none;
  }
  return { jobId: out.jobId, cols: raster.cols, rows: raster.rows, cellSizeM: Math.max(raster.dx, raster.dy),
    bounds: { minX: raster.x0, maxX: raster.x0 + raster.cols * raster.dx, minY: raster.y0, maxY: raster.y0 + raster.rows * raster.dy },
    classes, interference, powerDbm, outlines: {
      required: [],
      // The protected-margin edge only differs from the interference edge when a margin is set.
      sensitivity: limit < threshold ? isolineSegments({ ...raster, values: Float64Array.from(powerDbm) }, limit) : [],
      interference: isolineSegments({ ...raster, values: Float64Array.from(powerDbm) }, threshold),
    } };
}
