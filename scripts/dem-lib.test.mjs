import { describe, it, expect } from 'vitest';
import { decodeTerrarium } from '../src/lib/elevation.ts';
import { encodeTerrarium, mosaicSample } from './dem-lib.mjs';

describe('DEM conversion', () => {
  it.each([-10, 0, 20.5, 163])('round-trips %s metres', m => {
    expect(decodeTerrarium(...encodeTerrarium(m))).toBe(m);
  });
  const tile = (west, height, mask = 0) => ({ west, north: 2, width: 2, height: 2, cellSize: 0.5, dsm: new Int16Array(4).fill(height), mask: new Uint8Array(4).fill(mask) });
  it('selects the correct longitude tile and treats sea as water surface', () => {
    const tiles = [tile(103, 30), tile(104, 80)];
    expect(mosaicSample(tiles, 1.5, 103.5)).toBe(30);
    expect(mosaicSample(tiles, 1.5, 104.5)).toBe(80);
    expect(mosaicSample([tile(103, -9999, 3)], 1.5, 103.5)).toBe(0);
  });
  it('retains cloud-filled heights', () => {
    expect(mosaicSample([tile(103, 24, 49)], 1.5, 103.5)).toBe(24);
  });
  it('bilinearly interpolates and crosses tile boundaries', () => {
    expect(mosaicSample([tile(103, 30), tile(104, 80)], 1.5, 104)).toBe(55);
  });
});
