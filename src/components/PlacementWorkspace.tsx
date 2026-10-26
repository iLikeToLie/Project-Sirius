import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Antenna, Maximize2, Minus, Plus, RadioTower, Signal, Target } from 'lucide-react';
import type { Segment } from '../lib/contours';
import { antennaElevationM, groundSeparationM, separation3dM, solveTxForDistance } from '../lib/linkGeometry';
import { calculateLink, formatNumber } from '../lib/rf';
import { withWorkspace } from '../lib/state';
import { groundElevationM, WORLD_LIMIT_M } from '../lib/terrain';
import { flatGroundRadiusM, thresholdReferences, thresholdSlantRangeM, type ThresholdId } from '../lib/thresholds';
import {
  fitView, formatFrequency, FREQUENCY_SLIDER_MAX, frequencyFromSlider, gridStep, parseFrequency, screenToWorld, sliderFromFrequency,
  snapToGrid, viewBounds, worldToScreen, zoomAt, type ScreenPoint, type Size, type View, type WorldPoint,
} from '../lib/viewport';
import type { AntennaPlacement, AppState, LinkInputs, LinkWorkspace, TerrainSettings } from '../types';
import { useFieldWorker } from './useFieldWorker';
import { SignalCanvas } from './SignalCanvas';
import { CommitField, Metric, NumberField, StatusBadge, statusTone } from './ui';

type AntennaId = 'tx' | 'rx';
type Drag =
  | { kind: 'antenna'; id: AntennaId; pointerId: number; offset: WorldPoint }
  | { kind: 'pan'; pointerId: number; start: ScreenPoint; view: View };

const SNAP_M = 25;
const MIN_VIEW_M = 20;
const MAX_VIEW_M = 2 * WORLD_LIMIT_M;
const THRESHOLD_DASH: Record<ThresholdId, string> = { sensitivity: '3 6', required: '10 5', interference: '2 4 10 4' };

// The camera is presentation only; remembering it keeps the view stable when switching tabs.
let rememberedView: View | null = null;

const clampView = (view: View): View => ({ ...view, widthM: Math.min(MAX_VIEW_M, Math.max(MIN_VIEW_M, view.widthM)) });
const clampWorld = (value: number) => Math.min(WORLD_LIMIT_M, Math.max(-WORLD_LIMIT_M, value));
const formatDistance = (metres: number) => !Number.isFinite(metres) ? '—' : Math.abs(metres) >= 1000 ? `${formatNumber(metres / 1000, 2)} km` : `${formatNumber(metres, 1)} m`;

