import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { MapScenario, Sensor, SensorRole } from '../types';
import type { GroundAt } from './elevation';
import { offsetLatLon, SG_REFERENCE } from './geo';
import {
  addSensor, createSensor, evaluatePairs, MAX_SENSORS, receiverSummary, removeSensor, resolveIntendedTx, setRole,
} from './sensors';

const flat: GroundAt = () => 0;
const defaults = DEFAULT_STATE.inputs;
const place = (sensors: Sensor[], role: SensorRole, dx: number, dy = 0) => addSensor(sensors, createSensor(sensors, role, offsetLatLon(SG_REFERENCE, dx, dy), defaults));
const scenario = (sensors: Sensor[], useTerrainElevation = false): MapScenario => ({ sensors, selectedId: null, zonesForRxId: 'auto', useTerrainElevation });
const LINK = ['Acceptable link', 'Weak link', 'No link'];
const INTERFERENCE = ['Possible interference', 'Below interference threshold'];

describe('sensor model', () => {
  it('creates sensors from calculator defaults', () => {
    const t1 = createSensor([], 'tx', SG_REFERENCE, defaults);
    expect([t1.powerDbm, t1.gainDbi, t1.cableLossDb, t1.aglM]).toEqual([30, 12, 1.5, 10]);
    const r1 = createSensor([t1], 'rx', SG_REFERENCE, defaults);
    expect([r1.gainDbi, r1.cableLossDb, r1.sensitivityDbm, r1.intendedTxId]).toEqual([15, 1, -85, 'auto']);
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

  it('resolves auto to the nearest transmitter, ties by order', () => {
    let sensors = place([], 'tx', -100);
    sensors = place(sensors, 'tx', 100);
    sensors = place(sensors, 'rx', 0);
    expect(resolveIntendedTx(scenario(sensors), sensors[2], flat)?.name).toBe('T1');
    sensors = place(sensors, 'rx', 60);
    expect(resolveIntendedTx(scenario(sensors), sensors[3], flat)?.name).toBe('T2');
  });

  it('reverts receivers to auto when their transmitter is deleted', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'rx', 100);
    sensors = sensors.map((s) => s.role === 'rx' ? { ...s, intendedTxId: sensors[0].id } : s);
    const after = removeSensor(sensors, sensors[0].id);
    expect(after).toHaveLength(1);
    expect(after[0].intendedTxId).toBe('auto');
  });

  it('has no intended transmitter when none exist', () => {
    let sensors = place([], 'tx', 0);
    sensors = place(sensors, 'rx', 100);
    sensors = [setRole(sensors[0], 'rx'), sensors[1]];
    const s = scenario(sensors);
    expect(resolveIntendedTx(s, sensors[1], flat)).toBeNull();
    const pairs = evaluatePairs(s, defaults, flat);
    expect(pairs).toEqual([]);
    expect(receiverSummary(pairs, sensors[1].id).link).toBeNull();
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
    const linked = sensors.map((s) => s.id === rx.id ? { ...s, intendedTxId: sensors[2].id } : s);
    const pairs = evaluatePairs(scenario(linked), defaults, flat);
    const summary = receiverSummary(pairs, rx.id);
    expect(summary.link?.txId).toBe(sensors[2].id);
    expect(summary.interferersAbove).toBe(2);
    expect(summary.worstInterferer?.txId).toBe(sensors[1].id); // T2 is 50 m away, T1 100 m
  });
});
