import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { combineLossDb, horizontalTermDb, resolveAntenna, verticalTermDb } from '../lib/antenna';
import type { AntennaModel, AntennaPattern, Sensor } from '../types';

const SIZE = 260;
const C = SIZE / 2;
const R = 104;

export type Cut = [number, number][];
export const MAX_LOSS_DB = 60;
export const MAX_POINTS = 721;

/** Dashed-ring spacing and span: rings every 10 dB down to the front-to-back cap (at least 10 dB). */
export const plotRangeDb = (frontToBackDb: number): number => Math.max(10, Math.ceil(frontToBackDb / 10) * 10);

/** The model's resolved pattern pointing north with no tilt, so the traces show the model's own shape. */
const patternOf = (model: AntennaModel): AntennaPattern =>
  resolveAntenna({ antennaModels: [model] }, { antenna: { modelId: model.id, azimuthDeg: 0, downtiltDeg: 0, aimAtId: null } } as Sensor);

const hLoss = (p: AntennaPattern, deg: number) => p.kind === 'omni' ? 0 : combineLossDb(p, horizontalTermDb(p, deg), 0);
const vLoss = (p: AntennaPattern, deg: number) => p.kind === 'omni' ? 0 : combineLossDb(p, 0, verticalTermDb(p, deg));

/** Relative-gain loss (dB, 0 = boresight) of the horizontal cut at bearing `deg`; 0 for omni. */
export const horizontalCutDb = (model: AntennaModel, deg: number): number => hLoss(patternOf(model), deg);
/** Relative-gain loss of the vertical cut at elevation `deg`; 0 for omni. */
export const verticalCutDb = (model: AntennaModel, deg: number): number => vLoss(patternOf(model), deg);

// ---- Point-table edits (pure, so the plot, the table and the tests share them) ----

const SAME = 1e-9;
const round1 = (v: number) => Math.round(v * 10) / 10;
/** Angle that mirrors `a` about boresight in a horizontal cut. */
export const mirrorAngle = (a: number): number => { const m = (360 - a) % 360; return m < 0 ? m + 360 : m; };
const sortCut = (points: Cut): Cut => [...points].sort((x, y) => x[0] - y[0]);
const hasAngle = (points: Cut, angle: number) => points.some(([a]) => Math.abs(a - angle) < SAME);

/** Sets the loss at `angle` (and at its mirror when `symmetric`). */
export function withLoss(points: Cut, angle: number, loss: number, symmetric = false): Cut {
  const mirror = symmetric ? mirrorAngle(angle) : angle;
  return points.map(([a, l]) => Math.abs(a - angle) < SAME || Math.abs(a - mirror) < SAME ? [a, loss] : [a, l]);
}
/** Removes the point at `angle` (and its mirror when `symmetric`), keeping at least two points. */
export function withoutPoint(points: Cut, angle: number, symmetric = false): Cut {
  const mirror = symmetric ? mirrorAngle(angle) : angle;
  const next = points.filter(([a]) => Math.abs(a - angle) >= SAME && Math.abs(a - mirror) >= SAME);
  return next.length >= 2 ? next : points;
}
/** Adds a point (and its mirror when `symmetric`) unless the angle exists or the table is full; the result stays sorted. */
export function withPoint(points: Cut, angle: number, loss: number, symmetric = false): Cut {
  const add: Cut = [];
  if (!hasAngle(points, angle)) add.push([angle, loss]);
  const mirror = symmetric ? mirrorAngle(angle) : angle;
  if (symmetric && Math.abs(mirror - angle) >= SAME && !hasAngle(points, mirror)) add.push([mirror, loss]);
  if (!add.length || points.length + add.length > MAX_POINTS) return points;
  return sortCut([...points, ...add]);
}
/** Moves the point at `from` to `to` (and its mirror when `symmetric`); null when `to` is taken. */
export function withAngle(points: Cut, from: number, to: number, symmetric = false): Cut | null {
  const mirrorFrom = symmetric ? mirrorAngle(from) : from, mirrorTo = symmetric ? mirrorAngle(to) : to;
  const moveMirror = symmetric && Math.abs(mirrorFrom - from) >= SAME && hasAngle(points, mirrorFrom);
  const rest = points.filter(([a]) => Math.abs(a - from) >= SAME && !(moveMirror && Math.abs(a - mirrorFrom) < SAME));
  if (hasAngle(rest, to) || (moveMirror && (hasAngle(rest, mirrorTo) || Math.abs(to - mirrorTo) < SAME))) return null;
  const loss = points.find(([a]) => Math.abs(a - from) < SAME)?.[1] ?? 0;
  const mirrorLoss = points.find(([a]) => Math.abs(a - mirrorFrom) < SAME)?.[1] ?? loss;
  return sortCut([...rest, [to, loss], ...(moveMirror ? [[mirrorTo, mirrorLoss] as [number, number]] : [])]);
}
/** True when every point has a partner at 360° − angle with the same loss (within 0.05 dB). */
export function isSymmetric(points: Cut): boolean {
  return points.every(([a, l]) => { const m = mirrorAngle(a); const partner = points.find(([b]) => Math.abs(b - m) < SAME); return !!partner && Math.abs(partner[1] - l) <= 0.05; });
}
/** Loss of a cut at `angle` by linear interpolation: horizontal wraps at 360°, vertical clamps at the ends. */
export function interpLoss(points: Cut, angle: number, wrap: boolean): number {
  const s = sortCut(points);
  if (!s.length) return 0;
  let list = s, a = angle;
  if (wrap) {
    a = ((angle % 360) + 360) % 360;
    list = [[s[s.length - 1][0] - 360, s[s.length - 1][1]], ...s, [s[0][0] + 360, s[0][1]]];
  } else {
    if (angle <= s[0][0]) return s[0][1];
    if (angle >= s[s.length - 1][0]) return s[s.length - 1][1];
  }
  const i = list.findIndex(([x]) => x > a);
  const [a0, l0] = list[i - 1], [a1, l1] = list[i];
  return l0 + (l1 - l0) * (a - a0) / (a1 - a0);
}
/** Loss implied by a pointer `radiusPx` from the centre (viewBox px), snapped to 0.5 dB (0.1 with Shift) and held in 0..`range`. */
export function lossFromRadius(radiusPx: number, range: number, fine = false): number {
  const step = fine ? 0.1 : 0.5;
  const raw = (1 - radiusPx / R) * range;
  return Math.min(Math.min(range, MAX_LOSS_DB), Math.max(0, round1(Math.round(raw / step) * step)));
}
/** Loss after an arrow-key nudge: ↑ adds 0.5 dB (0.1 with Shift), ↓ subtracts; null for other keys. */
export function nudgedLoss(loss: number, key: string, shift: boolean): number | null {
  const step = shift ? 0.1 : 0.5;
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
  return Math.min(MAX_LOSS_DB, Math.max(0, round1(loss + (key === 'ArrowUp' ? step : -step))));
}

