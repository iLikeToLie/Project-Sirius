import type { LinkObjective } from '../types';

/** Strong (red) to weak (blue), like the CloudRF signal gradients; [position 0..1 from weak, r, g, b]. */
const STOPS: [number, number, number, number][] = [
  [0, 40, 70, 190], [0.15, 40, 190, 200], [0.35, 40, 170, 70], [0.55, 235, 220, 50], [0.75, 240, 140, 30], [1, 205, 30, 30],
];
export const SIGNAL_ALPHA = 165;

/** RGBA for a received power; transparent when unknown or below `lo`, saturated at `hi`. */
export function signalColour(powerDbm: number, lo: number, hi: number): [number, number, number, number] {
  if (!Number.isFinite(powerDbm) || powerDbm < lo) return [0, 0, 0, 0];
  const t = Math.min(1, (powerDbm - lo) / (hi - lo));
  let k = 1;
  while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
  const [t0, r0, g0, b0] = STOPS[k - 1], [t1, r1, g1, b1] = STOPS[k], f = (t - t0) / (t1 - t0);
  return [Math.round(r0 + (r1 - r0) * f), Math.round(g0 + (g1 - g0) * f), Math.round(b0 + (b1 - b0) * f), SIGNAL_ALPHA];
}

/** The dBm span the gradient covers, anchored on the thresholds the objective cares about. */
export function signalRange(t: { sensitivityDbm: number; fadeMarginTargetDb: number; interferenceThresholdDbm: number }, objective: LinkObjective, showAll: boolean): { lo: number; hi: number } {
  const desired = { lo: t.sensitivityDbm - 10, hi: t.sensitivityDbm + t.fadeMarginTargetDb + 40 };
  const avoidance = { lo: t.interferenceThresholdDbm - 30, hi: t.interferenceThresholdDbm + 30 };
  if (showAll) return { lo: Math.min(desired.lo, avoidance.lo), hi: Math.max(desired.hi, avoidance.hi) };
  return objective === 'desired' ? desired : avoidance;
}
