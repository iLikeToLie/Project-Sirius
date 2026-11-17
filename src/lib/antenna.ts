import type { AntennaModel, AntennaPattern, MapScenario, Sensor, SensorAntenna } from '../types';
import { type LatLon, toLocalM } from './geo';

/** Cap on the vertical term of the combined 3GPP pattern, in dB. */
export const VERTICAL_CAP_DB = 20;

/** Built-in model id: omni using the sensor's own Gain field. Never stored in the library. */
export const OMNI_MODEL_ID = 'omni';
export const MAX_ANTENNA_MODELS = 24;
export const MAX_PATTERN_POINTS = 721;
type Cut = [number, number][];

/** Linear interpolation of a sorted point table; horizontal cuts wrap at 360, vertical cuts clamp. */
export function interpolateLossDb(cut: Cut, angleDeg: number, wrap: boolean): number {
  if (!cut.length) return 0;
  const a = wrap ? normAzimuth(angleDeg) : angleDeg;
  let lo = 0, hi = cut.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cut[mid][0] < a) lo = mid + 1; else hi = mid;
  }
  if (lo < cut.length && cut[lo][0] === a) return cut[lo][1];
  if (!wrap && lo === 0) return cut[0][1];
  if (!wrap && lo === cut.length) return cut[cut.length - 1][1];
  const left = lo === 0 ? [cut[cut.length - 1][0] - 360, cut[cut.length - 1][1]] : cut[lo - 1];
  const right = lo === cut.length ? [cut[0][0] + 360, cut[0][1]] : cut[lo];
  return left[1] + (right[1] - left[1]) * (a - left[0]) / (right[0] - left[0]);
}

/** Interpolate the precomputed one-degree arrays without allocating in field loops. */
function sampleLoss(samples: number[], angle: number, wrap: boolean): number {
  const i = Math.floor(angle), fraction = angle - i;
  const next = wrap ? (i + 1) % samples.length : Math.min(i + 1, samples.length - 1);
  return samples[i] + fraction * (samples[next] - samples[i]);
}

/** First absolute 3 dB crossings around boresight. Known-axis callers supply wrap explicitly. */
export function derivedBeamwidthDeg(cut: Cut, wrap = !cut.some(([a]) => a < 0)): number {
  if (!cut.length) return 0;
  const vertical = !wrap, limit = vertical ? 90 : 180;
  const centre = interpolateLossDb(cut, 0, wrap);
  if (centre >= 3) return 0;
  const side = (sign: number) => {
    const angles = cut.map(([a]) => vertical ? sign * a : normAzimuth(sign * a))
      .filter(a => a > 0 && a < limit).concat(limit).sort((a, b) => a - b);
    let prevAngle = 0, prevLoss = centre;
    for (const a of angles) {
      const loss = interpolateLossDb(cut, sign * a, wrap);
      if (loss >= 3) return prevAngle + (a - prevAngle) * (3 - prevLoss) / (loss - prevLoss);
      prevAngle = a; prevLoss = loss;
    }
    return limit;
  };
  return side(1) + side(-1);
}

/** Seed editable cuts from the capped 3GPP terms, independent of pointing. */
export function sectorToPoints(model: AntennaModel): NonNullable<AntennaModel['pattern']> {
  const p: AntennaPattern = { ...model, kind: 'sector', azimuthDeg: 0, downtiltDeg: 0 };
  return {
    horizontal: Array.from({ length: 37 }, (_, i) => [i * 10, Math.min(horizontalTermDb(p, i * 10), model.frontToBackDb)]),
    vertical: Array.from({ length: 37 }, (_, i) => [i * 5 - 90, Math.min(verticalTermDb(p, i * 5 - 90), model.frontToBackDb)]),
  };
}

function validCut(value: unknown, min: number, max: number): value is Cut {
  return Array.isArray(value) && value.length >= 2 && value.length <= MAX_PATTERN_POINTS
    && value.every(p => Array.isArray(p) && p.length === 2 && finite(p[0]) && p[0] >= min && p[0] <= max && finite(p[1]) && p[1] >= 0 && p[1] <= 60)
    && new Set(value.map(p => p[0])).size === value.length;
}

function validPattern(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return validCut(p.horizontal, 0, 360) && validCut(p.vertical, -90, 90);
}

function contentHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

type CustomShape = { hLossDb: number[]; vLossDb: number[]; patternKey: string; beamwidthDeg: number; verticalBeamwidthDeg: number };
const customShapes = new WeakMap<AntennaModel, CustomShape>();
function customShape(model: AntennaModel): CustomShape {
  const cached = customShapes.get(model);
  if (cached) return cached;
  const horizontal = [...model.pattern!.horizontal].sort((a, b) => a[0] - b[0]);
  const vertical = [...model.pattern!.vertical].sort((a, b) => a[0] - b[0]);
  const shape = {
    hLossDb: Array.from({ length: 360 }, (_, i) => interpolateLossDb(horizontal, i, true)),
    vLossDb: Array.from({ length: 181 }, (_, i) => interpolateLossDb(vertical, i - 90, false)),
    beamwidthDeg: derivedBeamwidthDeg(horizontal, true), verticalBeamwidthDeg: derivedBeamwidthDeg(vertical, false),
    patternKey: `${model.id}:${contentHash(JSON.stringify([horizontal, vertical]))}`,
  };
  customShapes.set(model, shape);
  return shape;
}