const radius = (lossDb: number, range: number) => R * Math.max(0, 1 - lossDb / range);
const path = (points: [number, number][], close: boolean) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (close ? 'Z' : '');
const hXY = (a: number, r: number): [number, number] => { const t = a * Math.PI / 180; return [C + r * Math.sin(t), C - r * Math.cos(t)]; };
const vXY = (e: number, r: number): [number, number] => { const t = e * Math.PI / 180; return [C + r * Math.cos(t), C - r * Math.sin(t)]; };

export interface PolarEdit { cut: 'h' | 'v'; symmetric: boolean; onChange: (points: Cut) => void }

/** Horizontal trace (0° up, clockwise) and vertical trace (0° = horizon at right, up is positive), relative gain in dB. With `edit`, the active cut shows draggable loss handles. */
export function AntennaPolar({ model, edit: requestedEdit, compact = false }: { model: AntennaModel; edit?: PolarEdit; compact?: boolean }) {
  const edit = compact ? undefined : requestedEdit;
  const displaySize = compact ? 140 : SIZE;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragAngle = useRef<number | null>(null);
  const draftRef = useRef<Cut | null>(null);
  const [draft, setDraftState] = useState<Cut | null>(null);
  const setDraft = (next: Cut | null) => { draftRef.current = next; setDraftState(next); };

  const key = edit?.cut === 'v' ? 'vertical' : 'horizontal';
  const committed = edit && model.pattern ? model.pattern[key] : undefined;
  const points = draft ?? committed;
  const shown: AntennaModel = edit && draft && model.pattern ? { ...model, pattern: { ...model.pattern, [key]: draft } } : model;
  const tableMax = model.pattern ? Math.max(0, ...model.pattern.horizontal.map((p) => p[1]), ...model.pattern.vertical.map((p) => p[1])) : 0;
  const range = plotRangeDb(model.kind === 'custom' ? Math.max(model.frontToBackDb, tableMax) : model.frontToBackDb);
  const rings: number[] = [];
  for (let d = 0; d <= range; d += 10) rings.push(d);
  const p = patternOf(shown);
  const horizontal: [number, number][] = [];
  for (let a = 0; a < 360; a += 2) horizontal.push(hXY(a, radius(hLoss(p, a), range)));
  const vertical: [number, number][] = [];
  for (let e = -90; e <= 90; e += 2) vertical.push(vXY(e, radius(vLoss(p, e), range)));
  const label = `Antenna pattern for ${model.name}: ${model.kind === 'omni' ? 'omnidirectional, no pattern loss' : `horizontal beamwidth ${model.beamwidthDeg}°, vertical ${model.verticalBeamwidthDeg}°, front-to-back ${model.frontToBackDb} dB`}`;
  const cutName = key === 'horizontal' ? 'Horizontal' : 'Vertical';

  const toView = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return [(e.clientX - rect.left) * SIZE / rect.width, (e.clientY - rect.top) * SIZE / rect.height];
  };
  const onDown = (angle: number) => (e: PointerEvent<SVGCircleElement>) => {
    if (!committed) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragAngle.current = angle;
  };
  const onMove = (e: PointerEvent<SVGCircleElement>) => {
    if (dragAngle.current === null || !points || !edit) return;
    const xy = toView(e);
    if (!xy) return;
    setDraft(withLoss(draftRef.current ?? committed ?? points, dragAngle.current, lossFromRadius(Math.hypot(xy[0] - C, xy[1] - C), range, e.shiftKey), edit.symmetric && key === 'horizontal'));
  };
  const onUp = () => {
    dragAngle.current = null;
    const done = draftRef.current;
    setDraft(null);
    if (done && edit) edit.onChange(done);
  };
  const onKey = (angle: number, loss: number) => (e: KeyboardEvent<SVGCircleElement>) => {
    if (!edit || !committed) return;
    const sym = edit.symmetric && key === 'horizontal';
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); edit.onChange(withoutPoint(committed, angle, sym)); return; }
    const next = nudgedLoss(loss, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    edit.onChange(withLoss(committed, angle, next, sym));
  };
  const onDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!edit || !committed || (e.target as Element).classList.contains('handle')) return;
    const xy = toView(e);
    if (!xy) return;
    const sym = edit.symmetric && key === 'horizontal';
    let angle: number;
    if (key === 'horizontal') angle = Math.round(((Math.atan2(xy[0] - C, C - xy[1]) * 180 / Math.PI) + 360) % 360) % 360;
    else { angle = Math.round(Math.atan2(C - xy[1], xy[0] - C) * 180 / Math.PI); if (angle < -90 || angle > 90) return; }
    edit.onChange(withPoint(committed, angle, round1(interpLoss(committed, angle, key === 'horizontal')), sym));
  };

  return (
    <figure className={compact ? 'antenna-polar compact' : 'antenna-polar'}>
      <svg ref={svgRef} role="img" aria-label={label} viewBox={`0 0 ${SIZE} ${SIZE}`} width={displaySize} height={displaySize} onDoubleClick={edit ? onDouble : undefined}>
        {rings.map((d) => <circle key={d} cx={C} cy={C} r={radius(d, range)} className={d === 0 ? 'ring ring-outer' : 'ring'} />)}
        <line x1={C} y1={C - R} x2={C} y2={C + R} className="ring" />
        <line x1={C - R} y1={C} x2={C + R} y2={C} className="ring" />
        {!compact && rings.map((d) => <text key={d} x={C + 3} y={C - radius(d, range) + 10} className="plot-label">{d === 0 ? '0 dB' : `−${d}`}</text>)}
        <path d={path(horizontal, true)} className="trace trace-h" />
        <path d={path(vertical, false)} className="trace trace-v" />
        {!compact && <>
          <text x={C} y={11} textAnchor="middle" className="plot-label">N 0°</text>
          <text x={SIZE - 3} y={C - 4} textAnchor="end" className="plot-label">0° horizon</text>
        </>}
        {edit && points && points.map(([angle, loss]) => {
          const [x, y] = (key === 'horizontal' ? hXY : vXY)(angle, radius(loss, range));
          return <circle key={angle} cx={x} cy={y} r={5} tabIndex={0} role="slider" className={`handle handle-${key === 'horizontal' ? 'h' : 'v'}`}
            aria-label={`${cutName} point at ${angle}°`} aria-valuemin={0} aria-valuemax={Math.min(range, MAX_LOSS_DB)} aria-valuenow={loss} aria-valuetext={`${loss} dB loss`}
            onPointerDown={onDown(angle)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey(angle, loss)} />;
        })}
      </svg>
      {!compact && <figcaption>
        <span className="key key-h" aria-hidden="true" />Horizontal <span className="key key-v" aria-hidden="true" />Vertical <small>Relative gain, dB below boresight</small>
        {edit && <small>Drag a handle to change loss, or focus it and press ↑ / ↓ (Shift for 0.1 dB) or Delete. Double-click the plot to add a point.</small>}
      </figcaption>}
    </figure>
  );
}
