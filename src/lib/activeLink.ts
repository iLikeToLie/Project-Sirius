import type { LinkInputs, MapScenario, Sensor } from '../types';
import type { GroundAt } from './elevation';
import { toLatLon, toLocalM } from './geo';
import { solveTxAlongBearing } from './linkGeometry';
import { groundOf, pairInputs, pairPropagation, resolveIntendedTx, separationM } from './sensors';

/** The part of the app state the active link reads and writes. */
export interface LinkState { inputs: LinkInputs; map: MapScenario }

type Pair = { tx: Sensor; rx: Sensor };

const receivers = (map: MapScenario) => map.sensors.filter((s) => s.role === 'rx');
const nearest = (from: Sensor, candidates: Sensor[], map: MapScenario, groundAt: GroundAt) => candidates.reduce<Sensor | null>((best, s) =>
  !best || separationM(from, s, groundAt, map.useTerrainElevation) < separationM(from, best, groundAt, map.useTerrainElevation) ? s : best, null);
const servedBy = (map: MapScenario, txId: string, groundAt: GroundAt) => receivers(map).filter((rx) => resolveIntendedTx(map, rx, groundAt)?.id === txId);

/**
 * The link the Calculator, sweeps and placements show: the selected receiver's intended pair,
 * else the selected transmitter's nearest served receiver, else the first receiver's pair.
 */
export function activePair(map: MapScenario, groundAt: GroundAt): Pair | null {
  const selected = map.sensors.find((s) => s.id === map.selectedId);
  if (selected?.role === 'rx') {
    const tx = resolveIntendedTx(map, selected, groundAt) ?? nearest(selected, map.sensors.filter(s => s.role === 'tx'), map, groundAt);
    return tx ? { tx, rx: selected } : null;
  }
  if (selected?.role === 'tx') {
    const rx = nearest(selected, servedBy(map, selected.id, groundAt), map, groundAt);
    if (rx) return { tx: selected, rx };
  }
  for (const rx of receivers(map)) {
    const tx = resolveIntendedTx(map, rx, groundAt);
    if (tx) return { tx, rx };
  }
  return null;
}

/** Whose receiver settings a transmitter's range zones use. */
export function zoneReceiver(map: MapScenario, txId: string, groundAt: GroundAt): { rx: Sensor; reason: 'linked' | 'nearest' } | null {
  const tx = map.sensors.find((s) => s.id === txId);
  if (!tx) return null;
  const selected = receivers(map).find(rx => rx.id === map.selectedId);
  if (selected) return { rx: selected, reason: resolveIntendedTx(map, selected, groundAt)?.id === txId ? 'linked' : 'nearest' };
  const linked = servedBy(map, txId, groundAt);
  const picked = linked.find((rx) => rx.id === map.zonesForRxId);
  if (picked) return { rx: picked, reason: 'linked' };
  const linkedNearest = nearest(tx, linked, map, groundAt);
  if (linkedNearest) return { rx: linkedNearest, reason: 'linked' };
  const any = nearest(tx, receivers(map), map, groundAt);
  return any ? { rx: any, reason: 'nearest' } : null;
}

export function activeInputs(state: LinkState, groundAt: GroundAt): LinkInputs {
  const pair = activePair(state.map, groundAt);
  if (!pair) return state.inputs;
  const inputs = pairInputs(state.inputs, pair.tx, pair.rx, separationM(pair.tx, pair.rx, groundAt, state.map.useTerrainElevation));
  return { ...inputs, otherLossDb: inputs.otherLossDb + pairPropagation(state.map, pair.tx, pair.rx, inputs.frequencyGhz, groundAt).lossDb };
}

/** False when terrain is on and either end of the active link has no ground elevation yet. */
export function activeElevationKnown(state: LinkState, groundAt: GroundAt): boolean {
  const pair = activePair(state.map, groundAt);
  if (!pair) return true;
  return [pair.tx, pair.rx].every((s) => groundOf(s, groundAt, state.map.useTerrainElevation) !== null);
}

/** Calculator keys that belong to a sensor of the active pair (inverse of pairInputs). */
const SENSOR_FIELDS: Partial<Record<keyof LinkInputs, ['tx' | 'rx', keyof Sensor]>> = {
  transmitPowerDbm: ['tx', 'powerDbm'],
  txGainDbi: ['tx', 'gainDbi'],
  txLossDb: ['tx', 'cableLossDb'],
  txId: ['tx', 'name'],
  rxGainDbi: ['rx', 'gainDbi'],
  rxLossDb: ['rx', 'cableLossDb'],
  rxId: ['rx', 'name'],
  sensitivityDbm: ['rx', 'sensitivityDbm'],
  fadeMarginTargetDb: ['rx', 'fadeMarginTargetDb'],
  interferenceThresholdDbm: ['rx', 'interferenceThresholdDbm'],
};

const replaceSensor = (map: MapScenario, next: Sensor): MapScenario => ({ ...map, sensors: map.sensors.map((s) => (s.id === next.id ? next : s)) });

export function applyInputEdit<S extends LinkState, K extends keyof LinkInputs>(
  state: S, key: K, value: LinkInputs[K], groundAt: GroundAt,
): { ok: true; state: S } | { ok: false; reason: string } {
  const pair = activePair(state.map, groundAt);
  if (!pair) return { ok: true, state: { ...state, inputs: { ...state.inputs, [key]: value } } };

  if (key === 'distanceM') {
    const local = (s: Sensor) => ({ ...toLocalM(s), aglM: s.aglM });
    const solved = solveTxAlongBearing({
      tx: local(pair.tx),
      rx: local(pair.rx),
      groundAt: (xM, yM) => groundAt(toLatLon({ xM, yM })) ?? 0,
      flat: !state.map.useTerrainElevation,
    }, value as number);
    if (!solved.ok) return solved;
    const at = toLatLon(solved.tx);
    return { ok: true, state: { ...state, map: replaceSensor(state.map, { ...pair.tx, lat: at.lat, lon: at.lon }) } };
  }

  const field = SENSOR_FIELDS[key];
  if (!field) return { ok: true, state: { ...state, inputs: { ...state.inputs, [key]: value } } };
  const [role, sensorKey] = field;
  return { ok: true, state: { ...state, map: replaceSensor(state.map, { ...pair[role], [sensorKey]: value }) } };
}
