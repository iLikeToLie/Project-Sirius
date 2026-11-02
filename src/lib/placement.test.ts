import { describe, expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import { calculateLink } from './rf';
import { PLACEMENT, placementAllowance, placementClass } from './interference';
import { placementPlan, placementZones } from './interferenceLayer';
import { evaluatePairs, pairLinkInputs, type PairResult } from './sensors';
import { sampleGrid } from './contours';
import { computeMultiField } from './multiField';
import { SG_REFERENCE, toLatLon, toLocalM } from './geo';

describe('placement classification', () => {
  const victim = (powerDbm: number) => ({ powerDbm, limitDbm: -73, thresholdDbm: -70 });
  const served = (powerDbm: number) => ({ powerDbm, requiredDbm: -80 });
  it('honours exact protected, no-margin and served boundaries', () => {
    expect(placementClass([victim(-69.99)], [])).toBe(PLACEMENT.unsafe);
    expect(placementClass([victim(-70)], [])).toBe(PLACEMENT.marginal);
    expect(placementClass([victim(-72)], [])).toBe(PLACEMENT.marginal);
    expect(placementClass([victim(-73)], [served(-80.01)])).toBe(PLACEMENT.safe);
    expect(placementClass([victim(-73)], [served(-80)])).toBe(PLACEMENT.recommended);
  });
  it('checks every victim and served link, with unknown taking precedence', () => {
    expect(placementClass([victim(-90), victim(-60)], [served(-70)])).toBe(PLACEMENT.unsafe);
    expect(placementClass([victim(-90)], [served(-70), served(-90)])).toBe(PLACEMENT.safe);
    expect(placementClass([victim(-60), victim(NaN)], [])).toBe(PLACEMENT.unknown);
    expect(placementClass([victim(-60)], [served(NaN)])).toBe(PLACEMENT.unknown);
    expect(placementClass([{ ...victim(-90), limitDbm: NaN }], [])).toBe(PLACEMENT.unknown);
    expect(placementClass([], [])).toBe(PLACEMENT.recommended);
    expect(placementClass([{ ...victim(-90), limitDbm: -Infinity, thresholdDbm: -Infinity }], [])).toBe(PLACEMENT.unsafe);
  });
  it('never recommends equality at a raw interference threshold, including zero margin', () => {
    expect(placementClass([{ powerDbm: -65, limitDbm: -65, thresholdDbm: -65, exclusiveThresholdDbm: -65 }], []))
      .toBe(PLACEMENT.marginal);
    // C/I equality remains safe when the raw interference threshold is higher.
    expect(placementClass([{ powerDbm: -75, limitDbm: -75, thresholdDbm: -75, exclusiveThresholdDbm: -65 }], []))
      .toBe(PLACEMENT.recommended);
  });
});

describe('fixed placement allowances', () => {
  const { map, inputs } = freshDefaultState();
  const tx = map.sensors[0], rx = { ...map.sensors[1], objective: 'desired' as const, interferenceThresholdDbm: -60, protectionMarginDb: 3, requiredCiDb: 10 };
  const p = (id: string, power: number, intended = false): PairResult => ({ txId: id, txName: id, rxId: rx.id, intended,
    elevationKnown: true, distanceM: 100, propagationLossDb: 0, rejectionDb: 0, polarizationDb: 0, clearance: 'unknown',
    result: { ...calculateLink(inputs), receivedPowerDbm: power } });
  it('excludes the moving transmitter and subtracts only the other aggregate sources', () => {
    const m = { ...map, aggregateInterference: 'always' as const };
    const pairs = [p(tx.id, -30), p('other', -70)];
    expect(placementAllowance(m, rx, tx.id, pairs, 0)).toBeCloseTo(10 * Math.log10(10 ** -6 - 10 ** -7), 10);
    expect(placementAllowance(m, rx, tx.id, pairs, 3)).toBeCloseTo(10 * Math.log10(10 ** -6.3 - 10 ** -7), 10);
    pairs[0].result.receivedPowerDbm = -100;
    expect(placementAllowance(m, rx, tx.id, pairs, 0)).toBeCloseTo(10 * Math.log10(10 ** -6 - 10 ** -7), 10);
  });
  it('uses the weakest desired C/I allowance in both margin calculations, as Task 4 does', () => {
    const m = { ...map, aggregateInterference: 'always' as const };
    const pairs = [p(tx.id, -30), p('desired1', -50, true), p('desired2', -65, true), p('other', -80)];
    const expected = 10 * Math.log10(10 ** -7.5 - 10 ** -8);
    expect(placementAllowance(m, rx, tx.id, pairs, 0)).toBeCloseTo(expected, 10);
    expect(placementAllowance(m, rx, tx.id, pairs, 3)).toBeCloseTo(expected, 10);
  });
  it('uses worst-single allowance and rejects an existing violation from another transmitter', () => {
    const m = { ...map, aggregateInterference: 'never' as const };
    expect(placementAllowance(m, rx, tx.id, [p('other', -70)], 3)).toBe(-63);
    expect(placementAllowance(m, rx, tx.id, [p('other', -62)], 3)).toBe(-Infinity);
    expect(placementAllowance(m, rx, tx.id, [p('other', -59)], 0)).toBe(-Infinity);
  });
  it('keeps unknown fixed paths unknown instead of reporting a confident allowance', () => {
    const unknown = { ...p('other', -90), elevationKnown: false };
    expect(placementAllowance(map, rx, tx.id, [unknown], 3)).toBeNaN();
    expect(placementAllowance(map, rx, tx.id, [{ ...p('desired', -50, true), elevationKnown: false }], 3)).toBeNaN();
  });
  it('flags a fixed interferer already exactly at the raw threshold even with zero margin', () => {
    const m = { ...map, aggregateInterference: 'never' as const };
    const allowance = placementAllowance(m, rx, tx.id, [p('other', rx.interferenceThresholdDbm)], 0, true);
    expect(allowance).toBe(-Infinity);
    expect(placementClass([{ powerDbm: -100, limitDbm: -60, thresholdDbm: -60, exclusiveThresholdDbm: allowance }], []))
      .toBe(PLACEMENT.marginal);
  });
});

describe('placement field integration', () => {
  it('matches forward free-space pair powers when the transmitter is moved to each raster node', () => {
    const { map, inputs } = freshDefaultState();
    map.useTerrainElevation = false; map.propagationModel = 'free-space';
    const tx = map.sensors[0], rx = map.sensors[1];
    tx.aglM = 19; tx.gainDbi = 8; tx.frequencyGhz = 2.4;
    rx.objective = 'desired'; rx.desiredTxIds = [tx.id]; rx.aglM = 4; rx.gainDbi = 2;
    rx.polarization = 'H'; rx.frequencyGhz = 5.8; rx.acrDb = 17;
    const plan = placementPlan(map, inputs, tx, () => 0, evaluatePairs(map, inputs, () => 0));
    const local = toLocalM(tx);
    const raster = sampleGrid({ minX: local.xM + 20, maxX: local.xM + 80, minY: local.yM - 50, maxY: local.yM + 50 }, 3, 2, () => 0);
    const out = computeMultiField({ jobId: 1, sources: plan.sources, raster, rayGround: raster, origin: SG_REFERENCE, mode: 'free-space', rxAglM: tx.aglM, radials: 8 });
    for (let k = 0; k < raster.values.length; k++) {
      const at = toLatLon({ xM: raster.x0 + k % (raster.cols + 1) * raster.dx, yM: raster.y0 + Math.floor(k / (raster.cols + 1)) * raster.dy });
      const forward = evaluatePairs({ ...map, sensors: [{ ...tx, ...at }, rx] }, inputs, () => 0)[0];
      expect(out.powers[0][k]).toBeCloseTo(forward.result.receivedPowerDbm, 4);
    }
  });
  it('anchors rays at receivers with the original Tx-to-Rx budget, and orders victims before served', () => {
    const { map, inputs } = freshDefaultState();
    map.useTerrainElevation = true;
    const tx = map.sensors[0], served = map.sensors[1];
    served.objective = 'desired'; served.desiredTxIds = [tx.id];
    const victim = { ...served, id: 'victim', name: 'Victim', objective: 'avoidance' as const, aglM: 11, polarization: 'H' as const };
    map.sensors.push(victim);
    const plan = placementPlan(map, inputs, tx, () => 21, evaluatePairs(map, inputs, () => 21));
    expect(plan.victims.map(v => v.rx.id)).toEqual([victim.id]);
    expect(plan.served.map(s => s.id)).toEqual([served.id]);
    expect(plan.sources.map(s => [s.lat, s.lon, s.elevationM])).toEqual([[victim.lat, victim.lon, 32], [served.lat, served.lon, 21 + served.aglM]]);
    expect(plan.sources[0].inputs).toEqual(pairLinkInputs(map, inputs, tx, victim, 1).inputs);
    expect(plan.sources[0].inputs.transmitPowerDbm).toBe(tx.powerDbm);
  });
  it('classifies all five raster states and never gives groundless cells a safe colour', () => {
    const { map, inputs } = freshDefaultState();
    map.useTerrainElevation = false;
    const tx = map.sensors[0], served = map.sensors[1];
    served.objective = 'desired'; served.desiredTxIds = [tx.id]; served.sensitivityDbm = -90; served.fadeMarginTargetDb = 10;
    const victim = { ...served, id: 'victim', objective: 'avoidance' as const, interferenceThresholdDbm: -70, protectionMarginDb: 3 };
    map.sensors.push(victim);
    const plan = placementPlan(map, inputs, tx, () => 0, evaluatePairs(map, inputs, () => 0));
    const raster = sampleGrid({ minX: 0, maxX: 5, minY: 0, maxY: 1 }, 5, 1, () => 0);
    const field = (p: number[]) => Float32Array.from([...p, ...p]);
    const result = placementZones(plan, raster, { jobId: 5, powers: [field([-69, -71, -74, -74, NaN, -74]), field([-70, -70, -81, -80, -70, -70])] });
    expect([...result.classes].slice(0, 6)).toEqual([PLACEMENT.unsafe, PLACEMENT.marginal, PLACEMENT.safe, PLACEMENT.recommended, PLACEMENT.unknown, PLACEMENT.recommended]);
    raster.values[5] = NaN;
    expect(placementZones(plan, raster, { jobId: 6, powers: [field([-80, -80, -80, -80, -80, -80]), field([-70, -70, -70, -70, -70, -70])] }).classes[5]).toBe(PLACEMENT.unknown);
  });
});
