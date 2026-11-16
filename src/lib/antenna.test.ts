import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { AntennaPattern, Sensor } from '../types';
import { bearingDeg, defaultAntenna, DEFAULT_ANTENNA, isAntennaPattern, normAzimuth, offAxisDeg, pairPatternLoss, patternLossDb } from './antenna';
import { offsetLatLon } from './geo';

const origin = { lat: 1.35, lon: 103.8 };
const sector = (azimuthDeg: number, beamwidthDeg = 60, frontToBackDb = 25): AntennaPattern => ({ kind: 'sector', azimuthDeg, beamwidthDeg, frontToBackDb });
const sensor = (at: { lat: number; lon: number }, antenna: AntennaPattern): Sensor => ({ ...DEFAULT_STATE.map.sensors[0], ...at, antenna });

describe('antenna pattern', () => {
  it('has default values and returns fresh copies', () => {
    expect(DEFAULT_ANTENNA).toEqual({ kind: 'omni', azimuthDeg: 0, beamwidthDeg: 65, frontToBackDb: 25 });
    expect(defaultAntenna()).toEqual(DEFAULT_ANTENNA);
    expect(defaultAntenna()).not.toBe(DEFAULT_ANTENNA);
  });
  it('normalises azimuths', () => {
    expect(normAzimuth(-10)).toBe(350);
    expect(normAzimuth(360)).toBe(0);
    expect(normAzimuth(725)).toBe(5);
  });
  it('is 0 dB on boresight and 3 dB at half the beamwidth', () => {
    expect(patternLossDb(sector(90), 90)).toBe(0);
    expect(patternLossDb(sector(90, 60), 120)).toBeCloseTo(3, 9);
  });
  it('caps at the front-to-back ratio', () => {
    expect(patternLossDb(sector(0, 60, 25), 180)).toBe(25);
    expect(patternLossDb(sector(0, 60, 10), 90)).toBe(10);
  });
  it('is symmetric left and right and wraps across north', () => {
    const a = sector(0);
    expect(patternLossDb(a, 20)).toBeCloseTo(patternLossDb(a, 340), 9);
    expect(offAxisDeg(350, 10)).toBe(20);
    expect(offAxisDeg(10, 350)).toBe(20);
    expect(offAxisDeg(0, 180)).toBe(180);
    expect(patternLossDb(sector(350), 10)).toBeCloseTo(patternLossDb(sector(10), 350), 9);
  });
  it('is always 0 for omni, whatever its stored sector values', () => {
    for (const b of [0, 90, 180, 271]) expect(patternLossDb({ ...sector(0, 10, 40), kind: 'omni' }, b)).toBe(0);
  });
  it('measures bearings from north, clockwise', () => {
    expect(bearingDeg(origin, offsetLatLon(origin, 0, 500))).toBeCloseTo(0, 3);
    expect(bearingDeg(origin, offsetLatLon(origin, 500, 0))).toBeCloseTo(90, 3);
    expect(bearingDeg(origin, offsetLatLon(origin, 0, -500))).toBeCloseTo(180, 3);
    expect(bearingDeg(origin, offsetLatLon(origin, -500, 0))).toBeCloseTo(270, 3);
  });
  it('applies the pattern at both ends of a pair', () => {
    const east = offsetLatLon(origin, 500, 0);
    const tx = sensor(origin, sector(90));
    const rx = sensor(east, sector(270));
    const aimed = pairPatternLoss(tx, rx);
    expect(aimed).toEqual({ txDb: 0, rxDb: 0, txOffDeg: expect.closeTo(0, 3), rxOffDeg: expect.closeTo(0, 3), totalDb: 0 });
    const away = pairPatternLoss(sensor(origin, sector(270, 60, 25)), sensor(east, sector(0, 60, 20)));
    expect(away.txDb).toBe(25);
    expect(away.rxDb).toBe(20);
    expect(away.txOffDeg).toBeCloseTo(180, 3);
    expect(away.rxOffDeg).toBeCloseTo(90, 3);
    expect(away.totalDb).toBeCloseTo(45, 6);
  });
  it('gives NaN off-axis angles for omni ends', () => {
    const p = pairPatternLoss(sensor(origin, defaultAntenna()), sensor(offsetLatLon(origin, 0, 300), sector(180)));
    expect(p.txDb).toBe(0);
    expect(p.txOffDeg).toBeNaN();
    expect(p.rxOffDeg).toBeCloseTo(0, 3);
  });
  it('validates patterns', () => {
    expect(isAntennaPattern(sector(725))).toBe(true);
    expect(isAntennaPattern(DEFAULT_ANTENNA)).toBe(true);
    for (const bad of [null, 'x', { ...DEFAULT_ANTENNA, kind: 'dish' }, { ...DEFAULT_ANTENNA, azimuthDeg: NaN }, { ...DEFAULT_ANTENNA, beamwidthDeg: 0.5 },
      { ...DEFAULT_ANTENNA, beamwidthDeg: 181 }, { ...DEFAULT_ANTENNA, frontToBackDb: -1 }, { ...DEFAULT_ANTENNA, frontToBackDb: 61 }, { kind: 'omni' }]) {
      expect(isAntennaPattern(bad)).toBe(false);
    }
  });
});
