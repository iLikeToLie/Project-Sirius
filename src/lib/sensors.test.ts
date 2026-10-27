import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { MapScenario, Sensor, SensorRole } from '../types';
import type { GroundAt } from './elevation';
import { offsetLatLon, SG_REFERENCE } from './geo';
import { calculateLink } from './rf';
import {
  addSensor, changeRole, createSensor, evaluatePairs, effectiveObjective, MAX_SENSORS, meterScale, receiverSummary, removeSensor, resolveDesiredTxs, setRole, toggleDesired, type PairResult,
} from './sensors';

const flat: GroundAt = () => 0;
const defaults = DEFAULT_STATE.inputs;
const place = (sensors: Sensor[], role: SensorRole, dx: number, dy = 0) => addSensor(sensors, createSensor(sensors, role, offsetLatLon(SG_REFERENCE, dx, dy), defaults));
const scenario = (sensors: Sensor[], useTerrainElevation = false): MapScenario => ({ sensors, selectedId: null, zonesForRxId: 'auto', defaultObjective: 'desired', propagationModel: 'free-space', useTerrainElevation });
const LINK = ['Acceptable link', 'Weak link', 'No link'];
const INTERFERENCE = ['Possible interference', 'Below interference threshold'];
const [T1, T2, T3, R1, R2] = place(place(place(place(place([], 'tx', 0), 'tx', 1000), 'tx', 2000), 'rx', 200), 'rx', 400);
const sensorsWithLinks: Sensor[] = [T1, T2, { ...R1, desiredTxIds: [T1.id, T2.id] }, { ...R2, desiredTxIds: [T1.id] }];
const pairsWithPowers = (rxId: string, powers: [string, number][]): PairResult[] => powers.map(([txId, power]) => ({
  txId, txName: txId, rxId, intended: true, distanceM: 500, elevationKnown: true, propagationLossDb: 0, clearance: 'unknown',
  result: { ...calculateLink(defaults, 'desired'), receivedPowerDbm: power },
}));

describe('desired transmitter sets', () => {
  it('uses one meter scale covering every power, sensitivity and required level', () => {
    const scale = meterScale(pairsWithPowers(R1.id, [['T1', -90], ['T2', -60]]), { ...defaults, sensitivityDbm: -85 });
    expect(scale.scaleMin).toBeLessThanOrEqual(-100);
    expect(scale.scaleMax).toBeGreaterThanOrEqual(-50);
  });

  it('keeps the meter scale finite with unknown powers and no links', () => {
    for (const links of [[], pairsWithPowers(R1.id, [['T1', NaN]])]) {
      const scale = meterScale(links, defaults);
      expect(Number.isFinite(scale.scaleMin)).toBe(true);
      expect(scale.scaleMax).toBeGreaterThan(scale.scaleMin);
    }
  });

  it('returns to auto when the last desired transmitter is unticked', () => {
    expect(toggleDesired([T1.id], T1.id, [T1.id, T2.id])).toBe('auto');
  });

  it('adds a transmitter in sensor order without changing the original list', () => {
    const current = [T2.id];
    expect(toggleDesired(current, T1.id, [T1.id, T2.id])).toEqual([T1.id, T2.id]);
    expect(current).toEqual([T2.id]);
  });

  it('switches auto to an explicit selection', () => {
    expect(toggleDesired('auto', T2.id, [T1.id, T2.id])).toEqual([T2.id]);
  });

  it('returns every listed transmitter in sensor order, ignoring missing and receiver ids', () => {
    const rx = { ...R1, desiredTxIds: [T2.id, 'missing', R2.id, T1.id] };
    expect(resolveDesiredTxs(scenario([T1, T2, rx, R2]), rx, flat).map((s) => s.name)).toEqual(['T1', 'T2']);
  });

  it('returns one nearest transmitter for auto and none for avoidance', () => {
    expect(resolveDesiredTxs(scenario([T1, T2, R1]), R1, flat)).toEqual([T1]);
    const rx: Sensor = { ...R1, desiredTxIds: [T1.id, T2.id], objective: 'avoidance' };
    expect(resolveDesiredTxs(scenario([T1, T2, rx]), rx, flat)).toEqual([]);
    expect(rx.desiredTxIds).toEqual([T1.id, T2.id]);
    expect(resolveDesiredTxs(scenario([T1, T2, rx]), { ...rx, objective: 'desired' }, flat)).toEqual([T1, T2]);
  });

  it('marks every listed transmitter as desired and the others as interference', () => {
    const pairs = evaluatePairs(scenario([T1, T2, T3, { ...R1, desiredTxIds: [T1.id, T2.id] }]), defaults, flat);
    expect(pairs.filter((p) => p.rxId === R1.id && p.intended).map((p) => p.txId)).toEqual([T1.id, T2.id]);
    expect(pairs.find((p) => p.txId === T3.id)?.intended).toBe(false);
    expect(pairs.filter((p) => p.intended).every((p) => LINK.includes(p.result.status))).toBe(true);
    expect(INTERFERENCE).toContain(pairs.find((p) => p.txId === T3.id)?.result.status);
  });

  it('sorts desired links by received power, best first, ties by transmitter name', () => {
    const pairs = pairsWithPowers(R1.id, [['T2', -70], ['T1', -70], ['T3', -60]]);
    expect(receiverSummary(pairs, R1.id).links.map((p) => p.txId)).toEqual(['T3', 'T1', 'T2']);
    expect(pairs.map((p) => p.txId)).toEqual(['T2', 'T1', 'T3']);
  });

  it('breaks equal-power ties by transmitter name even after renaming', () => {
    const pairs = pairsWithPowers(R1.id, [['T1', -70], ['T2', -70]]);
    pairs[0].txName = 'Zulu';
    pairs[1].txName = 'Alpha';
    expect(receiverSummary(pairs, R1.id).links.map((p) => p.txId)).toEqual(['T2', 'T1']);
  });

  it('keeps unknown-power desired links behind finite links', () => {
    const pairs = pairsWithPowers(R1.id, [['T1', NaN], ['T2', -60]]);
    expect(receiverSummary(pairs, R1.id).links.map((p) => p.txId)).toEqual(['T2', 'T1']);
  });

  it('drops a transmitter from every list when it becomes a receiver', () => {
    const after = changeRole(sensorsWithLinks, T1.id, 'rx');
    expect(after.find((s) => s.id === R1.id)?.desiredTxIds).toEqual([T2.id]);
    expect(after.find((s) => s.id === R2.id)?.desiredTxIds).toBe('auto');
    expect(sensorsWithLinks.find((s) => s.id === R1.id)?.desiredTxIds).toEqual([T1.id, T2.id]);
  });

  it('drops a removed transmitter from every list, reverting only empty lists to auto', () => {
    const after = removeSensor(sensorsWithLinks, T1.id);
    expect(after.find((s) => s.id === R1.id)?.desiredTxIds).toEqual([T2.id]);
    expect(after.find((s) => s.id === R2.id)?.desiredTxIds).toBe('auto');
  });
});