/** All pattern inputs read by the maths, including pointing and the original custom table hash. */
export function patternKey(p: AntennaPattern): string {
  if (p.kind === 'omni') return 'omni';
  return JSON.stringify([p.kind, p.azimuthDeg, p.downtiltDeg, p.frontToBackDb,
    p.kind === 'custom' ? p.patternKey : [p.beamwidthDeg, p.verticalBeamwidthDeg]]);
}

/** A fresh sensor antenna: built-in omni, pointing north, no tilt, not tracking. */
export const defaultSensorAntenna = (): SensorAntenna => ({ modelId: OMNI_MODEL_ID, azimuthDeg: 0, downtiltDeg: 0, aimAtId: null });

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
  antenna.kind === 'custom' ? sampleLoss(antenna.hLossDb!, normAzimuth(bearing - antenna.azimuthDeg), true)
    : 12 * (offAxisDeg(antenna.azimuthDeg, bearing) / antenna.beamwidthDeg) ** 2;

/** Vertical term Av = min(12 ((e + tilt)/θv)², 20) for a far end `elevDeg` above the horizon. */
export const verticalTermDb = (antenna: AntennaPattern, elevDeg: number): number =>
  antenna.kind === 'custom' ? sampleLoss(antenna.vLossDb!, Math.max(-90, Math.min(90, elevDeg + antenna.downtiltDeg)) + 90, false)
    : Math.min(12 * ((elevDeg + antenna.downtiltDeg) / antenna.verticalBeamwidthDeg) ** 2, VERTICAL_CAP_DB);

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

type Models = Pick<MapScenario, 'antennaModels'>;

export const findModel = (map: Models, id: string): AntennaModel | undefined => map.antennaModels.find((m) => m.id === id);

/** New sector model: 65° × 10°, 25 dB front-to-back, typical gain to 0.5 dB, first free id `ant-<n>` and name "Sector <k>". */
export function newSectorModel(existing: AntennaModel[], name?: string): AntennaModel {
  const ids = new Set(existing.map((m) => m.id));
  let n = existing.length + 1;
  while (ids.has(`ant-${n}`)) n += 1;
  const names = new Set(existing.map((m) => m.name));
  let k = 1;
  while (names.has(`Sector ${k}`)) k += 1;
  return { id: `ant-${n}`, name: name ?? `Sector ${k}`, kind: 'sector', gainDbi: Math.round(typicalGainDbi(65, 10) * 2) / 2,
    beamwidthDeg: 65, verticalBeamwidthDeg: 10, frontToBackDb: 25 };
}

const OMNI_PATTERN = { kind: 'omni', beamwidthDeg: 65, frontToBackDb: 25, verticalBeamwidthDeg: 10 } as const;

/** The flat pattern the maths uses: omni (built-in, unknown model or an omni model) or the model's shape with the sensor's pointing. */
export function resolveAntenna(map: Models, sensor: Sensor): AntennaPattern {
  const a = sensor.antenna;
  const model = a.modelId === OMNI_MODEL_ID ? undefined : findModel(map, a.modelId);
  if (!model || model.kind === 'omni') return { ...OMNI_PATTERN, azimuthDeg: a.azimuthDeg, downtiltDeg: a.downtiltDeg };
  if (model.kind === 'custom') {
    const shape = customShape(model);
    return { ...shape, kind: 'custom', frontToBackDb: model.frontToBackDb, azimuthDeg: a.azimuthDeg, downtiltDeg: a.downtiltDeg };
  }
  return { kind: 'sector', azimuthDeg: a.azimuthDeg, beamwidthDeg: model.beamwidthDeg, frontToBackDb: model.frontToBackDb,
    verticalBeamwidthDeg: model.verticalBeamwidthDeg, downtiltDeg: a.downtiltDeg };
}

/** Boresight gain the link maths uses: the sensor's Gain for built-in omni (or an unknown model), else the model's. */
export function effectiveGainDbi(map: Models, sensor: Sensor): number {
  const model = sensor.antenna.modelId === OMNI_MODEL_ID ? undefined : findModel(map, sensor.antenna.modelId);
  return model ? model.gainDbi : sensor.gainDbi;
}

/**
 * Points every sensor with an Aim at target at it (bearing to 0.1°). Returns the same array, and the same
 * sensor objects, when nothing changes.
 */
