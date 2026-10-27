import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { MapScenario, Sensor, SensorRole } from '../types';
import { activeElevationKnown, activeInputs, activePair, applyInputEdit, zoneReceiver, type LinkState } from './activeLink';
import type { GroundAt } from './elevation';
import { offsetLatLon, SG_REFERENCE, toLocalM } from './geo';
import { addSensor, createSensor } from './sensors';

const flat: GroundAt = () => 0;
const place = (sensors: Sensor[], role: SensorRole, dx: number, dy = 0) => addSensor(sensors, createSensor(sensors, role, offsetLatLon(SG_REFERENCE, dx, dy), DEFAULT_STATE.inputs));
const map = (sensors: Sensor[], extra: Partial<MapScenario> = {}): MapScenario => ({ sensors, selectedId: null, zonesForRxId: 'auto', defaultObjective: 'desired', propagationModel: 'free-space', useTerrainElevation: false, ...extra });
const state = (m: MapScenario): LinkState => ({ inputs: { ...DEFAULT_STATE.inputs }, map: m });

// T1 at 0, T2 at 3000, R1 at 500 (→T1), R2 at 2600 (→T2), R3 at 900 (→T1)
let sensors = place([], 'tx', 0);
sensors = place(sensors, 'tx', 3000);
sensors = place(sensors, 'rx', 500);
sensors = place(sensors, 'rx', 2600);
sensors = place(sensors, 'rx', 900);
const [T1, T2, R1, R2, R3] = sensors;

describe('active link', () => {
  it('picks the active pair from the selection', () => {
    expect(activePair(map(sensors, { selectedId: R2.id }), flat)).toMatchObject({ tx: { id: T2.id }, rx: { id: R2.id } });
    expect(activePair(map(sensors, { selectedId: T1.id }), flat)).toMatchObject({ tx: { id: T1.id }, rx: { id: R1.id } });
    expect(activePair(map(sensors), flat)).toMatchObject({ tx: { id: T1.id }, rx: { id: R1.id } });
    expect(activePair(map([T1, T2]), flat)).toBeNull();
  });

  it('chooses the zone receiver', () => {
    expect(zoneReceiver(map(sensors), T1.id, flat)).toMatchObject({ rx: { id: R1.id }, reason: 'linked' });
    expect(zoneReceiver(map(sensors, { zonesForRxId: R3.id }), T1.id, flat)).toMatchObject({ rx: { id: R3.id }, reason: 'linked' });
    expect(zoneReceiver(map(sensors, { zonesForRxId: R2.id }), T1.id, flat)).toMatchObject({ rx: { id: R1.id }, reason: 'linked' });
    const lonely = [T1, T2, { ...R1, desiredTxIds: [T2.id] }];
    expect(zoneReceiver(map(lonely), T1.id, flat)).toMatchObject({ rx: { id: R1.id }, reason: 'nearest' });
    expect(zoneReceiver(map([T1]), T1.id, flat)).toBeNull();
  });

  it('exposes the active pair as calculator inputs', () => {
    const inputs = activeInputs(state(map(sensors, { selectedId: R1.id })), flat);
    expect(inputs.txId).toBe('T1');
    expect(inputs.rxId).toBe('R1');
    expect(inputs.distanceM).toBeCloseTo(500, 6);
  });

  it('reports whether the active link has known ground elevation', () => {
    const s = state(map(sensors, { selectedId: R1.id, useTerrainElevation: true }));
    expect(activeElevationKnown(s, () => null)).toBe(false);
    expect(activeElevationKnown(s, () => 12)).toBe(true);
    expect(activeElevationKnown({ ...s, map: { ...s.map, useTerrainElevation: false } }, () => null)).toBe(true);
  });

  it('falls back to the stored inputs without a pair', () => {
    const s = state(map([T1]));
    expect(activeInputs(s, flat)).toEqual(s.inputs);
  });

  it('writes calculator edits back to sensors and shared settings', () => {
    const s = state(map(sensors, { selectedId: R1.id }));
    const gain = applyInputEdit(s, 'txGainDbi', 20, flat);
    expect(gain.ok && gain.state.map.sensors.find((x) => x.id === T1.id)?.gainDbi).toBe(20);
    const freq = applyInputEdit(s, 'frequencyGhz', 2.4, flat);
    expect(freq.ok && freq.state.inputs.frequencyGhz).toBe(2.4);
    const name = applyInputEdit(s, 'rxId', 'Depot', flat);
    expect(name.ok && name.state.map.sensors.find((x) => x.id === R1.id)?.name).toBe('Depot');
  });

  it('moves Tx to a typed separation, keeping Rx fixed', () => {
    const s = state(map(sensors, { selectedId: R1.id }));
    const moved = applyInputEdit(s, 'distanceM', 1000, flat);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(activeInputs(moved.state, flat).distanceM).toBeCloseTo(1000, 6);
    expect(moved.state.map.sensors.find((x) => x.id === R1.id)).toEqual(R1);
    expect(toLocalM(moved.state.map.sensors.find((x) => x.id === T1.id)!).xM).toBeCloseTo(-500, 6);
  });

  it("rejects an impossible separation with the solver's reason", () => {
    const tall = sensors.map((x) => x.id === T1.id ? { ...x, aglM: 300 } : x);
    const result = applyInputEdit(state(map(tall, { selectedId: R1.id })), 'distanceM', 100, flat);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/at least 290/);
  });
});

it('uses selected avoidance receiver for zones and exposes its comparison pair', () => {
  const m = map(sensors.map(s => s.id === R3.id ? { ...s, objective: 'avoidance' as const } : s), { selectedId: R3.id });
  expect(zoneReceiver(m, T1.id, flat)?.rx.id).toBe(R3.id);
  expect(activePair(m, flat)?.rx.id).toBe(R3.id);
});
it('active inputs include the same terrain loss as pair evaluation', async () => {
  const { evaluatePairs } = await import('./sensors');
  const m = map(sensors, { selectedId: R1.id, propagationModel: 'terrain', useTerrainElevation: true });
  const ridge: GroundAt = p => p.lon > SG_REFERENCE.lon + .001 && p.lon < SG_REFERENCE.lon + .003 ? 30 : 0;
  const pair = evaluatePairs(m, DEFAULT_STATE.inputs, ridge).find(p => p.rxId === R1.id && p.intended)!;
  expect(activeInputs(state(m), ridge).otherLossDb).toBeCloseTo(DEFAULT_STATE.inputs.otherLossDb + pair.propagationLossDb, 10);
});
