import type { DistanceSweepSettings, GainSweepSettings, LinkInputs, LinkObjective, PlacementScenario, ScreeningStatus } from '../types';

export const SPEED_OF_LIGHT_MPS = 299_792_458;

export interface LinkResult {
  valid: boolean;
  wavelengthM: number;
  fsplDb: number;
  totalLossDb: number;
  receivedPowerDbm: number;
  receivedPowerMw: number;
  linkMarginDb: number;
  interferenceMarginDb: number;
  status: ScreeningStatus;
}

const finite = (values: number[]) => values.every(Number.isFinite);

type LinkBudgetInputs = Omit<LinkInputs, 'scenarioName' | 'txId' | 'rxId'>;
type SweepInputs = Omit<LinkBudgetInputs, 'distanceM'>;

export function isValidLinkInput(input: LinkBudgetInputs): boolean {
  return finite([
    input.transmitPowerDbm, input.txGainDbi, input.rxGainDbi, input.frequencyGhz, input.distanceM,
    input.txLossDb, input.rxLossDb, input.polarizationLossDb, input.obstructionLossDb, input.otherLossDb,
    input.sensitivityDbm, input.interferenceThresholdDbm, input.fadeMarginTargetDb,
  ]) && input.frequencyGhz > 0 && input.distanceM > 0 && input.fadeMarginTargetDb >= 0 && [
    input.txLossDb, input.rxLossDb, input.polarizationLossDb, input.obstructionLossDb, input.otherLossDb,
  ].every((loss) => loss >= 0);
}

export function wavelengthM(frequencyGhz: number): number {
  return SPEED_OF_LIGHT_MPS / (frequencyGhz * 1e9);
}

export function fsplDb(frequencyGhz: number, distanceM: number): number {
  return 32.44 + 20 * Math.log10(frequencyGhz * 1000) + 20 * Math.log10(distanceM / 1000);
}

export function totalLossDb(input: Pick<LinkInputs, 'txLossDb' | 'rxLossDb' | 'polarizationLossDb' | 'obstructionLossDb' | 'otherLossDb'>): number {
  return input.txLossDb + input.rxLossDb + input.polarizationLossDb + input.obstructionLossDb + input.otherLossDb;
}

export function screeningStatus(receivedPowerDbm: number, sensitivityDbm: number, interferenceThresholdDbm: number, fadeMarginTargetDb: number, objective: LinkObjective = 'avoidance'): ScreeningStatus {
  if (!finite([receivedPowerDbm, sensitivityDbm, interferenceThresholdDbm, fadeMarginTargetDb])) return 'Invalid input';
  if (objective === 'desired') {
    if (receivedPowerDbm < sensitivityDbm) return 'No link';
    return receivedPowerDbm - sensitivityDbm >= fadeMarginTargetDb ? 'Acceptable link' : 'Weak link';
  }
  if (receivedPowerDbm >= interferenceThresholdDbm) return 'Possible interference';
  return 'Below interference threshold';
}

export function calculateLink(input: LinkBudgetInputs, objective: LinkObjective = 'avoidance'): LinkResult {
  if (!isValidLinkInput(input)) {
    return { valid: false, wavelengthM: NaN, fsplDb: NaN, totalLossDb: NaN, receivedPowerDbm: NaN, receivedPowerMw: NaN, linkMarginDb: NaN, interferenceMarginDb: NaN, status: 'Invalid input' };
  }
  const pathLoss = fsplDb(input.frequencyGhz, input.distanceM);
  const losses = totalLossDb(input);
  const power = input.transmitPowerDbm + input.txGainDbi + input.rxGainDbi - pathLoss - losses;
  return {
    valid: true,
    wavelengthM: wavelengthM(input.frequencyGhz),
    fsplDb: pathLoss,
    totalLossDb: losses,
    receivedPowerDbm: power,
    receivedPowerMw: 10 ** (power / 10),
    linkMarginDb: power - input.sensitivityDbm,
    interferenceMarginDb: input.interferenceThresholdDbm - power,
    status: screeningStatus(power, input.sensitivityDbm, input.interferenceThresholdDbm, input.fadeMarginTargetDb, objective),
  };
}

function steppedValues(min: number, max: number, step: number, maxPoints: number): number[] {
  if (!finite([min, max, step]) || step <= 0 || max < min) return [];
  const count = Math.min(Math.floor((max - min) / step) + 1, maxPoints);
  return Array.from({ length: count }, (_, index) => min + index * step);
}

export function distanceSweep(input: SweepInputs, settings: DistanceSweepSettings) {
  return steppedValues(settings.minDistanceM, settings.maxDistanceM, settings.stepM, 1000).map((distanceM) => {
    const result = calculateLink({ ...input, distanceM });
    return { distanceM, receivedPowerDbm: result.receivedPowerDbm };
  });
}

export function gainSweep(input: SweepInputs, settings: GainSweepSettings) {
  return steppedValues(settings.minGainDbi, settings.maxGainDbi, settings.stepDb, 301).map((gainDbi) => ({
    gainDbi,
    receivedPowerDbm: settings.distancesM.map((distanceM) => calculateLink({
      ...input,
      distanceM,
      ...(settings.gainToSweep === 'tx' ? { txGainDbi: gainDbi } : { rxGainDbi: gainDbi }),
    }).receivedPowerDbm) as [number, number, number],
  }));
}

export interface PlacementResult extends PlacementScenario {
  totalLossDb: number;
  receivedPowerDbm: number;
  linkMarginDb: number;
  interferenceMarginDb: number;
  rank: number;
  status: ScreeningStatus;
}

export function calculatePlacements(input: LinkInputs, rows: PlacementScenario[], objective: LinkObjective = 'avoidance'): PlacementResult[] {
  const calculated = rows.map((row) => {
    const result = calculateLink({
      ...input,
      distanceM: row.distanceM,
      txGainDbi: row.txGainDbi,
      rxGainDbi: row.rxGainDbi,
      txLossDb: row.txLossDb,
      rxLossDb: row.rxLossDb,
      polarizationLossDb: row.polarizationLossDb,
      obstructionLossDb: row.obstructionLossDb,
      otherLossDb: row.otherLossDb,
    }, objective);
    return {
      ...row,
      totalLossDb: result.totalLossDb,
      receivedPowerDbm: result.receivedPowerDbm,
      linkMarginDb: result.linkMarginDb,
      interferenceMarginDb: result.interferenceMarginDb,
      status: result.status,
    };
  });
  return calculated.map((row) => ({
    ...row,
    rank: Number.isFinite(row.receivedPowerDbm) ? 1 + calculated.filter((candidate) => candidate.receivedPowerDbm > row.receivedPowerDbm).length : 0,
  }));
}

export const formatNumber = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
