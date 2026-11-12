import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import { activePair, type LinkPin } from '../../lib/activeLink';
import { buildingsOf, flatGround } from '../../lib/buildings';
import type { GroundAt } from '../../lib/elevation';
import { calculateLink, formatNumber } from '../../lib/rf';
import { effectiveObjective, groundOf, pairLinkInputs, pairPropagation, receiverSummary, separationM, type PairResult } from '../../lib/sensors';
import { pairVerdict, type ReceiverAssessment } from '../../lib/interference';
import type { AppState, LinkInputs } from '../../types';
import { CommitField, Metric, NumberField, StatusBadge, statusTone } from '../ui';
import { PathProfileChart } from './PathProfileChart';
import { RxMeterStack } from './RxMeterStack';
import { InterferenceMatrix } from './InterferenceMatrix';
import { oneOf, usePref } from '../usePref';

const TEXT_LABELS = { scenarioName: 'Scenario or link name', txId: 'Tx location / identifier', rxId: 'Rx location / identifier' } as const;

/** Drawer height in px after a drag, 'max' to fill the workspace, or null for the default. */
export type DrawerSize = number | 'max' | null;
const MIN_DRAWER_PX = 120;
const STEP_PX = 40;
/** Matches the 160 ms drawer-out animation in styles.css. */
const CLOSE_MS = 160;

/** Height limits for the drawer inside its workspace: the workspace height minus the 10 px margins. */
function drawerLimits(drawer: HTMLElement | null) {
  const parent = drawer?.offsetParent as HTMLElement | null;
  const rect = parent?.getBoundingClientRect();
  return { bottom: (rect?.bottom ?? window.innerHeight) - 10, max: Math.max(MIN_DRAWER_PX, (rect?.height ?? window.innerHeight) - 20) };
}

