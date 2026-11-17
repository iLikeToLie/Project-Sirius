import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import type { AntennaModel, AntennaPattern, MapScenario, Sensor } from '../types';
import { applyAimTracking, bearingDeg, defaultSensorAntenna, deleteModel, effectiveGainDbi, elevationDeg, findModel, isAntennaModel, isSensorAntenna, MAX_ANTENNA_MODELS, newSectorModel, normAzimuth, offAxisDeg, OMNI_MODEL_ID, pairPatternLoss, patternLossDb, resolveAntenna, typicalGainDbi } from './antenna';
import { offsetLatLon } from './geo';

const origin = { lat: 1.35, lon: 103.8 };
const sector = (azimuthDeg: number, beamwidthDeg = 60, frontToBackDb = 25): AntennaPattern => ({ kind: 'sector', azimuthDeg, beamwidthDeg, frontToBackDb, verticalBeamwidthDeg: 10, downtiltDeg: 0 });
const omniPattern = (): AntennaPattern => ({ ...sector(0), kind: 'omni' });
/** Library shared by the helpers below: every non-omni pattern becomes its own model. */
const models: AntennaModel[] = [];
const lib = () => ({ antennaModels: models });
const sensor = (at: { lat: number; lon: number }, pattern: AntennaPattern): Sensor => {
  let modelId = OMNI_MODEL_ID;
  if (pattern.kind === 'sector') {
    const model: AntennaModel = { id: `t-${models.length}`, name: 'T', kind: 'sector', gainDbi: 0, beamwidthDeg: pattern.beamwidthDeg, verticalBeamwidthDeg: pattern.verticalBeamwidthDeg, frontToBackDb: pattern.frontToBackDb };
    models.push(model);
    modelId = model.id;
  }
  return { ...DEFAULT_STATE.map.sensors[0], ...at, antenna: { modelId, azimuthDeg: pattern.azimuthDeg, downtiltDeg: pattern.downtiltDeg, aimAtId: null } };
};

