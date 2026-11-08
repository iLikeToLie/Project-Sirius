import type { GroundAt } from './elevation';
import { tilePixel } from './elevation';
import type { LatLon } from './geo';

export const BUILDING_TILE_URL = import.meta.env.BASE_URL + 'buildings/{z}/{x}/{y}.png';
/** Zoom of the source tiles (about 4.8 m pixels in Singapore); 13 and 14 hold the tallest of each 2×2 block. */
export const BUILDING_ZOOM = 15;
export const BUILDING_ZOOMS = [13, 14, 15] as const;
// Extent of the bundled tiles (public/buildings/manifest.json).
export const BUILDING_BOUNDS = { minLon: 103.596, minLat: 1.2, maxLon: 104.1, maxLat: 1.4835 };

/** How a building's height was found: measured, from storeys, or a default for its class. */
export type BuildingKind = 0 | 1 | 2 | 3;
export const BUILDING_KIND_LABEL: Record<BuildingKind, string> = { 0: 'No building', 1: 'Measured height', 2: 'Height from storeys', 3: 'Estimated (class default)' };

export interface BuildingTile { z: number; x: number; y: number; data: Uint8ClampedArray }
/** A loaded tile, 'empty' for one with no buildings (not generated), or undefined while unknown. */
export type BuildingLookup = (z: number, x: number, y: number) => BuildingTile | 'empty' | undefined;
/** Building height above ground in metres at a point; 0 where there is none or it is not loaded yet. */
export type BuildingAt = ((p: LatLon) => number) & { kindAt?: (p: LatLon) => BuildingKind };

/** Ground sampler that also carries the building heights to stand on it, when buildings are on. */
export type SurfaceGroundAt = GroundAt & { buildingAt?: BuildingAt };

export const decodeBuildingDm = (r: number, g: number) => r * 256 + g;

/** Nearest pixel, not bilinear: building edges are sharp. */
export function createBuildingSampler(lookup: BuildingLookup, z: number = BUILDING_ZOOM): BuildingAt & { kindAt: (p: LatLon) => BuildingKind } {
  const read = (p: LatLon): [BuildingTile, number] | null => {
    const { x, y, px, py } = tilePixel(p, z);
    const t = lookup(z, x, y);
    if (!t || t === 'empty') return null;
    return [t, (Math.min(255, Math.floor(py)) * 256 + Math.min(255, Math.floor(px))) * 4];
  };
  const sample = (p: LatLon) => {
    const hit = read(p);
    return hit ? decodeBuildingDm(hit[0].data[hit[1]], hit[0].data[hit[1] + 1]) / 10 : 0;
  };
  const kindAt = (p: LatLon): BuildingKind => {
    const hit = read(p);
    const k = hit ? hit[0].data[hit[1] + 2] : 0;
    return (k >= 1 && k <= 3 ? k : 0) as BuildingKind;
  };
  return Object.assign(sample, { kindAt });
}

/** The same ground sampler with building heights attached; `undefined` leaves buildings off. */
export function withBuildings(groundAt: GroundAt, buildingAt: BuildingAt | undefined): SurfaceGroundAt {
  if (!buildingAt) return groundAt;
  const surface: SurfaceGroundAt = (p) => groundAt(p);
  surface.buildingAt = buildingAt;
  return surface;
}

export const buildingsOf = (groundAt: GroundAt): BuildingAt | undefined => (groundAt as SurfaceGroundAt).buildingAt;

/** Flat ground (terrain elevation off) that keeps any building heights. */
export const flatGround = (groundAt: GroundAt): SurfaceGroundAt => withBuildings(() => 0, buildingsOf(groundAt));

/** Buildings take part only with terrain diffraction and the scenario's Buildings switch on. */
export const buildingsActive = (map: { buildings: boolean; propagationModel: string }) => map.buildings && map.propagationModel === 'terrain';

/** Every Tx→Rx path, plus each sensor's own point, for loading the building tiles they cross. */
export function sensorPaths(sensors: { role: string; lat: number; lon: number }[]): [LatLon, LatLon][] {
  const tx = sensors.filter((s) => s.role === 'tx'), rx = sensors.filter((s) => s.role === 'rx');
  return [...sensors.map((s): [LatLon, LatLon] => [s, s]), ...tx.flatMap((t) => rx.map((r): [LatLon, LatLon] => [t, r]))];
}
