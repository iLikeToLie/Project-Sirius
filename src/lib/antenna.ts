import type { AntennaPattern, Sensor } from '../types';
import { type LatLon, toLocalM } from './geo';

/** Omni, with the sector values a switch to Sector starts from. */
export const DEFAULT_ANTENNA: AntennaPattern = { kind: 'omni', azimuthDeg: 0, beamwidthDeg: 65, frontToBackDb: 25, verticalBeamwidthDeg: 10, downtiltDeg: 0, aimAtId: null };

/** Cap on the vertical term of the combined 3GPP pattern, in dB. */
export const VERTICAL_CAP_DB = 20;

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

/** Elevation angle in degrees of a point `toElevM` above/below `fromElevM`, `horizontalM` away (positive = above the horizon). */
export const elevationDeg = (fromElevM: number, toElevM: number, horizontalM: number): number =>
  Math.atan2(toElevM - fromElevM, horizontalM) * 180 / Math.PI;

/** Typical boresight gain of a beam of the given 3 dB widths: 10 log10(41253 / (h v)) dBi. */
export const typicalGainDbi = (hDeg: number, vDeg: number): number => 10 * Math.log10(41253 / (hDeg * vDeg));

/** Horizontal term Ah = 12 (φ/θh)², not yet capped. */
export const horizontalTermDb = (antenna: AntennaPattern, bearing: number): number =>
  12 * (offAxisDeg(antenna.azimuthDeg, bearing) / antenna.beamwidthDeg) ** 2;

/** Vertical term Av = min(12 ((e + tilt)/θv)², 20) for a far end `elevDeg` above the horizon. */
export const verticalTermDb = (antenna: AntennaPattern, elevDeg: number): number =>
  Math.min(12 * ((elevDeg + antenna.downtiltDeg) / antenna.verticalBeamwidthDeg) ** 2, VERTICAL_CAP_DB);

/** Combined loss of a Sector from its two terms: min(Ah + Av, FBR). */
export const combineLossDb = (antenna: AntennaPattern, horizontalDb: number, verticalDb: number): number =>
  Math.min(horizontalDb + verticalDb, antenna.frontToBackDb);

/**
 * Attenuation below boresight gain toward `bearing` and `elevationDeg` (above the horizon):
 * 0 for Omni, else min(Ah + Av, FBR) with Ah = 12 (φ/θh)² and Av = min(12 ((e + tilt)/θv)², 20).
 */
export function patternLossDb(antenna: AntennaPattern, bearing: number, elevationDeg = 0): number {
  if (antenna.kind === 'omni') return 0;
  return combineLossDb(antenna, horizontalTermDb(antenna, bearing), verticalTermDb(antenna, elevationDeg));
}

export interface PairPatternLoss {
  txDb: number;
  rxDb: number;
  /** Off-axis angle at each end in degrees; NaN for an Omni end. */
  txOffDeg: number;
  rxOffDeg: number;
  /** Elevation angle of the far end seen from each end (positive = above the horizon); NaN for an Omni end. */
  txElevDeg: number;
  rxElevDeg: number;
  totalDb: number;
}

/** Zero loss, Omni at both ends. */
export const ZERO_PATTERN_LOSS: PairPatternLoss = { txDb: 0, rxDb: 0, txOffDeg: NaN, rxOffDeg: NaN, txElevDeg: NaN, rxElevDeg: NaN, totalDb: 0 };

/**
 * Pattern loss of a real Tx→Rx pair: Tx uses the bearing Tx→Rx, Rx uses Rx→Tx. With both antenna
 * elevations (metres above the same datum) each end also sees the far end's elevation angle;
 * without them the elevation is 0.
 */
export function pairPatternLoss(tx: Sensor, rx: Sensor, txElevM?: number, rxElevM?: number): PairPatternLoss {
  const txBearing = bearingDeg(tx, rx);
  const rxBearing = bearingDeg(rx, tx);
  let txEl = 0, rxEl = 0;
  if (txElevM !== undefined && rxElevM !== undefined && Number.isFinite(txElevM) && Number.isFinite(rxElevM)) {
    const a = toLocalM(tx), b = toLocalM(rx);
    const horizontalM = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    txEl = elevationDeg(txElevM, rxElevM, horizontalM);
    rxEl = elevationDeg(rxElevM, txElevM, horizontalM);
  }
  const txDb = patternLossDb(tx.antenna, txBearing, txEl);
  const rxDb = patternLossDb(rx.antenna, rxBearing, rxEl);
  return {
    txDb,
    rxDb,
    txOffDeg: tx.antenna.kind === 'omni' ? NaN : offAxisDeg(tx.antenna.azimuthDeg, txBearing),
    rxOffDeg: rx.antenna.kind === 'omni' ? NaN : offAxisDeg(rx.antenna.azimuthDeg, rxBearing),
    txElevDeg: tx.antenna.kind === 'omni' ? NaN : txEl,
    rxElevDeg: rx.antenna.kind === 'omni' ? NaN : rxEl,
    totalDb: txDb + rxDb,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Kind is omni/sector, azimuth any finite number, beamwidth 1–180, front-to-back 0–60; vertical beamwidth 1–90, downtilt −20..45 and aimAtId (string or null) when present. */
export function isAntennaPattern(value: unknown): value is AntennaPattern {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.kind === 'omni' || v.kind === 'sector') && finite(v.azimuthDeg)
    && finite(v.beamwidthDeg) && v.beamwidthDeg >= 1 && v.beamwidthDeg <= 180
    && finite(v.frontToBackDb) && v.frontToBackDb >= 0 && v.frontToBackDb <= 60
    && (v.verticalBeamwidthDeg === undefined || (finite(v.verticalBeamwidthDeg) && v.verticalBeamwidthDeg >= 1 && v.verticalBeamwidthDeg <= 90))
    && (v.downtiltDeg === undefined || (finite(v.downtiltDeg) && v.downtiltDeg >= -20 && v.downtiltDeg <= 45))
    && (v.aimAtId === undefined || v.aimAtId === null || typeof v.aimAtId === 'string');
}
