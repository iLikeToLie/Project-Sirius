import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { MapScenario, Sensor, SensorRole } from '../types';
import { activeElevationKnown, activeInputs, activePair, applyInputEdit, zoneReceiver, type LinkState } from './activeLink';
import type { GroundAt } from './elevation';
import { offsetLatLon, SG_REFERENCE, toLocalM } from './geo';
import { addSensor, createSensor, evaluatePairs, receiverSummary } from './sensors';

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
  it('uses the strongest desired transmitter for the selected receiver, not the nearest or first', () => {
    const m = map([T1, { ...T2, powerDbm: T2.powerDbm + 30 }, { ...R1, desiredTxIds: [T1.id, T2.id] }], { selectedId: R1.id });
    const strongest = receiverSummary(evaluatePairs(m, DEFAULT_STATE.inputs, flat), R1.id).links[0];
    expect(strongest.txId).toBe(T2.id);
    expect(activePair(m, flat)?.tx.id).toBe(strongest.txId);
    expect(activeInputs(state(m), flat).txId).toBe(T2.name);
    const edited = applyInputEdit(state(m), 'txGainDbi', 20, flat);
    expect(edited.ok && edited.state.map.sensors.find((s) => s.id === T2.id)?.gainDbi).toBe(20);
  });

  it('uses the strongest desired link when falling back to the first receiver', () => {
    const m = map([T1, { ...T2, powerDbm: T2.powerDbm + 30 }, { ...R1, desiredTxIds: [T1.id, T2.id] }]);
    expect(activePair(m, flat)?.tx.id).toBe(T2.id);
  });

  it('serves a transmitter to every receiver that lists it, including second choices', () => {
    const m = map([T1, T2, { ...R1, desiredTxIds: [T2.id, T1.id] }, { ...R2, desiredTxIds: [T2.id, T1.id] }]);
    expect(zoneReceiver({ ...m, zonesForRxId: R2.id }, T2.id, flat)).toMatchObject({ rx: { id: R2.id }, reason: 'linked' });
    expect(zoneReceiver({ ...m, selectedId: R1.id }, T2.id, flat)).toMatchObject({ rx: { id: R1.id }, reason: 'linked' });
    expect(activePair({ ...m, selectedId: T2.id }, flat)).toMatchObject({ tx: { id: T2.id }, rx: { id: R2.id } });
  });

  it('breaks equal-power ties by transmitter id consistently with receiverSummary', () => {
    const m = map([{ ...T2, lat: T1.lat, lon: T1.lon }, T1, { ...R1, desiredTxIds: [T2.id, T1.id] }], { selectedId: R1.id });
    expect(activePair(m, flat)?.tx.id).toBe(T1.id);
  });

  it('uses terrain loss and shared frequency when choosing the strongest desired link', () => {
    const m = map([T1, T2, { ...R1, desiredTxIds: [T1.id, T2.id] }], { selectedId: R1.id, propagationModel: 'terrain', useTerrainElevation: true });
    const ridge: GroundAt = p => p.lon > SG_REFERENCE.lon + .001 && p.lon < SG_REFERENCE.lon + .003 ? 30 : 0;
    const low = { ...DEFAULT_STATE.inputs, frequencyGhz: .1 };
    const high = { ...DEFAULT_STATE.inputs, frequencyGhz: 10 };
    const advantage = (inputs: typeof low) => {
      const pairs = evaluatePairs(m, inputs, ridge);
      return pairs[0].result.receivedPowerDbm - pairs[1].result.receivedPowerDbm;
    };
    const powerBoost = -(advantage(low) + advantage(high)) / 2;
    const tuned = { ...m, sensors: m.sensors.map((s) => s.id === T1.id ? { ...s, powerDbm: s.powerDbm + powerBoost } : s) };
    const strongestLow = receiverSummary(evaluatePairs(tuned, low, ridge), R1.id).links[0];
    const strongestHigh = receiverSummary(evaluatePairs(tuned, high, ridge), R1.id).links[0];
    expect(strongestLow.txId).not.toBe(strongestHigh.txId);
    expect(activePair(tuned, ridge, low)?.tx.id).toBe(strongestLow.txId);
    expect(activePair(tuned, ridge, high)?.tx.id).toBe(strongestHigh.txId);
    expect(activeInputs({ map: tuned, inputs: high }, ridge).txId).toBe(tuned.sensors.find((s) => s.id === strongestHigh.txId)?.name);
  });

  it('keeps a finite desired pair ahead of a path with missing terrain', () => {
    const m = map([T1, T2, { ...R1, desiredTxIds: [T1.id, T2.id] }], { selectedId: R1.id, propagationModel: 'terrain', useTerrainElevation: true });
    const missing: GroundAt = p => p.lon < SG_REFERENCE.lon + .001 ? null : 0;
    expect(activePair(m, missing)?.tx.id).toBe(T2.id);
    expect(activeElevationKnown(state(m), missing)).toBe(true);
  });

  it('keeps avoidance lists for later and falls back to the nearest comparison transmitter', () => {
    const rx: Sensor = { ...R1, desiredTxIds: [T2.id], objective: 'avoidance' };
    const m = map([T1, T2, rx], { selectedId: R1.id });
    expect(activePair(m, flat)?.tx.id).toBe(T1.id);
    expect(zoneReceiver(m, T2.id, flat)?.reason).toBe('nearest');
    expect(activePair({ ...m, sensors: [T1, T2, { ...rx, objective: 'desired' }] }, flat)?.tx.id).toBe(T2.id);
    expect(rx.desiredTxIds).toEqual([T2.id]);
  });

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
