import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, DEFAULT_TERRAIN, freshDefaultState, workspaceForDistance } from '../data/defaults';
import type { AppState, LinkWorkspace } from '../types';
import { activeInputs } from './activeLink';
import { separation3dM } from './linkGeometry';
import { normalizeState, validateImport } from './state';
import { createSensor } from './sensors';

const unknownGround = () => null;
const base = () => {
  const { map: _map, schemaVersion: _version, ...rest } = freshDefaultState();
  return rest;
};
/** A web 1.4.0 save (schema 2, plan-view workspace). */
const v2 = (workspace: LinkWorkspace) => ({ ...base(), schemaVersion: 2, workspace });
const v4WithReceiver = (receiver: Record<string, unknown>) => {
  const state = freshDefaultState();
  const [tx, rx] = state.map.sensors;
  const { desiredTxIds: _desiredTxIds, ...legacyRx } = rx;
  return { ...state, schemaVersion: 4, map: { ...state.map, sensors: [tx, { ...legacyRx, intendedTxId: 'auto', ...receiver }] } };
};
const v5WithReceiver = (receiver: Record<string, unknown>) => {
  const state = freshDefaultState();
  const [tx, rx] = state.map.sensors;
  return { ...state, map: { ...state.map, sensors: [tx, { ...rx, ...receiver }] } };
};
/** A pre-1.4.0 save: no workspace at all. */
const v1 = (distanceM: number) => { const rest = base(); return { ...rest, inputs: { ...rest.inputs, distanceM } }; };

