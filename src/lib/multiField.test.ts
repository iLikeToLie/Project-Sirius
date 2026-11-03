import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import { sampleGrid } from './contours';
import { computeCoverage, reprojectPowers } from './coverage';
import { SG_REFERENCE, toLatLon, toLocalM } from './geo';
import { computeMultiField, type MultiFieldRequest } from './multiField';
import { calculateLink } from './rf';
import { thresholdSlantRangeM } from './thresholds';
import { computeZones } from './zones';

const request = (): MultiFieldRequest => ({
  jobId: 42, origin: SG_REFERENCE, mode: 'free-space', rxAglM: 5, radials: 360,
  raster: sampleGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 4, 4, (x, y) => 10 + x / 100 + y / 200),
  rayGround: sampleGrid({ minX: -500, maxX: 500, minY: -500, maxY: 500 }, 50, 50, () => 0),
  sources: [{ ...toLatLon({ xM: -30, yM: 20 }), elevationM: 35, inputs: { ...DEFAULT_STATE.inputs, otherLossDb: 8 } }],
});

describe('multi-source power fields', () => {
  it('matches the zone model’s 3D separation-derived power within 0.01 dB', () => {
    const req = request(), source = req.sources[0], tx = { ...toLocalM(source, req.origin), elevationM: source.elevationM };
    const out = computeMultiField(req);
    expect(out.jobId).toBe(req.jobId);
    expect(out.powers).toHaveLength(1);
    expect(out.powers[0]).toBeInstanceOf(Float32Array);
    const slant = {
      sensitivityM: thresholdSlantRangeM(source.inputs, source.inputs.sensitivityDbm),
      requiredM: thresholdSlantRangeM(source.inputs, source.inputs.sensitivityDbm + source.inputs.fadeMarginTargetDb),
      interferenceM: thresholdSlantRangeM(source.inputs, source.inputs.interferenceThresholdDbm),
    };
    const zones = computeZones({ jobId: req.jobId, ground: req.raster, tx, rxAglM: req.rxAglM, slant });
    for (let k = 0; k < req.raster.values.length; k++) {
      const x = req.raster.x0 + k % (req.raster.cols + 1) * req.raster.dx;
      const y = req.raster.y0 + Math.floor(k / (req.raster.cols + 1)) * req.raster.dy;
      const d = Math.hypot(x - tx.xM, y - tx.yM, req.raster.values[k] + req.rxAglM - tx.elevationM);
      const expected = calculateLink({ ...source.inputs, distanceM: d }).receivedPowerDbm;
      expect(Math.abs(out.powers[0][k] - expected)).toBeLessThan(0.01);
      expect(zones.classes[k]).toBe(expected >= source.inputs.sensitivityDbm + source.inputs.fadeMarginTargetDb ? 2 : expected >= source.inputs.sensitivityDbm ? 1 : 0);
      expect(zones.interference[k]).toBe(expected >= source.inputs.interferenceThresholdDbm ? 1 : 0);
    }
  });

  it('keeps source order, individual inputs and independent output arrays', () => {
    const req = request(), a = req.sources[0];
    const b = { ...a, inputs: { ...a.inputs, transmitPowerDbm: a.inputs.transmitPowerDbm + 7 } };
    const c = { ...a, ...toLatLon({ xM: 200, yM: 50 }), elevationM: 60 };
    const out = computeMultiField({ ...req, sources: [b, c, a] });
    for (let i = 0; i < 3; i++) {
      expect(out.powers[i]).toEqual(computeMultiField({ ...req, sources: [ [b, c, a][i] ] }).powers[0]);
    }
    expect(out.powers[0][0] - out.powers[2][0]).toBeCloseTo(7, 4);
    expect(out.powers[0].buffer).not.toBe(out.powers[2].buffer);
  });

  it('preserves missing ground per cell and missing source elevations per source', () => {
    const req = request(); req.raster.values[3] = NaN;
    const out = computeMultiField({ ...req, sources: [req.sources[0], { ...req.sources[0], elevationM: NaN }] });
    expect(out.powers[0][3]).toBeNaN();
    expect(Number.isFinite(out.powers[0][2])).toBe(true);
    expect(out.powers[1].every(Number.isNaN)).toBe(true);
    // Free-space fields use raster ground, not the separate terrain ray grid.
    req.rayGround.values.fill(NaN);
    expect(computeMultiField(req).powers[0]).toEqual(out.powers[0]);
  });

  it('does not report infinite power at a zero-length path', () => {
    const req = request();
    req.sources = [{ ...SG_REFERENCE, elevationM: req.raster.values[12] + req.rxAglM, inputs: DEFAULT_STATE.inputs }];
    const powers = computeMultiField(req).powers[0];
    expect(powers[12]).toBeNaN();
    expect(Number.isFinite(powers[13])).toBe(true);
  });

  it.each([180, 360])('reprojects terrain coverage for an off-screen source with %s radials', radials => {
    const req = request();
    req.mode = 'terrain'; req.radials = radials; req.rxAglM = 10;
    req.raster = sampleGrid({ minX: 100, maxX: 200, minY: 100, maxY: 200 }, 4, 4, () => 0);
    req.sources = [{ ...SG_REFERENCE, elevationM: 10, inputs: DEFAULT_STATE.inputs }];
    const maxRangeM = Math.hypot(200, 200), stepM = Math.max(30, maxRangeM / 400);
    const polar = computeCoverage({ jobId: req.jobId, tx: req.sources[0], rxAglM: req.rxAglM, inputs: req.sources[0].inputs,
      maxRangeM, stepM, radials, ground: { origin: req.origin, grid: req.rayGround } });
    const out = computeMultiField(req);
    expect(out.powers[0]).toEqual(Float32Array.from(reprojectPowers(polar, { xM: 0, yM: 0 }, req.raster)));
    expect(out.powers[0].every(Number.isFinite)).toBe(true);
    req.rayGround.values.fill(NaN);
    expect(computeMultiField(req).powers[0].every(Number.isNaN)).toBe(true);
  });

  it('preserves source order and terrain shadows behind a ridge', () => {
    const req = request(); req.mode = 'terrain'; req.rxAglM = 10;
    req.raster = sampleGrid({ minX: 1000, maxX: 2000, minY: -1000, maxY: 1000 }, 10, 20, () => 0);
    req.rayGround = sampleGrid({ minX: -2500, maxX: 2500, minY: -2500, maxY: 2500 }, 250, 250,
      (x, y) => x > 400 && x < 600 && Math.abs(y) < 300 ? 100 : 0);
    const a = { ...SG_REFERENCE, elevationM: 10, inputs: DEFAULT_STATE.inputs };
    const b = { ...a, inputs: { ...a.inputs, transmitPowerDbm: a.inputs.transmitPowerDbm + 6 } };
    req.sources = [b, a];
    const terrain = computeMultiField(req), clear = computeMultiField({ ...req, mode: 'free-space' });
    const east = 10 * 11 + 5;
    expect(terrain.powers[0][east] - terrain.powers[1][east]).toBeCloseTo(6, 4);
    expect(terrain.powers[0][east]).toBeLessThan(clear.powers[0][east] - 6);
  });

  it('accepts up to 12 sources, rejects 13 and handles an empty source list', () => {
    const req = request();
    expect(computeMultiField({ ...req, sources: [] })).toEqual({ jobId: 42, powers: [] });
    expect(computeMultiField({ ...req, sources: Array(12).fill(req.sources[0]) }).powers).toHaveLength(12);
    expect(() => computeMultiField({ ...req, sources: Array(13).fill(req.sources[0]) })).toThrow();
  });
});
