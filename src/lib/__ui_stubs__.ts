// TEMPORARY: stands in for Codex's feature/antenna-patterns-lib API. Delete after merging that branch.
import type { AntennaModel } from '../types';

export type Cut = [number, number][];
export interface Pattern { horizontal: Cut; vertical: Cut }

export function sectorToPoints(model: AntennaModel): Pattern {
  const horizontal: Cut = [];
  for (let a = 0; a < 360; a += 10) { const off = a > 180 ? 360 - a : a; horizontal.push([a, Math.min(12 * (off / model.beamwidthDeg) ** 2, model.frontToBackDb)]); }
  const vertical: Cut = [];
  for (let e = -90; e <= 90; e += 5) vertical.push([e, Math.min(12 * (e / model.verticalBeamwidthDeg) ** 2, 20)]);
  return { horizontal, vertical };
}

export function derivedBeamwidthDeg(cut: Cut): number {
  const half = cut.filter(([a, l]) => l <= 3 && Math.abs(a > 180 ? a - 360 : a) < 180).map(([a]) => Math.abs(a > 180 ? a - 360 : a));
  return Math.max(1, 2 * Math.max(0, ...half));
}

export const exportModelsJson = (models: AntennaModel[]): string => JSON.stringify({ format: 'lbw-antenna-models', version: 1, models }, null, 2);

export function importAntennaFile(_text: string, _filename: string, existing: AntennaModel[]): { models: AntennaModel[]; added: number; skipped: number; notes: string[] } | { error: string } {
  return { models: existing, added: 0, skipped: 0, notes: [] };
}

export const ANTENNA_PRESETS: { id: string; name: string }[] = [];
export const addPreset = (_existing: AntennaModel[], _id: string): AntennaModel | undefined => undefined;
