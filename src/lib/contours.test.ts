import { describe, expect, it } from 'vitest';
import { contourLevels, isolineSegments, sampleGrid } from './contours';

const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
const endpoints = (segments: number[][]) => segments.flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]]);

describe('isoline extraction', () => {
  it('finds a straight isoline on a plane', () => {
    const grid = sampleGrid(bounds, 20, 20, (x) => x);
    const segments = isolineSegments(grid, 2.5);
    expect(segments.length).toBe(20);
    for (const [x] of endpoints(segments)) expect(x).toBeCloseTo(2.5, 12);
  });

  it('approximates a circle within grid tolerance', () => {
    const grid = sampleGrid(bounds, 80, 80, (x, y) => Math.hypot(x, y));
    const segments = isolineSegments(grid, 6);
    expect(segments.length).toBeGreaterThan(40);
    for (const [x, y] of endpoints(segments)) expect(Math.abs(Math.hypot(x, y) - 6)).toBeLessThan(0.02);
  });

  it('returns nothing for a level outside the field', () => {
    expect(isolineSegments(sampleGrid(bounds, 10, 10, (x) => x), 50)).toEqual([]);
  });

  it('skips cells with missing values instead of treating them as zero', () => {
    const grid = sampleGrid(bounds, 10, 10, (x) => x < 0 ? NaN : x);
    for (const [x] of endpoints(isolineSegments(grid, 1))) expect(x).toBeGreaterThanOrEqual(0);
    expect(isolineSegments(grid, -5)).toEqual([]);
  });
});

describe('contour levels', () => {
  it('lists interval multiples inside the range', () => {
    expect(contourLevels(-12, 61, 25)).toEqual([0, 25, 50]);
  });

  it('coarsens the interval rather than drawing an unbounded number of lines', () => {
    const levels = contourLevels(0, 10_000, 1);
    expect(levels.length).toBeLessThanOrEqual(200);
    expect(levels[1] - levels[0]).toBeGreaterThan(1);
  });
});
