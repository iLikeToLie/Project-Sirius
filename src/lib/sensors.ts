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

/** Drops one transmitter from a receiver's desired list; an emptied list returns to auto. */
const withoutDesired = (s: Sensor, id: string): Sensor => {
  if (s.desiredTxIds === 'auto' || !s.desiredTxIds.includes(id)) return s;
  const desiredTxIds = s.desiredTxIds.filter((txId) => txId !== id);
  return { ...s, desiredTxIds: desiredTxIds.length ? desiredTxIds : 'auto' };
};

/** Sets one sensor's role and removes it from desired lists when it becomes a receiver. */
export function changeRole(sensors: Sensor[], id: string, role: SensorRole): Sensor[] {
  return sensors.map((s) => (s.id === id ? setRole(s, role, sensors) : role === 'rx' ? withoutDesired(s, id) : s));
}

/** Removes a sensor and its desired links; an emptied list returns to auto. */
export const removeSensor = (sensors: Sensor[], id: string) => sensors
  .filter((s) => s.id !== id)
  .map((s) => withoutDesired(s, id));

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

export function toggleDesired(current: Sensor['desiredTxIds'], txId: string, allTxIds: string[]): Sensor['desiredTxIds'] {
  const selected = current === 'auto' ? [] : current;
  const next = allTxIds.filter((id) => id === txId ? !selected.includes(id) : selected.includes(id));
  return next.length ? next : 'auto';
}

export function resolveDesiredTxs(scenario: MapScenario, rx: Sensor, groundAt: GroundAt): Sensor[] {
  if (effectiveObjective(scenario, rx) === 'avoidance') return [];
  const transmitters = scenario.sensors.filter((s) => s.role === 'tx');
  const desiredTxIds = rx.desiredTxIds;
  if (desiredTxIds !== 'auto') {
    const named = transmitters.filter((s) => desiredTxIds.includes(s.id));
    if (named.length) return named;
  }
  let best: Sensor | null = null;
  let bestDistance = Infinity;
  for (const tx of transmitters) {
    const d = separationM(tx, rx, groundAt, scenario.useTerrainElevation);
    if (d < bestDistance) { best = tx; bestDistance = d; }
  }
  return best ? [best] : [];
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

export interface PairResult { txId: string; txName: string; rxId: string; intended: boolean; distanceM: number; result: LinkResult; elevationKnown: boolean; propagationLossDb: number; clearance: Clearance | 'unknown' }

export function meterScale(links: PairResult[], inputs: LinkInputs): { scaleMin: number; scaleMax: number } {
  const values = [inputs.sensitivityDbm, inputs.sensitivityDbm + inputs.fadeMarginTargetDb, inputs.interferenceThresholdDbm,
    ...links.filter((p) => p.elevationKnown).map((p) => p.result.receivedPowerDbm)].filter(Number.isFinite);
  return { scaleMin: values.length ? Math.floor(Math.min(...values) - 10) : -120, scaleMax: values.length ? Math.ceil(Math.max(...values) + 10) : 0 };
}

export function pairPropagation(map: MapScenario, tx: Sensor, rx: Sensor, frequencyGhz: number, groundAt: GroundAt): { lossDb: number; clearance: Clearance | 'unknown' } {
  if (map.propagationModel !== 'terrain') return { lossDb: 0, clearance: 'unknown' };
  const sampler = map.useTerrainElevation ? groundAt : () => 0;
  const profile = buildProfile(tx, rx, sampler);
  if (!profile) return { lossDb: NaN, clearance: 'unknown' };
  return bullingtonLossDb(profile, profile.groundM[0] + tx.aglM, profile.groundM[profile.groundM.length - 1] + rx.aglM, frequencyGhz);
}

/** Every Tx→Rx pair: the receiver's desired set as communication, the rest as interference. */
export function evaluatePairs(scenario: MapScenario, shared: LinkInputs, groundAt: GroundAt): PairResult[] {
  const known = (s: Sensor) => groundOf(s, groundAt, scenario.useTerrainElevation) !== null;
  const pairs: PairResult[] = [];
  for (const rx of scenario.sensors.filter((s) => s.role === 'rx')) {
    const desired = resolveDesiredTxs(scenario, rx, groundAt);
    for (const tx of scenario.sensors.filter((s) => s.role === 'tx')) {
      const distanceM = separationM(tx, rx, groundAt, scenario.useTerrainElevation);
      const intended = desired.some((d) => d.id === tx.id);
      const propagation = pairPropagation(scenario, tx, rx, shared.frequencyGhz, groundAt);
      const inputs = pairInputs(shared, tx, rx, distanceM);
      inputs.otherLossDb += propagation.lossDb;
      pairs.push({
        txId: tx.id,
        txName: tx.name,
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
  const power = (p: PairResult) => Number.isFinite(p.result.receivedPowerDbm) ? p.result.receivedPowerDbm : -Infinity;
  const links = mine.filter((p) => p.intended).sort((a, b) => power(b) - power(a) || a.txName.localeCompare(b.txName) || a.txId.localeCompare(b.txId));
  return { links, worstInterferer, interferersAbove: interferers.length };
}

const STATUS_SEVERITY: Record<string, number> = { 'No link': 3, 'Weak link': 2, 'Invalid input': 1 };

/** The desired link with the worst status, ignoring links whose ground elevation is still unknown; ties keep the strongest. */
export const worstLink = (links: PairResult[]): PairResult | undefined => {
  const known = links.filter((l) => l.elevationKnown);
  return (known.length ? known : links).reduce<PairResult | undefined>(
    (worst, l) => (!worst || (STATUS_SEVERITY[l.result.status] ?? 0) > (STATUS_SEVERITY[worst.result.status] ?? 0) ? l : worst), undefined);
};
