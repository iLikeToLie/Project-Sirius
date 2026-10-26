import { describe, expect, it } from 'vitest';
import { DEFAULT_TERRAIN } from '../data/defaults';
import { groundElevationM, syntheticV1, TERRAIN_MODEL_VERSION } from './terrain';

const terrain = (overrides = {}) => ({ ...DEFAULT_TERRAIN, enabled: true, ...overrides });

describe('synthetic terrain sampler', () => {
  it('is flat at zero when terrain is disabled', () => {
    expect(groundElevationM({ ...DEFAULT_TERRAIN, offsetM: 300 }, -850, 1100)).toBe(0);
  });

  it('is pinned to model version synthetic-v1', () => {
    expect(TERRAIN_MODEL_VERSION).toBe('synthetic-v1');
  });

  it('is deterministic and has a ridge above the valley floor', () => {
    expect(syntheticV1(-700, 1100)).toBe(syntheticV1(-700, 1100));
    expect(syntheticV1(-700, 1100)).toBeGreaterThan(500);
    expect(syntheticV1(600, -3000)).toBeLessThan(50);
  });

  it('applies relief scale and offset to the shared height model', () => {
    const raw = syntheticV1(250, 400);
    expect(groundElevationM(terrain({ reliefScale: 2, offsetM: -30 }), 250, 400)).toBeCloseTo(2 * raw - 30, 12);
  });

  it('becomes flat at the offset when relief scale is zero', () => {
    expect(groundElevationM(terrain({ reliefScale: 0, offsetM: 12 }), -700, 1100)).toBe(12);
    expect(groundElevationM(terrain({ reliefScale: 0, offsetM: 12 }), 5000, -9000)).toBe(12);
  });

  it('allows negative ground elevations', () => {
    expect(groundElevationM(terrain({ offsetM: -500 }), 600, -3000)).toBeLessThan(0);
  });
});
