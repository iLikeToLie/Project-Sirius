import { describe, expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import { sampleGrid } from './contours';
import { interferenceSources, interferenceZones, placementZones, referenceReceiver } from './interferenceLayer';

describe('total interference layer', () => {
  it('prefers the selected receiver, then zone receiver, then first receiver', () => {
    const { map } = freshDefaultState();
    const rx = map.sensors[1], other = { ...rx, id: 'other' };
    map.sensors.push(other);
    expect(referenceReceiver(map, other, rx)).toBe(other);
    expect(referenceReceiver(map, map.sensors[0], other)).toBe(other);
    expect(referenceReceiver(map, null, null)).toBe(rx);
    map.sensors = [map.sensors[0]];
    expect(referenceReceiver(map, null, null)).toBeNull();
  });
  it('excludes desired transmitters and retains pair isolation and receiver height settings', () => {
    const { map, inputs } = freshDefaultState();
    map.useTerrainElevation = false;
    const tx = map.sensors[0], rx = map.sensors[1];
    rx.objective = 'desired'; rx.desiredTxIds = [tx.id];
    const other = { ...tx, id: 'other', polarization: 'H' as const };
    map.sensors.push(other);
    const sources = interferenceSources(map, inputs, rx, () => 0);
    expect(sources).toHaveLength(1);
    expect(sources[0].inputs.otherLossDb).toBe(inputs.otherLossDb + map.crossPolarDiscriminationDb);
    expect(sources[0].elevationM).toBe(other.aglM);
    rx.objective = 'avoidance';
    expect(interferenceSources(map, inputs, rx, () => 0)).toHaveLength(2);
  });
  const grid = sampleGrid({ minX: 0, maxX: 3, minY: 0, maxY: 1 }, 3, 1, () => 0);
  const field = (values: number[]) => Float32Array.from([...values, ...values]);
  it('sums linear powers or takes the maximum and classifies exact band boundaries', () => {
    const { map } = freshDefaultState(), rx = map.sensors[1];
    rx.interferenceThresholdDbm = -70; rx.protectionMarginDb = 3;
    map.aggregateInterference = 'never';
    const powers = [field([-70, -73, -74, -80]), field([-80, -80, -80, -80])];
    const worst = interferenceZones(map, rx, grid, { jobId: 1, powers });
    expect([...worst.interference].slice(0, 4)).toEqual([1, 0, 0, 0]);
    expect([...worst.classes].slice(0, 4)).toEqual([0, 1, 0, 0]);
    map.aggregateInterference = 'always';
    const total = interferenceZones(map, rx, grid, { jobId: 1, powers: [field([-72, -80, -80, -80]), field([-72, -80, -80, -80])] });
    expect(total.powerDbm![0]).toBeCloseTo(-68.9897, 3);
    expect(total.interference[0]).toBe(1);
  });
  it('marks incomplete paths unknown, and no interferers clear on known ground', () => {
    const { map } = freshDefaultState(), rx = map.sensors[1];
    const unknown = interferenceZones(map, rx, grid, { jobId: 1, powers: [field([-80, NaN, -80, -80]), field([-90, -90, -90, -90])] });
    expect(unknown.classes[1]).toBe(255);
    expect(unknown.powerDbm![1]).toBeNaN();
    grid.values[0] = NaN;
    const empty = interferenceZones(map, rx, grid, { jobId: 2, powers: [] });
    expect(empty.classes[0]).toBe(255);
    expect(empty.classes[1]).toBe(0);
    expect(empty.powerDbm![1]).toBe(-Infinity);
  });
  it('outlines the interference and protected-margin edges so band layers match the range layer', () => {
    const { map } = freshDefaultState(), rx = map.sensors[1];
    rx.interferenceThresholdDbm = -70; rx.protectionMarginDb = 3;
    map.aggregateInterference = 'never';
    const zones = interferenceZones(map, rx, grid, { jobId: 1, powers: [field([-60, -68, -75, -80])] });
    expect(zones.outlines.interference.length).toBeGreaterThan(0);
    expect(zones.outlines.sensitivity.length).toBeGreaterThan(0);
    rx.protectionMarginDb = 0;
    expect(interferenceZones(map, rx, grid, { jobId: 1, powers: [field([-60, -68, -75, -80])] }).outlines.sensitivity).toEqual([]);
  });
  it('outlines placement band edges and leaves unknown cells without lines', () => {
    const plan = { victims: [], served: [], sources: [] } as unknown as Parameters<typeof placementZones>[0];
    const g = sampleGrid({ minX: 0, maxX: 3, minY: 0, maxY: 1 }, 3, 1, () => 0);
    const zones = placementZones(plan, g, { jobId: 1, powers: [] });
    // With no victims or served receivers every known cell is Recommended: one uniform band, no edges.
    expect(zones.outlines.required).toEqual([]);
    expect(zones.outlines.interference).toEqual([]);
  });
});
