import type { AntennaPlacement, LinkWorkspace, TerrainSettings } from '../types';
import { groundElevationM, WORLD_LIMIT_M } from './terrain';

export type SolveResult = { ok: true; tx: AntennaPlacement } | { ok: false; reason: string };

export const isValidPlacement = (p: AntennaPlacement) =>
  [p.xM, p.yM, p.aglM].every(Number.isFinite) && p.aglM >= 0;

/** Total antenna elevation = ground elevation under the antenna + height above ground. */
export const antennaElevationM = (terrain: TerrainSettings, p: AntennaPlacement) =>
  groundElevationM(terrain, p.xM, p.yM) + p.aglM;

export const groundSeparationM = (ws: LinkWorkspace) => Math.hypot(ws.tx.xM - ws.rx.xM, ws.tx.yM - ws.rx.yM);

export const separation3dM = (ws: LinkWorkspace) => Math.hypot(
  ws.tx.xM - ws.rx.xM,
  ws.tx.yM - ws.rx.yM,
  antennaElevationM(ws.terrain, ws.tx) - antennaElevationM(ws.terrain, ws.rx),
);

/** Unit plan-view direction from Rx to Tx; coincident endpoints fall back to −X. */
function bearing(ws: LinkWorkspace) {
  const dx = ws.tx.xM - ws.rx.xM;
  const dy = ws.tx.yM - ws.rx.yM;
  const length = Math.hypot(dx, dy);
  return length > 0 ? { ux: dx / length, uy: dy / length } : { ux: -1, uy: 0 };
}

const txAlongBearing = (ws: LinkWorkspace, s: number): AntennaPlacement => {
  const { ux, uy } = bearing(ws);
  return { xM: ws.rx.xM + ux * s, yM: ws.rx.yM + uy * s, aglM: ws.tx.aglM };
};

/** Largest radial distance from Rx along the bearing that keeps Tx inside the world bounds. */
function radialLimit(ws: LinkWorkspace) {
  const { ux, uy } = bearing(ws);
  const limits = [[ux, ws.rx.xM], [uy, ws.rx.yM]].map(([u, origin]) => u === 0 ? Infinity : ((u > 0 ? WORLD_LIMIT_M : -WORLD_LIMIT_M) - origin) / u);
  return Math.max(0, Math.min(...limits));
}

/**
 * Every radial distance s (from Rx, along the current bearing, Tx AGL fixed) at which the 3D
 * separation equals distanceM. Flat ground is solved analytically; terrain uses a bounded scan
 * with bisection. Separation is never shorter than s, so roots lie in [0, distanceM].
 */
export function findTxRadialDistances(ws: LinkWorkspace, distanceM: number): number[] {
  if (!ws.terrain.enabled) {
    const dz = Math.abs(antennaElevationM(ws.terrain, ws.tx) - antennaElevationM(ws.terrain, ws.rx));
    return distanceM < dz ? [] : [Math.sqrt(distanceM ** 2 - dz ** 2)];
  }
  const gap = (s: number) => separation3dM({ ...ws, tx: txAlongBearing(ws, s) }) - distanceM;
  const maxS = Math.min(distanceM, radialLimit(ws));
  const samples = Math.min(20_000, Math.max(2_000, Math.ceil(maxS / 2)));
  const roots: number[] = [];
  let s0 = 0;
  let g0 = gap(0);
  if (g0 === 0) roots.push(0);
  for (let i = 1; i <= samples; i += 1) {
    const s1 = (maxS * i) / samples;
    const g1 = gap(s1);
    if (g1 === 0) roots.push(s1);
    else if (g0 !== 0 && Math.sign(g0) !== Math.sign(g1)) {
      let lo = s0;
      let hi = s1;
      let glo = g0;
      for (let k = 0; k < 80; k += 1) {
        const mid = (lo + hi) / 2;
        const gm = gap(mid);
        if (Math.sign(gm) === Math.sign(glo)) { lo = mid; glo = gm; } else hi = mid;
      }
      roots.push((lo + hi) / 2);
    }
    s0 = s1;
    g0 = g1;
  }
  return roots;
}

const fmt = (value: number) => Number(value.toFixed(2)).toString();

/**
 * Moves Tx along its current plan-view bearing from the fixed Rx so the 3D separation equals
 * distanceM. Rx and both AGL values never change; the root nearest the current Tx wins.
 */
export function solveTxForDistance(ws: LinkWorkspace, distanceM: number): SolveResult {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return { ok: false, reason: 'Enter a separation greater than zero.' };
  const roots = findTxRadialDistances(ws, distanceM);
  if (!roots.length) {
    if (!ws.terrain.enabled) {
      const dz = Math.abs(antennaElevationM(ws.terrain, ws.tx) - antennaElevationM(ws.terrain, ws.rx));
      return { ok: false, reason: `Separation must be at least ${fmt(dz)} m for these antenna heights.` };
    }
    return { ok: false, reason: `No position along the current bearing gives ${fmt(distanceM)} m 3D separation over this terrain. Layout unchanged.` };
  }
  const current = groundSeparationM(ws);
  const best = roots.reduce((a, b) => Math.abs(b - current) < Math.abs(a - current) ? b : a);
  return { ok: true, tx: txAlongBearing(ws, best) };
}
