import type { LinkInputs, MapScenario, Sensor } from '../types';
import type { ScalarGrid } from './contours';
import type { GroundAt } from './elevation';
import { effectiveMarginDb, sumDbm, usesAggregate } from './interference';
import type { MultiFieldRequest, MultiFieldResult } from './multiField';
import { groundOf, pairLinkInputs, resolveDesiredTxs } from './sensors';
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
    classes, interference, powerDbm, outlines: { sensitivity: [], required: [], interference: [] } };
}
