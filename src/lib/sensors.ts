import type { LinkInputs, MapScenario, Sensor, SensorRole } from '../types';
import type { GroundAt } from './elevation';
import { type LatLon, toLocalM } from './geo';
import { buildProfile, bullingtonLossDb, type Clearance } from './propagation';
import { calculateLink, type LinkResult } from './rf';

export const MAX_SENSORS = 6;

const AUTO_NAME = /^[TR][1-9]\d*$/;

/** First free T1, T2… (transmitters) or R1, R2… (receivers) among the given sensors. */
function nextName(existing: Sensor[], role: SensorRole) {
  const prefix = role === 'tx' ? 'T' : 'R';
  const names = new Set(existing.map((s) => s.name));
  let k = 1;
  while (names.has(`${prefix}${k}`)) k += 1;
  return `${prefix}${k}`;
}

export function createSensor(existing: Sensor[], role: SensorRole, at: LatLon, defaults: LinkInputs): Sensor {
  const ids = new Set(existing.map((s) => s.id));
  let n = existing.length + 1;
  while (ids.has(`sensor-${n}`)) n += 1;
  return {
    id: `sensor-${n}`,
    name: nextName(existing, role),
    role,
    lat: at.lat,
    lon: at.lon,
    aglM: 10,
    gainDbi: role === 'tx' ? defaults.txGainDbi : defaults.rxGainDbi,
    cableLossDb: role === 'tx' ? defaults.txLossDb : defaults.rxLossDb,
    powerDbm: defaults.transmitPowerDbm,
    sensitivityDbm: defaults.sensitivityDbm,
    fadeMarginTargetDb: defaults.fadeMarginTargetDb,
    interferenceThresholdDbm: defaults.interferenceThresholdDbm,
    desiredTxIds: 'auto',
    objective: 'default',
  };
}

export const addSensor = (sensors: Sensor[], sensor: Sensor) => sensors.length >= MAX_SENSORS ? sensors : [...sensors, sensor];

/** Auto-generated names (T1, R2…) follow the new role; names the user typed are kept. */
export function setRole(sensor: Sensor, role: SensorRole, existing: Sensor[] = []): Sensor {
  if (sensor.role === role || !AUTO_NAME.test(sensor.name)) return { ...sensor, role };
  return { ...sensor, role, name: nextName(existing.filter((s) => s.id !== sensor.id), role) };
}

/** Sets one sensor's role; receivers that named it as their transmitter go back to the nearest one. */
export function changeRole(sensors: Sensor[], id: string, role: SensorRole): Sensor[] {
  return sensors.map((s) => {
    if (s.id === id) return setRole(s, role, sensors);
    if (role !== 'rx' || s.desiredTxIds === 'auto' || !s.desiredTxIds.includes(id)) return s;
    const desiredTxIds = s.desiredTxIds.filter((txId) => txId !== id);
    return { ...s, desiredTxIds: desiredTxIds.length ? desiredTxIds : ('auto' as const) };
  });
}

/** Receivers that named the removed sensor as their transmitter go back to the nearest one. */
export const removeSensor = (sensors: Sensor[], id: string) => sensors
  .filter((s) => s.id !== id)
  .map((s) => {
    if (s.desiredTxIds === 'auto' || !s.desiredTxIds.includes(id)) return s;
    const desiredTxIds = s.desiredTxIds.filter((txId) => txId !== id);
    return { ...s, desiredTxIds: desiredTxIds.length ? desiredTxIds : ('auto' as const) };
  });

export function groundOf(s: Sensor, groundAt: GroundAt, useTerrain: boolean): number | null {
  return useTerrain ? groundAt(s) : 0;
}

/** 3D separation in metres. Unknown ground counts as 0 for the arithmetic; callers flag it. */
export function separationM(a: Sensor, b: Sensor, groundAt: GroundAt, useTerrain: boolean): number {
  const pa = toLocalM(a);
  const pb = toLocalM(b);
  const za = (groundOf(a, groundAt, useTerrain) ?? 0) + a.aglM;
  const zb = (groundOf(b, groundAt, useTerrain) ?? 0) + b.aglM;
  return Math.hypot(pb.xM - pa.xM, pb.yM - pa.yM, zb - za);
}

