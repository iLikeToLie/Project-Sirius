import { describe, expect, it } from 'vitest';
import { DEFAULT_TERRAIN, workspaceForDistance } from '../data/defaults';
import type { LinkWorkspace } from '../types';
import { antennaElevationM, findTxRadialDistances, groundSeparationM, isValidPlacement, separation3dM, solveTxForDistance } from './linkGeometry';

const flat = (tx: LinkWorkspace['tx'], rx: LinkWorkspace['rx']): LinkWorkspace => ({ tx, rx, terrain: { ...DEFAULT_TERRAIN } });
const hilly = (tx: LinkWorkspace['tx'], rx: LinkWorkspace['rx'], overrides = {}): LinkWorkspace => ({ tx, rx, terrain: { ...DEFAULT_TERRAIN, enabled: true, ...overrides } });

describe('link geometry', () => {
  it('measures a 3-4-5 planar separation on flat ground', () => {
    const ws = flat({ xM: 3, yM: 4, aglM: 10 }, { xM: 0, yM: 0, aglM: 10 });
    expect(groundSeparationM(ws)).toBe(5);
    expect(separation3dM(ws)).toBe(5);
  });

  it('includes antenna height difference in 3D separation', () => {
    const ws = flat({ xM: 3, yM: 0, aglM: 14 }, { xM: 0, yM: 0, aglM: 10 });
    expect(groundSeparationM(ws)).toBe(3);
    expect(separation3dM(ws)).toBe(5);
  });

  it('reproduces the 500 m default scenario', () => {
    expect(separation3dM(workspaceForDistance(500))).toBe(500);
  });

  it('adds terrain elevation to antenna height above ground', () => {
    const ws = hilly({ xM: -700, yM: 1100, aglM: 10 }, { xM: 600, yM: -3000, aglM: 10 });
    expect(antennaElevationM(ws.terrain, ws.tx)).toBeGreaterThan(500);
    expect(separation3dM(ws)).toBeGreaterThan(groundSeparationM(ws));
  });

  it('is unchanged by a common elevation offset', () => {
    const a = hilly({ xM: -700, yM: 1100, aglM: 10 }, { xM: 600, yM: -3000, aglM: 25 });
    const b = hilly(a.tx, a.rx, { offsetM: 750 });
    expect(separation3dM(b)).toBeCloseTo(separation3dM(a), 9);
  });

  it('allows negative ground elevation', () => {
    const ws = hilly({ xM: 600, yM: -3000, aglM: 10 }, { xM: 0, yM: -3000, aglM: 10 }, { offsetM: -500 });
    expect(antennaElevationM(ws.terrain, ws.tx)).toBeLessThan(0);
    expect(Number.isFinite(separation3dM(ws))).toBe(true);
  });

  it('rejects negative or nonfinite placements', () => {
    expect(isValidPlacement({ xM: 0, yM: 0, aglM: 0 })).toBe(true);
    expect(isValidPlacement({ xM: 0, yM: 0, aglM: -1 })).toBe(false);
    expect(isValidPlacement({ xM: NaN, yM: 0, aglM: 1 })).toBe(false);
  });
});

describe('separation solver', () => {
  it('moves Tx along its bearing on flat ground, keeping Rx and Tx AGL fixed', () => {
    const ws = workspaceForDistance(500);
    const solved = solveTxForDistance(ws, 1000);
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.tx).toEqual({ xM: 750, yM: 0, aglM: 10 });
    expect(separation3dM({ ...ws, tx: solved.tx })).toBeCloseTo(1000, 9);
  });

  it('hits the requested 3D separation over terrain', () => {
    const ws = hilly({ xM: 300, yM: 400, aglM: 15 }, { xM: 900, yM: 1200, aglM: 30 });
    const solved = solveTxForDistance(ws, 4200);
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(separation3dM({ ...ws, tx: solved.tx })).toBeCloseTo(4200, 6);
    expect(solved.tx.aglM).toBe(15);
    const before = Math.atan2(ws.tx.yM - ws.rx.yM, ws.tx.xM - ws.rx.xM);
    const after = Math.atan2(solved.tx.yM - ws.rx.yM, solved.tx.xM - ws.rx.xM);
    expect(after).toBeCloseTo(before, 9);
  });

  it('chooses the solution nearest the current Tx when several exist', () => {
    const rx = { xM: 700, yM: 1100, aglM: 10 };
    const base = hilly({ xM: 600, yM: 1100, aglM: 10 }, rx, { reliefScale: 5 });
    const target = 2600;
    const roots = findTxRadialDistances(base, target);
    expect(roots.length).toBeGreaterThanOrEqual(2);
    for (const root of [roots[0], roots[roots.length - 1]]) {
      const ws = { ...base, tx: { xM: rx.xM - root - 1, yM: rx.yM, aglM: 10 } };
      const solved = solveTxForDistance(ws, target);
      expect(solved.ok).toBe(true);
      if (solved.ok) expect(rx.xM - solved.tx.xM).toBeCloseTo(root, 6);
    }
  });

  it('explains when no position reaches the requested separation', () => {
    const ws = flat({ xM: 10, yM: 0, aglM: 100 }, { xM: 0, yM: 0, aglM: 0 });
    const solved = solveTxForDistance(ws, 50);
    expect(solved.ok).toBe(false);
    if (!solved.ok) expect(solved.reason).toMatch(/at least 100/);
  });

  it('rejects zero, negative and nonfinite distances', () => {
    const ws = workspaceForDistance(500);
    for (const d of [0, -5, NaN, Infinity]) expect(solveTxForDistance(ws, d).ok).toBe(false);
  });

  it('uses the negative X bearing when Tx and Rx share a plan position', () => {
    const ws = flat({ xM: 5, yM: 5, aglM: 10 }, { xM: 5, yM: 5, aglM: 10 });
    const solved = solveTxForDistance(ws, 100);
    expect(solved.ok).toBe(true);
    if (solved.ok) expect(solved.tx).toEqual({ xM: -95, yM: 5, aglM: 10 });
  });
});
