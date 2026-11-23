import data from '../data/antennaPresets.json';
import type { AntennaModel } from '../types';
import { exportModelsJson, importAntennaFile } from './antennaFiles';

export const PRESET_FAMILIES = ['Omni', 'Sectors and panels', 'Directional', 'Dishes'] as const;
type PresetFamily = typeof PRESET_FAMILIES[number];
const familyById = new Map<string, PresetFamily>([
  ['dipole-2', 'Omni'], ['collinear-6', 'Omni'], ['collinear-9', 'Omni'], ['ceiling-omni', 'Omni'], ['collinear-15', 'Omni'],
  ['sector-33', 'Sectors and panels'], ['sector-45', 'Sectors and panels'], ['sector-60-hg', 'Sectors and panels'],
  ['sector-65', 'Sectors and panels'], ['sector-90', 'Sectors and panels'], ['sector-120', 'Sectors and panels'], ['panel-30', 'Sectors and panels'], ['patch-8', 'Sectors and panels'],
  ['yagi-7', 'Directional'], ['yagi-12', 'Directional'], ['yagi-16', 'Directional'], ['lpda-10', 'Directional'],
  ['helical-13', 'Directional'], ['horn-15', 'Directional'], ['horn-20', 'Directional'],
  ['grid-24', 'Dishes'], ['dish-30', 'Dishes'], ['dish-34', 'Dishes'],
]);

interface AntennaPreset {
  id: string;
  label: string;
  description: string;
  family: PresetFamily;
  model: Omit<AntennaModel, 'id'>;
}

/** Illustrative shapes, loaded through the same versioned importer as user files. */
export function loadAntennaPresets(source: typeof data): AntennaPreset[] {
  const loaded = importAntennaFile(JSON.stringify(source), 'antennaPresets.json', []);
  if ('error' in loaded) throw new Error(`Invalid built-in antenna presets: ${loaded.error}`);
  if (loaded.models.length !== source.models.length) {
    throw new Error(`Built-in antenna presets were truncated (${loaded.models.length} of ${source.models.length} loaded).`);
  }
  return loaded.models.map((m, i) => {
    const { id: _id, ...model } = m;
    const { presetId: id, description } = source.models[i];
    const family = familyById.get(id);
    if (!family) throw new Error(`Missing family for built-in antenna preset: ${id}`);
    return { id, label: m.name, description, family, model };
  });
}

export const ANTENNA_PRESETS = loadAntennaPresets(data);

/** Add an editable independent copy; callers append the returned model to their scenario. */
export function addPreset(existing: AntennaModel[], presetId: string): AntennaModel {
  const preset = ANTENNA_PRESETS.find(p => p.id === presetId);
  if (!preset) throw new Error(`Unknown antenna preset: ${presetId}`);
  const result = importAntennaFile(exportModelsJson([{ ...preset.model, id: 'preset' }]), 'preset.json', existing);
  if ('error' in result) throw new Error(result.error);
  if (!result.added) throw new Error('The antenna library is full (24 models).');
  return result.models[result.models.length - 1];
}
