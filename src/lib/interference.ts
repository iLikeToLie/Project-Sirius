import type { MapScenario, ScreeningStatus, Sensor } from '../types';
import { effectiveObjective, receiverSummary, worstLink, type PairResult } from './sensors';
import { formatNumber } from './rf';

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

export interface Mitigation {
  kind: 'power' | 'distance' | 'frequency' | 'polarization';
  txId: string;
  deltaDb: number;
  text: string;
  estimate: boolean;
}

export const PLACEMENT = { unsafe: 0, marginal: 1, safe: 2, recommended: 3, unknown: 255 } as const;
interface PlacementVictimPower { powerDbm: number; limitDbm: number; thresholdDbm: number }
interface PlacementServedPower { powerDbm: number; requiredDbm: number }

/** Equality at an allowance is permitted, matching the transmitter power bounds. */
export function placementClass(victims: PlacementVictimPower[], served: PlacementServedPower[]): number {
  if (victims.some(v => !Number.isFinite(v.powerDbm) || Number.isNaN(v.limitDbm) || Number.isNaN(v.thresholdDbm)) ||
      served.some(s => !Number.isFinite(s.powerDbm) || !Number.isFinite(s.requiredDbm))) return PLACEMENT.unknown;
  if (victims.some(v => v.powerDbm > v.thresholdDbm)) return PLACEMENT.unsafe;
  if (victims.some(v => v.powerDbm > v.limitDbm)) return PLACEMENT.marginal;
  return served.every(s => s.powerDbm >= s.requiredDbm) ? PLACEMENT.recommended : PLACEMENT.safe;
}

/** Fixed received-power allowance for a moving source. Its current path is deliberately excluded. */
export function placementAllowance(map: MapScenario, rx: Sensor, txId: string, pairs: PairResult[], marginDb: number): number {
  const fixed = pairs.filter(p => p.rxId === rx.id && p.txId !== txId);
  if (fixed.some(p => !p.elevationKnown || !p.result.valid || !Number.isFinite(p.result.receivedPowerDbm))) return NaN;
  const desired = effectiveObjective(map, rx) === 'desired' ? fixed.filter(p => p.intended) : [];
  const ci = desired.reduce((limit, p) => Math.min(limit, p.result.receivedPowerDbm - rx.requiredCiDb), Infinity);
  const limit = Math.min(rx.interferenceThresholdDbm - marginDb, ci);
  const powers = fixed.filter(p => !p.intended).map(p => p.result.receivedPowerDbm);
  if (usesAggregate(map, rx)) return remainingPowerDbm(limit, sumDbm(powers));
  // An already violated fixed path cannot be repaired by moving this transmitter.
  return powers.some(p => p > limit) ? -Infinity : limit;
}

