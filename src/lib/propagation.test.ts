import { describe, it, expect } from 'vitest';
import { SG_REFERENCE, offsetLatLon } from './geo';
import { buildProfile, bullingtonLossDb, fresnelRadiusM, knifeEdgeLossDb } from './propagation';

describe('terrain propagation', () => {
  it.each([[0, 6.03, 2], [-1, 0, 8], [1, 13.9, 1], [2.4, 20.7, 0]])('knife edge at nu %s', (nu, loss, digits) => expect(knifeEdgeLossDb(nu)).toBeCloseTo(loss, digits));
  it('has a 3.6 m midpoint Fresnel radius at 5.8 GHz', () => expect(fresnelRadiusM(500, 500, 299792458 / 5.8e9)).toBeCloseTo(3.6, 1));
  it('keeps a clear flat-sea 5 km link lossless', () => {
    const p = buildProfile(SG_REFERENCE, offsetLatLon(SG_REFERENCE, 5000, 0), () => 0)!;
    expect(bullingtonLossDb(p, 10, 10, 5.8)).toMatchObject({ lossDb: 0, clearance: 'los' });
  });
  const ridge = { distancesM: new Float64Array([0, 1000, 2000]), groundM: new Float64Array([0, 30, 0]) };
  it('increases ridge loss with frequency', () => {
    const low = bullingtonLossDb(ridge, 10, 10, .433), high = bullingtonLossDb(ridge, 10, 10, 28);
    expect(low.clearance).toBe('obstructed'); expect(low.lossDb).toBeGreaterThan(6); expect(high.lossDb).toBeGreaterThan(low.lossDb);
  });
  it('classifies intrusion below the direct ray', () => expect(bullingtonLossDb({ ...ridge, groundM: new Float64Array([0, 9, 0]) }, 10, 10, 5.8).clearance).toBe('fresnel'));
  it('gives about 6 dB at a grazing edge at either frequency', () => {
    const p = { ...ridge, groundM: new Float64Array([0, 10, 0]) };
    for (const f of [.433, 28]) expect(bullingtonLossDb(p, 10, 10, f).lossDb).toBeCloseTo(6.03, 2);
  });
  it('adds 9.2 m Earth bulge at the midpoint of 25 km and caps samples', () => {
    const p = buildProfile(SG_REFERENCE, offsetLatLon(SG_REFERENCE, 25000, 0), () => 0)!;
    expect(Math.max(...p.groundM)).toBeCloseTo(9.2, 1); expect(p.groundM.length).toBeLessThanOrEqual(512);
  });
  it('rejects a path with any unknown ground', () => expect(buildProfile(SG_REFERENCE, offsetLatLon(SG_REFERENCE, 2000, 0), p => p.lon > SG_REFERENCE.lon + .005 ? null : 0)).toBeNull());
});
