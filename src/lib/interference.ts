import type { MapScenario, ScreeningStatus, Sensor } from '../types';
import { effectiveObjective, receiverSummary, worstLink, type PairResult } from './sensors';

type InterferenceStatus = 'Possible interference' | 'Marginal interference' | 'Below interference threshold';

export interface Contributor { txId: string; powerDbm: number; share: number }
export interface LinkAssessment { txId: string; status: ScreeningStatus; ciDb: number }
export interface ReceiverAssessment {
  rxId: string;
  aggregate: boolean;
  thresholdDbm: number;
  marginDb: number;
  limitDbm: number;
  interferenceDbm: number;
  status: InterferenceStatus;
  contributors: Contributor[];
  unknownPaths: number;
  links: LinkAssessment[];
}

export const effectiveMarginDb = (map: MapScenario, rx: Sensor): number =>
  rx.protectionMarginDb === 'default' ? map.protectionMarginDb : rx.protectionMarginDb;

export const usesAggregate = (map: MapScenario, rx: Sensor): boolean =>
  map.aggregateInterference === 'always' ||
  (map.aggregateInterference === 'objective' && effectiveObjective(map, rx) === 'avoidance');

/** Sum in linear power, scaled by the strongest term to avoid numeric overflow. */
export function sumDbm(powers: number[]): number {
  const finite = powers.filter(Number.isFinite);
  if (!finite.length) return -Infinity;
  const peak = finite.reduce((a, b) => Math.max(a, b), -Infinity);
  return peak + 10 * Math.log10(finite.reduce((sum, p) => sum + 10 ** ((p - peak) / 10), 0));
}

const verdict = (power: number, threshold: number, margin: number): InterferenceStatus =>
  power >= threshold ? 'Possible interference' : power > threshold - margin ? 'Marginal interference' : 'Below interference threshold';

export function pairVerdict(p: PairResult, rx: Sensor, marginDb: number): InterferenceStatus | 'Invalid input' {
  if (!p.elevationKnown || !p.result.valid || !Number.isFinite(p.result.receivedPowerDbm) ||
    !Number.isFinite(rx.interferenceThresholdDbm) || !Number.isFinite(marginDb) || marginDb < 0) return 'Invalid input';
  return verdict(p.result.receivedPowerDbm, rx.interferenceThresholdDbm, marginDb);
}

export function assessReceiver(map: MapScenario, rx: Sensor, pairs: PairResult[]): ReceiverAssessment {
  const interferers = pairs.filter((p) => p.rxId === rx.id && !p.intended);
  const known = interferers.filter((p) => p.elevationKnown && p.result.valid && Number.isFinite(p.result.receivedPowerDbm))
    .sort((a, b) => b.result.receivedPowerDbm - a.result.receivedPowerDbm || a.txName.localeCompare(b.txName) || a.txId.localeCompare(b.txId));
  const aggregate = usesAggregate(map, rx);
  const total = sumDbm(known.map((p) => p.result.receivedPowerDbm));
  const interferenceDbm = aggregate ? total : known[0]?.result.receivedPowerDbm ?? -Infinity;
  const marginDb = effectiveMarginDb(map, rx);
  // Compute shares from scaled linear powers so equal contributors have equal shares.
  const peak = known[0]?.result.receivedPowerDbm ?? 0;
  const weights = known.map((p) => 10 ** ((p.result.receivedPowerDbm - peak) / 10));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const links = receiverSummary(pairs, rx.id).links.map((p): LinkAssessment => {
    const ciDb = interferenceDbm === -Infinity ? Infinity : p.result.receivedPowerDbm - interferenceDbm;
    const status = p.elevationKnown && p.result.valid &&
      (p.result.status === 'Acceptable link' || p.result.status === 'Weak link') && ciDb < rx.requiredCiDb
      ? 'Interfered link' : p.result.status;
    return { txId: p.txId, status, ciDb };
  });
  return {
    rxId: rx.id, aggregate, thresholdDbm: rx.interferenceThresholdDbm, marginDb,
    limitDbm: rx.interferenceThresholdDbm - marginDb, interferenceDbm,
    status: verdict(interferenceDbm, rx.interferenceThresholdDbm, marginDb),
    contributors: known.map((p, i) => ({ txId: p.txId, powerDbm: p.result.receivedPowerDbm, share: weights[i] / weightSum })),
    unknownPaths: interferers.filter((p) => !p.elevationKnown).length,
    links,
  };
}

