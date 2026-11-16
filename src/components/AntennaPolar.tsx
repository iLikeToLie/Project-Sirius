import { combineLossDb, horizontalTermDb, verticalTermDb } from '../lib/antenna';
import type { AntennaModel, AntennaPattern } from '../types';

const SIZE = 260;
const C = SIZE / 2;
const R = 104;

/** Dashed-ring spacing and span: rings every 10 dB down to the front-to-back cap (at least 10 dB). */
export const plotRangeDb = (frontToBackDb: number): number => Math.max(10, Math.ceil(frontToBackDb / 10) * 10);

/** Pattern of a model pointing north with no tilt, so the traces show the model's own shape. */
const patternOf = (model: AntennaModel): AntennaPattern => ({
  kind: model.kind, azimuthDeg: 0, downtiltDeg: 0, beamwidthDeg: model.beamwidthDeg,
  verticalBeamwidthDeg: model.verticalBeamwidthDeg, frontToBackDb: model.frontToBackDb,
});

/** Relative-gain loss (dB, 0 = boresight) of the horizontal cut at bearing `deg`; 0 for omni. */
export const horizontalCutDb = (model: AntennaModel, deg: number): number => {
  const p = patternOf(model);
  return p.kind === 'omni' ? 0 : combineLossDb(p, horizontalTermDb(p, deg), 0);
};
/** Relative-gain loss of the vertical cut at elevation `deg`; 0 for omni. */
export const verticalCutDb = (model: AntennaModel, deg: number): number => {
  const p = patternOf(model);
  return p.kind === 'omni' ? 0 : combineLossDb(p, 0, verticalTermDb(p, deg));
};

const radius = (lossDb: number, range: number) => R * Math.max(0, 1 - lossDb / range);
const path = (points: [number, number][], close: boolean) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (close ? 'Z' : '');

/** Horizontal trace (0° up, clockwise) and vertical trace (0° = horizon at right, up is positive), relative gain in dB. */
export function AntennaPolar({ model }: { model: AntennaModel }) {
  const range = plotRangeDb(model.frontToBackDb);
  const rings: number[] = [];
  for (let d = 0; d <= range; d += 10) rings.push(d);
  const horizontal: [number, number][] = [];
  for (let a = 0; a < 360; a += 2) {
    const r = radius(horizontalCutDb(model, a), range);
    const t = a * Math.PI / 180;
    horizontal.push([C + r * Math.sin(t), C - r * Math.cos(t)]);
  }
  const vertical: [number, number][] = [];
  for (let e = -90; e <= 90; e += 2) {
    const r = radius(verticalCutDb(model, e), range);
    const t = e * Math.PI / 180;
    vertical.push([C + r * Math.cos(t), C - r * Math.sin(t)]);
  }
  const label = `Antenna pattern for ${model.name}: ${model.kind === 'omni' ? 'omnidirectional, no pattern loss' : `horizontal beamwidth ${model.beamwidthDeg}°, vertical ${model.verticalBeamwidthDeg}°, front-to-back ${model.frontToBackDb} dB`}`;
  return (
    <figure className="antenna-polar">
      <svg role="img" aria-label={label} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {rings.map((d) => <circle key={d} cx={C} cy={C} r={radius(d, range)} className={d === 0 ? 'ring ring-outer' : 'ring'} />)}
        <line x1={C} y1={C - R} x2={C} y2={C + R} className="ring" />
        <line x1={C - R} y1={C} x2={C + R} y2={C} className="ring" />
        {rings.map((d) => <text key={d} x={C + 3} y={C - radius(d, range) + 10} className="plot-label">{d === 0 ? '0 dB' : `−${d}`}</text>)}
        <path d={path(horizontal, true)} className="trace trace-h" />
        <path d={path(vertical, false)} className="trace trace-v" />
        <text x={C} y={11} textAnchor="middle" className="plot-label">N 0°</text>
        <text x={SIZE - 3} y={C - 4} textAnchor="end" className="plot-label">0° horizon</text>
      </svg>
      <figcaption>
        <span className="key key-h" aria-hidden="true" />Horizontal <span className="key key-v" aria-hidden="true" />Vertical <small>Relative gain, dB below boresight</small>
      </figcaption>
    </figure>
  );
}