describe('sensor model', () => {
  it('creates sensors from calculator defaults', () => {
    const t1 = createSensor([], 'tx', SG_REFERENCE, defaults);
    expect([t1.powerDbm, t1.gainDbi, t1.cableLossDb, t1.aglM]).toEqual([30, 12, 1.5, 10]);
    const r1 = createSensor([t1], 'rx', SG_REFERENCE, defaults);
    expect([r1.gainDbi, r1.cableLossDb, r1.sensitivityDbm, r1.desiredTxIds]).toEqual([15, 1, -85, 'auto']);
    expect(r1.id).not.toBe(t1.id);
  });

  it('names and limits sensors', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'tx', 100);
    sensors = place(sensors, 'rx', 200);
    expect(sensors.map((s) => s.name)).toEqual(['T1', 'T2', 'R1']);
    for (let i = 0; i < 5; i += 1) sensors = place(sensors, 'rx', 300 + i);
    expect(sensors).toHaveLength(MAX_SENSORS);
    expect(place(sensors, 'rx', 999)).toBe(sensors);
  });

  it('keeps role-specific values when toggling', () => {
    const t1 = { ...createSensor([], 'tx', SG_REFERENCE, defaults), powerDbm: 27 };
    const back = setRole(setRole(t1, 'rx'), 'tx');
    expect(back.powerDbm).toBe(27);
    expect(back.role).toBe('tx');
  });

  it('renames auto-named sensors to match a new role but keeps typed names', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'rx', 100);
    expect(setRole(sensors[1], 'tx', sensors).name).toBe('T2');
    expect(setRole({ ...sensors[1], name: 'Depot mast' }, 'tx', sensors).name).toBe('Depot mast');
  });

  it('reverts receivers to auto when their transmitter becomes a receiver', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'tx', 50);
    sensors = place(sensors, 'rx', 100);
    sensors = sensors.map((s) => (s.role === 'rx' ? { ...s, desiredTxIds: [sensors[1].id] } : s));
    const after = changeRole(sensors, sensors[1].id, 'rx');
    expect(after[1].role).toBe('rx');
    expect(after[2].desiredTxIds).toBe('auto');
    expect(changeRole(after, sensors[1].id, 'tx')[2].desiredTxIds).toBe('auto');
  });

  it('resolves auto to the nearest transmitter, ties by order', () => {
    let sensors = place([], 'tx', -100);
    sensors = place(sensors, 'tx', 100);
    sensors = place(sensors, 'rx', 0);
    expect(resolveDesiredTxs(scenario(sensors), sensors[2], flat)[0]?.name).toBe('T1');
    sensors = place(sensors, 'rx', 60);
    expect(resolveDesiredTxs(scenario(sensors), sensors[3], flat)[0]?.name).toBe('T2');
  });

  it('reverts receivers to auto when their transmitter is deleted', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'rx', 100);
    sensors = sensors.map((s) => s.role === 'rx' ? { ...s, desiredTxIds: [sensors[0].id] } : s);
    const after = removeSensor(sensors, sensors[0].id);
    expect(after).toHaveLength(1);
    expect(after[0].desiredTxIds).toBe('auto');
  });

  it('has no intended transmitter when none exist', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'rx', 100);
    sensors = [setRole(sensors[0], 'rx'), sensors[1]];
    const s = scenario(sensors);
    expect(resolveDesiredTxs(s, sensors[1], flat)).toEqual([]);
    const pairs = evaluatePairs(s, defaults, flat);
    expect(pairs).toEqual([]);
    expect(receiverSummary(pairs, sensors[1].id).links).toEqual([]);
  });

  it('judges intended pairs as desired and others as avoidance', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'tx', 2000);
    sensors = place(sensors, 'rx', 300);
    const pairs = evaluatePairs(scenario(sensors), defaults, flat);
    const intended = pairs.find((p) => p.intended)!;
    const other = pairs.find((p) => !p.intended)!;
    expect(intended.txId).toBe(sensors[0].id);
    expect(LINK).toContain(intended.result.status);
    expect(INTERFERENCE).toContain(other.result.status);
  });

  it('matches the workbook default for one 500 m link', () => {
    let sensors = place([], 'tx', 250);
    sensors = place(sensors, 'rx', -250);
    const [pair] = evaluatePairs(scenario(sensors), defaults, flat);
    expect(pair.distanceM).toBeCloseTo(500, 9);
    expect(pair.result.receivedPowerDbm).toBeCloseTo(-51.187959957979174, 10);
  });

  it('reports invalid input for co-located sensors without throwing', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'rx', 0);
    const [pair] = evaluatePairs(scenario(sensors), defaults, flat);
    expect(pair.result.status).toBe('Invalid input');
  });

  it('flags pairs whose ground elevation is unknown', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'rx', 400);
    const [pair] = evaluatePairs(scenario(sensors, true), defaults, () => null);
    expect(pair.elevationKnown).toBe(false);
    expect(Number.isFinite(pair.result.receivedPowerDbm)).toBe(true);
  });

  it('counts interferers above threshold and picks the worst', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'tx', 150);
    sensors = place(sensors, 'tx', 5000);
    sensors = place(sensors, 'rx', 100);
    const rx = sensors[3];
    const linked = sensors.map((s) => s.id === rx.id ? { ...s, desiredTxIds: [sensors[2].id] } : s);
    const pairs = evaluatePairs(scenario(linked), defaults, flat);
    const summary = receiverSummary(pairs, rx.id);
    expect(summary.links[0]?.txId).toBe(sensors[2].id);
    expect(summary.interferersAbove).toBe(2);
    expect(summary.worstInterferer?.txId).toBe(sensors[1].id); // T2 is 50 m away, T1 100 m
  });
});

