import { expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import { sampleGrid } from './contours';
import { coverageZones, reprojectPowers, type CoverageResult } from './coverage';
import { SG_REFERENCE } from './geo';

const polar = (): CoverageResult => ({ jobId: 8, radials: 4, steps: 2, stepM: 100,
  powerDbm: Float32Array.of(-50, -60, -70, -80, -90, -100, -110, -120), unknown: new Uint8Array(8) });

it('keeps the existing nearest-ray classes, interference and powers exactly', () => {
  const out = polar();
  const raster = sampleGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 2, 2, () => 0);
  const req = { tx: { ...SG_REFERENCE, elevationM: 10 }, rxAglM: 10,
    inputs: { ...DEFAULT_STATE.inputs, sensitivityDbm: -85, fadeMarginTargetDb: 20, interferenceThresholdDbm: -75 },
    radials: 4, stepM: 100, maxRangeM: 200, ground: { origin: SG_REFERENCE, grid: raster } };
  const zones = coverageZones(out, req, raster);
  expect(Array.from(zones.powerDbm!)).toEqual([-110, -90, -70, -110, -50, -70, -50, -50, -70]);
  expect(Array.from(zones.classes)).toEqual([0, 0, 1, 0, 2, 1, 2, 2, 1]);
  expect(Array.from(zones.interference)).toEqual([0, 0, 1, 0, 1, 1, 1, 1, 1]);
});

it('reprojects from the source position, retains NaN for unknown and outside-range nodes', () => {
  const out = polar(); out.unknown[2] = 1;
  const raster = sampleGrid({ minX: 100, maxX: 300, minY: -50, maxY: 250 }, 2, 3, () => 0);
  const powers = reprojectPowers(out, { xM: 100, yM: -50 }, raster);
  expect(powers).toBeInstanceOf(Float64Array);
  expect(powers[0]).toBe(-50); // source node uses first north sample, as before
  expect(powers[1]).toBeNaN(); // unknown first east sample
  expect(powers[2]).toBe(-80); // second east sample
  expect(powers[3]).toBe(-50); // first north sample
  expect(powers[6]).toBe(-60); // second north sample
  expect(powers[9]).toBeNaN(); // beyond range
});
