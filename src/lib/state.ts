import { DEFAULT_TERRAIN, freshDefaultState, mapForPlacements, workspaceForDistance } from '../data/defaults';
import type { AntennaPlacement, AppState, LinkInputs, LinkWorkspace, MapScenario, Sensor, TerrainSettings } from '../types';
import { antennaElevationM, isValidPlacement } from './linkGeometry';
import { MAX_SENSORS } from './sensors';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// ---- Schema 2 (web 1.4.0 plan view), read only for migration ----

function readPlacement(value: unknown): AntennaPlacement | undefined {
  if (!isRecord(value)) return undefined;
  const placement = { xM: value.xM, yM: value.yM, aglM: value.aglM } as AntennaPlacement;
  return [placement.xM, placement.yM, placement.aglM].every((n) => typeof n === 'number') && isValidPlacement(placement) ? placement : undefined;
}

function readTerrain(value: unknown): TerrainSettings {
  if (!isRecord(value) || (value.model !== undefined && value.model !== DEFAULT_TERRAIN.model)) return { ...DEFAULT_TERRAIN };
  const number = (n: unknown, fallback: number, valid: (v: number) => boolean) => isFiniteNumber(n) && valid(n) ? n : fallback;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_TERRAIN.enabled,
    model: DEFAULT_TERRAIN.model,
    offsetM: number(value.offsetM, DEFAULT_TERRAIN.offsetM, () => true),
    reliefScale: number(value.reliefScale, DEFAULT_TERRAIN.reliefScale, (v) => v >= 0),
    contourIntervalM: number(value.contourIntervalM, DEFAULT_TERRAIN.contourIntervalM, (v) => v > 0),
  };
}

/** Pre-1.4.0 scenarios (no workspace) get flat-ground geometry that reproduces their saved distance. */
function readWorkspace(value: unknown, legacyDistanceM: number): LinkWorkspace {
  const fallback = workspaceForDistance(legacyDistanceM);
  if (!isRecord(value)) return fallback;
  const tx = readPlacement(value.tx);
  const rx = readPlacement(value.rx);
  if (!tx || !rx) return fallback;
  return { tx, rx, terrain: readTerrain(value.terrain) };
}

/**
 * A plan-view link becomes two map sensors with terrain elevation off. Each sensor's height above
 * ground takes its old total elevation, so the 3D separation and every result stay as saved. If
 * a total was below 0 (a negative 1.4.0 elevation offset), both shift up by the same amount:
 * heights above ground stay valid and the vertical difference is unchanged.
 */
function migrateWorkspace(ws: LinkWorkspace, inputs: LinkInputs): MapScenario {
  const txTotal = antennaElevationM(ws.terrain, ws.tx);
  const rxTotal = antennaElevationM(ws.terrain, ws.rx);
  const lift = -Math.min(0, txTotal, rxTotal);
  const at = (p: AntennaPlacement, total: number) => ({ ...p, aglM: total + lift });
  return { ...mapForPlacements(inputs, at(ws.tx, txTotal), at(ws.rx, rxTotal), false), propagationModel: 'terrain' };
}

// ---- Schema 3 ----

const SENSOR_NUMBERS = ['lat', 'lon', 'aglM', 'gainDbi', 'cableLossDb', 'powerDbm', 'sensitivityDbm', 'fadeMarginTargetDb', 'interferenceThresholdDbm'] as const;

function readDesired(value: unknown): Sensor['desiredTxIds'] | undefined {
  if (value === 'auto') return 'auto';
  if (Array.isArray(value) && value.every((id) => typeof id === 'string')) return value;
  return undefined;
}

