import { describe, expect, it } from 'vitest';
import { offsetLatLon, SG_REFERENCE, toLatLon, toLocalM, type LatLon } from './geo';

const R = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;
const haversine = (a: LatLon, b: LatLon) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const tuas = { lat: 1.32, lon: 103.64 };
const changi = { lat: 1.36, lon: 103.99 };

describe('Singapore tangent-plane projection', () => {
  it('maps the reference to the origin', () => {
    expect(toLocalM(SG_REFERENCE)).toEqual({ xM: 0, yM: 0 });
  });

  it('round-trips island-scale points', () => {
    for (const p of [tuas, changi]) {
      const back = toLatLon(toLocalM(p));
      expect(back.lat).toBeCloseTo(p.lat, 9);
      expect(back.lon).toBeCloseTo(p.lon, 9);
    }
  });

  it('keeps distance error under 0.5 m across the island', () => {
    const a = toLocalM(tuas);
    const b = toLocalM(changi);
    expect(Math.abs(Math.hypot(b.xM - a.xM, b.yM - a.yM) - haversine(tuas, changi))).toBeLessThan(0.5);
  });

  it('offsets by metres', () => {
    const p = toLocalM(offsetLatLon(SG_REFERENCE, 100, -50));
    expect(p.xM).toBeCloseTo(100, 6);
    expect(p.yM).toBeCloseTo(-50, 6);
  });
});