export function assessAll(map: MapScenario, pairs: PairResult[]): Map<string, ReceiverAssessment> {
  return new Map(map.sensors.filter((s) => s.role === 'rx').map((rx) => [rx.id, assessReceiver(map, rx, pairs)]));
}

/** Select using assessed statuses while retaining the original pair and its raw RF result. */
export function worstAssessedLink(assessment: ReceiverAssessment, links: PairResult[]): PairResult | undefined {
  const statuses = new Map(assessment.links.map((l) => [l.txId, l.status]));
  const assessed = links.map((p) => ({ ...p, result: { ...p.result, status: statuses.get(p.txId) ?? p.result.status } }));
  const worst = worstLink(assessed);
  return worst ? links.find((p) => p.txId === worst.txId && p.rxId === worst.rxId) : undefined;
}

export interface TransmitterPowerRange {
  maxDbm: number;
  limitedBy: string | null;
  limitKind: 'threshold' | 'ci' | null;
  minDbm: number | null;
  minFor: string | null;
  unknownPaths: number;
}

/** Power left for one source after subtracting the other sources in linear units. */
function remainingPowerDbm(limit: number, others: number): number {
  if (others === -Infinity) return limit;
  if (others >= limit) return -Infinity;
  return limit + 10 * Math.log10(-Math.expm1((others - limit) * Math.LN10 / 10));
}

/** Bounds for one transmitter, holding geometry and every other transmitter fixed. */
export function transmitterPowerRange(map: MapScenario, txId: string, pairs: PairResult[]): TransmitterPowerRange {
  const tx = map.sensors.find(s => s.id === txId && s.role === 'tx');
  if (!tx) throw new Error('Power range requires a transmitter in this scenario.');
  const range: TransmitterPowerRange = { maxDbm: Infinity, limitedBy: null, limitKind: null, minDbm: null, minFor: null, unknownPaths: 0 };
  const unknown = new Set<PairResult>();
  const known = (p: PairResult) => {
    const valid = p.elevationKnown && p.result.valid && Number.isFinite(p.result.receivedPowerDbm);
    if (!valid) unknown.add(p);
    return valid;
  };
  for (const rx of map.sensors.filter(s => s.role === 'rx')) {
    const mine = pairs.filter(p => p.rxId === rx.id);
    const target = mine.find(p => p.txId === txId);
    if (!target || !known(target)) continue;
    if (target.intended) {
      const min = tx.powerDbm + rx.sensitivityDbm + rx.fadeMarginTargetDb - target.result.receivedPowerDbm;
      if (range.minDbm === null || min > range.minDbm) {
        range.minDbm = min; range.minFor = rx.id;
      }
      continue;
    }
    const others = usesAggregate(map, rx) ? sumDbm(mine.filter(p => !p.intended && p.txId !== txId).filter(known).map(p => p.result.receivedPowerDbm)) : -Infinity;
    const threshold = remainingPowerDbm(rx.interferenceThresholdDbm - effectiveMarginDb(map, rx), others);
    const desired = effectiveObjective(map, rx) === 'desired' ? mine.filter(p => p.intended).filter(known) : [];
    const weakest = desired.reduce((power, p) => Math.min(power, p.result.receivedPowerDbm), Infinity);
    const ci = weakest === Infinity ? Infinity : remainingPowerDbm(weakest - rx.requiredCiDb, others);
    const max = tx.powerDbm + Math.min(threshold, ci) - target.result.receivedPowerDbm;
    if (max < range.maxDbm) {
      range.maxDbm = max; range.limitedBy = rx.id; range.limitKind = ci < threshold ? 'ci' : 'threshold';
    }
  }
  range.unknownPaths = unknown.size;
  return range;
}