describe('antenna pattern', () => {
  it('defaults to a fresh built-in omni sensor antenna', () => {
    expect(defaultSensorAntenna()).toEqual({ modelId: 'omni', azimuthDeg: 0, downtiltDeg: 0, aimAtId: null });
    expect(defaultSensorAntenna()).not.toBe(defaultSensorAntenna());
  });
  it('normalises azimuths', () => {
    expect(normAzimuth(-10)).toBe(350);
    expect(normAzimuth(360)).toBe(0);
    expect(normAzimuth(725)).toBe(5);
  });
  it('is 0 dB on boresight and 3 dB at half the beamwidth', () => {
    expect(patternLossDb(sector(90), 90)).toBe(0);
    expect(patternLossDb(sector(90, 60), 120)).toBeCloseTo(3, 9);
  });
  it('caps at the front-to-back ratio', () => {
    expect(patternLossDb(sector(0, 60, 25), 180)).toBe(25);
    expect(patternLossDb(sector(0, 60, 10), 90)).toBe(10);
  });
  it('is symmetric left and right and wraps across north', () => {
    const a = sector(0);
    expect(patternLossDb(a, 20)).toBeCloseTo(patternLossDb(a, 340), 9);
    expect(offAxisDeg(350, 10)).toBe(20);
    expect(offAxisDeg(10, 350)).toBe(20);
    expect(offAxisDeg(0, 180)).toBe(180);
    expect(patternLossDb(sector(350), 10)).toBeCloseTo(patternLossDb(sector(10), 350), 9);
  });
  it('is always 0 for omni, whatever its stored sector values', () => {
    for (const b of [0, 90, 180, 271]) expect(patternLossDb({ ...sector(0, 10, 40), kind: 'omni' }, b)).toBe(0);
  });
  it('measures bearings from north, clockwise', () => {
    expect(bearingDeg(origin, offsetLatLon(origin, 0, 500))).toBeCloseTo(0, 3);
    expect(bearingDeg(origin, offsetLatLon(origin, 500, 0))).toBeCloseTo(90, 3);
    expect(bearingDeg(origin, offsetLatLon(origin, 0, -500))).toBeCloseTo(180, 3);
    expect(bearingDeg(origin, offsetLatLon(origin, -500, 0))).toBeCloseTo(270, 3);
  });
  it('applies the pattern at both ends of a pair', () => {
    const east = offsetLatLon(origin, 500, 0);
    const tx = sensor(origin, sector(90));
    const rx = sensor(east, sector(270));
    const aimed = pairPatternLoss(lib(), tx, rx);
    expect(aimed).toEqual({ txDb: 0, rxDb: 0, txOffDeg: expect.closeTo(0, 3), rxOffDeg: expect.closeTo(0, 3), txElevDeg: 0, rxElevDeg: 0, totalDb: 0 });
    const away = pairPatternLoss(lib(), sensor(origin, sector(270, 60, 25)), sensor(east, sector(0, 60, 20)));
    expect(away.txDb).toBe(25);
    expect(away.rxDb).toBe(20);
    expect(away.txOffDeg).toBeCloseTo(180, 3);
    expect(away.rxOffDeg).toBeCloseTo(90, 3);
    expect(away.totalDb).toBeCloseTo(45, 6);
  });
  it('gives NaN off-axis angles for omni ends', () => {
    const p = pairPatternLoss(lib(), sensor(origin, omniPattern()), sensor(offsetLatLon(origin, 0, 300), sector(180)));
    expect(p.txDb).toBe(0);
    expect(p.txOffDeg).toBeNaN();
    expect(p.rxOffDeg).toBeCloseTo(0, 3);
  });
  it('validates models and sensor antennas', () => {
    const model = newSectorModel([]);
    expect(isAntennaModel(model)).toBe(true);
    for (const bad of [null, 'x', { ...model, kind: 'dish' }, { ...model, id: '' }, { ...model, gainDbi: NaN }, { ...model, beamwidthDeg: 0.5 }, { ...model, beamwidthDeg: 181 },
      { ...model, verticalBeamwidthDeg: 0.5 }, { ...model, verticalBeamwidthDeg: 91 }, { ...model, frontToBackDb: -1 }, { ...model, frontToBackDb: 61 }, { id: 'x' }]) {
      expect(isAntennaModel(bad)).toBe(false);
    }
    expect(isSensorAntenna(defaultSensorAntenna())).toBe(true);
    expect(isSensorAntenna({ ...defaultSensorAntenna(), azimuthDeg: 725 })).toBe(true);
    for (const bad of [null, {}, { ...defaultSensorAntenna(), modelId: 3 }, { ...defaultSensorAntenna(), azimuthDeg: NaN }, { ...defaultSensorAntenna(), downtiltDeg: -21 },
      { ...defaultSensorAntenna(), downtiltDeg: 46 }, { ...defaultSensorAntenna(), aimAtId: 5 }, { modelId: 'omni', azimuthDeg: 0, downtiltDeg: 0 }]) {
      expect(isSensorAntenna(bad)).toBe(false);
    }
  });
});

