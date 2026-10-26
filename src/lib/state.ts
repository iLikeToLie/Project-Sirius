import { DEFAULT_TERRAIN, freshDefaultState, workspaceForDistance } from '../data/defaults';
import type { AntennaPlacement, AppState, LinkWorkspace, TerrainSettings } from '../types';
import { isValidPlacement, separation3dM } from './linkGeometry';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function readPlacement(value: unknown): AntennaPlacement | undefined {
  if (!isRecord(value)) return undefined;
  const placement = { xM: value.xM, yM: value.yM, aglM: value.aglM } as AntennaPlacement;
  return [placement.xM, placement.yM, placement.aglM].every((n) => typeof n === 'number') && isValidPlacement(placement) ? placement : undefined;
}

function readTerrain(value: unknown): TerrainSettings {
  if (!isRecord(value) || (value.model !== undefined && value.model !== DEFAULT_TERRAIN.model)) return { ...DEFAULT_TERRAIN };
  const number = (n: unknown, fallback: number, valid: (v: number) => boolean) => typeof n === 'number' && Number.isFinite(n) && valid(n) ? n : fallback;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_TERRAIN.enabled,
    model: DEFAULT_TERRAIN.model,
    offsetM: number(value.offsetM, DEFAULT_TERRAIN.offsetM, () => true),
    reliefScale: number(value.reliefScale, DEFAULT_TERRAIN.reliefScale, (v) => v >= 0),
    contourIntervalM: number(value.contourIntervalM, DEFAULT_TERRAIN.contourIntervalM, (v) => v > 0),
  };
}

/** Legacy scenarios (no workspace) get flat-ground geometry that reproduces their saved distance. */
function readWorkspace(value: unknown, legacyDistanceM: number): LinkWorkspace {
  const fallback = workspaceForDistance(legacyDistanceM);
  if (!isRecord(value)) return fallback;
  const tx = readPlacement(value.tx);
  const rx = readPlacement(value.rx);
  if (!tx || !rx) return fallback;
  return { tx, rx, terrain: readTerrain(value.terrain) };
}

/** The workspace is the single source of the calculator's Tx-to-Rx distance. */
export const withWorkspace = (state: AppState, workspace: LinkWorkspace): AppState => ({
  ...state,
  workspace,
  inputs: { ...state.inputs, distanceM: separation3dM(workspace) },
});

export function normalizeState(saved?: Partial<AppState>): AppState {
  const defaults = freshDefaultState();
  if (!saved) return defaults;
  const inputs = { ...defaults.inputs, ...saved.inputs };
  return withWorkspace({
    ...defaults,
    ...saved,
    schemaVersion: 2,
    linkObjective: saved.linkObjective === 'avoidance' ? 'avoidance' : 'desired',
    inputs,
    distanceSweep: { ...defaults.distanceSweep, ...saved.distanceSweep },
    gainSweep: { ...defaults.gainSweep, ...saved.gainSweep },
    placements: Array.isArray(saved.placements) ? saved.placements : defaults.placements,
  }, readWorkspace(saved.workspace, inputs.distanceM));
}