/** The Calculator's inputs, results and Rx meter for the active link, writing back through `onEdit`. */
export const LinkBudgetDrawer = memo(function LinkBudgetDrawer({ state, pairs, assessments, groundAt, onEdit, open, onToggle, pin, onPin, size, onResize }: {
  state: AppState;
  pairs: PairResult[];
  assessments: Map<string, ReceiverAssessment>;
  open: boolean;
  onToggle: (open: boolean) => void;
  size: DrawerSize;
  onResize: (size: DrawerSize) => void;
  groundAt: GroundAt;
  pin: LinkPin | null;
  onPin: (pin: LinkPin | null) => void;
  onEdit: <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => string | undefined;
}) {
  const { map } = state;
  const [view, setView] = usePref<'budget' | 'matrix'>('drawerView', 'budget', oneOf('budget', 'matrix'));
  const pair = useMemo(() => activePair(map, groundAt, state.inputs, pin), [map, groundAt, state.inputs, pin]);
  const model = useMemo(() => {
    if (!pair) return null;
    const distanceM = separationM(pair.tx, pair.rx, groundAt, map.useTerrainElevation);
    const { inputs, rejectionDb, polarizationDb } = pairLinkInputs(map, state.inputs, pair.tx, pair.rx, distanceM);
    const propagation = pairPropagation(map, pair.tx, pair.rx, inputs.frequencyGhz, groundAt);
    const objective = pairs.find(p => p.txId === pair.tx.id && p.rxId === pair.rx.id)?.intended === false ? 'avoidance' : effectiveObjective(map, pair.rx);
    const result = calculateLink({ ...inputs, otherLossDb: inputs.otherLossDb + propagation.lossDb }, objective);
    const known = [pair.tx, pair.rx].every((s) => groundOf(s, groundAt, map.useTerrainElevation) !== null) && Number.isFinite(propagation.lossDb);
    return { inputs, propagation, objective, result, known, rejectionDb, polarizationDb };
  }, [pair, map, state.inputs, groundAt, pairs]);

  const rxPairs = useMemo(() => pair ? pairs.filter(p => p.rxId === pair.rx.id) : [], [pair, pairs]);
  const links = useMemo(() => pair ? receiverSummary(rxPairs, pair.rx.id).links : [], [pair, rxPairs]);
  // An avoidance receiver has no desired links, so its meter shows the shown pair against the interference threshold.
  const avoidance = model?.objective === 'avoidance';
  const meterLinks = useMemo(() => avoidance && pair ? rxPairs.filter((p) => p.txId === pair.tx.id) : links, [avoidance, pair, rxPairs, links]);
  const pinMatrixCell = useCallback((p: LinkPin) => { onPin({ ...p, scope: 'pair' }); setView('budget'); document.getElementById('drawer-tab-budget')?.focus(); }, [onPin, setView]);

  // Closing plays a short exit before the content unmounts; reduced motion closes at once.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => { if (open) setClosing(false); }, [open]);
  const toggle = () => {
    if (!open || closing) { window.clearTimeout(closeTimer.current); setClosing(false); onToggle(!open); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onToggle(false); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => { setClosing(false); onToggle(false); }, CLOSE_MS);
  };

  if (!pair || !model) {
    return <section className="map-card link-budget-drawer collapsed" aria-label="Link budget"><div className="drawer-bar"><b>Link budget</b><span className="field-note">Add a transmitter and a receiver to see the link budget.</span></div></section>;
  }
  const { inputs, propagation, objective, result, known } = model;
  const assessment = assessments.get(pair.rx.id)!;
  const displayedPair = rxPairs.find(p => p.txId === pair.tx.id);
  const status = objective === 'avoidance' ? displayedPair ? pairVerdict(displayedPair, pair.rx, assessment.marginDb) : 'Invalid input' : assessment.links.find(l => l.txId === pair.tx.id)?.status ?? result.status;
  const num = <K extends keyof LinkInputs>(key: K) => (v: number) => { onEdit(key, v as LinkInputs[K]); };
  const text = (key: keyof typeof TEXT_LABELS) => (
    <label className="field"><span>{TEXT_LABELS[key]}</span><input type="text" value={inputs[key]} onChange={(e) => { onEdit(key, e.target.value); }} /></label>
  );
  const tone = statusTone(status);

  const clamp = (px: number, max: number) => Math.round(Math.min(max, Math.max(MIN_DRAWER_PX, px)));
  const currentPx = (drawer: HTMLElement | null) => drawer?.getBoundingClientRect().height ?? MIN_DRAWER_PX;
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget, drawer = handle.parentElement as HTMLElement, workspace = drawer.offsetParent as HTMLElement | null;
    const { bottom, max } = drawerLimits(drawer);
    handle.setPointerCapture(e.pointerId);
    // While dragging, write the height straight to the DOM once per frame; React state (and the whole map
    // workspace render) is only touched when the pointer is released.
    let latest: number | null = null, frame = 0, final: number | null = null;
    const paint = () => {
      frame = 0;
      if (latest === null) return;
      drawer.style.height = `${latest}px`;
      workspace?.style.setProperty('--drawer-h', `${latest}px`);
      final = latest; latest = null;
    };
    const move = (ev: PointerEvent) => { latest = clamp(bottom - ev.clientY, max); if (!frame) frame = requestAnimationFrame(paint); };
    const end = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
      if (frame) { cancelAnimationFrame(frame); paint(); }
      drawer.style.height = '';
      if (final !== null) onResize(final);
      else workspace?.style.removeProperty('--drawer-h');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  const nudge = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const drawer = e.currentTarget.parentElement;
    const { max } = drawerLimits(drawer);
    const steps: Record<string, number> = { ArrowUp: STEP_PX, ArrowDown: -STEP_PX, PageUp: STEP_PX * 4, PageDown: -STEP_PX * 4 };
    if (e.key in steps) { e.preventDefault(); onResize(clamp(currentPx(drawer) + steps[e.key], max)); }
    else if (e.key === 'Home') { e.preventDefault(); onResize(MIN_DRAWER_PX); }
    else if (e.key === 'End') { e.preventDefault(); onResize('max'); }
  };

  return (
    <section className={`map-card link-budget-drawer${open ? '' : ' collapsed'}${closing ? ' closing' : ''} link-tone-${tone}`} aria-label="Link budget">
      {open && (
        <div
          className="drawer-resize" role="separator" aria-orientation="horizontal" aria-label="Resize link budget" tabIndex={0}
          title="Drag to resize · double-click to reset · arrow keys to adjust"
          onPointerDown={startDrag} onKeyDown={nudge} onDoubleClick={() => onResize(null)}
        />
      )}
      <div className="drawer-bar">
        <button type="button" className="ghost drawer-toggle" aria-expanded={open} onClick={toggle}><ChevronUp size={14} aria-hidden="true" className="drawer-chevron" /><span>Link budget</span></button>
        <span className="drawer-summary">{inputs.txId} → {inputs.rxId} · <b>{formatNumber(result.receivedPowerDbm)} dBm</b></span>
        {open && (
          <button type="button" className="ghost drawer-expand" aria-pressed={size === 'max'} onClick={() => onResize(size === 'max' ? null : 'max')}>
            {size === 'max' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{size === 'max' ? 'Restore' : 'Expand'}
          </button>
        )}
        <StatusBadge status={status} />
      </div>
      {open && <div className="tabs drawer-tabs" role="tablist" aria-label="Drawer views">
        {(['budget', 'matrix'] as const).map(v => <button key={v} id={`drawer-tab-${v}`} type="button" role="tab" aria-selected={view === v} aria-controls={`drawer-panel-${v}`} tabIndex={view === v ? 0 : -1}
          onClick={() => setView(v)} onKeyDown={e => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const next = e.key === 'Home' ? 'budget' : e.key === 'End' ? 'matrix' : v === 'budget' ? 'matrix' : 'budget';
              setView(next); document.getElementById(`drawer-tab-${next}`)?.focus();
            }
          }}>{v === 'budget' ? 'Link budget' : 'Matrix'}</button>)}
      </div>}
      {open && view === 'matrix' && <div id="drawer-panel-matrix" role="tabpanel" aria-labelledby="drawer-tab-matrix" className="drawer-matrix-panel" tabIndex={0}>
        <InterferenceMatrix map={map} pairs={pairs} assessments={assessments} onPin={pinMatrixCell} />
      </div>}
      {open && view === 'budget' && (
        <div className="drawer-body" id="drawer-panel-budget" role="tabpanel" aria-labelledby="drawer-tab-budget">
          <div className="drawer-inputs">
            <p className="field-note"><b>{objective === 'desired' ? 'Desired communication' : 'Interference avoidance'}.</b> {objective === 'desired' ? 'Tx and Rx should communicate. Received power above sensitivity with the required fade margin is desirable.' : 'Tx and Rx should remain isolated. Received power below the interference threshold is desirable.'}</p>
            {(links.length > 1 || displayedPair?.intended === false) && (
              <label className="field link-pin"><span>Showing link from</span>
                <select value={pin?.rxId === pair.rx.id && pin.txId === pair.tx.id ? pair.tx.id : ''} onChange={(e) => onPin(e.target.value ? { rxId: pair.rx.id, txId: e.target.value } : null)}>
                  <option value="">Strongest (re-ranks as you edit)</option>
                  {displayedPair?.intended === false && <option value={pair.tx.id}>{pair.tx.name} (interferer)</option>}
                  {links.map((l) => <option key={l.txId} value={l.txId}>{l.txName}</option>)}
                </select>
              </label>
            )}
            <div className="form-grid three">{text('scenarioName')}{text('txId')}{text('rxId')}</div>
            <div className="form-grid four">
              <NumberField label="Transmit power" unit="dBm" value={inputs.transmitPowerDbm} onChange={num('transmitPowerDbm')} />
              <NumberField label="Operating frequency" unit="GHz" min={0.000001} value={inputs.frequencyGhz} onChange={num('frequencyGhz')} />
              <CommitField label="Tx-to-Rx 3D separation" unit="m" value={inputs.distanceM} onCommit={(v) => onEdit('distanceM', v)} />
              <NumberField label="Fade margin target" unit="dB" min={0} value={inputs.fadeMarginTargetDb} onChange={num('fadeMarginTargetDb')} />
              <NumberField label="Tx antenna gain" unit="dBi" value={inputs.txGainDbi} onChange={num('txGainDbi')} />
              <NumberField label="Rx antenna gain" unit="dBi" value={inputs.rxGainDbi} onChange={num('rxGainDbi')} />
              <NumberField label="Tx cable & connector loss" unit="dB" min={0} value={inputs.txLossDb} onChange={num('txLossDb')} />
              <NumberField label="Rx cable & connector loss" unit="dB" min={0} value={inputs.rxLossDb} onChange={num('rxLossDb')} />
              <NumberField label="Polarization mismatch" unit="dB" min={0} value={inputs.polarizationLossDb} onChange={num('polarizationLossDb')} help="Extra loss on every pair; per-sensor mismatch is added on top." />
              <NumberField label="Obstruction / environment" unit="dB" min={0} value={inputs.obstructionLossDb} onChange={num('obstructionLossDb')} />
              <NumberField label="Other miscellaneous loss" unit="dB" min={0} value={state.inputs.otherLossDb} onChange={num('otherLossDb')} />
              <NumberField label="Receiver sensitivity" unit="dBm" value={inputs.sensitivityDbm} onChange={num('sensitivityDbm')} />
              <NumberField label="Interference threshold" unit="dBm" value={inputs.interferenceThresholdDbm} onChange={num('interferenceThresholdDbm')} />
            </div>
          </div>
          <div className="drawer-results">
            <div className="metric-grid drawer-metrics">
              <Metric label="Received power" value={formatNumber(result.receivedPowerDbm, 2)} unit="dBm" note={`${result.receivedPowerMw < 0.001 ? result.receivedPowerMw.toExponential(3) : formatNumber(result.receivedPowerMw, 6)} mW`} />
              <Metric label="Link margin" value={formatNumber(result.linkMarginDb)} unit="dB" note="Power above sensitivity" />
              <Metric label="Interference margin" value={formatNumber(result.interferenceMarginDb)} unit="dB" note="Threshold minus received power" />
              {objective === 'avoidance' && <Metric label="Protected margin" value={known ? formatNumber(assessment.limitDbm - result.receivedPowerDbm) : 'Unknown'} unit="dB" note="Protected limit minus received power" />}
              <Metric label="Free-space path loss" value={formatNumber(result.fsplDb)} unit="dB" />
              <Metric label="Diffraction loss" value={map.propagationModel === 'terrain' ? formatNumber(propagation.lossDb) : 'off'} unit={map.propagationModel === 'terrain' ? 'dB' : ''} note={map.propagationModel === 'terrain' ? `Clearance: ${propagation.clearance}${buildingsOf(groundAt) ? ' · terrain and buildings' : ''}` : 'Free-space model'} />
              {model.rejectionDb > 0 && <Metric label="Frequency rejection" value={formatNumber(model.rejectionDb)} unit="dB" />}
              <Metric label="Per-sensor polarization mismatch" value={formatNumber(model.polarizationDb)} unit="dB" note={`${pair.tx.polarization} → ${pair.rx.polarization}`} />
              <Metric label="Total system losses" value={formatNumber(result.totalLossDb)} unit="dB" />
              <Metric label="Wavelength" value={formatNumber(result.wavelengthM, 4)} unit="m" />
            </div>
            {!known && map.useTerrainElevation && <p className="field-note" role="status">Elevation unavailable for this path; terrain prediction is unknown.</p>}
            <section className="rx-meter-section" aria-label="Rx power meter"><h4 className="rx-meter-heading">Rx power meter</h4><RxMeterStack links={meterLinks} inputs={inputs} objective={objective} assessment={assessment} /></section>
            {map.propagationModel === 'terrain' && <PathProfileChart tx={pair.tx} rx={pair.rx} groundAt={map.useTerrainElevation ? groundAt : flatGround(groundAt)} frequencyGhz={inputs.frequencyGhz} />}
          </div>
        </div>
      )}
    </section>
  );
});