export const effectiveObjective = (map: MapScenario, rx: Sensor) => rx.objective === 'default' ? map.defaultObjective : rx.objective;

export function resolveIntendedTx(scenario: MapScenario, rx: Sensor, groundAt: GroundAt): Sensor | null {
  if (effectiveObjective(scenario, rx) === 'avoidance') return null;
  const transmitters = scenario.sensors.filter((s) => s.role === 'tx');
  const named = rx.desiredTxIds === 'auto' ? undefined : transmitters.find((s) => s.id === rx.desiredTxIds[0]);
  if (named) return named;
  let best: Sensor | null = null;
  let bestDistance = Infinity;
  for (const tx of transmitters) {
    const d = separationM(tx, rx, groundAt, scenario.useTerrainElevation);
    if (d < bestDistance) { best = tx; bestDistance = d; }
  }
  return best;
}

export function pairInputs(shared: LinkInputs, tx: Sensor, rx: Sensor, distanceM: number): LinkInputs {
  return {
    ...shared,
    txId: tx.name,
    rxId: rx.name,
    transmitPowerDbm: tx.powerDbm,
    txGainDbi: tx.gainDbi,
    txLossDb: tx.cableLossDb,
    rxGainDbi: rx.gainDbi,
    rxLossDb: rx.cableLossDb,
    sensitivityDbm: rx.sensitivityDbm,
    fadeMarginTargetDb: rx.fadeMarginTargetDb,
    interferenceThresholdDbm: rx.interferenceThresholdDbm,
    distanceM,
  };
}

export interface PairResult { txId: string; rxId: string; intended: boolean; distanceM: number; result: LinkResult; elevationKnown: boolean; propagationLossDb: number; clearance: Clearance | 'unknown' }

export function pairPropagation(map: MapScenario, tx: Sensor, rx: Sensor, frequencyGhz: number, groundAt: GroundAt): { lossDb: number; clearance: Clearance | 'unknown' } {
  if (map.propagationModel !== 'terrain') return { lossDb: 0, clearance: 'unknown' };
  const sampler = map.useTerrainElevation ? groundAt : () => 0;
  const profile = buildProfile(tx, rx, sampler);
  if (!profile) return { lossDb: NaN, clearance: 'unknown' };
  return bullingtonLossDb(profile, profile.groundM[0] + tx.aglM, profile.groundM[profile.groundM.length - 1] + rx.aglM, frequencyGhz);
}

/** Every Tx→Rx pair: the receiver's intended pair as desired communication, the rest as interference. */
export function evaluatePairs(scenario: MapScenario, shared: LinkInputs, groundAt: GroundAt): PairResult[] {
  const known = (s: Sensor) => groundOf(s, groundAt, scenario.useTerrainElevation) !== null;
  const pairs: PairResult[] = [];
  for (const rx of scenario.sensors.filter((s) => s.role === 'rx')) {
    const intendedId = resolveIntendedTx(scenario, rx, groundAt)?.id;
    for (const tx of scenario.sensors.filter((s) => s.role === 'tx')) {
      const distanceM = separationM(tx, rx, groundAt, scenario.useTerrainElevation);
      const intended = tx.id === intendedId;
      const propagation = pairPropagation(scenario, tx, rx, shared.frequencyGhz, groundAt);
      const inputs = pairInputs(shared, tx, rx, distanceM);
      inputs.otherLossDb += propagation.lossDb;
      pairs.push({
        txId: tx.id,
        rxId: rx.id,
        intended,
        distanceM,
        result: calculateLink(inputs, intended ? 'desired' : 'avoidance'),
        elevationKnown: known(tx) && known(rx) && Number.isFinite(propagation.lossDb),
        propagationLossDb: propagation.lossDb,
        clearance: propagation.clearance,
      });
    }
  }
  return pairs;
}

export function receiverSummary(pairs: PairResult[], rxId: string) {
  const mine = pairs.filter((p) => p.rxId === rxId);
  const interferers = mine.filter((p) => !p.intended && p.result.status === 'Possible interference');
  const worstInterferer = interferers.reduce<PairResult | null>((worst, p) => !worst || p.result.receivedPowerDbm > worst.result.receivedPowerDbm ? p : worst, null);
  return { link: mine.find((p) => p.intended) ?? null, worstInterferer, interferersAbove: interferers.length };
}