function readSensor(value: unknown): Sensor | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, role } = value;
  const desiredTxIds = 'desiredTxIds' in value
    ? readDesired(value.desiredTxIds)
    : typeof value.intendedTxId !== 'string' ? undefined : value.intendedTxId && value.intendedTxId !== 'auto' ? [value.intendedTxId] : 'auto';
  if (typeof id !== 'string' || !id || typeof name !== 'string' || (role !== 'tx' && role !== 'rx') || !desiredTxIds) return undefined;
  if (!SENSOR_NUMBERS.every((key) => isFiniteNumber(value[key]))) return undefined;
  const sensor = Object.fromEntries(['id', 'name', 'role', ...SENSOR_NUMBERS].map((key) => [key, value[key]])) as unknown as Sensor;
  sensor.desiredTxIds = desiredTxIds;
  const valid = Math.abs(sensor.lat) <= 90 && Math.abs(sensor.lon) <= 180 && sensor.aglM >= 0 && sensor.cableLossDb >= 0 && sensor.fadeMarginTargetDb >= 0;
  if (value.objective !== undefined && !['default', 'desired', 'avoidance'].includes(value.objective as string)) return undefined;
  sensor.objective = value.objective as Sensor['objective'] ?? 'default';
  return valid ? sensor : undefined;
}

/** Strict: any invalid sensor rejects the whole map. */
function readMap(value: unknown): MapScenario | undefined {
  if (!isRecord(value) || !Array.isArray(value.sensors) || value.sensors.length > MAX_SENSORS || typeof value.useTerrainElevation !== 'boolean') return undefined;
  if (value.propagationModel !== undefined && !['terrain', 'free-space'].includes(value.propagationModel as string)) return undefined;
  if (value.defaultObjective !== undefined && !['desired', 'avoidance'].includes(value.defaultObjective as string)) return undefined;
  const sensors = value.sensors.map(readSensor);
  if (sensors.some((s) => !s)) return undefined;
  const list = sensors as Sensor[];
  if (new Set(list.map((s) => s.id)).size !== list.length) return undefined;
  const ids = new Set(list.map((s) => s.id));
  const txIds = new Set(list.filter((s) => s.role === 'tx').map((s) => s.id));
  return {
    sensors: list.map((s) => {
      if (s.desiredTxIds === 'auto') return s;
      const desiredTxIds = [...new Set(s.desiredTxIds.filter((id) => txIds.has(id)))];
      return { ...s, desiredTxIds: desiredTxIds.length ? desiredTxIds : 'auto' };
    }),
    selectedId: typeof value.selectedId === 'string' && ids.has(value.selectedId) ? value.selectedId : null,
    zonesForRxId: typeof value.zonesForRxId === 'string' && ids.has(value.zonesForRxId) ? value.zonesForRxId : 'auto',
    useTerrainElevation: value.useTerrainElevation,
    propagationModel: value.propagationModel as MapScenario['propagationModel'] ?? 'terrain',
    defaultObjective: value.defaultObjective as MapScenario['defaultObjective'] ?? 'desired',
  };
}

export function normalizeState(saved?: unknown): AppState {
  const defaults = freshDefaultState();
  if (!isRecord(saved)) return defaults;
  const s = saved as Partial<AppState> & { workspace?: unknown };
  const inputs = { ...defaults.inputs, ...s.inputs };
  const map = 'map' in s ? readMap(s.map) ?? defaults.map : migrateWorkspace(readWorkspace(s.workspace, inputs.distanceM), inputs);
  return {
    schemaVersion: 5,
    linkObjective: s.linkObjective === 'avoidance' ? 'avoidance' : 'desired',
    inputs,
    distanceSweep: { ...defaults.distanceSweep, ...s.distanceSweep },
    gainSweep: { ...defaults.gainSweep, ...s.gainSweep },
    placements: Array.isArray(s.placements) ? s.placements : defaults.placements,
    map,
  };
}

/** For JSON import: null rejects the file. Saves without a map migrate; a present map must be valid. */
export function validateImport(raw: unknown): AppState | null {
  if (!isRecord(raw) || !isRecord(raw.inputs) || !isRecord(raw.distanceSweep) || !isRecord(raw.gainSweep) || !Array.isArray(raw.placements)) return null;
  if ('map' in raw && !readMap(raw.map)) return null;
  return normalizeState(raw);
}
