import { describe, it, expect } from 'vitest';
import { computeCoverage, gridGroundNear, type CoverageRequest } from './coverage';
import { sampleGrid } from './contours';
import { DEFAULT_STATE } from '../data/defaults';
import { SG_REFERENCE } from './geo';
import { calculateLink } from './rf';
import { flatGroundRadiusM, thresholdSlantRangeM } from './thresholds';
const request = (fn = (_x: number, _y: number) => 0): CoverageRequest => ({ jobId: 1, tx: { ...SG_REFERENCE, elevationM: 10 }, rxAglM: 10, inputs: DEFAULT_STATE.inputs, maxRangeM: 4000, radials: 8, stepM: 20, ground: { origin: SG_REFERENCE, grid: sampleGrid({ minX: -4100, maxX: 4100, minY: -4100, maxY: 4100 }, 410, 410, fn) } });
describe('radial coverage', () => {
  it('matches Friis on flat clear ground and crosses sensitivity within one step', () => {
    const req = request(); req.inputs = { ...req.inputs, sensitivityDbm: -65 };
    const out = computeCoverage(req);
    for (let i = 0; i < out.powerDbm.length; i++) expect(out.powerDbm[i]).toBeCloseTo(calculateLink({ ...req.inputs, distanceM: (i % out.steps + 1) * req.stepM }).receivedPowerDbm, 2);
    const crossing = Array.from(out.powerDbm.slice(0, out.steps)).findIndex(p => p < req.inputs.sensitivityDbm);
    const range = flatGroundRadiusM(thresholdSlantRangeM(req.inputs, -65), 0);
    expect(Math.abs((crossing + 1) * req.stepM - range)).toBeLessThanOrEqual(req.stepM);
  });
  it('shadows the sector behind a ridge with greater loss at higher frequency', () => {
    const req = request((x, y) => x > 800 && x < 1100 && Math.abs(y) < 300 ? 80 : 0);
    req.inputs = { ...req.inputs, frequencyGhz: .433 };
    const low = computeCoverage(req); const high = computeCoverage({ ...req, inputs: { ...req.inputs, frequencyGhz: 28 } });
    const east = 2 * low.steps + 99, north = 99;
    expect(low.powerDbm[east]).toBeLessThan(low.powerDbm[north] - 6);
    const lowDeficit = low.powerDbm[north] - low.powerDbm[east], highDeficit = high.powerDbm[north] - high.powerDbm[east];
    expect(highDeficit).toBeGreaterThan(lowDeficit);
  });
  it('marks downstream samples unknown after missing ground', () => {
    const out = computeCoverage(request((x, y) => y > 800 && y < 1000 ? NaN : 0));
    expect(out.unknown[49]).toBe(1); expect(out.powerDbm[49]).toBeNaN(); expect(out.unknown[150]).toBe(1);
  });
  it('keeps ground known within half a step beyond the grid edge, and unknown past that', () => {
    const grid = sampleGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 20, 20, () => 7);
    expect(gridGroundNear(grid, 108, 0, 10.2)).toBe(7);
    expect(gridGroundNear(grid, 115, 0, 10.2)).toBeNaN();
    const out = computeCoverage({ ...request(), maxRangeM: 140, stepM: 35, radials: 4, ground: { origin: SG_REFERENCE, grid } });
    expect(out.unknown[2]).toBe(0); // 105 m, 5 m past the 100 m edge
    expect(out.unknown[3]).toBe(1); // 140 m, well past it
  });
  it('computes 720 × 400 within 300 ms', () => {
    const req = { ...request(), radials: 720, stepM: 10 };
    const t = performance.now(); const out = computeCoverage(req);
    expect(out.powerDbm.length).toBe(288000); expect(performance.now() - t).toBeLessThan(300);
  });
});
it('reprojects polar samples into classes and preserves unknown cells', async () => {
  const { coverageZones } = await import('./coverage');
  const req = request(); const out = computeCoverage(req);
  const raster = sampleGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 2, 2, () => 0);
  out.unknown.fill(1); out.powerDbm.fill(NaN);
  expect(Array.from(coverageZones(out, req, raster).classes)).toEqual(Array(9).fill(255));
  out.unknown.fill(0); out.powerDbm.fill(-60);
  expect(Array.from(coverageZones(out, req, raster).classes)).toEqual(Array(9).fill(2));
});
it('draws received-power contours and never bridges unknown terrain', async () => {
  const { coverageZones } = await import('./coverage');
  const req = { ...request(), radials: 4, maxRangeM: 300, stepM: 100 };
  const out = computeCoverage(req);
  out.powerDbm.set(Array.from({ length: 12 }, (_, i) => [-50, -70, -90][i % 3]));
  const raster = sampleGrid({ minX: -100, maxX: 100, minY: 100, maxY: 300 }, 2, 4, () => 0);
  const zones = coverageZones(out, req, raster);
  for (const lines of Object.values(zones.outlines)) expect(lines.length).toBeGreaterThan(0);
  out.unknown.fill(1);
  const missing = coverageZones(out, req, raster);
  for (const lines of Object.values(missing.outlines)) expect(lines).toEqual([]);
});
it('exposes received power per grid node, NaN where unknown', async () => {
  const { coverageZones } = await import('./coverage');
  const req = { ...request(), radials: 4, maxRangeM: 300, stepM: 100 };
  const out = computeCoverage(req);
  const raster = sampleGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 2, 2, () => 0);
  out.unknown.fill(0); out.powerDbm.fill(-60);
  expect(Array.from(coverageZones(out, req, raster).powerDbm!)).toEqual(Array(9).fill(-60));
  out.unknown.fill(1);
  expect(Array.from(coverageZones(out, req, raster).powerDbm!).every(Number.isNaN)).toBe(true);
});