export function applyAimTracking(sensors: Sensor[]): Sensor[] {
  let changed = false;
  const byId = new Map(sensors.map((s) => [s.id, s]));
  const next = sensors.map((s) => {
    const id = s.antenna.aimAtId;
    const target = id === null ? undefined : byId.get(id);
    if (!target || target === s) return s;
    const azimuthDeg = normAzimuth(Math.round(bearingDeg(s, target) * 10) / 10);
    if (azimuthDeg === s.antenna.azimuthDeg) return s;
    changed = true;
    return { ...s, antenna: { ...s.antenna, azimuthDeg } };
  });
  return changed ? next : sensors;
}

/** The map with aim tracking applied; the same object when nothing moves. */
export function trackMap(map: MapScenario): MapScenario {
  const tracked = applyAimTracking(map.sensors);
  return tracked === map.sensors ? map : { ...map, sensors: tracked };
}

/** Maps every sensor through `fn` and re-applies aim tracking (use for any sensor edit made outside the Link workspace). */
export const updateMapSensors = (map: MapScenario, fn: (sensor: Sensor) => Sensor): MapScenario => trackMap({ ...map, sensors: map.sensors.map(fn) });

/** Azimuth for a pointer `dx` right and `dy` down (screen px) of the sensor, on a map rotated by `mapBearing`; whole degrees, 5° with Shift. */
export function azimuthFromPointer(dx: number, dy: number, mapBearing: number, shift = false): number {
  const raw = Math.atan2(dx, -dy) * 180 / Math.PI + mapBearing;
  const step = shift ? 5 : 1;
  return normAzimuth(Math.round(raw / step) * step);
}

/** Removes a model; its sensors go back to the built-in omni. */
export function deleteModel(map: MapScenario, id: string): MapScenario {
  return { ...map, antennaModels: map.antennaModels.filter((m) => m.id !== id),
    sensors: map.sensors.map((s) => s.antenna.modelId === id ? { ...s, antenna: { ...s.antenna, modelId: OMNI_MODEL_ID } } : s) };
}

/**
 * Pattern loss of a real Tx→Rx pair: Tx uses the bearing Tx→Rx, Rx uses Rx→Tx. With both antenna
 * elevations (metres above the same datum) each end also sees the far end's elevation angle;
 * without them the elevation is 0. Patterns are resolved from the map's library.
 */
export function pairPatternLoss(map: Models, tx: Sensor, rx: Sensor, txElevM?: number, rxElevM?: number): PairPatternLoss {
  const txA = resolveAntenna(map, tx), rxA = resolveAntenna(map, rx);
  const txBearing = bearingDeg(tx, rx);
  const rxBearing = bearingDeg(rx, tx);
  let txEl = 0, rxEl = 0;
  if (txElevM !== undefined && rxElevM !== undefined && Number.isFinite(txElevM) && Number.isFinite(rxElevM)) {
    const a = toLocalM(tx), b = toLocalM(rx);
    const horizontalM = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    txEl = elevationDeg(txElevM, rxElevM, horizontalM);
    rxEl = elevationDeg(rxElevM, txElevM, horizontalM);
  }
  const txDb = patternLossDb(txA, txBearing, txEl);
  const rxDb = patternLossDb(rxA, rxBearing, rxEl);
  return {
    txDb,
    rxDb,
    txOffDeg: txA.kind === 'omni' ? NaN : offAxisDeg(txA.azimuthDeg, txBearing),
    rxOffDeg: rxA.kind === 'omni' ? NaN : offAxisDeg(rxA.azimuthDeg, rxBearing),
    txElevDeg: txA.kind === 'omni' ? NaN : txEl,
    rxElevDeg: rxA.kind === 'omni' ? NaN : rxEl,
    totalDb: txDb + rxDb,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** id and name non-empty strings, kind omni/sector/custom, gain finite, beamwidth 1–180, vertical beamwidth 1–90, front-to-back 0–60. */
export function isAntennaModel(value: unknown): value is AntennaModel {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && v.id !== '' && typeof v.name === 'string' && v.name.trim() !== ''
    && (v.kind === 'omni' || v.kind === 'sector' || v.kind === 'custom') && finite(v.gainDbi)
    && (v.kind !== 'custom' || v.pattern !== undefined)
    && (v.pattern === undefined || validPattern(v.pattern))
    && finite(v.beamwidthDeg) && v.beamwidthDeg >= 1 && v.beamwidthDeg <= 180
    && finite(v.verticalBeamwidthDeg) && v.verticalBeamwidthDeg >= 1 && v.verticalBeamwidthDeg <= 90
    && finite(v.frontToBackDb) && v.frontToBackDb >= 0 && v.frontToBackDb <= 60;
}

/** modelId string, azimuth finite, downtilt −20..45, aimAtId string or null. */
export function isSensorAntenna(value: unknown): value is SensorAntenna {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.modelId === 'string' && finite(v.azimuthDeg) && finite(v.downtiltDeg) && v.downtiltDeg >= -20 && v.downtiltDeg <= 45
    && (v.aimAtId === null || typeof v.aimAtId === 'string');
}
