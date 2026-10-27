import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, DEFAULT_TERRAIN, freshDefaultState, workspaceForDistance } from '../data/defaults';
import type { AppState, LinkWorkspace } from '../types';
import { activeInputs } from './activeLink';
import { separation3dM } from './linkGeometry';
import { normalizeState, validateImport } from './state';

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
  it('returns defaults when nothing is saved', () => {
    expect(normalizeState()).toEqual(DEFAULT_STATE);
    expect(DEFAULT_STATE.schemaVersion).toBe(5);
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
    expect(state.schemaVersion).toBe(5);
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

  it('rejects imports with more than six sensors, unknown roles or non-numeric fields', () => {
    const good = freshDefaultState();
    const seven = { ...good, map: { ...good.map, sensors: Array.from({ length: 7 }, (_, i) => ({ ...good.map.sensors[0], id: `s${i}` })) } };
    const badRole = { ...good, map: { ...good.map, sensors: [{ ...good.map.sensors[0], role: 'relay' }] } };
    const badNumber = { ...good, map: { ...good.map, sensors: [{ ...good.map.sensors[0], lat: 'north' }] } };
    const negativeHeight = { ...good, map: { ...good.map, sensors: [{ ...good.map.sensors[0], aglM: -1 }] } };
    for (const raw of [seven, badRole, badNumber, negativeHeight, { inputs: good.inputs }, null, 'text']) expect(validateImport(raw)).toBeNull();
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

it('migrates v3 with free-space results unchanged', () => {
  const old = freshDefaultState();
  const { propagationModel: _p, defaultObjective: _d, ...map } = old.map;
  const next = normalizeState({ ...old, schemaVersion: 3, map });
  expect(next.map.propagationModel).toBe('free-space'); expect(next.map.defaultObjective).toBe('desired');
  expect(activeInputs(next, () => 0).otherLossDb).toBe(old.inputs.otherLossDb);
});
