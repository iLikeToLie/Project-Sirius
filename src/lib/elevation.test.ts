import { describe, expect, it } from 'vitest';
import { createGroundSampler, decodeTerrarium, tilePixel, type ElevationTile } from './elevation';

const Z = 14;
const TX = 12916;
const TY = 8130;

/** Terrarium pixel for an elevation in metres. */
const encode = (m: number) => { const v = m + 32768; const r = Math.floor(v / 256); const g = Math.floor(v - r * 256); return [r, g, Math.round((v - r * 256 - g) * 256)]; };

function tile(fill: number, pixels: Record<string, number> = {}): ElevationTile {
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < 256 * 256; i += 1) {
    const [r, g, b] = encode(pixels[`${i % 256},${Math.floor(i / 256)}`] ?? fill);
    data.set([r, g, b, 255], i * 4);
  }
  return { z: Z, x: TX, y: TY, data };
}

/** Lat/lon of a fractional pixel position in the test tile. */
function at(px: number, py: number) {
  const n = 2 ** Z;
  const lon = ((TX + px / 256) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (TY + py / 256)) / n))) * 180) / Math.PI;
  return { lat, lon };
}

describe('Terrarium elevation', () => {
  it('decodes terrarium pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 20, 0)).toBe(20);
    expect(decodeTerrarium(127, 246, 0)).toBe(-10);
    expect(decodeTerrarium(128, 0, 128)).toBe(0.5);
  });

  it('locates Singapore at zoom 14', () => {
    const p = tilePixel({ lat: 1.3521, lon: 103.8198 }, 14);
    expect(p.x).toBe(12916);
    expect(p.y).toBe(8130);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThan(256);
  });

  it('interpolates bilinearly', () => {
    const t = tile(0, { '10,10': 10, '11,10': 20, '10,11': 30, '11,11': 40 });
    const ground = createGroundSampler((z, x, y) => (z === Z && x === TX && y === TY ? t : undefined), Z);
    expect(ground(at(11, 11))).toBeCloseTo(25, 6);
    expect(ground(at(10.5, 10.5))).toBeCloseTo(10, 6);
  });

  it('returns null for a missing tile', () => {
    const ground = createGroundSampler(() => undefined, Z);
    expect(ground(at(100, 100))).toBeNull();
  });

  it('clamps sea bathymetry to the water surface', () => {
    const t = tile(-20);
    const ground = createGroundSampler((z, x, y) => (x === TX && y === TY ? t : undefined), Z);
    expect(ground(at(100, 100))).toBe(0);
  });
});
