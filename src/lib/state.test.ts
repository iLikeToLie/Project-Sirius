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
/** A pre-1.4.0 save: no workspace at all. */
const v1 = (distanceM: number) => { const rest = base(); return { ...rest, inputs: { ...rest.inputs, distanceM } }; };

describe('scenario state', () => {
  it('returns defaults when nothing is saved', () => {
    expect(normalizeState()).toEqual(DEFAULT_STATE);
    expect(DEFAULT_STATE.schemaVersion).toBe(3);
    expect(DEFAULT_STATE.map.sensors.map((s) => s.role)).toEqual(['tx', 'rx']);
    expect(DEFAULT_STATE.map.useTerrainElevation).toBe(true);
  });

  it('migrates a 1.4.0 workspace without changing its result', () => {
    const workspace: LinkWorkspace = { tx: { xM: 300, yM: 400, aglM: 12 }, rx: { xM: 0, yM: 0, aglM: 10 }, terrain: { ...DEFAULT_TERRAIN, enabled: true } };
    const state = normalizeState(v2(workspace) as unknown as Partial<AppState>);
    expect(state.schemaVersion).toBe(3);
    expect(state.map.sensors).toHaveLength(2);
    expect(state.map.useTerrainElevation).toBe(false);
    expect(activeInputs(state, unknownGround).distanceM).toBeCloseTo(separation3dM(workspace), 6);
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
