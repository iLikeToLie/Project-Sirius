import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { AntennaPattern, Sensor } from '../types';
import { bearingDeg, defaultAntenna, elevationDeg, typicalGainDbi, DEFAULT_ANTENNA, isAntennaPattern, normAzimuth, offAxisDeg, pairPatternLoss, patternLossDb } from './antenna';
import { offsetLatLon } from './geo';

const origin = { lat: 1.35, lon: 103.8 };
const sector = (azimuthDeg: number, beamwidthDeg = 60, frontToBackDb = 25): AntennaPattern => ({ kind: 'sector', azimuthDeg, beamwidthDeg, frontToBackDb, verticalBeamwidthDeg: 10, downtiltDeg: 0, aimAtId: null });
const sensor = (at: { lat: number; lon: number }, antenna: AntennaPattern): Sensor => ({ ...DEFAULT_STATE.map.sensors[0], ...at, antenna });

describe('antenna pattern', () => {
  it('has default values and returns fresh copies', () => {
    expect(DEFAULT_ANTENNA).toEqual({ kind: 'omni', azimuthDeg: 0, beamwidthDeg: 65, frontToBackDb: 25, verticalBeamwidthDeg: 10, downtiltDeg: 0, aimAtId: null });
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
    expect(aimed).toEqual({ txDb: 0, rxDb: 0, txOffDeg: expect.closeTo(0, 3), rxOffDeg: expect.closeTo(0, 3), txElevDeg: 0, rxElevDeg: 0, totalDb: 0 });
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
      { ...DEFAULT_ANTENNA, beamwidthDeg: 181 }, { ...DEFAULT_ANTENNA, frontToBackDb: -1 }, { ...DEFAULT_ANTENNA, frontToBackDb: 61 }, { kind: 'omni' },
      { ...DEFAULT_ANTENNA, verticalBeamwidthDeg: 0.5 }, { ...DEFAULT_ANTENNA, verticalBeamwidthDeg: 91 }, { ...DEFAULT_ANTENNA, downtiltDeg: -21 }, { ...DEFAULT_ANTENNA, downtiltDeg: 46 },
      { ...DEFAULT_ANTENNA, downtiltDeg: NaN }, { ...DEFAULT_ANTENNA, aimAtId: 5 }]) {
      expect(isAntennaPattern(bad)).toBe(false);
    }
  });
});

describe('vertical pattern', () => {
  const tilted = (tilt: number, v = 10, fbr = 25) => ({ ...sector(0, 60, fbr), verticalBeamwidthDeg: v, downtiltDeg: tilt });
  it('is 0 dB on the horizon with no tilt and at e = -tilt', () => {
    expect(patternLossDb(tilted(0), 0, 0)).toBe(0);
    expect(patternLossDb(tilted(6), 0, -6)).toBe(0);
  });
  it('is 3 dB at half the vertical beamwidth either side of the tilted axis', () => {
    expect(patternLossDb(tilted(0), 0, 5)).toBeCloseTo(3, 9);
    expect(patternLossDb(tilted(0), 0, -5)).toBeCloseTo(3, 9);
    expect(patternLossDb(tilted(4), 0, 1)).toBeCloseTo(3, 9);
    expect(patternLossDb(tilted(4), 0, -9)).toBeCloseTo(3, 9);
  });
  it('caps the vertical term at 20 dB and the combination at the front-to-back ratio', () => {
    expect(patternLossDb(tilted(0, 10, 40), 0, 80)).toBe(20);
    expect(patternLossDb(tilted(0, 10, 15), 0, 80)).toBe(15);
    // Ah = 3 (30 deg off at 60 deg beamwidth) + Av = 3 adds up; the sum is capped at FBR, not each term.
    expect(patternLossDb(tilted(0, 10, 5), 30, 5)).toBe(5);
    expect(patternLossDb(tilted(0, 10, 25), 30, 5)).toBeCloseTo(6, 9);
  });
  it('leaves Omni lossless in elevation', () => {
    expect(patternLossDb({ ...tilted(10), kind: 'omni' }, 0, 45)).toBe(0);
  });
  it('computes elevation angles and typical gain', () => {
    expect(elevationDeg(10, 10, 100)).toBe(0);
    expect(elevationDeg(110, 10, 100)).toBeCloseTo(-45, 9);
    expect(elevationDeg(0, 100, 100)).toBeCloseTo(45, 9);
    expect(typicalGainDbi(65, 10)).toBeCloseTo(18.03, 2);
  });
  it('sees a tall Tx tilted down differently from a street Rx at the foot of the mast', () => {
    const near = offsetLatLon(origin, 0, 50);
    const tx = sensor(origin, tilted(0)), rx = sensor(near, defaultAntenna());
    // 60 m mast, receiver at 2 m, 50 m away: 49 deg below the horizon.
    const flat = pairPatternLoss({ ...tx, antenna: { ...tilted(0), azimuthDeg: 0 } }, rx, 60, 2);
    expect(flat.txElevDeg).toBeCloseTo(-49.2, 1);
    expect(flat.txDb).toBe(20);
    expect(flat.rxElevDeg).toBeNaN();
    const down = pairPatternLoss({ ...tx, antenna: { ...tilted(0), azimuthDeg: 0, downtiltDeg: 10 } }, rx, 60, 2);
    expect(down.txDb).toBe(20);
    // Far away the same mast is nearly on the horizon, and a 3 deg downtilt aims at it.
    const far = sensor(offsetLatLon(origin, 0, 1000), defaultAntenna());
    const aimed = pairPatternLoss({ ...tx, antenna: { ...tilted(3.3), azimuthDeg: 0 } }, far, 60, 2);
    expect(aimed.txElevDeg).toBeCloseTo(-3.32, 1);
    expect(aimed.txDb).toBeLessThan(0.01);
    expect(pairPatternLoss({ ...tx, antenna: tilted(0) }, far, 60, 2).txDb).toBeGreaterThan(1);
    // Without heights the elevation is 0.
    expect(pairPatternLoss(tx, far).txElevDeg).toBe(0);
  });
  it('applies the Rx pattern with the opposite elevation sign', () => {
    const rx = sensor(offsetLatLon(origin, 0, 100), { ...sector(180), downtiltDeg: 0 });
    const p = pairPatternLoss(sensor(origin, defaultAntenna()), rx, 2, 22);
    expect(p.rxElevDeg).toBeCloseTo(-11.3, 1);
    expect(p.rxDb).toBeCloseTo(12 * (11.31 / 10) ** 2, 1);
  });
});
