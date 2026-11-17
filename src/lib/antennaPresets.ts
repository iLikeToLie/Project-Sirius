import data from '../data/antennaPresets.json';
import type { AntennaModel } from '../types';
import { exportModelsJson, importAntennaFile } from './antennaFiles';

const loaded = importAntennaFile(JSON.stringify(data), 'antennaPresets.json', []);
if ('error' in loaded) throw new Error(`Invalid built-in antenna presets: ${loaded.error}`);

/** Illustrative shapes, loaded through the same versioned importer as user files. */
export const ANTENNA_PRESETS: { id: string; label: string; description: string; model: Omit<AntennaModel, 'id'> }[] = loaded.models.map((m, i) => {
  const { id: _id, ...model } = m;
  return { id: data.models[i].presetId, label: m.name, description: data.models[i].description, model };
});

/** Add an editable independent copy; callers append the returned model to their scenario. */
export function addPreset(existing: AntennaModel[], presetId: string): AntennaModel {
  const preset = ANTENNA_PRESETS.find(p => p.id === presetId);
  if (!preset) throw new Error(`Unknown antenna preset: ${presetId}`);
  const result = importAntennaFile(exportModelsJson([{ ...preset.model, id: 'preset' }]), 'preset.json', existing);
  if ('error' in result) throw new Error(result.error);
  if (!result.added) throw new Error('The antenna library is full (24 models).');
  return result.models[result.models.length - 1];
}
