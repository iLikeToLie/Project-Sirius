import type { AntennaPattern, Sensor } from '../types';
import { type LatLon, toLocalM } from './geo';

/** Omni, with the sector values a switch to Sector starts from. */
export const DEFAULT_ANTENNA: AntennaPattern = { kind: 'omni', azimuthDeg: 0, beamwidthDeg: 65, frontToBackDb: 25 };

/** A fresh copy, safe to mutate or store on a sensor. */
export const defaultAntenna = (): AntennaPattern => ({ ...DEFAULT_ANTENNA });

/** Any finite angle into [0, 360). */
export const normAzimuth = (deg: number): number => {
  const n = ((deg % 360) + 360) % 360;
  return n >= 360 ? 0 : n;
};

/** Bearing from `from` to `to` in degrees from true north, clockwise, in [0, 360) (workspace local plane). */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const a = toLocalM(from);
  const b = toLocalM(to);
  return normAzimuth(Math.atan2(b.xM - a.xM, b.yM - a.yM) * 180 / Math.PI);
}

/** Smallest angle between an azimuth and a bearing, in [0, 180]. */
export function offAxisDeg(azimuthDeg: number, bearing: number): number {
  const d = Math.abs(normAzimuth(azimuthDeg) - normAzimuth(bearing));
  return d > 180 ? 360 - d : d;
}

/** Attenuation below boresight gain toward `bearing`: 0 for Omni, else min(12 (φ/θ3dB)², FBR). */
export function patternLossDb(antenna: AntennaPattern, bearing: number): number {
  if (antenna.kind === 'omni') return 0;
  const phi = offAxisDeg(antenna.azimuthDeg, bearing);
  return Math.min(12 * (phi / antenna.beamwidthDeg) ** 2, antenna.frontToBackDb);
}

export interface PairPatternLoss {
  txDb: number;
  rxDb: number;
  /** Off-axis angle at each end in degrees; NaN for an Omni end. */
  txOffDeg: number;
  rxOffDeg: number;
  totalDb: number;
}

/** Zero loss, Omni at both ends. */
export const ZERO_PATTERN_LOSS: PairPatternLoss = { txDb: 0, rxDb: 0, txOffDeg: NaN, rxOffDeg: NaN, totalDb: 0 };

/** Pattern loss of a real Tx→Rx pair: Tx uses the bearing Tx→Rx, Rx uses Rx→Tx. */
export function pairPatternLoss(tx: Sensor, rx: Sensor): PairPatternLoss {
  const txBearing = bearingDeg(tx, rx);
  const rxBearing = bearingDeg(rx, tx);
  const txDb = patternLossDb(tx.antenna, txBearing);
  const rxDb = patternLossDb(rx.antenna, rxBearing);
  return {
    txDb,
    rxDb,
    txOffDeg: tx.antenna.kind === 'omni' ? NaN : offAxisDeg(tx.antenna.azimuthDeg, txBearing),
    rxOffDeg: rx.antenna.kind === 'omni' ? NaN : offAxisDeg(rx.antenna.azimuthDeg, rxBearing),
    totalDb: txDb + rxDb,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Kind is omni/sector, azimuth any finite number, beamwidth 1–180, front-to-back 0–60. */
export function isAntennaPattern(value: unknown): value is AntennaPattern {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.kind === 'omni' || v.kind === 'sector') && finite(v.azimuthDeg)
    && finite(v.beamwidthDeg) && v.beamwidthDeg >= 1 && v.beamwidthDeg <= 180
    && finite(v.frontToBackDb) && v.frontToBackDb >= 0 && v.frontToBackDb <= 60;
}
