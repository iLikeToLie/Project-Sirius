import { describe, expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import { activeInputs, applyInputEdit } from './activeLink';
import { calculateLink } from './rf';
import { createSensor, evaluatePairs, pairInputs, pairLinkInputs, separationM, setRole } from './sensors';
import { normalizeState, validateImport } from './state';

const flat = () => 0;
const scenario = () => {
  const state = freshDefaultState();
  state.map.useTerrainElevation = false;
  state.map.propagationModel = 'free-space';
  return state;
};

describe('polarization state and pair integration', () => {
  it('defaults old schema 5 and 6 files to vertical polarization and 15 dB XPD', () => {
    for (const schemaVersion of [5, 6]) {
      const state = scenario();
      const old = JSON.parse(JSON.stringify(state));
      old.schemaVersion = schemaVersion;
      delete old.map.crossPolarDiscriminationDb;
      for (const sensor of old.map.sensors) delete sensor.polarization;
      const imported = validateImport(old)!;
      expect(imported.map.crossPolarDiscriminationDb).toBe(15);
      expect(imported.map.sensors.map(s => s.polarization)).toEqual(['V', 'V']);
      expect(imported).toEqual(state);
      expect(normalizeState(old)).toEqual(state);
    }
  });

  it('defaults new sensors to V and keeps polarization across role changes and save/reload', () => {
    const state = scenario();
    for (const role of ['tx', 'rx'] as const) expect(createSensor([], role, state.map.sensors[0], state.inputs).polarization).toBe('V');
    for (const polarization of ['V', 'H', 'RHCP', 'LHCP'] as const) {
      state.map.sensors[0].polarization = polarization;
      expect(setRole(setRole(state.map.sensors[0], 'rx'), 'tx').polarization).toBe(polarization);
      for (const xpd of [0, 22]) {
        state.map.crossPolarDiscriminationDb = xpd;
        expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
      }
    }
  });

  it('rejects invalid polarization or XPD while allowing missing legacy fields', () => {
    for (const polarization of ['v', 'HV', '', null, 15]) {
      const state = scenario();
      Object.assign(state.map.sensors[1], { polarization });
      expect(validateImport(state), String(polarization)).toBeNull();
    }
    for (const crossPolarDiscriminationDb of [-1, NaN, Infinity, null, '15']) {
      const state = scenario();
      Object.assign(state.map, { crossPolarDiscriminationDb });
      expect(validateImport(state), String(crossPolarDiscriminationDb)).toBeNull();
    }
  });

  it('preserves powers, margins and statuses with every sensor vertical for desired and interferer pairs', () => {
    const state = scenario();
    const extra = createSensor(state.map.sensors, 'tx', { lat: 1.3, lon: 103.85 }, state.inputs);
    state.map.sensors.push(extra);
    const [tx, rx] = state.map.sensors;
    rx.desiredTxIds = [tx.id];
    for (const pair of evaluatePairs(state.map, state.inputs, flat)) {
      const transmitter = state.map.sensors.find(s => s.id === pair.txId)!;
      const before = pairInputs(state.inputs, transmitter, rx, pair.distanceM);
      expect(pair.polarizationDb).toBe(0);
      expect(pair.result).toEqual(calculateLink(before, pair.intended ? 'desired' : 'avoidance'));
    }
  });

  it('lowers V to H received power by exactly XPD in both link objectives', () => {
    for (const objective of ['desired', 'avoidance'] as const) for (const xpd of [0, 15, 22]) {
      const state = scenario();
      state.map.defaultObjective = objective;
      state.map.crossPolarDiscriminationDb = xpd;
      const before = evaluatePairs(state.map, state.inputs, flat)[0];
      state.map.sensors[1].polarization = 'H';
      const after = evaluatePairs(state.map, state.inputs, flat)[0];
      expect(after.polarizationDb).toBe(xpd);
      expect(before.result.receivedPowerDbm - after.result.receivedPowerDbm).toBeCloseTo(xpd, 10);
      expect(after.result.totalLossDb - before.result.totalLossDb).toBeCloseTo(xpd, 10);
    }
  });

  it('adds mismatch, frequency rejection and shared polarization loss once, including active inputs and edits', () => {
    const state = scenario();
    const [tx, rx] = state.map.sensors;
    rx.polarization = 'H';
    tx.frequencyGhz = 5.9;
    const derived = pairLinkInputs(state.map, state.inputs, tx, rx, separationM(tx, rx, flat, false));
    expect(derived.rejectionDb).toBe(30);
    expect(derived.polarizationDb).toBe(15);
    expect(derived.inputs.otherLossDb).toBe(state.inputs.otherLossDb + 30 + 15);
    expect(derived.inputs.polarizationLossDb).toBe(state.inputs.polarizationLossDb);
    expect(activeInputs(state, flat)).toEqual(derived.inputs);
    const edited = applyInputEdit(state, 'otherLossDb', 2, flat);
    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error(edited.reason);
    expect(activeInputs(edited.state, flat).otherLossDb).toBe(2 + 30 + 15);
    expect(evaluatePairs(state.map, state.inputs, flat)[0].result).toEqual(calculateLink(derived.inputs, 'desired'));
  });
});