/** Receiver-local advice, holding all other powers and settings fixed. No confident advice from incomplete paths. */
export function mitigations(map: MapScenario, assessment: ReceiverAssessment, pairs: PairResult[]): Mitigation[] {
  const rx = map.sensors.find(s => s.id === assessment.rxId && s.role === 'rx');
  const relevant = pairs.filter(p => p.rxId === assessment.rxId);
  if (!rx || assessment.unknownPaths > 0 || relevant.some(p => !p.elevationKnown || !p.result.valid || !Number.isFinite(p.result.receivedPowerDbm))) return [];

  let limit = assessment.limitDbm;
  let reason = 'protected limit';
  for (const link of assessment.links.filter(l => l.status === 'Interfered link')) {
    const desired = relevant.find(p => p.intended && p.txId === link.txId);
    if (!desired) continue;
    const ciLimit = desired.result.receivedPowerDbm - rx.requiredCiDb;
    if (ciLimit < limit) { limit = ciLimit; reason = 'C/I requirement'; }
  }
  if (!Number.isFinite(limit) || assessment.interferenceDbm <= limit) return [];
  const [strongest, ...rest] = assessment.contributors;
  if (!strongest) return [];
  const tx = map.sensors.find(s => s.id === strongest.txId && s.role === 'tx');
  if (!tx || !Number.isFinite(tx.powerDbm)) return [];
  const name = (id: string) => map.sensors.find(s => s.id === id)?.name ?? id;
  const others = assessment.aggregate ? sumDbm(rest.map(c => c.powerDbm)) : -Infinity;
  const allowed = remainingPowerDbm(limit, others);
  if (allowed === -Infinity) return [{
    kind: 'power', txId: tx.id, deltaDb: Infinity, estimate: false,
    text: `Reducing ${tx.name} alone cannot fix ${rx.name}'s ${reason}; other contributors already reach the limit. Reduce ${rest.map(c => name(c.txId)).join(', ')} as well.`,
  }];

  const reduction = strongest.powerDbm - allowed;
  if (!(reduction > 0) || !Number.isFinite(reduction)) return [];
  // Round both displayed values toward safety; retain full precision in deltaDb.
  const displayedReduction = Math.ceil(reduction * 100) / 100;
  const displayedPower = Math.floor((tx.powerDbm - displayedReduction) * 100) / 100;
  const remaining = !assessment.aggregate ? rest.filter(c => c.powerDbm > limit) : [];
  const note = remaining.length ? ` ${remaining.map(c => name(c.txId)).join(', ')} must also be reduced to clear this receiver's violation.` : '';
  const suggestions: Mitigation[] = [{
    kind: 'power', txId: tx.id, deltaDb: reduction, estimate: false,
    text: `Reduce ${tx.name} power by ${formatNumber(displayedReduction, 2)} dB (to ${formatNumber(displayedPower, 2)} dBm) for ${rx.name}'s ${reason}.${note}`,
  }];
  const path = relevant.find(p => p.txId === tx.id && !p.intended);
  const newDistance = path ? path.distanceM * 10 ** (reduction / 20) : NaN;
  if (path && path.distanceM > 0 && Number.isFinite(newDistance)) {
    const estimate = map.propagationModel === 'terrain';
    suggestions.push({
      kind: 'distance', txId: tx.id, deltaDb: reduction, estimate,
      text: `Increase ${tx.name} to ${rx.name} separation from ${formatNumber(path.distanceM, 2)} m to ${formatNumber(Math.ceil(newDistance * 100) / 100, 2)} m${estimate ? ' (free-space estimate; terrain may differ)' : ''}.${note}`,
    });
  }
  if (tx.polarization === rx.polarization && reduction <= map.crossPolarDiscriminationDb) {
    const orthogonal = { V: 'H', H: 'V', RHCP: 'LHCP', LHCP: 'RHCP' } as const;
    suggestions.push({
      kind: 'polarization', txId: tx.id, deltaDb: reduction, estimate: false,
      text: `Switch ${tx.name} polarization from ${tx.polarization} to ${orthogonal[tx.polarization]} for ${rx.name}'s ${reason}.${note}`,
    });
  }
  // Pair power already includes the current rejection. The replacement must supply
  // that isolation plus the additional reduction, rather than counting it twice.
  if (path) {
    const requiredRejection = path.rejectionDb + reduction;
    const nonOverlapMhz = (tx.bandwidthMhz + rx.bandwidthMhz) / 2;
    const step = rx.rejectionMask.find(s => s.rejectionDb >= requiredRejection);
    const offsetMhz = map.rejectionModel === 'simple'
      ? (rx.acrDb >= requiredRejection ? nonOverlapMhz : undefined)
      : (step ? Math.max(step.offsetMhz, nonOverlapMhz) : undefined);
    if (offsetMhz !== undefined) {
      const estimate = map.propagationModel === 'terrain';
      suggestions.push({
        kind: 'frequency', txId: tx.id, deltaDb: reduction, estimate,
        text: `Set ${tx.name} centre frequency at least ${formatNumber(Math.ceil(offsetMhz * 100) / 100, 2)} MHz above ${rx.name}'s centre frequency for its ${reason}${estimate ? ' (isolation estimate; terrain may differ)' : ''}.${note}`,
      });
    }
  }
  return suggestions;
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
