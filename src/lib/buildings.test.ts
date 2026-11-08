import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { MapScenario, Sensor } from '../types';
import { buildingsOf, createBuildingSampler, flatGround, withBuildings, type BuildingTile } from './buildings';
import { tilePixel, type GroundAt } from './elevation';
import { SG_REFERENCE, offsetLatLon, toLocalM, type LatLon } from './geo';
import { buildProfile, bullingtonLossDb } from './propagation';
import { addSensor, createSensor, evaluatePairs, groundOf, separationM } from './sensors';
import { normalizeState, validateImport } from './state';

const flat: GroundAt = () => 0;
/** A wall of the given height across the x axis between two eastward offsets from the reference. */
const wall = (fromM: number, toM: number, heightM: number) => (p: LatLon) => {
  const x = toLocalM(p).xM - toLocalM(SG_REFERENCE).xM;
  return x >= fromM && x <= toM ? heightM : 0;
};

describe('building tiles', () => {
  const at = offsetLatLon(SG_REFERENCE, 0, 0);
  const { x, y, px, py } = tilePixel(at, 15);
  const data = new Uint8ClampedArray(256 * 256 * 4);
  const i = (Math.floor(py) * 256 + Math.floor(px)) * 4;
  data[i] = 0x08; data[i + 1] = 0x16; data[i + 2] = 1; // 2070 dm, measured
  const tile: BuildingTile = { z: 15, x, y, data };
  it('decodes decimetres and kind at the nearest pixel', () => {
    const sample = createBuildingSampler((z, tx, ty) => (z === 15 && tx === x && ty === y ? tile : undefined));
    expect(sample(at)).toBeCloseTo(207, 5);
    expect(sample.kindAt(at)).toBe(1);
    expect(sample(offsetLatLon(at, 30, 30))).toBe(0);
  });
  it('reads missing and empty tiles as no building', () => {
    expect(createBuildingSampler(() => undefined)(at)).toBe(0);
    expect(createBuildingSampler(() => 'empty').kindAt(at)).toBe(0);
  });
  it('attaches buildings to a ground sampler without changing ground', () => {
    const surface = withBuildings(() => 7, () => 20);
    expect(surface(at)).toBe(7);
    expect(buildingsOf(surface)!(at)).toBe(20);
    expect(withBuildings(flat, undefined)).toBe(flat);
    expect(flatGround(surface)(at)).toBe(0);
    expect(buildingsOf(flatGround(surface))!(at)).toBe(20);
  });
});

describe('profiles with buildings', () => {
  const to = offsetLatLon(SG_REFERENCE, 1000, 0);
  it('samples every 5 m and stands buildings on the ground', () => {
    const p = buildProfile(SG_REFERENCE, to, withBuildings(() => 2, wall(400, 430, 40)))!;
    expect(p.distancesM.length).toBeGreaterThanOrEqual(201); expect(p.distancesM.length).toBeLessThanOrEqual(202);
    expect(Math.max(...p.buildingM!)).toBe(40);
    expect(Math.max(...p.groundM)).toBeCloseTo(42, 1);
  });
  it('is unchanged when buildings are off', () => {
    expect(buildProfile(SG_REFERENCE, to, flat)!.buildingM).toBeUndefined();
    expect(buildProfile(SG_REFERENCE, to, flat)!.distancesM.length).toBe(35);
  });
  it('lets a street-mounted end ignore its own building only', () => {
    const surface = withBuildings(flat, (p) => Math.max(wall(0, 20, 30)(p), wall(500, 520, 25)(p)));
    const roof = buildProfile(SG_REFERENCE, to, surface)!;
    const street = buildProfile(SG_REFERENCE, to, surface, 30, { from: true })!;
    expect(roof.buildingM![0]).toBe(30);
    expect(street.buildingM![0]).toBe(0);
    expect(Math.max(...street.buildingM!)).toBe(25);
  });
  it('keeps a taller neighbour that touches a street-level sensor\'s own building', () => {
    const surface = withBuildings(flat, (p) => wall(0, 20, 30)(p) || wall(20, 60, 150)(p));
    const street = buildProfile(SG_REFERENCE, to, surface, 30, { from: true })!;
    expect(street.buildingM![0]).toBe(0);
    expect(Math.max(...street.buildingM!)).toBe(150);
  });
  it('blocks a low link behind a tall building, frequency dependent', () => {
    const p = buildProfile(SG_REFERENCE, to, withBuildings(flat, wall(480, 520, 60)))!;
    const low = bullingtonLossDb(p, 10, 10, 0.433), high = bullingtonLossDb(p, 10, 10, 28);
    expect(low.clearance).toBe('obstructed');
    expect(high.lossDb).toBeGreaterThan(low.lossDb);
  });
});

