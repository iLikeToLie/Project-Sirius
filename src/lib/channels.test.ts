import { describe, expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import { activeInputs } from './activeLink';
import { calculateLink } from './rf';
import { createSensor, evaluatePairs, pairInputs, pairLinkInputs, pairPropagation, separationM, setRole } from './sensors';
import { normalizeState, validateImport } from './state';

const flat = () => 0;
describe('channel state and pair integration', () => {
  it('migrates missing channel fields in older files with default-channel power parity', () => {
    const state = freshDefaultState();
    state.map.useTerrainElevation = false;
    state.map.propagationModel = 'free-space';
    const legacy = JSON.parse(JSON.stringify(state));
    legacy.schemaVersion = 5;
    delete legacy.map.rejectionModel;
    for (const s of legacy.map.sensors) for (const key of ['frequencyGhz', 'bandwidthMhz', 'acrDb', 'rejectionMask']) delete s[key];
    const restored = validateImport(legacy)!;
    expect(restored).toEqual(state);
    const [tx, rx] = restored.map.sensors;
    const inputs = pairInputs(state.inputs, tx, rx, separationM(tx, rx, flat, false));
    const before = calculateLink(inputs, 'desired');
    const [after] = evaluatePairs(restored.map, restored.inputs, flat);
    expect(after.result).toEqual(before);
    expect(after.rejectionDb).toBe(0);
    expect(after.polarizationDb).toBe(0);
    expect(activeInputs(restored, flat)).toEqual(inputs);
  });
  it('retains both ACR and mask across model changes, role changes and import', () => {
    const state = freshDefaultState();
    state.map.sensors[1].acrDb = 23;
    state.map.sensors[1].rejectionMask = [{ offsetMhz: 12, rejectionDb: 18 }, { offsetMhz: 30, rejectionDb: 42 }];
    state.map.sensors[0].frequencyGhz = 5.9;
    const rx = state.map.sensors[1];
    expect(setRole(setRole(rx, 'tx'), 'rx')).toMatchObject({ acrDb: rx.acrDb, rejectionMask: rx.rejectionMask, bandwidthMhz: rx.bandwidthMhz, frequencyGhz: rx.frequencyGhz });
    for (const rejectionModel of ['simple', 'mask', 'simple'] as const) {
      state.map.rejectionModel = rejectionModel;
      const restored = validateImport(JSON.parse(JSON.stringify(state)))!;
      expect(restored).toEqual(state);
      expect(normalizeState(restored)).toEqual(state);
      expect(evaluatePairs(restored.map, restored.inputs, flat)[0].rejectionDb).toBe(rejectionModel === 'simple' ? 23 : 42);
    }
  });
  it('creates independent valid default masks', () => {
    const state = freshDefaultState();
    const a = createSensor([], 'tx', state.map.sensors[0], state.inputs);
    const b = createSensor([a], 'rx', state.map.sensors[1], state.inputs);
    a.rejectionMask[0].rejectionDb = 1;
    expect(b.rejectionMask[0].rejectionDb).toBe(30);
    expect(b).toMatchObject({ frequencyGhz: 'default', bandwidthMhz: 20, acrDb: 30 });
  });
  it('applies rejection exactly once and uses transmitter frequency for diffraction and active inputs', () => {
    const state = freshDefaultState();
    state.map.sensors[0].frequencyGhz = 2.4;
    state.map.sensors[1].acrDb = 23;
    const [tx, rx] = state.map.sensors;
    const groundAt = (p: { lon: number }) => Math.abs(p.lon - (tx.lon + rx.lon) / 2) < .0003 ? 80 : 0;
    const distance = separationM(tx, rx, groundAt, true);
    const { inputs, rejectionDb } = pairLinkInputs(state.map, state.inputs, tx, rx, distance);
    expect(inputs.frequencyGhz).toBe(2.4);
    expect(rejectionDb).toBe(23);
    const propagation = pairPropagation(state.map, tx, rx, inputs.frequencyGhz, groundAt);
    expect(propagation.lossDb).toBeGreaterThan(0);
    expect(propagation.lossDb).not.toBeCloseTo(pairPropagation(state.map, tx, rx, state.inputs.frequencyGhz, groundAt).lossDb, 4);
    const expected = { ...inputs, otherLossDb: inputs.otherLossDb + propagation.lossDb };
    expect(activeInputs(state, groundAt)).toEqual(expected);
    expect(evaluatePairs(state.map, state.inputs, groundAt)[0].result).toEqual(calculateLink(expected, 'desired'));
  });
  it('rejects invalid channels and masks, even when the inactive model would not use them', () => {
    const invalid: Record<string, unknown>[] = [
      ...[0, -1, NaN, Infinity, '5.8', null].map(frequencyGhz => ({ frequencyGhz })),
      ...[0, -1, NaN, Infinity, null].map(bandwidthMhz => ({ bandwidthMhz })),
      ...[-1, NaN, Infinity, null].map(acrDb => ({ acrDb })),
      ...[[], Array(5).fill({ offsetMhz: 1, rejectionDb: 0 }), [null],
        [{ offsetMhz: 0, rejectionDb: 1 }], [{ offsetMhz: 1, rejectionDb: -1 }],
        [{ offsetMhz: Infinity, rejectionDb: 1 }], [{ offsetMhz: 1, rejectionDb: NaN }],
        [{ offsetMhz: 20, rejectionDb: 30 }, { offsetMhz: 20, rejectionDb: 40 }],
        [{ offsetMhz: 20, rejectionDb: 30 }, { offsetMhz: 10, rejectionDb: 40 }],
        [{ offsetMhz: 20, rejectionDb: 30 }, { offsetMhz: 40, rejectionDb: 20 }],
      ].map(rejectionMask => ({ rejectionMask })),
    ];
    for (const patch of invalid) {
      const state = freshDefaultState();
      Object.assign(state.map.sensors[1], patch);
      expect(validateImport(state), JSON.stringify(patch)).toBeNull();
    }
    for (const rejectionModel of ['other', null, 1]) {
      const state = freshDefaultState();
      expect(validateImport({ ...state, map: { ...state.map, rejectionModel } })).toBeNull();
    }
  });
});