describe('terrain and objectives', () => {
  const sensors = place(place(place([], 'tx', 0), 'rx', 2000), 'rx', 2100);
  const m = () => ({ ...scenario(sensors, true), propagationModel: 'terrain' as const, defaultObjective: 'desired' as const });
  it('resolves default and override without changing another receiver', () => {
    const before = evaluatePairs(m(), defaults, flat);
    const changed = { ...m(), sensors: sensors.map((s, i) => i === 1 ? { ...s, objective: 'avoidance' as const } : s), selectedId: sensors[1].id };
    expect(resolveDesiredTxs(changed, changed.sensors[1], flat)).toEqual([]);
    expect(evaluatePairs(changed, defaults, flat)[0].intended).toBe(false);
    expect(evaluatePairs(changed, defaults, flat)[1]).toEqual(before[1]);
    expect(effectiveObjective({ ...m(), defaultObjective: 'avoidance' }, { ...sensors[1], objective: 'default' })).toBe('avoidance');
  });
  it('subtracts diffraction exactly once', () => {
    const ridge: GroundAt = p => p.lon > SG_REFERENCE.lon + .008 && p.lon < SG_REFERENCE.lon + .010 ? 60 : 0;
    const terrain = evaluatePairs(m(), defaults, ridge)[0];
    const free = evaluatePairs({ ...m(), propagationModel: 'free-space' }, defaults, ridge)[0];
    expect(terrain.clearance).toBe('obstructed'); expect(terrain.propagationLossDb).toBeGreaterThan(6);
    expect(free.result.receivedPowerDbm - terrain.result.receivedPowerDbm).toBeCloseTo(terrain.propagationLossDb, 10);
  });
  it('does not confidently classify a path with missing intermediate tiles', () => {
    const [pair] = evaluatePairs(m(), defaults, p => p.lon > SG_REFERENCE.lon + .008 && p.lon < SG_REFERENCE.lon + .010 ? null : 0);
    expect(pair.elevationKnown).toBe(false); expect(pair.propagationLossDb).toBeNaN();
    expect(pair.clearance).toBe('unknown'); expect(pair.result.status).toBe('Invalid input');
  });
});
