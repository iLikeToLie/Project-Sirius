import { expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import type { AntennaModel } from '../types';
import { newSectorModel, patternLossDb, resolveAntenna } from './antenna';
import { normalizeState, validateImport } from './state';
import { computeMultiField, multiFieldKey, type MultiFieldRequest } from './multiField';
import { sampleGrid } from './contours';
import { computeCoverage } from './coverage';
import { SG_REFERENCE } from './geo';

const model = (): AntennaModel => ({ ...newSectorModel([]), kind: 'custom', frontToBackDb: 60,
  pattern: { horizontal: [[0, 0], [90, 10], [180, 20], [270, 30]], vertical: [[-90, 40], [0, 0], [90, 30]] } });
const pattern = () => resolveAntenna({ antennaModels: [model()] }, { ...freshDefaultState().map.sensors[0],
  antenna: { modelId: 'ant-1', azimuthDeg: 0, downtiltDeg: 5, aimAtId: null } });

it('upgrades schema 8 unchanged and round-trips schema 9, retaining sorted inactive cuts', () => {
  const state = freshDefaultState();
  expect(state.schemaVersion).toBe(9);
  expect(normalizeState({ ...state, schemaVersion: 8 })).toEqual(state);
  state.map.antennaModels = [model()];
  state.map.sensors[0].antenna.modelId = 'ant-1';
  expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
  state.map.antennaModels[0].kind = 'sector';
  expect(validateImport(state)).toEqual(state);
  state.map.antennaModels[0].pattern!.horizontal.reverse();
  expect(validateImport(state)?.map.antennaModels[0].pattern!.horizontal[0]).toEqual([0, 0]);
});

it('keys both custom field patterns by their table content', () => {
  const p = pattern();
  const parts = { layer: 'x', mode: 'free-space' as const, rxAglM: 10, rxOnRoof: false, radials: 8,
    view: null, dragging: false, elevationVersion: 0, buildingsVersion: false as const, terrain: false };
  const source = { ...SG_REFERENCE, elevationM: 20, inputs: freshDefaultState().inputs };
  const key = (pat: typeof p, cell = false) => multiFieldKey({ ...parts, sources: [{ ...source, patterns: cell ? { cell: pat } : { source: pat } }] });
  const m = model(); m.pattern!.horizontal[2][1] = 22;
  const edited = resolveAntenna({ antennaModels: [m] }, { ...freshDefaultState().map.sensors[0], antenna: { modelId: m.id, azimuthDeg: 0, downtiltDeg: 5, aimAtId: null } });
  expect(key(p)).not.toBe(key(edited));
  expect(key(p, true)).not.toBe(key(edited, true));
});

it('applies custom source and cell losses to free-space cells and terrain radials', () => {
  const p = pattern(), inputs = freshDefaultState().inputs;
  const req: MultiFieldRequest = { jobId: 1, origin: SG_REFERENCE, mode: 'free-space', rxAglM: 10, radials: 8,
    raster: sampleGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 2, 2, () => 0),
    rayGround: sampleGrid({ minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 }, 10, 10, () => 0),
    sources: [{ ...SG_REFERENCE, elevationM: 20, inputs }] };
  const omni = computeMultiField(req).powers[0];
  const dir = computeMultiField({ ...req, sources: [{ ...req.sources[0], patterns: { source: p, cell: p } }] }).powers[0];
  for (let k = 0; k < omni.length; k++) {
    const x = -100 + k % 3 * 100, y = -100 + Math.floor(k / 3) * 100;
    const bearing = Math.atan2(x, y) * 180 / Math.PI, e = Math.atan2(-10, Math.hypot(x, y)) * 180 / Math.PI;
    expect(omni[k] - dir[k]).toBeCloseTo(patternLossDb(p, bearing, e) + patternLossDb(p, bearing + 180, -e), 3);
  }
  const radial = { jobId: 1, tx: { ...SG_REFERENCE, elevationM: 20 }, rxAglM: 10, inputs, radials: 8, stepM: 100, maxRangeM: 1000,
    ground: { origin: SG_REFERENCE, grid: req.rayGround } };
  const a = computeCoverage(radial), b = computeCoverage({ ...radial, patterns: { source: p, cell: p } });
  for (let r = 0; r < 8; r++) {
    const e = Math.atan2(-10, 100) * 180 / Math.PI;
    expect(a.powerDbm[r * a.steps] - b.powerDbm[r * a.steps]).toBeCloseTo(patternLossDb(p, r * 45, e) + patternLossDb(p, r * 45 + 180, -e), 3);
  }
});