describe('antenna library', () => {
  const map = (antennaModels: AntennaModel[], sensors: Sensor[] = []) => ({ ...DEFAULT_STATE.map, antennaModels, sensors }) as MapScenario;
  const withModel = (s: Sensor, modelId: string, extra: Partial<Sensor['antenna']> = {}): Sensor => ({ ...s, antenna: { ...s.antenna, modelId, ...extra } });
  it('creates sector models with unique ids and names, typical gain to 0.5 dB', () => {
    const a = newSectorModel([]);
    expect(a).toEqual({ id: 'ant-1', name: 'Sector 1', kind: 'sector', gainDbi: 18, beamwidthDeg: 65, verticalBeamwidthDeg: 10, frontToBackDb: 25 });
    const b = newSectorModel([a]);
    expect(b.id).toBe('ant-2');
    expect(b.name).toBe('Sector 2');
    const c = newSectorModel([{ ...a, id: 'ant-2' }, { ...a, name: 'Sector 2' }], 'Panel');
    expect(c.id).toBe('ant-3');
    expect(c.name).toBe('Panel');
    expect(newSectorModel([{ ...a, id: 'ant-1' }, { ...a, id: 'ant-2', name: 'Sector 5' }]).id).toBe('ant-3');
    expect(MAX_ANTENNA_MODELS).toBe(24);
  });
  it('resolves omni, unknown models and models to the flat pattern', () => {
    const m: AntennaModel = { id: 'ant-1', name: 'S', kind: 'sector', gainDbi: 17, beamwidthDeg: 40, verticalBeamwidthDeg: 8, frontToBackDb: 30 };
    const s = { ...DEFAULT_STATE.map.sensors[0], antenna: { modelId: 'ant-1', azimuthDeg: 120, downtiltDeg: 4, aimAtId: null } };
    const lib1 = map([m]);
    expect(findModel(lib1, 'ant-1')).toBe(m);
    expect(findModel(lib1, 'zz')).toBeUndefined();
    expect(resolveAntenna(lib1, s)).toEqual({ kind: 'sector', azimuthDeg: 120, beamwidthDeg: 40, frontToBackDb: 30, verticalBeamwidthDeg: 8, downtiltDeg: 4 });
    expect(resolveAntenna(lib1, withModel(s, 'omni')).kind).toBe('omni');
    expect(resolveAntenna(lib1, withModel(s, 'missing')).kind).toBe('omni');
    expect(resolveAntenna(map([{ ...m, kind: 'omni' }]), s).kind).toBe('omni');
  });
  it('gives gain to the model, and to the sensor for omni', () => {
    const m: AntennaModel = { ...newSectorModel([]), gainDbi: 17.5 };
    const s = { ...DEFAULT_STATE.map.sensors[0], gainDbi: 9 };
    const lib1 = map([m]);
    expect(effectiveGainDbi(lib1, s)).toBe(9);
    expect(effectiveGainDbi(lib1, withModel(s, m.id))).toBe(17.5);
    expect(effectiveGainDbi(lib1, withModel(s, 'missing'))).toBe(9);
    expect(withModel(s, m.id).gainDbi).toBe(9);
  });
  it('deletes a model and sends its sensors back to omni', () => {
    const [a, b] = DEFAULT_STATE.map.sensors;
    const m1 = newSectorModel([]), m2 = newSectorModel([m1]);
    const next = deleteModel(map([m1, m2], [withModel(a, m1.id, { azimuthDeg: 50 }), withModel(b, m2.id)]), m1.id);
    expect(next.antennaModels).toEqual([m2]);
    expect(next.sensors[0].antenna).toEqual({ modelId: 'omni', azimuthDeg: 50, downtiltDeg: 0, aimAtId: null });
    expect(next.sensors[1].antenna.modelId).toBe(m2.id);
  });
});

describe('aim tracking', () => {
  const [a0, b0] = DEFAULT_STATE.map.sensors;
  const a: Sensor = { ...a0, ...origin }, b: Sensor = { ...b0, ...offsetLatLon(origin, 500, 0) };
  const track = (s: Sensor, aimAtId: string | null, azimuthDeg = 0): Sensor => ({ ...s, antenna: { ...s.antenna, aimAtId, azimuthDeg } });
  it('points at the target, rounded to 0.1 degree', () => {
    const [x, y] = applyAimTracking([track(a, b.id), b]);
    expect(x.antenna.azimuthDeg).toBe(90);
    expect(y).toBe(b);
    const odd = applyAimTracking([track(a, b.id), { ...b, ...offsetLatLon(origin, 300, 700) }])[0].antenna.azimuthDeg;
    expect(odd).toBeCloseTo(23.2, 5);
  });
  it('follows when the target moves and returns the same objects when nothing changes', () => {
    const list = [track(a, b.id), b];
    const first = applyAimTracking(list);
    expect(applyAimTracking(first)).toBe(first);
    const moved = applyAimTracking([first[0], { ...b, ...offsetLatLon(origin, 0, 500) }]);
    expect(moved[0].antenna.azimuthDeg).toBe(0);
    const untracked = [a, b];
    expect(applyAimTracking(untracked)).toBe(untracked);
  });
  it('ignores a missing target or a self target', () => {
    const list = [track(a, 'ghost', 33), track(b, b.id, 44)];
    expect(applyAimTracking(list)).toBe(list);
  });
});

