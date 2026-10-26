import type { LinkInputs, LinkObjective, LinkWorkspace } from '../types';
import { type Bounds, contourLevels, isolineSegments, sampleGrid, type Segment } from './contours';
import { antennaElevationM } from './linkGeometry';
import { isValidLinkInput, totalLossDb } from './rf';
import { groundElevationM } from './terrain';

export type ThresholdId = 'sensitivity' | 'required' | 'interference';

export interface ThresholdReference { id: ThresholdId; label: string; levelDbm: number; active: boolean }

/** The three receiver references. Objective decides which drive status; all stay visible. */
export function thresholdReferences(inputs: LinkInputs, objective: LinkObjective): ThresholdReference[] {
  const desired = objective === 'desired';
  return [
    { id: 'sensitivity', label: 'Sensitivity', levelDbm: inputs.sensitivityDbm, active: desired },
    { id: 'required', label: 'Required receive level', levelDbm: inputs.sensitivityDbm + inputs.fadeMarginTargetDb, active: desired },
    { id: 'interference', label: 'Interference threshold', levelDbm: inputs.interferenceThresholdDbm, active: !desired },
  ];
}

/** 3D Tx-to-Rx separation at which free-space received power equals levelDbm (inverse of fsplDb). */
export function thresholdSlantRangeM(inputs: LinkInputs, levelDbm: number): number {
  if (!isValidLinkInput({ ...inputs, distanceM: 1 }) || !Number.isFinite(levelDbm)) return NaN;
  const allowedFsplDb = inputs.transmitPowerDbm + inputs.txGainDbi + inputs.rxGainDbi - totalLossDb(inputs) - levelDbm;
  return 1000 * 10 ** ((allowedFsplDb - 32.44 - 20 * Math.log10(inputs.frequencyGhz * 1000)) / 20);
}

/** Plan-view radius of a slant range on flat ground; NaN when the height difference alone exceeds it. */
export function flatGroundRadiusM(slantRangeM: number, heightDifferenceM: number): number {
  const dz = Math.abs(heightDifferenceM);
  if (!Number.isFinite(slantRangeM) || slantRangeM < dz) return NaN;
  return Math.sqrt(slantRangeM ** 2 - dz ** 2);
}

export interface FieldRequest {
  jobId: number;
  workspace: LinkWorkspace;
  inputs: LinkInputs;
  objective: LinkObjective;
  bounds: Bounds;
  cols: number;
  rows: number;
}

export type BoundaryState = 'visible' | 'outside-view' | 'unavailable';

export interface FieldResult {
  jobId: number;
  cellSizeM: number;
  terrainContours: { level: number; major: boolean; segments: Segment[] }[];
  thresholds: (ThresholdReference & { slantRangeM: number; state: BoundaryState; segments: Segment[] })[];
}

/**
 * Terrain contours and terrain-aware threshold boundaries over one bounded grid. Each grid point is
 * a candidate receiver at the current Rx height above ground; the boundary is where its 3D
 * separation from Tx equals the threshold slant range. Free-space only: no terrain shadowing.
 */
export function computeFields({ jobId, workspace, inputs, objective, bounds, cols, rows }: FieldRequest): FieldResult {
  const { terrain, tx, rx } = workspace;
  const cellSizeM = Math.max((bounds.maxX - bounds.minX) / cols, (bounds.maxY - bounds.minY) / rows);
  if (!terrain.enabled) return { jobId, cellSizeM, terrainContours: [], thresholds: [] };

  const txElevation = antennaElevationM(terrain, tx);
  const ground = sampleGrid(bounds, cols, rows, (x, y) => groundElevationM(terrain, x, y));
  const separation: typeof ground = {
    ...ground,
    values: ground.values.map((g, index) => {
      const x = ground.x0 + (index % (cols + 1)) * ground.dx;
      const y = ground.y0 + Math.floor(index / (cols + 1)) * ground.dy;
      return Math.hypot(x - tx.xM, y - tx.yM, g + rx.aglM - txElevation);
    }),
  };

  const thresholds = thresholdReferences(inputs, objective).map((reference) => {
    const slantRangeM = thresholdSlantRangeM(inputs, reference.levelDbm);
    const segments = Number.isFinite(slantRangeM) ? isolineSegments(separation, slantRangeM) : [];
    const state: BoundaryState = !Number.isFinite(slantRangeM) ? 'unavailable' : segments.length ? 'visible' : 'outside-view';
    return { ...reference, slantRangeM, state, segments };
  });

  let terrainContours: FieldResult['terrainContours'] = [];
  if (terrain.reliefScale !== 0) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of ground.values) { if (value < min) min = value; if (value > max) max = value; }
    const levels = contourLevels(min, max, terrain.contourIntervalM);
    const step = levels.length > 1 ? levels[1] - levels[0] : terrain.contourIntervalM;
    terrainContours = levels
      .map((level) => ({ level, major: Math.round(level / step) % 5 === 0, segments: isolineSegments(ground, level) }))
      .filter((contour) => contour.segments.length > 0);
  }
  return { jobId, cellSizeM, terrainContours, thresholds };
}