describe('sensors on buildings', () => {
  const map = (sensors: Sensor[], extra: Partial<MapScenario> = {}): MapScenario => ({ ...DEFAULT_STATE.map, sensors, propagationModel: 'terrain', useTerrainElevation: true, buildings: true, ...extra });
  let sensors = addSensor([], createSensor([], 'tx', SG_REFERENCE, DEFAULT_STATE.inputs));
  sensors = addSensor(sensors, createSensor(sensors, 'rx', offsetLatLon(SG_REFERENCE, 1000, 0), DEFAULT_STATE.inputs));
  const [tx, rx] = sensors;
  const tower = withBuildings(flat, wall(-10, 10, 50));
  it('counts a roof-mounted antenna from the roof and a street one from the ground', () => {
    expect(tx.mount).toBe('roof');
    expect(groundOf(tx, tower, true)).toBe(50);
    expect(groundOf({ ...tx, mount: 'street' }, tower, true)).toBe(0);
    expect(groundOf(tx, flat, true)).toBe(0);
    expect(separationM(tx, rx, tower, true)).toBeCloseTo(Math.hypot(1000, 50), 0);
  });
  it('clears a path from the roof but not from the street beside a tall block', () => {
    const blocked = withBuildings(flat, (p) => Math.max(wall(-10, 10, 50)(p), wall(100, 120, 30)(p)));
    const roof = evaluatePairs(map(sensors), DEFAULT_STATE.inputs, blocked)[0];
    const street = evaluatePairs(map([{ ...tx, mount: 'street' }, rx]), DEFAULT_STATE.inputs, blocked)[0];
    expect(roof.clearance).not.toBe('obstructed');
    expect(street.clearance).toBe('obstructed');
    expect(street.propagationLossDb).toBeGreaterThan(roof.propagationLossDb);
  });
});

describe('schema 7', () => {
  it('opens older scenarios with buildings off and roof mounts', () => {
    const fresh = normalizeState();
    const saved = JSON.parse(JSON.stringify({ ...fresh, schemaVersion: 6 }));
    delete saved.map.buildings;
    for (const s of saved.map.sensors) delete s.mount;
    const loaded = normalizeState(saved);
    expect(loaded.schemaVersion).toBe(7);
    expect(loaded.map.buildings).toBe(false);
    expect(loaded.map.sensors.every((s) => s.mount === 'roof')).toBe(true);
  });
  it('keeps saved values and rejects invalid ones', () => {
    const fresh = normalizeState();
    const saved = { ...fresh, map: { ...fresh.map, buildings: true, sensors: fresh.map.sensors.map((s) => ({ ...s, mount: 'street' as const })) } };
    const loaded = validateImport(JSON.parse(JSON.stringify(saved)))!;
    expect(loaded.map.buildings).toBe(true);
    expect(loaded.map.sensors[0].mount).toBe('street');
    expect(validateImport({ ...saved, map: { ...saved.map, buildings: 'yes' } })).toBeNull();
    expect(validateImport({ ...saved, map: { ...saved.map, sensors: [{ ...saved.map.sensors[0], mount: 'mast' }] } })).toBeNull();
  });
});
