import type { LinkInputs, MapScenario, Sensor, SensorRole } from '../types';
import type { GroundAt } from './elevation';
import { type LatLon, toLocalM } from './geo';
import { calculateLink, type LinkResult } from './rf';

export const MAX_SENSORS = 6;

export function createSensor(existing: Sensor[], role: SensorRole, at: LatLon, defaults: LinkInputs): Sensor {
  const ids = new Set(existing.map((s) => s.id));
  let n = existing.length + 1;
  while (ids.has(`sensor-${n}`)) n += 1;
  const prefix = role === 'tx' ? 'T' : 'R';
  const names = new Set(existing.map((s) => s.name));
  let k = 1;
  while (names.has(`${prefix}${k}`)) k += 1;
  return {
    id: `sensor-${n}`,
    name: `${prefix}${k}`,
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
    intendedTxId: 'auto',
  };
}

export const addSensor = (sensors: Sensor[], sensor: Sensor) => sensors.length >= MAX_SENSORS ? sensors : [...sensors, sensor];

export const setRole = (sensor: Sensor, role: SensorRole): Sensor => ({ ...sensor, role });

/** Receivers that named the removed sensor as their transmitter go back to the nearest one. */
export const removeSensor = (sensors: Sensor[], id: string) => sensors
  .filter((s) => s.id !== id)
  .map((s) => s.intendedTxId === id ? { ...s, intendedTxId: 'auto' } : s);

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

export function resolveIntendedTx(scenario: MapScenario, rx: Sensor, groundAt: GroundAt): Sensor | null {
  const transmitters = scenario.sensors.filter((s) => s.role === 'tx');
  const named = transmitters.find((s) => s.id === rx.intendedTxId);
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

export interface PairResult { txId: string; rxId: string; intended: boolean; distanceM: number; result: LinkResult; elevationKnown: boolean }

/** Every Tx→Rx pair: the receiver's intended pair as desired communication, the rest as interference. */
export function evaluatePairs(scenario: MapScenario, shared: LinkInputs, groundAt: GroundAt): PairResult[] {
  const known = (s: Sensor) => groundOf(s, groundAt, scenario.useTerrainElevation) !== null;
  const pairs: PairResult[] = [];
  for (const rx of scenario.sensors.filter((s) => s.role === 'rx')) {
    const intendedId = resolveIntendedTx(scenario, rx, groundAt)?.id;
    for (const tx of scenario.sensors.filter((s) => s.role === 'tx')) {
      const distanceM = separationM(tx, rx, groundAt, scenario.useTerrainElevation);
      const intended = tx.id === intendedId;
      pairs.push({
        txId: tx.id,
        rxId: rx.id,
        intended,
        distanceM,
        result: calculateLink(pairInputs(shared, tx, rx, distanceM), intended ? 'desired' : 'avoidance'),
        elevationKnown: known(tx) && known(rx),
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
