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
