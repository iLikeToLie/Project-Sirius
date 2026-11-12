import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import { sampleGrid } from './contours';
import { flatGroundRadiusM, thresholdSlantRangeM } from './thresholds';
import { computeZones, sameZoneResult, ZONE, type ZoneRequest, type ZoneResult } from './zones';

const inputs = DEFAULT_STATE.inputs;
const slant = {
  sensitivityM: thresholdSlantRangeM(inputs, inputs.sensitivityDbm),
  requiredM: thresholdSlantRangeM(inputs, inputs.sensitivityDbm + inputs.fadeMarginTargetDb),
  interferenceM: thresholdSlantRangeM(inputs, inputs.interferenceThresholdDbm),
};
const bounds = { minX: -30_000, maxX: 30_000, minY: -30_000, maxY: 30_000 };
const COLS = 300;
const request = (ground = sampleGrid(bounds, COLS, COLS, () => 0), s = slant): ZoneRequest => ({
  jobId: 1, ground, tx: { xM: 0, yM: 0, elevationM: 10 }, rxAglM: 10, slant: s,
});
const node = (xM: number, yM: number) => ((yM + 30_000) / 200) * (COLS + 1) + (xM + 30_000) / 200;

describe('range zones', () => {
  it('classifies nodes by separation', () => {
    const z = computeZones(request());
    expect(z.classes[node(1000, 0)]).toBe(ZONE.acceptable);
    expect(z.classes[node(3000, 0)]).toBe(ZONE.acceptable);
    expect(z.classes[node(10_000, 0)]).toBe(ZONE.weak);
    expect(z.classes[node(28_000, 0)]).toBe(ZONE.none);
  });

  it('marks the interference area', () => {
    const z = computeZones(request());
    expect(z.interference[node(1000, 0)]).toBe(1);
    expect(z.interference[node(2400, 0)]).toBe(1);
    expect(z.interference[node(2600, 0)]).toBe(0);
    expect(z.interference[node(3000, 0)]).toBe(0);
  });

  it('matches the analytic circle on flat ground', () => {
    const z = computeZones(request());
    const radius = flatGroundRadiusM(slant.requiredM, 0);
    expect(z.outlines.required.length).toBeGreaterThan(40);
    for (const [x, y] of z.outlines.required) expect(Math.abs(Math.hypot(x, y) - radius)).toBeLessThan(z.cellSizeM);
  });

  it('leaves unknown ground unknown', () => {
    const z = computeZones(request(sampleGrid(bounds, COLS, COLS, (x) => (x < 0 ? NaN : 0))));
    expect(z.classes[node(-1000, 0)]).toBe(ZONE.unknown);
    expect(z.interference[node(-1000, 0)]).toBe(0);
    for (const [x1, , x2] of z.outlines.interference) { expect(x1).toBeGreaterThanOrEqual(0); expect(x2).toBeGreaterThanOrEqual(0); }
  });

  it('handles unavailable slant ranges', () => {
    const z = computeZones(request(undefined, { sensitivityM: NaN, requiredM: NaN, interferenceM: NaN }));
    expect(z.outlines).toEqual({ sensitivity: [], required: [], interference: [] });
    expect(z.classes.every((c) => c === ZONE.none)).toBe(true);
  });
});

describe('sameZoneResult', () => {
  const zone = (): ZoneResult => ({ jobId: 1, bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1 }, cols: 2, rows: 1, cellSizeM: 1,
    classes: Uint8Array.from([0, 1, 2, 255, 0, 1]), interference: new Uint8Array(6), powerDbm: Float32Array.from([-60, NaN, -70, -80, -90, -50]),
    outlines: { sensitivity: [[0, 0, 1, 1]], required: [], interference: [] } });
  it('ignores the job id, and compares NaN power nodes as equal', () => {
    expect(sameZoneResult(zone(), { ...zone(), jobId: 9 })).toBe(true);
  });
  it('notices a changed class, power, outline or missing result', () => {
    const changed = zone(); changed.classes[1] = 0;
    expect(sameZoneResult(zone(), changed)).toBe(false);
    const power = zone(); power.powerDbm![0] = -61;
    expect(sameZoneResult(zone(), power)).toBe(false);
    const outline = zone(); outline.outlines.sensitivity = [[0, 0, 1, 2]];
    expect(sameZoneResult(zone(), outline)).toBe(false);
    expect(sameZoneResult(zone(), null)).toBe(false);
    expect(sameZoneResult(null, null)).toBe(true);
  });
});
