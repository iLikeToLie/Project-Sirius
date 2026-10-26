import type { GroundAt } from './elevation';
import { toLocalM, type LatLon } from './geo';
import { SPEED_OF_LIGHT_MPS } from './rf';

export const EFFECTIVE_EARTH_RADIUS_M = 6_371_008.8 * 4 / 3;
export const earthBulgeM = (d1M: number, d2M: number) => d1M * d2M / (2 * EFFECTIVE_EARTH_RADIUS_M);
export const knifeEdgeLossDb = (nu: number): number => nu <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.hypot(nu - 0.1, 1) + nu - 0.1);
export const fresnelRadiusM = (d1M: number, d2M: number, wavelengthM: number): number => d1M + d2M > 0 ? Math.sqrt(wavelengthM * d1M * d2M / (d1M + d2M)) : 0;
export interface PathProfile { distancesM: Float64Array; groundM: Float64Array }
export type Clearance = 'los' | 'fresnel' | 'obstructed';

export function buildProfile(from: LatLon, to: LatLon, groundAt: GroundAt, spacingM = 30): PathProfile | null {
  const a = toLocalM(from), b = toLocalM(to);
  const length = Math.hypot(b.xM - a.xM, b.yM - a.yM);
  if (!Number.isFinite(length) || !Number.isFinite(spacingM) || spacingM <= 0) return null;
  // shortcut: paths longer than 15.33 km exceed 30 m spacing; raise the sample cap for finer long-path analysis.
  const intervals = Math.max(1, Math.min(511, Math.ceil(length / spacingM)));
  const distancesM = new Float64Array(intervals + 1), groundM = new Float64Array(intervals + 1);
  for (let i = 0; i <= intervals; i++) {
    const t = i / intervals;
    const ground = groundAt({ lat: from.lat + (to.lat - from.lat) * t, lon: from.lon + (to.lon - from.lon) * t });
    if (ground === null || !Number.isFinite(ground)) return null;
    distancesM[i] = length * t;
    groundM[i] = ground + earthBulgeM(length * t, length * (1 - t));
  }
  return { distancesM, groundM };
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
