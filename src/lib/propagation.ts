import { buildingsOf } from './buildings';
import type { GroundAt } from './elevation';
import { toLocalM, type LatLon } from './geo';
import { SPEED_OF_LIGHT_MPS } from './rf';

export const EFFECTIVE_EARTH_RADIUS_M = 6_371_008.8 * 4 / 3;
export const earthBulgeM = (d1M: number, d2M: number) => d1M * d2M / (2 * EFFECTIVE_EARTH_RADIUS_M);
export const knifeEdgeLossDb = (nu: number): number => nu <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.hypot(nu - 0.1, 1) + nu - 0.1);
export const fresnelRadiusM = (d1M: number, d2M: number, wavelengthM: number): number => d1M + d2M > 0 ? Math.sqrt(wavelengthM * d1M * d2M / (d1M + d2M)) : 0;
/** groundM includes Earth bulge and, when buildings are on, building heights; buildingM holds those heights alone. */
export interface PathProfile { distancesM: Float64Array; groundM: Float64Array; buildingM?: Float64Array }
export type Clearance = 'los' | 'fresnel' | 'obstructed';
/** Sample spacing and interval cap with buildings on: 5 m, up to a 20 km path at full detail. */
export const BUILDING_SPACING_M = 5;
const MAX_INTERVALS = 511, MAX_BUILDING_INTERVALS = 4095;

/**
 * Ground profile between two points. With buildings attached to the sampler, building heights stand
 * on the ground, sampled every 5 m. A street-mounted end ignores its own building: the run of
 * samples from that end with its building's height (a footprint is drawn at one height, so a
 * taller or lower neighbour that touches it still counts).
 */
export function buildProfile(from: LatLon, to: LatLon, groundAt: GroundAt, spacingM = 30, street: { from?: boolean; to?: boolean } = {}): PathProfile | null {
  const a = toLocalM(from), b = toLocalM(to);
  const length = Math.hypot(b.xM - a.xM, b.yM - a.yM);
  if (!Number.isFinite(length) || !Number.isFinite(spacingM) || spacingM <= 0) return null;
  const buildingAt = buildingsOf(groundAt);
  const spacing = buildingAt ? Math.min(spacingM, BUILDING_SPACING_M) : spacingM;
  // shortcut: long paths exceed the spacing (15.33 km at 30 m, 20.5 km at 5 m); raise the cap for finer long-path analysis.
  const intervals = Math.max(1, Math.min(buildingAt ? MAX_BUILDING_INTERVALS : MAX_INTERVALS, Math.ceil(length / spacing)));
  const distancesM = new Float64Array(intervals + 1), groundM = new Float64Array(intervals + 1);
  const buildingM = buildingAt ? new Float64Array(intervals + 1) : undefined;
  for (let i = 0; i <= intervals; i++) {
    const t = i / intervals;
    const p = { lat: from.lat + (to.lat - from.lat) * t, lon: from.lon + (to.lon - from.lon) * t };
    const ground = groundAt(p);
    if (ground === null || !Number.isFinite(ground)) return null;
    distancesM[i] = length * t;
    groundM[i] = ground + earthBulgeM(length * t, length * (1 - t));
    if (buildingM) buildingM[i] = buildingAt!(p);
  }
  if (buildingM) {
    const own = (h: number, i: number) => buildingM[i] > 0 && Math.abs(buildingM[i] - h) < 0.05;
    if (street.from) { const h = buildingM[0]; for (let i = 0; i <= intervals && own(h, i); i++) buildingM[i] = 0; }
    if (street.to) { const h = buildingM[intervals]; for (let i = intervals; i >= 0 && own(h, i); i--) buildingM[i] = 0; }
    for (let i = 0; i <= intervals; i++) groundM[i] += buildingM[i];
  }
  return { distancesM, groundM, buildingM };
}

export function bullingtonLossDb(profile: PathProfile, txElevM: number, rxElevM: number, frequencyGhz: number): { lossDb: number; clearance: Clearance; worstIndex: number } {
  const { distancesM: d, groundM: g } = profile;
  const length = d[d.length - 1], wavelength = SPEED_OF_LIGHT_MPS / (frequencyGhz * 1e9);
  let txSlope = -Infinity, rxSlope = -Infinity, maxNu = -Infinity, worstIndex = -1;
  let clearance: Clearance = 'los';
  for (let i = 1; i < d.length - 1; i++) {
    const ray = txElevM + (rxElevM - txElevM) * d[i] / length;
    const deficit = g[i] - ray;
    const f = fresnelRadiusM(d[i], length - d[i], wavelength);
    const nu = deficit * Math.SQRT2 / f;
    if (nu > maxNu) { maxNu = nu; worstIndex = i; }
    if (deficit >= 0) clearance = 'obstructed';
    else if (deficit > -0.6 * f && clearance !== 'obstructed') clearance = 'fresnel';
    txSlope = Math.max(txSlope, (g[i] - txElevM) / d[i]);
    rxSlope = Math.max(rxSlope, (g[i] - rxElevM) / (length - d[i]));
  }
  if (clearance === 'los') return { lossDb: 0, clearance, worstIndex };
  if (txSlope > (rxElevM - txElevM) / length) {
    const edge = (rxElevM - txElevM + rxSlope * length) / (txSlope + rxSlope);
    const height = txElevM + txSlope * edge - (txElevM + (rxElevM - txElevM) * edge / length);
    maxNu = height * Math.SQRT2 / fresnelRadiusM(edge, length - edge, wavelength);
  }
  return { lossDb: knifeEdgeLossDb(maxNu), clearance, worstIndex };
}
