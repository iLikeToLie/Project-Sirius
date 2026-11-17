import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { AntennaModel } from '../types';
import { derivedBeamwidthDeg, horizontalTermDb, interpolateLossDb, isAntennaModel, MAX_PATTERN_POINTS, newSectorModel, patternKey, patternLossDb, resolveAntenna, sectorToPoints, verticalTermDb } from './antenna';

const custom = (): AntennaModel => ({ ...newSectorModel([]), kind: 'custom', frontToBackDb: 60,
  pattern: { horizontal: [[0, 0], [90, 12], [180, 30], [270, 24]], vertical: [[-90, 50], [0, 0], [90, 30]] } });
const resolve = (m: AntennaModel, azimuthDeg = 0, downtiltDeg = 0) => resolveAntenna({ antennaModels: [m] }, {
  ...DEFAULT_STATE.map.sensors[0], antenna: { modelId: m.id, azimuthDeg, downtiltDeg, aimAtId: null },
});

describe('custom antenna point tables', () => {
  it('interpolates cyclic cuts across north and clamps vertical endpoints', () => {
    expect(interpolateLossDb([[10, 2], [350, 6]], 0, true)).toBe(4);
    expect(interpolateLossDb([[0, 0], [360, 0]], -1, true)).toBe(0);
    expect(interpolateLossDb([[-90, 40], [90, 20]], -120, false)).toBe(40);
    expect(interpolateLossDb([[-90, 40], [90, 20]], 120, false)).toBe(20);
  });
  it('densifies once per model, preserves signed asymmetry and survives structured clone', () => {
    const m = custom(), p = resolve(m, 20), q = resolve(m, 30);
    expect(p.kind).toBe('custom');
    expect(p.hLossDb).toHaveLength(360);
    expect(p.vLossDb).toHaveLength(181);
    expect(p.hLossDb).toBe(q.hLossDb);
    expect(horizontalTermDb(p, 65)).toBe(6);
    expect(horizontalTermDb(p, -25)).toBe(12);
    expect(patternLossDb(structuredClone(p), 65)).toBe(6);
    expect(horizontalTermDb(p, 65.5)).toBeCloseTo(12 * 45.5 / 90);
  });
  it('uses custom vertical loss with tilt and no 20 dB cap, then caps the sum', () => {
    const p = resolve(custom(), 0, 10);
    expect(verticalTermDb(p, -10)).toBe(0);
    expect(verticalTermDb(p, 80)).toBe(30);
    expect(verticalTermDb(p, 100)).toBe(30);
    expect(patternLossDb({ ...p, frontToBackDb: 25 }, 180, 80)).toBe(25);
  });
  it('seeds tables with the sector terms at every sample angle', () => {
    const m = newSectorModel([]), points = sectorToPoints(m), p = resolve(m);
    expect(points.horizontal).toHaveLength(37);
    expect(points.vertical).toHaveLength(37);
    for (const [a, loss] of points.horizontal) expect(loss).toBeCloseTo(patternLossDb(p, a), 8);
    for (const [a, loss] of points.vertical) expect(loss).toBeCloseTo(patternLossDb(p, 0, a), 8);
    expect(isAntennaModel({ ...m, kind: 'custom', pattern: points })).toBe(true);
  });
  it('derives the first 3 dB crossings around boresight, ignoring sidelobes', () => {
    expect(derivedBeamwidthDeg([[0, 0], [30, 3], [90, 20], [180, 0], [330, 6]])).toBe(45);
    expect(derivedBeamwidthDeg([[-90, 30], [-10, 3], [0, 0], [20, 3], [90, 30]])).toBe(30);
    expect(derivedBeamwidthDeg([[0, 0], [180, 0]])).toBe(360);
    expect(resolve(custom()).beamwidthDeg).toBeCloseTo(33.75);
  });
  it('derives one-sided and flat vertical cuts using clamping rather than wrapping', () => {
    const m = custom();
    m.pattern!.vertical = [[0, 0], [90, 30]];
    expect(resolve(m).verticalBeamwidthDeg).toBe(99);
    const flat = { ...m, pattern: { ...m.pattern!, vertical: [[0, 0], [90, 0]] as [number, number][] } };
    expect(resolve(flat).verticalBeamwidthDeg).toBe(180);
  });
  it('keys content and pointing, including edits between integer samples', () => {
    const m = custom(), p = resolve(m);
    const edited = { ...m, pattern: { ...m.pattern!, horizontal: [[0, 0], [0.2, 1], [0.4, 0], [90, 12], [180, 30], [270, 24]] as [number, number][] } };
    expect(patternKey(resolve(edited))).not.toBe(patternKey(p));
    expect(patternKey(resolve(m, 1))).not.toBe(patternKey(p));
    expect(patternKey(resolve(m, 0, 1))).not.toBe(patternKey(p));
    expect(patternKey(structuredClone(p))).toBe(patternKey(p));
    expect(patternKey({ ...resolve(newSectorModel([])), beamwidthDeg: 90 })).not.toBe(patternKey(resolve(newSectorModel([]))));
  });
  it('validates all table bounds, unique angles and retained sector tables', () => {
    const m = custom();
    expect(MAX_PATTERN_POINTS).toBe(721);
    expect(isAntennaModel(m)).toBe(true);
    const badCuts = [[], [[0, 0]], [[0, 0], [0, 2]], [[-1, 0], [90, 0]], [[0, -1], [90, 0]], [[0, 61], [90, 0]], [[0, NaN], [90, 0]], [[0, 0, 2], [90, 0]], Array.from({ length: 722 }, (_, i) => [i / 3, 0])];
    for (const cut of badCuts) expect(isAntennaModel({ ...m, pattern: { ...m.pattern, horizontal: cut } })).toBe(false);
    expect(isAntennaModel({ ...m, pattern: undefined })).toBe(false);
    expect(isAntennaModel({ ...m, pattern: { ...m.pattern, vertical: [[-91, 0], [0, 0]] } })).toBe(false);
    expect(isAntennaModel({ ...m, kind: 'sector' })).toBe(true);
    expect(isAntennaModel({ ...m, kind: 'sector', pattern: {} })).toBe(false);
    expect(isAntennaModel({ ...m, name: ' ' })).toBe(false);
  });
});
