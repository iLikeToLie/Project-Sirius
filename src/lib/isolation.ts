import type { LinkInputs, RejectionStep, Sensor } from '../types';

/** Fixed XPD for orthogonal antennas; ideal linear/circular coupling loses half the power. */
export function polarizationMismatchDb(a: Sensor['polarization'], b: Sensor['polarization'], xpdDb: number): number {
  if (a === b) return 0;
  const linear = (p: Sensor['polarization']) => p === 'V' || p === 'H';
  return linear(a) === linear(b) ? xpdDb : 10 * Math.log10(2);
}

/** Thermal noise at -174 dBm/Hz, integrated across the receiver bandwidth. */
export const noiseFloorDbm = (bandwidthMhz: number, noiseFigureDb: number): number => -174 + 10 * Math.log10(bandwidthMhz * 1e6) + noiseFigureDb;

export const defaultRejectionMask = (): RejectionStep[] => [
  { offsetMhz: 20, rejectionDb: 30 }, { offsetMhz: 40, rejectionDb: 45 }, { offsetMhz: 60, rejectionDb: 60 },
];

export function isRejectionMask(value: unknown): value is RejectionStep[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((s, i) =>
    s !== null && typeof s === 'object' && Number.isFinite(s.offsetMhz) && s.offsetMhz > 0 &&
    Number.isFinite(s.rejectionDb) && s.rejectionDb >= 0 &&
    (i === 0 || (s.offsetMhz > value[i - 1].offsetMhz && s.rejectionDb >= value[i - 1].rejectionDb)));
}

export const centreMhz = (s: Sensor, shared: LinkInputs) => 1000 * (s.frequencyGhz === 'default' ? shared.frequencyGhz : s.frequencyGhz);

/** Rectangular in-band overlap; leakage outside the overlapping band is omitted. */
export function frequencyRejectionDb(
  tx: { fMhz: number; bwMhz: number },
  rx: { fMhz: number; bwMhz: number; acrDb: number; mask: RejectionStep[] },
  model: 'simple' | 'mask',
): number {
  const overlap = Math.max(0, Math.min(tx.fMhz + tx.bwMhz / 2, rx.fMhz + rx.bwMhz / 2) - Math.max(tx.fMhz - tx.bwMhz / 2, rx.fMhz - rx.bwMhz / 2));
  if (overlap > 0) return Math.max(0, -10 * Math.log10(Math.min(1, overlap / tx.bwMhz)));
  if (model === 'simple') return rx.acrDb;
  const offset = Math.abs(tx.fMhz - rx.fMhz);
  let rejection = rx.mask[0].rejectionDb;
  for (const step of rx.mask) {
    if (step.offsetMhz > offset) break;
    rejection = step.rejectionDb;
  }
  return rejection;
}
