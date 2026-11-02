import { describe, expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import type { ScreeningStatus } from '../types';
import { calculateLink } from './rf';
import { evaluatePairs, receiverSummary, type PairResult } from './sensors';
import { assessAll, assessReceiver, effectiveMarginDb, pairVerdict, sumDbm, transmitterPowerRange, usesAggregate, worstAssessedLink } from './interference';

const state = freshDefaultState();
const rx = { ...state.map.sensors[1], objective: 'avoidance' as const };
const pair = (txId: string, power: number, intended = false, status: ScreeningStatus = 'Acceptable link'): PairResult => ({
  txId, txName: txId, rxId: rx.id, intended, elevationKnown: true, distanceM: 100,
  propagationLossDb: 0, clearance: 'unknown',
  result: { ...calculateLink(state.inputs, intended ? 'desired' : 'avoidance'), receivedPowerDbm: power, status },
});

describe('transmitter power range', () => {
  const tx = { ...state.map.sensors[0], id: 'target', powerDbm: 30 };
  const map = { ...state.map, sensors: [tx, rx], aggregateInterference: 'never' as const };

  it('limits a single victim at the protected boundary', () => {
    const p = pair(tx.id, -60);
    const range = transmitterPowerRange(map, tx.id, [p]);
    expect(range).toMatchObject({ maxDbm: 22, limitedBy: rx.id, limitKind: 'threshold', minDbm: null, minFor: null, unknownPaths: 0 });
    const at = (powerDbm: number) => ({ ...p, result: { ...p.result, receivedPowerDbm: p.result.receivedPowerDbm + powerDbm - tx.powerDbm } });
    expect(pairVerdict(at(range.maxDbm), rx, 3)).toBe('Below interference threshold');
    expect(pairVerdict(at(range.maxDbm + 0.01), rx, 3)).toBe('Marginal interference');
  });

  it('subtracts other aggregate interference in linear power', () => {
    const range = transmitterPowerRange({ ...map, aggregateInterference: 'always' }, tx.id, [pair(tx.id, -70), pair('other', -72)]);
    const allowed = 10 * Math.log10(10 ** (-68 / 10) - 10 ** (-72 / 10));
    expect(range.maxDbm).toBeCloseTo(30 + allowed + 70, 10);
  });

  it('reports no finite power when other sources already reach the protected limit', () => {
    for (const power of [-68, -67]) {
      expect(transmitterPowerRange({ ...map, aggregateInterference: 'always' }, tx.id, [pair(tx.id, -70), pair('other', power)]))
        .toMatchObject({ maxDbm: -Infinity, limitedBy: rx.id, limitKind: 'threshold' });
    }
  });

  it('uses the weakest known desired link for a C/I limit', () => {
    const desired = { ...rx, objective: 'desired' as const };
    const range = transmitterPowerRange({ ...map, sensors: [tx, desired] }, tx.id, [pair(tx.id, -60), pair('wanted1', -55, true), pair('wanted2', -65, true)]);
    expect(range).toMatchObject({ maxDbm: 15, limitedBy: rx.id, limitKind: 'ci' });
  });

  it('subtracts aggregate others from the C/I allowance too', () => {
    const desired = { ...rx, objective: 'desired' as const };
    const range = transmitterPowerRange({ ...map, sensors: [tx, desired], aggregateInterference: 'always' }, tx.id, [pair(tx.id, -60), pair('wanted', -65, true), pair('other', -80)]);
    expect(range.limitKind).toBe('ci');
    expect(range.maxDbm).toBeCloseTo(30 + 10 * Math.log10(10 ** (-75 / 10) - 10 ** (-80 / 10)) + 60, 10);
  });

  it('finds the largest served-link minimum and reports conflicting bounds', () => {
    const served = { ...rx, id: 'served', objective: 'desired' as const };
    const range = transmitterPowerRange({ ...map, sensors: [tx, rx, served] }, tx.id, [pair(tx.id, -60), { ...pair(tx.id, -85, true), rxId: served.id }]);
    expect(range.minDbm).toBe(45);
    expect(range.minFor).toBe(served.id);
    expect(range.minDbm!).toBeGreaterThan(range.maxDbm);
  });

  it('returns unbounded maximum without victims and null minimum without served links', () => {
    expect(transmitterPowerRange(map, tx.id, [])).toMatchObject({ maxDbm: Infinity, limitedBy: null, minDbm: null, minFor: null });
    expect(transmitterPowerRange(map, tx.id, [pair(tx.id, -70, true)])).toMatchObject({ maxDbm: Infinity, minDbm: 30 });
  });

  it('omits and counts unknown target, desired and aggregate-other paths once', () => {
    const desired = { ...rx, objective: 'desired' as const };
    const unknown = (p: PairResult) => ({ ...p, elevationKnown: false });
    expect(transmitterPowerRange(map, tx.id, [unknown(pair(tx.id, -30))])).toMatchObject({ maxDbm: Infinity, unknownPaths: 1 });
    const range = transmitterPowerRange({ ...map, sensors: [tx, desired], aggregateInterference: 'always' }, tx.id,
      [pair(tx.id, -60), unknown(pair('wanted', -40, true)), unknown(pair('other', -30))]);
    expect(range).toMatchObject({ maxDbm: 22, limitKind: 'threshold', unknownPaths: 2 });
  });

  it('preserves the reported boundary with actual terrain diffraction when power changes', () => {
    const terrainMap = { ...state.map, defaultObjective: 'avoidance' as const, useTerrainElevation: true, propagationModel: 'terrain' as const };
    const ground = (at: { lon: number }) => Math.abs(at.lon - (terrainMap.sensors[0].lon + terrainMap.sensors[1].lon) / 2) < 0.0002 ? 80 : 0;
    const txId = terrainMap.sensors[0].id;
    const before = evaluatePairs(terrainMap, state.inputs, ground);
    expect(before[0].propagationLossDb).toBeGreaterThan(0);
    const range = transmitterPowerRange(terrainMap, txId, before);
    const at = (powerDbm: number) => evaluatePairs({ ...terrainMap, sensors: terrainMap.sensors.map(s => s.id === txId ? { ...s, powerDbm } : s) }, state.inputs, ground);
    const boundary = at(range.maxDbm);
    expect(boundary[0].propagationLossDb).toBe(before[0].propagationLossDb);
    expect(assessReceiver(terrainMap, terrainMap.sensors[1], boundary).status).toBe('Below interference threshold');
    expect(assessReceiver(terrainMap, terrainMap.sensors[1], at(range.maxDbm + 0.01)).status).toBe('Marginal interference');
  });
});
const three = () => ['a', 'b', 'c'].map((id) => pair(id, -67));

describe('receiver interference assessment', () => {
  it('sums three -67 dBm interferers to -62.23 dBm for avoidance', () => {
    const a = assessReceiver(state.map, rx, three());
    expect(a.aggregate).toBe(true);
    expect(a.interferenceDbm).toBeCloseTo(-62.2288, 4);
    expect(a.status).toBe('Possible interference');
    expect(a.contributors.map((c) => c.share)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('uses the worst single interferer when aggregate is never', () => {
    const a = assessReceiver({ ...state.map, aggregateInterference: 'never' }, rx, three());
    expect(a.interferenceDbm).toBe(-67);
    expect(a.status).toBe('Marginal interference');
  });

  it('uses worst single for desired receivers in objective mode', () => {
    const desired = { ...rx, objective: 'desired' as const };
    expect(assessReceiver(state.map, desired, three()).interferenceDbm).toBe(-67);
    expect(usesAggregate({ ...state.map, aggregateInterference: 'always' }, desired)).toBe(true);
    expect(usesAggregate({ ...state.map, defaultObjective: 'avoidance' }, { ...rx, objective: 'default' })).toBe(true);
  });

  it.each([
    [-68, 'Below interference threshold'], [-67.9, 'Marginal interference'], [-65, 'Possible interference'],
  ] as const)('judges the protected boundary at %s dBm', (power, status) => {
    expect(pairVerdict(pair('a', power), rx, 3)).toBe(status);
    expect(assessReceiver(state.map, rx, [pair('a', power)]).status).toBe(status);
  });

  it('marks a desired link interfered below its required C/I, retaining equality', () => {
    const pairs = [pair('wanted', -60, true), pair('other', -68)];
    const desired = { ...rx, objective: 'desired' as const };
    expect(assessReceiver(state.map, desired, pairs).links[0]).toEqual({ txId: 'wanted', ciDb: 8, status: 'Interfered link' });
    expect(assessReceiver(state.map, { ...desired, requiredCiDb: 8 }, pairs).links[0].status).toBe('Acceptable link');
    expect(assessReceiver(state.map, desired, [pair('wanted', -60, true, 'Weak link'), pair('other', -68)]).links[0].status).toBe('Interfered link');
  });

  it('preserves No link and Invalid input under interference', () => {
    for (const status of ['No link', 'Invalid input'] as const) {
      expect(assessReceiver(state.map, rx, [pair('wanted', -90, true, status), pair('other', -50)]).links[0].status).toBe(status);
    }
  });

  it('omits unknown interferers and counts their paths', () => {
    const unknown = { ...pair('unknown', -30), elevationKnown: false };
    const a = assessReceiver(state.map, rx, [pair('known', -70), unknown]);
    expect(a.unknownPaths).toBe(1);
    expect(a.interferenceDbm).toBe(-70);
    expect(a.contributors.map((c) => c.txId)).toEqual(['known']);
    expect(pairVerdict(unknown, rx, 3)).toBe('Invalid input');
  });

  it('honors receiver margin overrides including zero', () => {
    expect(effectiveMarginDb(state.map, rx)).toBe(3);
    expect(effectiveMarginDb(state.map, { ...rx, protectionMarginDb: 0 })).toBe(0);
    expect(assessReceiver(state.map, { ...rx, protectionMarginDb: 5 }, [pair('a', -69)]).status).toBe('Marginal interference');
  });

  it('preserves no-interferer link status and gives infinite C/I', () => {
    const a = assessReceiver(state.map, rx, [pair('wanted', -60, true)]);
    expect(a.interferenceDbm).toBe(-Infinity);
    expect(a.status).toBe('Below interference threshold');
    expect(a.links[0]).toEqual({ txId: 'wanted', status: 'Acceptable link', ciDb: Infinity });
  });

  it('sorts contributors by power with shares of total power and keeps summary link ordering', () => {
    const pairs = [pair('weak', -80), pair('strong', -70), pair('z', -60, true), pair('a', -60, true)];
    const a = assessReceiver(state.map, rx, pairs);
    expect(a.contributors.map((c) => c.txId)).toEqual(['strong', 'weak']);
    expect(a.contributors[0].share).toBeCloseTo(10 / 11);
    expect(a.links.map((l) => l.txId)).toEqual(receiverSummary(pairs, rx.id).links.map((l) => l.txId));
  });

  it('assesses receivers only and isolates their pairs', () => {
    const other = { ...rx, id: 'other' };
    const map = { ...state.map, sensors: [state.map.sensors[0], rx, other] };
    const all = assessAll(map, [pair('a', -70), { ...pair('a', -40), rxId: other.id }]);
    expect(all.size).toBe(2);
    expect(all.get(rx.id)?.interferenceDbm).toBe(-70);
    expect(all.get(other.id)?.interferenceDbm).toBe(-40);
  });

  it('sums finite powers stably and ignores non-finite values', () => {
    expect(sumDbm([])).toBe(-Infinity);
    expect(sumDbm([NaN, Infinity, -Infinity])).toBe(-Infinity);
    expect(sumDbm([-70, NaN, -70])).toBeCloseTo(-66.9897, 4);
    expect(sumDbm([4000, 4000])).toBeCloseTo(4003.0103, 4);
  });

  it('rejects invalid individual pair powers', () => {
    expect(pairVerdict(pair('a', NaN), rx, 3)).toBe('Invalid input');
    expect(pairVerdict({ ...pair('a', -70), result: { ...pair('a', -70).result, valid: false } }, rx, 3)).toBe('Invalid input');
  });

  it('selects the worst assessed link with No link above Interfered above Weak', () => {
    const pairs = [pair('strong', -60, true), pair('weak', -85, true, 'Weak link'), pair('missing', -90, true, 'No link')];
    const a = assessReceiver(state.map, rx, [...pairs, pair('other', -68)]);
    expect(worstAssessedLink(a, pairs)?.txId).toBe('missing');
    expect(worstAssessedLink(a, pairs.slice(0, 2))?.txId).toBe('strong');
    expect(worstAssessedLink(a, [])).toBeUndefined();
  });
});
