import type { LatLon } from './geo';

export const ELEVATION_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const ELEVATION_ZOOM = 14;
const TILE_SIZE = 256;

export interface ElevationTile { z: number; x: number; y: number; data: Uint8ClampedArray }
export type TileLookup = (z: number, x: number, y: number) => ElevationTile | undefined;
/** Ground elevation in metres, or null when it is not known (never a silent zero). */
export type GroundAt = (p: LatLon) => number | null;

export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Web-mercator tile indices and the fractional pixel (0–256) inside that tile. */
export function tilePixel(p: LatLon, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const lat = (p.lat * Math.PI) / 180;
  const gx = ((p.lon + 180) / 360) * n * TILE_SIZE;
  const gy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * TILE_SIZE;
  const x = Math.floor(gx / TILE_SIZE);
  const y = Math.floor(gy / TILE_SIZE);
  return { x, y, px: gx - x * TILE_SIZE, py: gy - y * TILE_SIZE };
}

/**
 * Bilinear sampling between pixel centres, crossing tile edges through lookup. Negative values
 * (sea bathymetry) clamp to 0 m, the water surface an antenna would stand on.
 */
export function createGroundSampler(lookup: TileLookup, z: number): GroundAt {
  const pixel = (gx: number, gy: number): number | null => {
    const t = lookup(z, Math.floor(gx / TILE_SIZE), Math.floor(gy / TILE_SIZE));
    if (!t) return null;
    const i = ((gy % TILE_SIZE) * TILE_SIZE + (gx % TILE_SIZE)) * 4;
    return decodeTerrarium(t.data[i], t.data[i + 1], t.data[i + 2]);
  };
  return (p) => {
    const { x, y, px, py } = tilePixel(p, z);
    const fx = x * TILE_SIZE + px - 0.5;
    const fy = y * TILE_SIZE + py - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const tx = fx - i0;
    const ty = fy - j0;
    const v00 = pixel(i0, j0);
    const v10 = pixel(i0 + 1, j0);
    const v01 = pixel(i0, j0 + 1);
    const v11 = pixel(i0 + 1, j0 + 1);
    if (v00 === null || v10 === null || v01 === null || v11 === null) return null;
    const value = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    return Math.max(0, value);
  };
}
