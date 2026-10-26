import type { TerrainSettings } from '../types';

export const TERRAIN_MODEL_VERSION = 'synthetic-v1' as const;

/** Search and drag bounds for the workspace, in metres from the origin. */
export const WORLD_LIMIT_M = 100_000;

/**
 * Synthetic reference landscape in metres above a local reference: two finite ridges, a headland
 * and a gentle plain. Illustrative only, not surveyed terrain. Never change this function in
 * place; add a new model version so saved scenarios keep their terrain.
 */
export function syntheticV1(x: number, y: number): number {
  const west = -850 + 210 * Math.sin(y / 1700) + 65 * Math.sin(y / 610);
  const east = 2050 + 160 * Math.sin(y / 1300);
  const ridge1 = 650 * Math.exp(-(((x - west) / 680) ** 2) - ((y - 1100) / 2300) ** 2);
  const ridge2 = 470 * Math.exp(-(((x - east) / 580) ** 2) - ((y - 900) / 1900) ** 2);
  const headland = 780 * Math.exp(-(((x - 600) / 1500) ** 2) - ((y - 3600) / 1100) ** 2);
  return 8 + 0.0015 * y + ridge1 + ridge2 + headland;
}

/** Ground elevation relative to the local reference. Disabled terrain is flat ground at zero. */
export function groundElevationM(terrain: TerrainSettings, x: number, y: number): number {
  if (!terrain.enabled) return 0;
  if (terrain.reliefScale === 0) return terrain.offsetM;
  return terrain.offsetM + terrain.reliefScale * syntheticV1(x, y);
}
