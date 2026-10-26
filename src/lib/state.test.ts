import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, freshDefaultState } from '../data/defaults';
import type { AppState } from '../types';
import { normalizeState, withWorkspace } from './state';

const legacy = (distanceM: number) => {
  const { workspace: _workspace, schemaVersion: _version, ...rest } = freshDefaultState();
  return { ...rest, inputs: { ...rest.inputs, distanceM } } as Partial<AppState>;
};

describe('scenario migration', () => {
  it('returns defaults when nothing is saved', () => {
    expect(normalizeState()).toEqual(DEFAULT_STATE);
  });

  it('gives a legacy scenario flat-ground geometry that reproduces its distance', () => {
    const state = normalizeState(legacy(1234.5));
    expect(state.schemaVersion).toBe(2);
    expect(state.workspace.terrain.enabled).toBe(false);
    expect(state.workspace.tx.aglM).toBe(state.workspace.rx.aglM);
    expect(state.workspace.tx.xM - state.workspace.rx.xM).toBeCloseTo(1234.5, 9);
    expect(state.inputs.distanceM).toBeCloseTo(1234.5, 9);
  });

  it('keeps a valid saved workspace and derives distance from it', () => {
    const saved = freshDefaultState();
    saved.workspace.tx = { xM: 3, yM: 4, aglM: 10 };
    saved.workspace.rx = { xM: 0, yM: 0, aglM: 10 };
    saved.inputs.distanceM = 999;
    const state = normalizeState(saved);
    expect(state.workspace.tx).toEqual({ xM: 3, yM: 4, aglM: 10 });
    expect(state.inputs.distanceM).toBeCloseTo(5, 12);
  });

  it('replaces malformed workspace data with migrated geometry', () => {
    const saved = { ...freshDefaultState(), workspace: { tx: { xM: 'a', yM: 0, aglM: -2 }, rx: null } } as unknown as Partial<AppState>;
    const state = normalizeState(saved);
    expect(state.workspace.tx.xM - state.workspace.rx.xM).toBeCloseTo(500, 9);
    expect(state.inputs.distanceM).toBeCloseTo(500, 9);
  });

  it('derives the calculator distance whenever the workspace changes', () => {
    const state = withWorkspace(freshDefaultState(), { ...DEFAULT_STATE.workspace, tx: { xM: 0, yM: 40, aglM: 10 }, rx: { xM: 30, yM: 0, aglM: 10 } });
    expect(state.inputs.distanceM).toBe(50);
    expect(state.workspace.tx.yM).toBe(40);
  });

  it('accepts negative terrain offset but rejects invalid terrain numbers', () => {
    const saved = freshDefaultState();
    saved.workspace.terrain = { ...saved.workspace.terrain, offsetM: -40, contourIntervalM: 0 };
    const state = normalizeState(saved);
    expect(state.workspace.terrain.offsetM).toBe(-40);
    expect(state.workspace.terrain.contourIntervalM).toBe(DEFAULT_STATE.workspace.terrain.contourIntervalM);
  });
});