describe('scenario state', () => {
  it('imports and restores twelve sensors, but rejects a thirteenth', () => {
    const state = freshDefaultState();
    state.map.sensors = [];
    for (let i = 0; i < 12; i += 1) {
      state.map.sensors.push(createSensor(state.map.sensors, i < 6 ? 'tx' : 'rx', { lat: 1.3, lon: 103.8 + i * 0.001 }, state.inputs));
    }
    expect(validateImport(state)?.map.sensors).toEqual(state.map.sensors);
    expect(normalizeState(state).map.sensors).toEqual(state.map.sensors);
    state.map.sensors.push(createSensor(state.map.sensors, 'rx', { lat: 1.3, lon: 103.9 }, state.inputs));
    expect(validateImport(state)).toBeNull();
    expect(normalizeState(state).map).toEqual(freshDefaultState().map);
  });
  it('returns defaults when nothing is saved', () => {
    expect(normalizeState()).toEqual(DEFAULT_STATE);
    expect(DEFAULT_STATE.schemaVersion).toBe(9);
    expect(DEFAULT_STATE.map.sensors.map((s) => s.role)).toEqual(['tx', 'rx']);
    expect(DEFAULT_STATE.map.useTerrainElevation).toBe(true);
  });

  it('defaults new receivers to auto', () => {
    expect(DEFAULT_STATE.map.sensors.every((s) => s.desiredTxIds === 'auto' || s.role === 'tx')).toBe(true);
  });

  it('migrates a saved intendedTxId string to a one-item list', () => {
    const state = normalizeState(v4WithReceiver({ intendedTxId: 'sensor-1' }) as unknown as Partial<AppState>);
    expect(state.map.sensors.find((s) => s.role === 'rx')?.desiredTxIds).toEqual(['sensor-1']);
  });

  it('opens a saved receiver with an empty intendedTxId on auto instead of rejecting the map', () => {
    const state = normalizeState(v4WithReceiver({ intendedTxId: '' }) as unknown as Partial<AppState>);
    expect(state.map.sensors).toHaveLength(2);
    expect(state.map.sensors.find((s) => s.role === 'rx')?.desiredTxIds).toBe('auto');
  });

  it('drops unknown transmitters and falls back to auto when nothing is left', () => {
    const state = normalizeState(v5WithReceiver({ desiredTxIds: ['missing-id'] }) as unknown as Partial<AppState>);
    expect(state.map.sensors.find((s) => s.role === 'rx')?.desiredTxIds).toBe('auto');
  });

  it('removes duplicate ids', () => {
    const state = normalizeState(v5WithReceiver({ desiredTxIds: ['sensor-1', 'sensor-1'] }) as unknown as Partial<AppState>);
    expect(state.map.sensors.find((s) => s.role === 'rx')?.desiredTxIds).toEqual(['sensor-1']);
  });

  it('migrates a 1.4.0 workspace without changing its result', () => {
    const workspace: LinkWorkspace = { tx: { xM: 300, yM: 400, aglM: 12 }, rx: { xM: 0, yM: 0, aglM: 10 }, terrain: { ...DEFAULT_TERRAIN, enabled: true } };
    const state = normalizeState(v2(workspace) as unknown as Partial<AppState>);
    expect(state.schemaVersion).toBe(9);
    expect(state.map.sensors).toHaveLength(2);
    expect(state.map.useTerrainElevation).toBe(false);
    expect(activeInputs(state, unknownGround).distanceM).toBeCloseTo(separation3dM(workspace), 6);
  });

  it('keeps a 1.4.0 scenario with negative elevations across reloads', () => {
    const workspace: LinkWorkspace = { tx: { xM: 300, yM: 400, aglM: 12 }, rx: { xM: 0, yM: 0, aglM: 10 }, terrain: { ...DEFAULT_TERRAIN, enabled: true, offsetM: -100 } };
    const first = normalizeState(v2(workspace) as unknown as Partial<AppState>);
    const reloaded = normalizeState(JSON.parse(JSON.stringify(first)));
    expect(reloaded.map.sensors.map((s) => s.id)).toEqual(first.map.sensors.map((s) => s.id));
    expect(reloaded.map.sensors.every((s) => s.aglM >= 0)).toBe(true);
    expect(activeInputs(reloaded, unknownGround).distanceM).toBeCloseTo(separation3dM(workspace), 6);
  });

  it('migrates pre-1.4.0 scenarios through flat geometry', () => {
    const state = normalizeState(v1(1234.5) as unknown as Partial<AppState>);
    expect(activeInputs(state, unknownGround).distanceM).toBeCloseTo(1234.5, 6);
    expect(separation3dM(workspaceForDistance(1234.5))).toBeCloseTo(1234.5, 12);
  });

  it('keeps calculator names on migrated sensors', () => {
    const state = normalizeState(v1(500) as unknown as Partial<AppState>);
    expect(state.map.sensors.map((s) => s.name)).toEqual([DEFAULT_STATE.inputs.txId, DEFAULT_STATE.inputs.rxId]);
  });

  it('rejects imports with more than twelve sensors, unknown roles or non-numeric fields', () => {
    const good = freshDefaultState();
    const thirteen = { ...good, map: { ...good.map, sensors: Array.from({ length: 13 }, (_, i) => ({ ...good.map.sensors[0], id: `s${i}` })) } };
    const badRole = { ...good, map: { ...good.map, sensors: [{ ...good.map.sensors[0], role: 'relay' }] } };
    const badNumber = { ...good, map: { ...good.map, sensors: [{ ...good.map.sensors[0], lat: 'north' }] } };
    const negativeHeight = { ...good, map: { ...good.map, sensors: [{ ...good.map.sensors[0], aglM: -1 }] } };
    for (const raw of [thirteen, badRole, badNumber, negativeHeight, { inputs: good.inputs }, null, 'text']) expect(validateImport(raw)).toBeNull();
  });

  it('accepts a valid v3 scenario round trip', () => {
    const good = freshDefaultState();
    good.map.selectedId = good.map.sensors[1].id;
    expect(validateImport(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it('clears a selection that names a missing sensor', () => {
    const good = freshDefaultState();
    good.map.selectedId = 'ghost';
    expect(normalizeState(good).map.selectedId).toBeNull();
  });
});

describe('schema 6 interference settings', () => {
  it('migrates a schema 5 file with missing fields without changing link results', () => {
    const old = JSON.parse(JSON.stringify(freshDefaultState()));
    old.schemaVersion = 5;
    delete old.map.protectionMarginDb;
    delete old.map.aggregateInterference;
    for (const sensor of old.map.sensors) {
      delete sensor.protectionMarginDb;
      delete sensor.requiredCiDb;
    }
    const next = validateImport(old)!;
    expect(next.schemaVersion).toBe(9);
    expect(next.map.protectionMarginDb).toBe(3);
    expect(next.map.aggregateInterference).toBe('objective');
    for (const sensor of next.map.sensors) {
      expect(sensor.protectionMarginDb).toBe('default');
      expect(sensor.requiredCiDb).toBe(10);
    }
    expect(activeInputs(next, () => 0)).toEqual(activeInputs(freshDefaultState(), () => 0));
  });

  it('round-trips custom schema 8 settings including zero and receiver overrides', () => {
    const raw = JSON.parse(JSON.stringify(freshDefaultState()));
    raw.schemaVersion = 8;
    raw.map.protectionMarginDb = 0;
    raw.map.sensors[1].protectionMarginDb = 4;
    raw.map.sensors[1].requiredCiDb = 0;
    for (const mode of ['objective', 'always', 'never']) {
      raw.map.aggregateInterference = mode;
      expect(validateImport(raw)).toEqual({ ...raw, schemaVersion: 9 });
    }
  });

  it('defaults newly created sensors', () => {
    const state = freshDefaultState();
    const sensor = createSensor([], 'rx', { lat: 1.3, lon: 103.8 }, state.inputs);
    expect(sensor).toMatchObject({ protectionMarginDb: 'default', requiredCiDb: 10 });
  });

  it('rejects invalid settings instead of silently replacing them', () => {
    for (const field of ['protectionMarginDb', 'requiredCiDb']) {
      for (const value of [-1, NaN, Infinity, null, '3', 'invalid']) {
        const raw = JSON.parse(JSON.stringify(freshDefaultState()));
        raw.map.sensors[1][field] = value;
        expect(validateImport(raw), `${field}: ${String(value)}`).toBeNull();
      }
    }
    for (const value of [-1, NaN, Infinity, null, '3', 'default']) {
      const raw = JSON.parse(JSON.stringify(freshDefaultState()));
      raw.map.protectionMarginDb = value;
      expect(validateImport(raw)).toBeNull();
    }
    for (const value of ['invalid', null, 1]) {
      const raw = JSON.parse(JSON.stringify(freshDefaultState()));
      raw.map.aggregateInterference = value;
      expect(validateImport(raw)).toBeNull();
    }
  });
});

it('migrates v3 onto the terrain model with the default objective', () => {
  const old = freshDefaultState();
  const { propagationModel: _p, defaultObjective: _d, ...map } = old.map;
  const next = normalizeState({ ...old, schemaVersion: 3, map });
  expect(next.map.propagationModel).toBe('terrain'); expect(next.map.defaultObjective).toBe('desired');
  // Over flat ground the terrain model adds no diffraction, so the loss budget is unchanged.
  expect(activeInputs(next, () => 0).otherLossDb).toBe(old.inputs.otherLossDb);
});

describe('antenna library (schema 8)', () => {
  const raw = () => JSON.parse(JSON.stringify(freshDefaultState()));
  const model = (id: string, extra = {}) => ({ id, name: id, kind: 'sector', gainDbi: 17, beamwidthDeg: 40, verticalBeamwidthDeg: 8, frontToBackDb: 30, ...extra });
  it('migrates a map without antennaModels or sensor antennas to empty library and built-in omni', () => {
    const old = raw();
    old.schemaVersion = 7;
    delete old.map.antennaModels;
    for (const s of old.map.sensors) delete s.antenna;
    const next = normalizeState(old);
    expect(next.schemaVersion).toBe(9);
    expect(next.map.antennaModels).toEqual([]);
    for (const s of next.map.sensors) expect(s.antenna).toEqual({ modelId: 'omni', azimuthDeg: 0, downtiltDeg: 0, aimAtId: null });
  });
  it('round-trips models and sensor pointing, normalising the azimuth', () => {
    const state = raw();
    const other = state.map.sensors[1].id;
    state.map.antennaModels = [model('ant-1')];
    state.map.sensors[0].antenna = { modelId: 'ant-1', azimuthDeg: 120, downtiltDeg: -3, aimAtId: other };
    expect(validateImport(state)).toEqual(state);
    state.map.sensors[0].antenna.azimuthDeg = -30;
    expect(validateImport(state)?.map.sensors[0].antenna.azimuthDeg).toBe(330);
  });
  it('rejects invalid models, duplicate ids, the reserved id and more than 24', () => {
    const cases: unknown[][] = [
      [model('a', { kind: 'dish' })], [model('a', { beamwidthDeg: 0 })], [model('a', { verticalBeamwidthDeg: 91 })], [model('a', { frontToBackDb: 61 })], [model('a', { gainDbi: 'x' })],
      [model('a'), model('a')], [model('omni')], [model('')], Array.from({ length: 25 }, (_, i) => model(`m${i}`)),
    ];
    for (const models of cases) { const state = raw(); state.map.antennaModels = models; expect(validateImport(state)).toBeNull(); }
    const state = raw(); state.map.antennaModels = 'x'; expect(validateImport(state)).toBeNull();
    const ok = raw(); ok.map.antennaModels = Array.from({ length: 24 }, (_, i) => model(`m${i}`)); expect(validateImport(ok)).not.toBeNull();
  });
  it('rejects an invalid sensor antenna', () => {
    for (const bad of [{ modelId: 3 }, { azimuthDeg: 'x' }, { downtiltDeg: -21 }, { downtiltDeg: 46 }, { downtiltDeg: 'x' }, { aimAtId: 3 }, 'x']) {
      const state = raw();
      state.map.sensors[0].antenna = typeof bad === 'string' ? bad : { ...state.map.sensors[0].antenna, ...bad };
      expect(validateImport(state)).toBeNull();
    }
    expect(normalizeState({ ...raw(), map: { ...raw().map, sensors: [{ ...raw().map.sensors[0], antenna: 'x' }] } }).map).toEqual(freshDefaultState().map);
  });
  it('moves an unknown model to omni and clears an aimAtId that names no sensor or the sensor itself', () => {
    const state = raw();
    state.map.sensors[0].antenna = { ...state.map.sensors[0].antenna, modelId: 'ghost', aimAtId: 'ghost' };
    state.map.sensors[1].antenna = { ...state.map.sensors[1].antenna, aimAtId: state.map.sensors[1].id };
    const next = validateImport(state)!;
    expect(next.map.sensors[0].antenna.modelId).toBe('omni');
    expect(next.map.sensors[0].antenna.aimAtId).toBeNull();
    expect(next.map.sensors[1].antenna.aimAtId).toBeNull();
  });
  it('converts the interim flat per-sensor format, reusing identical models and keeping results', () => {
    const state = raw();
    const [a, b] = state.map.sensors;
    delete state.map.antennaModels;
    a.gainDbi = 15; b.gainDbi = 15;
    a.antenna = { kind: 'sector', azimuthDeg: 90, beamwidthDeg: 40, frontToBackDb: 30, verticalBeamwidthDeg: 7, downtiltDeg: -3, aimAtId: b.id };
    b.antenna = { kind: 'sector', azimuthDeg: 270, beamwidthDeg: 40, frontToBackDb: 30, verticalBeamwidthDeg: 7, downtiltDeg: 2, aimAtId: null };
    const next = normalizeState(state);
    expect(next.map.antennaModels).toEqual([{ id: 'ant-1', name: 'Sector 1', kind: 'sector', gainDbi: 15, beamwidthDeg: 40, verticalBeamwidthDeg: 7, frontToBackDb: 30 }]);
    expect(next.map.sensors[0].antenna).toEqual({ modelId: 'ant-1', azimuthDeg: 90, downtiltDeg: -3, aimAtId: b.id });
    expect(next.map.sensors[1].antenna).toEqual({ modelId: 'ant-1', azimuthDeg: 270, downtiltDeg: 2, aimAtId: null });
    // Different gain: a second model. Horizontal-only flat values default the vertical fields. Omni becomes the default.
    b.gainDbi = 12; b.antenna = { kind: 'sector', azimuthDeg: 10, beamwidthDeg: 40, frontToBackDb: 30 };
    const two = normalizeState(state);
    expect(two.map.antennaModels.map((m) => [m.id, m.gainDbi, m.verticalBeamwidthDeg])).toEqual([['ant-1', 15, 7], ['ant-2', 12, 10]]);
    b.antenna = { kind: 'omni', azimuthDeg: 5, beamwidthDeg: 65, frontToBackDb: 25, verticalBeamwidthDeg: 10, downtiltDeg: 0, aimAtId: null };
    expect(normalizeState(state).map.sensors[1].antenna).toEqual({ modelId: 'omni', azimuthDeg: 0, downtiltDeg: 0, aimAtId: null });
    b.antenna = { kind: 'sector', azimuthDeg: 10, beamwidthDeg: 0, frontToBackDb: 30 };
    expect(validateImport(state)).toBeNull();
  });
});