describe('vertical pattern', () => {
  const tilted = (tilt: number, v = 10, fbr = 25) => ({ ...sector(0, 60, fbr), verticalBeamwidthDeg: v, downtiltDeg: tilt });
  it('is 0 dB on the horizon with no tilt and at e = -tilt', () => {
    expect(patternLossDb(tilted(0), 0, 0)).toBe(0);
    expect(patternLossDb(tilted(6), 0, -6)).toBe(0);
  });
  it('is 3 dB at half the vertical beamwidth either side of the tilted axis', () => {
    expect(patternLossDb(tilted(0), 0, 5)).toBeCloseTo(3, 9);
    expect(patternLossDb(tilted(0), 0, -5)).toBeCloseTo(3, 9);
    expect(patternLossDb(tilted(4), 0, 1)).toBeCloseTo(3, 9);
    expect(patternLossDb(tilted(4), 0, -9)).toBeCloseTo(3, 9);
  });
  it('caps the vertical term at 20 dB and the combination at the front-to-back ratio', () => {
    expect(patternLossDb(tilted(0, 10, 40), 0, 80)).toBe(20);
    expect(patternLossDb(tilted(0, 10, 15), 0, 80)).toBe(15);
    // Ah = 3 (30 deg off at 60 deg beamwidth) + Av = 3 adds up; the sum is capped at FBR, not each term.
    expect(patternLossDb(tilted(0, 10, 5), 30, 5)).toBe(5);
    expect(patternLossDb(tilted(0, 10, 25), 30, 5)).toBeCloseTo(6, 9);
  });
  it('leaves Omni lossless in elevation', () => {
    expect(patternLossDb({ ...tilted(10), kind: 'omni' }, 0, 45)).toBe(0);
  });
  it('computes elevation angles and typical gain', () => {
    expect(elevationDeg(10, 10, 100)).toBe(0);
    expect(elevationDeg(110, 10, 100)).toBeCloseTo(-45, 9);
    expect(elevationDeg(0, 100, 100)).toBeCloseTo(45, 9);
    expect(typicalGainDbi(65, 10)).toBeCloseTo(18.03, 2);
  });
  it('sees a tall Tx tilted down differently from a street Rx at the foot of the mast', () => {
    const near = offsetLatLon(origin, 0, 50);
    const tilt = (t: Sensor, downtiltDeg: number): Sensor => ({ ...t, antenna: { ...t.antenna, downtiltDeg } });
    const tx = sensor(origin, tilted(0)), rx = sensor(near, omniPattern());
    // 60 m mast, receiver at 2 m, 50 m away: 49 deg below the horizon.
    const flat = pairPatternLoss(lib(), tx, rx, 60, 2);
    expect(flat.txElevDeg).toBeCloseTo(-49.2, 1);
    expect(flat.txDb).toBe(20);
    expect(flat.rxElevDeg).toBeNaN();
    const down = pairPatternLoss(lib(), tilt(tx, 10), rx, 60, 2);
    expect(down.txDb).toBe(20);
    // Far away the same mast is nearly on the horizon, and a 3 deg downtilt aims at it.
    const far = sensor(offsetLatLon(origin, 0, 1000), omniPattern());
    const aimed = pairPatternLoss(lib(), tilt(tx, 3.3), far, 60, 2);
    expect(aimed.txElevDeg).toBeCloseTo(-3.32, 1);
    expect(aimed.txDb).toBeLessThan(0.01);
    expect(pairPatternLoss(lib(), tx, far, 60, 2).txDb).toBeGreaterThan(1);
    // Without heights the elevation is 0.
    expect(pairPatternLoss(lib(), tx, far).txElevDeg).toBe(0);
  });
  it('applies the Rx pattern with the opposite elevation sign', () => {
    const rx = sensor(offsetLatLon(origin, 0, 100), { ...sector(180), downtiltDeg: 0 });
    const p = pairPatternLoss(lib(), sensor(origin, omniPattern()), rx, 2, 22);
    expect(p.rxElevDeg).toBeCloseTo(-11.3, 1);
    expect(p.rxDb).toBeCloseTo(12 * (11.31 / 10) ** 2, 1);
  });
});