function segmentsPath(segments: Segment[], toScreen: (p: WorldPoint) => ScreenPoint) {
  let d = '';
  for (const [x1, y1, x2, y2] of segments) {
    const a = toScreen({ xM: x1, yM: y1 });
    const b = toScreen({ xM: x2, yM: y2 });
    d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

function FrequencyControl({ frequencyGhz, onChange }: { frequencyGhz: number; onChange: (ghz: number) => void }) {
  const valid = Number.isFinite(frequencyGhz) && frequencyGhz >= 0.001 && frequencyGhz <= 100;
  const [text, setText] = useState(valid ? formatFrequency(frequencyGhz) : '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!editing && valid) setText(formatFrequency(frequencyGhz)); }, [frequencyGhz, editing, valid]);
  const apply = () => {
    setEditing(false);
    const ghz = parseFrequency(text);
    if (!Number.isFinite(ghz) || ghz < 0.001 || ghz > 100) {
      setError('Enter 1 MHz to 100 GHz, e.g. 433 MHz or 5.8 GHz.');
      if (valid) setText(formatFrequency(frequencyGhz));
      return;
    }
    setError('');
    onChange(ghz);
  };
  return (
    <div className="frequency-control">
      <label className="field">
        <span>Operating frequency</span>
        <input
          type="text" value={text} aria-invalid={error ? true : undefined}
          onFocus={() => setEditing(true)} onChange={(event) => setText(event.target.value)} onBlur={apply}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }}
        />
      </label>
      <input
        type="range" min={0} max={FREQUENCY_SLIDER_MAX} step={1} aria-label="Operating frequency, logarithmic"
        value={valid ? sliderFromFrequency(frequencyGhz) : 0} aria-valuetext={valid ? formatFrequency(frequencyGhz) : 'Invalid frequency'}
        onChange={(event) => { setError(''); onChange(Number(frequencyFromSlider(Number(event.target.value)).toPrecision(6))); }}
      />
      <div className="range-scale"><span>1 MHz</span><span>1 GHz</span><span>100 GHz</span></div>
      {error && <small className="field-error" role="alert">{error}</small>}
    </div>
  );
}

export function PlacementWorkspace({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(rememberedView);
  const [draft, setDraft] = useState<LinkWorkspace | null>(null);
  const [selected, setSelected] = useState<AntennaId>('tx');
  const [snap, setSnap] = useState(false);
  const [editor, setEditor] = useState<{ text: string; error: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [panning, setPanning] = useState(false);

  const ws = draft ?? state.workspace;
  const { terrain } = ws;
  const separation = separation3dM(ws);
  const result = useMemo(() => calculateLink({ ...state.inputs, distanceM: separation }, state.linkObjective), [state.inputs, separation, state.linkObjective]);
  const tone = statusTone(result.status);
  const references = thresholdReferences(state.inputs, state.linkObjective).map((reference) => {
    const slantRangeM = thresholdSlantRangeM(state.inputs, reference.levelDbm);
    return { ...reference, slantRangeM, flatRadiusM: flatGroundRadiusM(slantRangeM, ws.tx.aglM - ws.rx.aglM) };
  });

  useEffect(() => { rememberedView = view; }, [view]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      sizeRef.current = next;
      setSize(next);
      setView((current) => current ?? (next.width > 0 ? clampView(fitView(next, [state.workspace.tx, state.workspace.rx])) : null));
    });
    observer.observe(stage);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((current) => current && clampView(zoomAt(current, sizeRef.current, pointer, event.deltaY > 0 ? 1.15 : 1 / 1.15)));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => { observer.disconnect(); stage.removeEventListener('wheel', onWheel); };
    // Initial fit uses the geometry at mount only.
  }, []);

  const dragging = draft !== null || panning;
  const fieldRequest = terrain.enabled && view && size.width > 0 ? (() => {
    const bounds = viewBounds(view, size);
    const padX = (bounds.maxX - bounds.minX) * 0.04;
    const padY = (bounds.maxY - bounds.minY) * 0.04;
    const pixelsPerCell = dragging ? 14 : 5;
    return {
      workspace: ws,
      inputs: state.inputs,
      objective: state.linkObjective,
      bounds: { minX: bounds.minX - padX, maxX: bounds.maxX + padX, minY: bounds.minY - padY, maxY: bounds.maxY + padY },
      cols: Math.max(16, Math.ceil(size.width / pixelsPerCell)),
      rows: Math.max(10, Math.ceil(size.height / pixelsPerCell)),
    };
  })() : null;
  const { result: fields, refining } = useFieldWorker(fieldRequest);

  const commit = (next: LinkWorkspace) => setState((current) => withWorkspace(current, next));
  const updateTerrain = (patch: Partial<TerrainSettings>): undefined => { commit({ ...state.workspace, terrain: { ...state.workspace.terrain, ...patch } }); return undefined; };
  const setInput = <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => setState((current) => ({ ...current, inputs: { ...current.inputs, [key]: value } }));
  const updateAntenna = (id: AntennaId, patch: Partial<AntennaPlacement>): undefined => { commit({ ...state.workspace, [id]: { ...state.workspace[id], ...patch } }); return undefined; };

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startAntennaDrag = (id: AntennaId) => (event: PointerEvent<SVGGElement>) => {
    if (!view || event.button !== 0) return;
    event.stopPropagation();
    setSelected(id);
    const pointer = screenToWorld(view, size, localPoint(event));
    drag.current = { kind: 'antenna', id, pointerId: event.pointerId, offset: { xM: state.workspace[id].xM - pointer.xM, yM: state.workspace[id].yM - pointer.yM } };
    (event.currentTarget.ownerSVGElement ?? event.currentTarget).setPointerCapture(event.pointerId);
    setDraft(state.workspace);
  };

  const startPan = (event: PointerEvent<SVGSVGElement>) => {
    if (!view || event.button !== 0) return;
    drag.current = { kind: 'pan', pointerId: event.pointerId, start: localPoint(event), view };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !view) return;
    const point = localPoint(event);
    if (active.kind === 'pan') {
      const metresPerPixel = active.view.widthM / size.width;
      setView({ ...active.view, cx: active.view.cx - (point.x - active.start.x) * metresPerPixel, cy: active.view.cy + (point.y - active.start.y) * metresPerPixel });
      return;
    }
    const pointer = screenToWorld(view, size, point);
    let next = { xM: pointer.xM + active.offset.xM, yM: pointer.yM + active.offset.yM };
    if (snap) next = snapToGrid(next, SNAP_M);
    setDraft((current) => {
      const base = current ?? state.workspace;
      return { ...base, [active.id]: { ...base[active.id], xM: clampWorld(next.xM), yM: clampWorld(next.yM) } };
    });
  };

  const endDrag = (cancelled: boolean) => (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (active.kind === 'antenna') {
      if (!cancelled && draft) {
        commit(draft);
        setAnnouncement(`${active.id === 'tx' ? 'Transmitter' : 'Receiver'} placed. Separation ${formatDistance(separation3dM(draft))}.`);
      }
      setDraft(null);
    }
  };

  const nudge = (id: AntennaId) => (event: KeyboardEvent<SVGGElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const p = state.workspace[id];
    updateAntenna(id, { xM: clampWorld(p.xM + delta[0]), yM: clampWorld(p.yM + delta[1]) });
  };

  const fitLink = () => size.width > 0 && setView(clampView(fitView(size, [ws.tx, ws.rx])));
  const fitThresholds = () => {
    // On terrain every ground boundary lies within its slant range of Tx, so the slant range bounds it.
    const radii = references.map((r) => terrain.enabled ? r.slantRangeM : r.flatRadiusM).filter(Number.isFinite);
    if (!radii.length || size.width === 0) return;
    const radius = Math.max(...radii);
    setView(clampView({ cx: ws.tx.xM, cy: ws.tx.yM, widthM: Math.max(200, 2.3 * radius, (2.3 * radius * size.width) / size.height) }));
  };
  const zoomBy = (factor: number) => view && setView(clampView(zoomAt(view, size, { x: size.width / 2, y: size.height / 2 }, factor)));

  const applySeparation = (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    const solved = solveTxForDistance(state.workspace, editor.text.trim() === '' ? NaN : Number(editor.text));
    if (!solved.ok) { setEditor({ ...editor, error: solved.reason }); return; }
    const next = { ...state.workspace, tx: solved.tx };
    commit(next);
    setEditor(null);
    setAnnouncement(`Transmitter moved. Separation ${formatDistance(separation3dM(next))}.`);
    if (view) {
      const b = viewBounds(view, size);
      if (solved.tx.xM < b.minX || solved.tx.xM > b.maxX || solved.tx.yM < b.minY || solved.tx.yM > b.maxY) setView(clampView(fitView(size, [solved.tx, next.rx])));
    }
  };

  const toScreen = (p: WorldPoint) => view ? worldToScreen(view, size, p) : { x: 0, y: 0 };
  const txScreen = toScreen(ws.tx);
  const rxScreen = toScreen(ws.rx);
  const mid = { x: (txScreen.x + rxScreen.x) / 2, y: (txScreen.y + rxScreen.y) / 2 };
  const scale = view ? size.width / view.widthM : 1;
  const selectedPlacement = ws[selected];
  const groundElevation = groundElevationM(terrain, selectedPlacement.xM, selectedPlacement.yM);
  const fieldThreshold = (id: ThresholdId) => fields?.thresholds.find((t) => t.id === id);

  const grid = (() => {
    if (!view || size.width === 0) return null;
    const step = gridStep(view.widthM, size.width);
    const b = viewBounds(view, size);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = Math.ceil(b.minX / step) * step; x <= b.maxX; x += step) xs.push(x);
    for (let y = Math.ceil(b.minY / step) * step; y <= b.maxY; y += step) ys.push(y);
    return { step, xs, ys };
  })();

  return (
    <div className="workspace-layout">
      <section className={`panel workspace-canvas-panel link-tone-${tone}`} aria-label="Link workspace canvas">
        <div className="workspace-toolbar" role="toolbar" aria-label="Canvas view">
          <button type="button" className="ghost" onClick={fitLink}><Maximize2 size={15} /> Fit link</button>
          <button type="button" className="ghost" onClick={fitThresholds}><Target size={15} /> Fit all thresholds</button>
          <button type="button" className="ghost icon-only" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom in"><Plus size={15} /></button>
          <button type="button" className="ghost icon-only" onClick={() => zoomBy(1.4)} aria-label="Zoom out"><Minus size={15} /></button>
          <button type="button" className={`ghost ${snap ? 'is-on' : ''}`} aria-pressed={snap} onClick={() => setSnap(!snap)}>Snap {SNAP_M} m</button>
          {refining && <span className="refining" role="status">Refining terrain…</span>}
        </div>

        <div ref={stageRef} className="workspace-stage">
          {view && size.width > 0 && (
            <svg
              className="workspace-svg" width={size.width} height={size.height} role="img"
              aria-label={`Plan view. Transmitter and receiver ${formatDistance(separation)} apart.`}
              onPointerDown={startPan} onPointerMove={moveDrag} onPointerUp={endDrag(false)} onPointerCancel={endDrag(true)}
            >
              {grid && (
                <g className="grid-lines" aria-hidden="true">
                  {grid.xs.map((x) => { const sx = toScreen({ xM: x, yM: 0 }).x; return <g key={`x${x}`}><line x1={sx} x2={sx} y1={0} y2={size.height} /><text x={sx + 4} y={size.height - 8}>{formatDistance(x)}</text></g>; })}
                  {grid.ys.map((y) => { const sy = toScreen({ xM: 0, yM: y }).y; return <g key={`y${y}`}><line x1={0} x2={size.width} y1={sy} y2={sy} /><text x={6} y={sy - 4}>{formatDistance(y)}</text></g>; })}
                </g>
              )}

              {terrain.enabled && fields && (
                <g className="terrain-contours" aria-hidden="true">
                  {fields.terrainContours.map((contour) => {
                    const label = contour.major && contour.segments[Math.floor(contour.segments.length / 2)];
                    const at = label && toScreen({ xM: label[0], yM: label[1] });
                    return (
                      <g key={contour.level} className={contour.major ? 'contour major' : 'contour'}>
                        <path d={segmentsPath(contour.segments, toScreen)} />
                        {at && <text x={at.x} y={at.y}>{formatNumber(contour.level, 0)} m</text>}
                      </g>
                    );
                  })}
                </g>
              )}

              {result.valid && (
                <g className="threshold-layer" aria-hidden="true">
                  {references.map((reference) => {
                    const className = `threshold threshold-${reference.id}${reference.active ? ' active' : ''}`;
                    if (terrain.enabled) {
                      const field = fieldThreshold(reference.id);
                      return field?.segments.length ? <path key={reference.id} className={className} strokeDasharray={THRESHOLD_DASH[reference.id]} d={segmentsPath(field.segments, toScreen)} /> : null;
                    }
                    const r = reference.flatRadiusM * scale;
                    const visible = Number.isFinite(r) && r > 0 && r < 4e6;
                    return visible ? <circle key={reference.id} className={className} strokeDasharray={THRESHOLD_DASH[reference.id]} cx={txScreen.x} cy={txScreen.y} r={r} /> : null;
                  })}
                </g>
              )}

              <line className="link-line" x1={txScreen.x} y1={txScreen.y} x2={rxScreen.x} y2={rxScreen.y} />

              {(['rx', 'tx'] as const).map((id) => {
                const p = toScreen(ws[id]);
                const name = id === 'tx' ? state.inputs.txId || 'Transmitter' : state.inputs.rxId || 'Receiver';
                return (
                  <g
                    key={id} className={`antenna antenna-${id}${selected === id ? ' selected' : ''}`} transform={`translate(${p.x} ${p.y})`}
                    role="button" tabIndex={0}
                    aria-label={`${id === 'tx' ? 'Transmitter' : 'Receiver'} ${name} at X ${formatNumber(ws[id].xM, 1)} m, Y ${formatNumber(ws[id].yM, 1)} m. Arrow keys move 1 m, Shift with arrows 10 m.`}
                    onPointerDown={startAntennaDrag(id)} onFocus={() => setSelected(id)} onKeyDown={nudge(id)}
                  >
                    <circle className="antenna-hit" r={24} />
                    <circle className="antenna-ring" r={19} />
                    <RadioTower x={-12} y={-13} width={24} height={24} strokeWidth={1.7} aria-hidden="true" />
                    <text className="antenna-role" y={38}>{id === 'tx' ? 'TX' : 'RX'}</text>
                    <text className="antenna-name" y={53}>{name}</text>
                  </g>
                );
              })}
            </svg>
          )}

          {view && <SignalCanvas from={txScreen} to={rxScreen} frequencyGhz={state.inputs.frequencyGhz} visible={result.valid} />}

          {view && !editor && (
            <button
              type="button" className="separation-label" style={{ transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)` }}
              onDoubleClick={() => setEditor({ text: String(Number(separation.toFixed(2))), error: '' })}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditor({ text: String(Number(separation.toFixed(2))), error: '' }); } }}
              aria-label={`3D separation ${formatDistance(separation)}. Press Enter to type a separation; the transmitter moves along its bearing.`}
              title="Double-click to type a separation. Moves Tx along its bearing."
            >
              {formatDistance(separation)}
            </button>
          )}

          {view && editor && (
            <form className="separation-editor" style={{ transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%)` }} onSubmit={applySeparation} noValidate>
              <label className="field">
                <span>3D separation</span>
                <div className="input-with-unit">
                  <input
                    autoFocus type="text" inputMode="decimal" value={editor.text} aria-invalid={editor.error ? true : undefined}
                    onChange={(event) => setEditor({ text: event.target.value, error: '' })}
                    onKeyDown={(event) => { if (event.key === 'Escape') setEditor(null); }}
                  />
                  <b>m</b>
                </div>
              </label>
              {editor.error && <small className="field-error" role="alert">{editor.error}</small>}
              <div className="editor-actions">
                <button type="submit" className="primary-button">Apply</button>
                <button type="button" className="ghost" onClick={() => setEditor(null)}>Cancel</button>
              </div>
            </form>
          )}
        </div>

        <p className="workspace-hint">Drag an antenna or the background. Arrow keys nudge the focused antenna 1 m, with Shift 10 m. Double-click the separation to type it.</p>
        <p className="visually-hidden" aria-live="polite">{announcement}</p>
      </section>

      <aside className="workspace-inspector">
        <section className={`result-hero result-tone-${tone}`}>
          <p className="eyebrow">PREDICTED RECEIVED POWER</p>
          <div className="power-value">{formatNumber(result.receivedPowerDbm, 2)} <span>dBm</span></div>
          <p>{state.inputs.txId || 'Transmitter'} → {state.inputs.rxId || 'Receiver'}</p>
          <StatusBadge status={result.status} />
        </section>

        <div className="objective-toggle" role="group" aria-label="Link objective">
          <button type="button" className={state.linkObjective === 'desired' ? 'active' : ''} aria-pressed={state.linkObjective === 'desired'} onClick={() => setState((current) => ({ ...current, linkObjective: 'desired' }))}><Signal size={16} /> Desired communication</button>
          <button type="button" className={state.linkObjective === 'avoidance' ? 'active' : ''} aria-pressed={state.linkObjective === 'avoidance'} onClick={() => setState((current) => ({ ...current, linkObjective: 'avoidance' }))}><Antenna size={16} /> Interference avoidance</button>
        </div>

        <div className="metric-grid">
          <Metric label="3D separation" value={formatNumber(separation, separation < 100 ? 2 : 1)} unit="m" note="Feeds the link budget" />
          <Metric label="Ground separation" value={formatNumber(groundSeparationM(ws), 1)} unit="m" note="Plan-view distance" />
          <Metric label="Link margin" value={formatNumber(result.linkMarginDb)} unit="dB" />
          <Metric label="Interference margin" value={formatNumber(result.interferenceMarginDb)} unit="dB" />
        </div>

        <section className="panel inspector-section">
          <div className="inspector-heading">
            <h3>Selected antenna</h3>
            <div className="segmented" role="group" aria-label="Selected antenna">
              {(['tx', 'rx'] as const).map((id) => <button key={id} type="button" className={selected === id ? 'active' : ''} aria-pressed={selected === id} onClick={() => setSelected(id)}>{id.toUpperCase()}</button>)}
            </div>
          </div>
          <div className="form-grid two">
            <CommitField label="X position" unit="m" value={selectedPlacement.xM} onCommit={(v) => Math.abs(v) > WORLD_LIMIT_M ? 'Keep within ±100 km.' : updateAntenna(selected, { xM: v })} />
            <CommitField label="Y position" unit="m" value={selectedPlacement.yM} onCommit={(v) => Math.abs(v) > WORLD_LIMIT_M ? 'Keep within ±100 km.' : updateAntenna(selected, { yM: v })} />
            <CommitField label="Antenna height above ground" unit="m" value={selectedPlacement.aglM} onCommit={(v) => v < 0 ? 'Height above ground cannot be negative.' : updateAntenna(selected, { aglM: v })} />
            <NumberField label={`${selected === 'tx' ? 'Tx' : 'Rx'} antenna gain`} unit="dBi" value={selected === 'tx' ? state.inputs.txGainDbi : state.inputs.rxGainDbi} onChange={(v) => setInput(selected === 'tx' ? 'txGainDbi' : 'rxGainDbi', v)} />
          </div>
          <dl className="readouts">
            <div><dt>Ground elevation</dt><dd>{formatNumber(groundElevation, 1)} m</dd></div>
            <div><dt>Total antenna elevation</dt><dd>{formatNumber(antennaElevationM(terrain, selectedPlacement), 1)} m</dd></div>
          </dl>
          <p className="field-note">Elevations are relative to the {terrain.enabled ? 'synthetic terrain’s local reference' : 'flat ground plane'}, not sea level.</p>
        </section>

        <section className="panel inspector-section">
          <h3>Signal</h3>
          <FrequencyControl frequencyGhz={state.inputs.frequencyGhz} onChange={(ghz) => setInput('frequencyGhz', ghz)} />
        </section>

        <section className="panel inspector-section">
          <div className="inspector-heading">
            <h3>Terrain</h3>
            <label className="switch">
              <input type="checkbox" checked={terrain.enabled} onChange={(event) => updateTerrain({ enabled: event.target.checked })} />
              <span>Synthetic terrain</span>
            </label>
          </div>
          <div className="form-grid three">
            <CommitField label="Elevation offset" unit="m" value={terrain.offsetM} disabled={!terrain.enabled} onCommit={(v) => updateTerrain({ offsetM: v })} />
            <CommitField label="Relief scale" unit="×" value={terrain.reliefScale} disabled={!terrain.enabled} onCommit={(v) => v < 0 ? 'Relief scale cannot be negative.' : updateTerrain({ reliefScale: v })} />
            <CommitField label="Contour interval" unit="m" value={terrain.contourIntervalM} disabled={!terrain.enabled} onCommit={(v) => v <= 0 ? 'Use an interval above zero.' : updateTerrain({ contourIntervalM: v })} />
          </div>
          <p className="field-note">An illustrative landscape (model synthetic-v1), not a surveyed site. Relief 0 is flat ground; contour interval changes the drawing only.</p>
        </section>

        <section className="panel inspector-section">
          <h3>Threshold boundaries</h3>
          <ul className="threshold-legend">
            {references.map((reference) => {
              const field = fieldThreshold(reference.id);
              const boundary = !result.valid || !Number.isFinite(reference.slantRangeM) ? 'Not available for these inputs'
                : terrain.enabled
                  ? field?.state === 'visible' ? `Ground boundary follows the terrain at Rx height ${formatNumber(ws.rx.aglM, 1)} m above ground`
                    : field ? 'No boundary within the current view' : 'Calculating…'
                  : Number.isFinite(reference.flatRadiusM) ? `Ground radius ${formatDistance(reference.flatRadiusM)}` : 'No ground crossing at these antenna heights';
              return (
                <li key={reference.id} className={`threshold-row threshold-${reference.id}`}>
                  <svg width="28" height="10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" strokeDasharray={THRESHOLD_DASH[reference.id]} /></svg>
                  <div>
                    <strong>{reference.label}</strong> <span className="tag">{reference.active ? 'drives status' : 'reference'}</span>
                    <p>{formatNumber(reference.levelDbm, 1)} dBm at {formatDistance(reference.slantRangeM)} slant range</p>
                    <p>{boundary}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {terrain.enabled && fields && <p className="field-note">Boundaries are interpolated on a {formatDistance(fields.cellSizeM)} grid, accurate to about half a cell.</p>}
        </section>

        <div className="callout">
          <b>Free-space estimate</b>
          <p>Terrain sets antenna elevations and the 3D separation only. A ridge between Tx and Rx is not treated as an obstruction. The Calculator’s {formatNumber(result.totalLossDb, 1)} dB of system losses still apply.</p>
        </div>
      </aside>
    </div>
  );
}
