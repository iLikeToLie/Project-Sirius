import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Antenna, BookOpen, Calculator, ChartLine, Download, FileDown, Github,
  MapPinned, RadioTower, RotateCcw, Save, Signal, Upload,
} from 'lucide-react';
import {
  CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Title, Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { freshDefaultState } from './data/defaults';
import { calculateLink, calculatePlacements, distanceSweep, formatNumber, gainSweep } from './lib/rf';
import { normalizeState, validateImport } from './lib/state';
import { CommitField, Metric, NumberField, StatusBadge, statusTone } from './components/ui';
import { activeElevationKnown, activeInputs, activePair, applyInputEdit, type LinkPin } from './lib/activeLink';
import { resolveDesiredTxs } from './lib/sensors';
import { useElevationTiles } from './components/map/useElevationTiles';
import type { AppState, LinkInputs, LinkObjective, PlacementScenario, ScreeningStatus } from './types';

// MapLibre is large; load the map only when the Link workspace opens.
const MapWorkspace = lazy(() => import('./components/map/MapWorkspace').then((m) => ({ default: m.MapWorkspace })));

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const STORAGE_KEY = 'friis-rf-planner-v3-state';
const REPO_URL = 'https://github.com/iLikeToLie/Project-Sirius';
const WORKBOOK_URL = `${REPO_URL}/raw/main/Friis_RF_Link_and_Interference_Calculator_v3.xlsx`;
type View = 'calculator' | 'workspace' | 'distance' | 'gain' | 'placement' | 'guide';

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : freshDefaultState();
  } catch {
    return freshDefaultState();
  }
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input type="text" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

const chartOptions = (xTitle: string) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  scales: {
    x: { title: { display: true, text: xTitle, color: '#8ea0bf' }, grid: { color: 'rgba(39, 52, 74, 0.55)' }, ticks: { color: '#8ea0bf', maxTicksLimit: 12 } },
    y: { title: { display: true, text: 'Received power (dBm)', color: '#8ea0bf' }, grid: { color: 'rgba(39, 52, 74, 0.55)' }, ticks: { color: '#8ea0bf' } },
  },
  plugins: { legend: { labels: { color: '#d7ddee', usePointStyle: true, pointStyle: 'line' as const } } },
});

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [view, setView] = useState<View>('calculator');
  const [savedFlash, setSavedFlash] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const elevation = useElevationTiles();
  const { groundAt } = elevation;
  // The Calculator's active link needs sensor ground heights even when the map is not open.
  useEffect(() => { if (state.map.useTerrainElevation) elevation.ensure(state.map.sensors); }, [state.map.sensors, state.map.useTerrainElevation, elevation.ensure]);
  // Every view reads the active link's inputs: the selected receiver and its strongest desired transmitter.
  // A transmitter the user is editing stays the active one even if the edit would re-rank the links.
  const [pin, setPin] = useState<LinkPin | null>(null);
  useEffect(() => setPin(null), [state.map.selectedId]);
  // A pin whose transmitter has left the receiver's desired set must not come back to life if it is re-added.
  useEffect(() => {
    if (!pin) return;
    const rx = state.map.sensors.find((s) => s.id === pin.rxId);
    if (!rx || !resolveDesiredTxs(state.map, rx, groundAt).some((s) => s.id === pin.txId)) setPin(null);
  }, [pin, state.map, groundAt]);
  const viewState = useMemo(() => ({ ...state, inputs: activeInputs(state, groundAt, pin) }), [state, groundAt, pin]);
  const elevationKnown = useMemo(() => activeElevationKnown(state, groundAt, pin), [state, groundAt, pin]);
  const result = useMemo(() => calculateLink(viewState.inputs, state.linkObjective), [viewState.inputs, state.linkObjective]);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state]);

  const editInput = <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]): string | undefined => {
    const shown = activePair(state.map, groundAt, state.inputs, pin);
    const held = shown ? { rxId: shown.rx.id, txId: shown.tx.id } : null;
    const edited = applyInputEdit(state, key, value, groundAt, held);
    if (!edited.ok) return edited.reason;
    setPin(held);
    setState(edited.state);
    return undefined;
  };
  const setInput = <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => { editInput(key, value); };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.inputs.scenarioName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'rf-scenario'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const importJson = async (file?: File) => {
    if (!file) return;
    try {
      const imported = validateImport(JSON.parse(await file.text()));
      if (!imported) throw new Error('Invalid scenario');
      setState(imported);
    } catch {
      window.alert('This file is not a valid Friis RF Planner scenario.');
    }
  };

  const nav = [
    ['calculator', Calculator, 'Calculator'], ['workspace', RadioTower, 'Link workspace'], ['distance', ChartLine, 'Distance sweep'], ['gain', Antenna, 'Gain sweep'],
    ['placement', MapPinned, 'Placements'], ['guide', BookOpen, 'Guide'],
  ] as const;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Signal size={22} /></div><div><strong>FRIIS RF</strong><span>LINK MISSION CONTROL</span></div></div>
        <span className="version-chip">WEB 1.8.0 · V3 MODEL</span>
        <nav>{nav.map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
        <div className="sidebar-note"><Activity size={18} /><p><b>Screening model</b><br />Free-space estimates support engineering review; they do not prove harmful interference.</p></div>
        <a className="repo-link" href={REPO_URL} target="_blank" rel="noreferrer"><Github size={18} /> View repository</a>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">RF LINK & INTERFERENCE SCREENING</p><h1>{nav.find(([id]) => id === view)?.[2]}</h1></div>
          <div className="toolbar">
            <button className="ghost" onClick={() => importRef.current?.click()}><Upload size={17} /> Import</button>
            <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => { void importJson(event.target.files?.[0]); event.currentTarget.value = ''; }} />
            <button className="ghost" onClick={downloadJson}><Save size={17} /> {savedFlash ? 'Saved' : 'Export'}</button>
            <button className="ghost" onClick={() => { if (window.confirm('Reset all fields and placement rows to the Version 3 defaults?')) setState(freshDefaultState()); }}><RotateCcw size={17} /> Reset</button>
            <a className="primary-button" href={WORKBOOK_URL}><Download size={17} /> Workbook V3</a>
          </div>
        </header>

        <div className="content">
          {view === 'calculator' && <CalculatorView state={viewState} setState={setState} setInput={setInput} editInput={editInput} result={result} elevationKnown={elevationKnown} />}
          {view === 'workspace' && <Suspense fallback={<p className="muted">Loading map…</p>}><MapWorkspace state={state} setState={setState} elevation={elevation} pin={pin} setPin={setPin} /></Suspense>}
          {view === 'distance' && <DistanceView state={viewState} setState={setState} />}
          {view === 'gain' && <GainView state={viewState} setState={setState} />}
          {view === 'placement' && <PlacementView state={viewState} setState={setState} />}
          {view === 'guide' && <GuideView />}
        </div>
      </main>
    </div>
  );
}

function CalculatorView({ state, setState, setInput, editInput, result, elevationKnown }: { elevationKnown: boolean; state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; setInput: <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => void; editInput: <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => string | undefined; result: ReturnType<typeof calculateLink> }) {
  const setObjective = (linkObjective: LinkObjective) => setState((current) => ({ ...current, linkObjective }));
  return (
    <div className="calculator-layout">
      <LinkSchematic state={state} result={result} />
      <section className="panel inputs-panel">
        <div className="panel-heading"><div><p className="eyebrow">MODEL INPUTS</p><h2>{state.inputs.scenarioName || 'Untitled scenario'}</h2></div><StatusBadge status={result.status} /></div>
        <div className="objective-selector">
          <div><span>Link objective</span><p>{state.linkObjective === 'desired' ? 'Tx and Rx should communicate. Received power above sensitivity with the required fade margin is desirable.' : 'Tx and Rx should remain isolated. Received power below the interference threshold is desirable.'}</p></div>
          <div className="objective-toggle" role="group" aria-label="Link objective">
            <button className={state.linkObjective === 'desired' ? 'active' : ''} onClick={() => setObjective('desired')}><Signal size={16} /> Desired communication</button>
            <button className={state.linkObjective === 'avoidance' ? 'active' : ''} onClick={() => setObjective('avoidance')}><Antenna size={16} /> Interference avoidance</button>
          </div>
        </div>
        <div className="form-section"><h3>Scenario</h3><div className="form-grid three"><TextField label="Scenario or link name" value={state.inputs.scenarioName} onChange={(value) => setInput('scenarioName', value)} /><TextField label="Tx location / identifier" value={state.inputs.txId} onChange={(value) => setInput('txId', value)} /><TextField label="Rx location / identifier" value={state.inputs.rxId} onChange={(value) => setInput('rxId', value)} /></div></div>
        <div className="form-section"><h3>Signal and geometry</h3><div className="form-grid four"><NumberField label="Transmit power" value={state.inputs.transmitPowerDbm} unit="dBm" onChange={(value) => setInput('transmitPowerDbm', value)} help="Transmitter output before Tx loss" /><NumberField label="Operating frequency" value={state.inputs.frequencyGhz} unit="GHz" min={0.000001} onChange={(value) => setInput('frequencyGhz', value)} /><CommitField label="Tx-to-Rx 3D separation" value={state.inputs.distanceM} unit="m" help="Moves Tx along its bearing in the Link workspace" onCommit={(value) => editInput('distanceM', value)} /><NumberField label="Fade margin target" value={state.inputs.fadeMarginTargetDb} unit="dB" min={0} onChange={(value) => setInput('fadeMarginTargetDb', value)} /></div></div>
        <div className="form-section"><h3>Antenna gain and losses</h3><div className="form-grid four"><NumberField label="Tx antenna gain" value={state.inputs.txGainDbi} unit="dBi" onChange={(value) => setInput('txGainDbi', value)} help="Gain toward the receiver" /><NumberField label="Rx antenna gain" value={state.inputs.rxGainDbi} unit="dBi" onChange={(value) => setInput('rxGainDbi', value)} help="Gain toward the transmitter" /><NumberField label="Tx cable & connector loss" value={state.inputs.txLossDb} unit="dB" min={0} onChange={(value) => setInput('txLossDb', value)} /><NumberField label="Rx cable & connector loss" value={state.inputs.rxLossDb} unit="dB" min={0} onChange={(value) => setInput('rxLossDb', value)} /><NumberField label="Polarization mismatch" value={state.inputs.polarizationLossDb} unit="dB" min={0} onChange={(value) => setInput('polarizationLossDb', value)} /><NumberField label="Obstruction / environment" value={state.inputs.obstructionLossDb} unit="dB" min={0} onChange={(value) => setInput('obstructionLossDb', value)} /><NumberField label="Other miscellaneous loss" value={state.inputs.otherLossDb} unit="dB" min={0} onChange={(value) => setInput('otherLossDb', value)} /></div></div>
        <div className="form-section"><h3>Receiver thresholds</h3><div className="form-grid three"><NumberField label="Receiver sensitivity" value={state.inputs.sensitivityDbm} unit="dBm" onChange={(value) => setInput('sensitivityDbm', value)} /><NumberField label="Interference threshold" value={state.inputs.interferenceThresholdDbm} unit="dBm" onChange={(value) => setInput('interferenceThresholdDbm', value)} /></div></div>
      </section>
      <aside className="results-column">
        <section className={`result-hero result-tone-${statusTone(result.status)}`}><p className="eyebrow">PREDICTED RECEIVED POWER</p><div className="power-value">{formatNumber(result.receivedPowerDbm, 2)} <span>dBm</span></div><p>{state.inputs.txId || 'Transmitter'} → {state.inputs.rxId || 'Receiver'}</p><StatusBadge status={result.status} /></section>
        <div className="metric-grid"><Metric label="Link margin" value={formatNumber(result.linkMarginDb)} unit="dB" note="Power above sensitivity" /><Metric label="Interference margin" value={formatNumber(result.interferenceMarginDb)} unit="dB" note="Threshold minus received power" /><Metric label="Free-space path loss" value={formatNumber(result.fsplDb)} unit="dB" /><Metric label="Total system losses" value={formatNumber(result.totalLossDb)} unit="dB" /><Metric label="Wavelength" value={formatNumber(result.wavelengthM, 4)} unit="m" /><Metric label="Received power" value={result.receivedPowerMw < 0.001 ? result.receivedPowerMw.toExponential(3) : formatNumber(result.receivedPowerMw, 6)} unit="mW" /></div>
        {!elevationKnown && <div className="callout" role="status"><b>Elevation unavailable</b><p>Ground elevation for this link has not loaded (or the elevation service is unreachable), so the 3D separation uses 0 m ground. Open the Link workspace to load it, or switch off Use terrain elevation.</p></div>}<div className="callout"><b>{state.linkObjective === 'desired' ? 'Desired communication mode' : 'Interference avoidance mode'}</b><p>{state.linkObjective === 'desired' ? 'Status is based on receiver sensitivity and the fade-margin target. The interference threshold remains visible for reference but does not penalize a strong intended signal.' : 'Status is based on the interference screening threshold. A positive interference margin means predicted power is below that limit.'}</p></div>
      </aside>
    </div>
  );
}

function LinkSchematic({ state, result }: { state: AppState; result: ReturnType<typeof calculateLink> }) {
  const tone = statusTone(result.status);
  const received = result.receivedPowerDbm;
  const requiredReceiveLevelDbm = state.inputs.sensitivityDbm + state.inputs.fadeMarginTargetDb;
  const referenceValueDbm = state.linkObjective === 'desired' ? requiredReceiveLevelDbm : state.inputs.interferenceThresholdDbm;
  const referenceLabel = state.linkObjective === 'desired' ? 'Required level' : 'Interference';
  const referenceTitle = state.linkObjective === 'desired'
    ? `Required receive level: sensitivity + ${state.inputs.fadeMarginTargetDb} dB fade margin`
    : `Interference threshold ${state.inputs.interferenceThresholdDbm} dBm`;
  const powerValues = [received, state.inputs.sensitivityDbm, referenceValueDbm].filter(Number.isFinite);
  const scaleMin = powerValues.length ? Math.floor(Math.min(...powerValues) - 10) : -120;
  const scaleMax = powerValues.length ? Math.ceil(Math.max(...powerValues) + 10) : 0;
  const powerPosition = (value: number) => Number.isFinite(value) && scaleMax > scaleMin
    ? Math.max(0, Math.min(100, ((value - scaleMin) / (scaleMax - scaleMin)) * 100))
    : 0;
  const rxPosition = powerPosition(received);
  const sensitivityPosition = powerPosition(state.inputs.sensitivityDbm);
  const referencePosition = powerPosition(referenceValueDbm);

  return (
    <section className={`panel link-schematic link-tone-${tone}`} aria-label="Dynamic transmitter to receiver link graphic">
      <div className="panel-heading schematic-heading">
        <div><p className="eyebrow">LIVE LINK VIEW</p><h2>{state.inputs.scenarioName || 'Untitled scenario'}</h2></div>
        <div className="schematic-status"><span>{state.linkObjective === 'desired' ? 'Desired communication' : 'Interference avoidance'}</span><StatusBadge status={result.status} /></div>
      </div>

      <div className="link-stage">
        <div className="radio-endpoint tx-endpoint">
          <div className="endpoint-icon"><Antenna size={32} strokeWidth={1.7} /><span className="antenna-pulse pulse-one" /><span className="antenna-pulse pulse-two" /></div>
          <span className="endpoint-role">TRANSMITTER</span>
          <strong>{state.inputs.txId || 'Tx'}</strong>
          <div className="endpoint-stats"><span><b>{formatNumber(state.inputs.transmitPowerDbm)}</b> dBm output</span><span><b>{formatNumber(state.inputs.txGainDbi)}</b> dBi gain</span></div>
          <div className="endpoint-loss">Cable & connector loss <b>{formatNumber(state.inputs.txLossDb)} dB</b></div>
        </div>

        <div className="propagation-path">
          <div className="distance-readout"><span>Tx-to-Rx distance</span><strong>{formatNumber(state.inputs.distanceM, state.inputs.distanceM < 100 ? 1 : 0)} m</strong></div>
          <div className="signal-lane">
            <span className="beam-cone beam-from-tx" />
            <span className="signal-line" />
            <span className="signal-packet packet-one" />
            <span className="signal-packet packet-two" />
            <span className="signal-packet packet-three" />
            <span className="beam-cone beam-into-rx" />
          </div>
          <div className="path-summary"><span>FSPL <b>{formatNumber(result.fsplDb)} dB</b></span><span>Frequency <b>{formatNumber(state.inputs.frequencyGhz, 3)} GHz</b></span><span>Total loss <b>{formatNumber(result.totalLossDb)} dB</b></span></div>
          <div className="path-losses"><span>Polarization <b>{formatNumber(state.inputs.polarizationLossDb)} dB</b></span><span>Environment <b>{formatNumber(state.inputs.obstructionLossDb)} dB</b></span><span>Other <b>{formatNumber(state.inputs.otherLossDb)} dB</b></span></div>
        </div>

        <div className="receiver-stack">
          <div className="radio-endpoint rx-endpoint">
            <div className="endpoint-icon"><Antenna size={32} strokeWidth={1.7} /></div>
            <span className="endpoint-role">RECEIVER</span>
            <strong>{state.inputs.rxId || 'Rx'}</strong>
            <div className="endpoint-stats"><span><b>{formatNumber(result.receivedPowerDbm)}</b> dBm received</span><span><b>{formatNumber(state.inputs.rxGainDbi)}</b> dBi gain</span></div>
            <div className="endpoint-loss">Cable & connector loss <b>{formatNumber(state.inputs.rxLossDb)} dB</b></div>
          </div>
          <div className="power-meter">
            <div className="meter-title"><span>Rx power meter</span><b>{formatNumber(result.receivedPowerDbm)} dBm</b></div>
            <div className="meter-track">
              <span className="meter-fill" style={{ width: `${rxPosition}%` }} />
              <span className="meter-needle" style={{ left: `${rxPosition}%` }} />
              <span className="meter-marker sensitivity-marker" style={{ left: `${sensitivityPosition}%` }} title={`Sensitivity ${state.inputs.sensitivityDbm} dBm`} />
              <span className={`meter-marker ${state.linkObjective === 'desired' ? 'required-marker' : 'threshold-marker'}`} style={{ left: `${referencePosition}%` }} title={referenceTitle} />
            </div>
            <div className="meter-scale"><span>{scaleMin} dBm</span><span>{scaleMax} dBm</span></div>
            <div className="threshold-key"><span className="sensitivity-key">Sensitivity <b>{formatNumber(state.inputs.sensitivityDbm)} dBm</b></span><span className={state.linkObjective === 'desired' ? 'required-key' : 'threshold-key-item'} title={referenceTitle}>{referenceLabel} <b>{formatNumber(referenceValueDbm)} dBm</b></span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DistanceView({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const points = useMemo(() => distanceSweep(state.inputs, state.distanceSweep), [state.inputs, state.distanceSweep]);
  const setSetting = (key: keyof AppState['distanceSweep'], value: number) => setState((current) => ({ ...current, distanceSweep: { ...current.distanceSweep, [key]: value } }));
  const data = { labels: points.map((p) => p.distanceM), datasets: [
    { label: 'Received power', data: points.map((p) => p.receivedPowerDbm), borderColor: '#ffb347', backgroundColor: 'rgba(255,179,71,.10)', fill: true, tension: .2, pointRadius: 0, borderWidth: 2.5 },
    { label: 'Receiver sensitivity', data: points.map(() => state.inputs.sensitivityDbm), borderColor: '#72b7ff', borderDash: [7, 6], pointRadius: 0, borderWidth: 1.5 },
    { label: 'Interference threshold', data: points.map(() => state.inputs.interferenceThresholdDbm), borderColor: '#ff6b6b', borderDash: [7, 6], pointRadius: 0, borderWidth: 1.5 },
  ] };
  return <SweepLayout title={`${state.inputs.scenarioName} · Power vs distance`} description="Sweep Tx-to-Rx separation while all other calculator inputs remain fixed." controls={<><NumberField label="Minimum distance" unit="m" min={0.000001} value={state.distanceSweep.minDistanceM} onChange={(v) => setSetting('minDistanceM', v)} /><NumberField label="Maximum distance" unit="m" min={0.000001} value={state.distanceSweep.maxDistanceM} onChange={(v) => setSetting('maxDistanceM', v)} /><NumberField label="Distance step" unit="m" min={0.000001} value={state.distanceSweep.stepM} onChange={(v) => setSetting('stepM', v)} /><div className="point-count"><span>Calculated points</span><strong>{points.length}</strong><small>Maximum 1,000</small></div></>} chart={<Line data={data} options={chartOptions('Distance (m)')} />} table={<SimpleSweepTable headers={['Distance (m)', 'Received power (dBm)', 'Sensitivity (dBm)', 'Interference threshold (dBm)']} rows={points.slice(0, 20).map((p) => [formatNumber(p.distanceM), formatNumber(p.receivedPowerDbm), formatNumber(state.inputs.sensitivityDbm), formatNumber(state.inputs.interferenceThresholdDbm)])} total={points.length} />} />;
}

function GainView({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const points = useMemo(() => gainSweep(state.inputs, state.gainSweep), [state.inputs, state.gainSweep]);
  const setSetting = <K extends keyof AppState['gainSweep']>(key: K, value: AppState['gainSweep'][K]) => setState((current) => ({ ...current, gainSweep: { ...current.gainSweep, [key]: value } }));
  const colors = ['#ffb347', '#72b7ff', '#34d399'];
  const data = { labels: points.map((p) => p.gainDbi), datasets: [
    ...state.gainSweep.distancesM.map((distance, curve) => ({ label: `Curve ${curve + 1} · ${distance} m`, data: points.map((p) => p.receivedPowerDbm[curve]), borderColor: colors[curve], pointRadius: 0, borderWidth: 2.3, tension: .15 })),
    { label: 'Receiver sensitivity', data: points.map(() => state.inputs.sensitivityDbm), borderColor: '#72b7ff', borderDash: [7, 6], pointRadius: 0, borderWidth: 1.5 },
    { label: 'Interference threshold', data: points.map(() => state.inputs.interferenceThresholdDbm), borderColor: '#ff6b6b', borderDash: [7, 6], pointRadius: 0, borderWidth: 1.5 },
  ] };
  return <SweepLayout title={`Power vs ${state.gainSweep.gainToSweep === 'tx' ? 'Tx' : 'Rx'} antenna gain`} description="Compare three distances while sweeping either transmit or receive antenna gain." controls={<><label className="field"><span>Gain to sweep</span><select value={state.gainSweep.gainToSweep} onChange={(e) => setSetting('gainToSweep', e.target.value as 'tx' | 'rx')}><option value="tx">Tx antenna gain</option><option value="rx">Rx antenna gain</option></select></label><NumberField label="Minimum gain" unit="dBi" value={state.gainSweep.minGainDbi} onChange={(v) => setSetting('minGainDbi', v)} /><NumberField label="Maximum gain" unit="dBi" value={state.gainSweep.maxGainDbi} onChange={(v) => setSetting('maxGainDbi', v)} /><NumberField label="Gain step" unit="dB" min={0.000001} value={state.gainSweep.stepDb} onChange={(v) => setSetting('stepDb', v)} /><div className="distance-controls"><span>Comparison distances</span>{state.gainSweep.distancesM.map((distance, index) => <NumberField key={index} label={`Curve ${index + 1}`} unit="m" min={0.000001} value={distance} onChange={(value) => { const distances = [...state.gainSweep.distancesM] as [number, number, number]; distances[index] = value; setSetting('distancesM', distances); }} />)}</div><div className="point-count"><span>Calculated points</span><strong>{points.length}</strong><small>Maximum 301</small></div></>} chart={<Line data={data} options={chartOptions('Swept gain (dBi)')} />} table={<SimpleSweepTable headers={['Gain (dBi)', ...state.gainSweep.distancesM.map((d, i) => `Curve ${i + 1} · ${d} m`)]} rows={points.slice(0, 20).map((p) => [formatNumber(p.gainDbi), ...p.receivedPowerDbm.map((v) => formatNumber(v))])} total={points.length} />} />;
}

function SweepLayout({ title, description, controls, chart, table }: { title: string; description: string; controls: React.ReactNode; chart: React.ReactNode; table: React.ReactNode }) {
  return <div className="sweep-grid"><section className="panel sweep-controls"><p className="eyebrow">SWEEP SETTINGS</p><h2>{title}</h2><p className="muted">{description}</p><div className="control-stack">{controls}</div></section><section className="panel chart-panel"><div className="chart-wrap">{chart}</div></section><section className="panel table-panel">{table}</section></div>;
}

function SimpleSweepTable({ headers, rows, total }: { headers: string[]; rows: string[][]; total: number }) {
  return <><div className="panel-heading"><div><p className="eyebrow">DATA PREVIEW</p><h3>First {Math.min(20, total)} of {total} points</h3></div></div><div className="table-scroll"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></>;
}

function PlacementView({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const rows = useMemo(() => calculatePlacements(state.inputs, state.placements, state.linkObjective), [state.inputs, state.placements, state.linkObjective]);
  const update = (id: string, key: keyof PlacementScenario, value: string | number) => setState((current) => ({ ...current, placements: current.placements.map((row) => row.id === id ? { ...row, [key]: value } : row) }));
  return <section className="panel placement-panel"><div className="panel-heading"><div><p className="eyebrow">PLACEMENT COMPARISON</p><h2>Compare candidate sites</h2><p className="muted">Uses the calculator's transmit power, frequency, thresholds, fade target, and <b>{state.linkObjective === 'desired' ? 'desired communication' : 'interference avoidance'}</b> objective. Each row supplies its own gains, distance, and losses.</p></div><span className="version-chip">{rows.length} SCENARIOS</span></div><div className="table-scroll"><table className="placement-table"><thead><tr><th>Rank</th><th>Scenario</th><th>Distance (m)</th><th>Tx gain</th><th>Rx gain</th><th>Tx loss</th><th>Rx loss</th><th>Pol.</th><th>Obstr.</th><th>Other</th><th>Total loss</th><th>Power (dBm)</th><th>Link margin</th><th>Interference margin</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="rank">{row.rank || '—'}</span></td><td><input aria-label="Scenario name" value={row.name} onChange={(e) => update(row.id, 'name', e.target.value)} /></td>{(['distanceM','txGainDbi','rxGainDbi','txLossDb','rxLossDb','polarizationLossDb','obstructionLossDb','otherLossDb'] as const).map((key) => <td key={key}><input aria-label={key} type="number" value={row[key]} onChange={(e) => update(row.id, key, Number(e.target.value))} /></td>)}<td>{formatNumber(row.totalLossDb)}</td><td className="emphasis">{formatNumber(row.receivedPowerDbm)}</td><td>{formatNumber(row.linkMarginDb)}</td><td>{formatNumber(row.interferenceMarginDb)}</td><td><StatusBadge status={row.status} /></td></tr>)}</tbody></table></div></section>;
}

function GuideView() {
  return <div className="guide-grid"><section className="panel guide-hero"><p className="eyebrow">WEB 1.8.0 · VERSION 3 MODEL</p><h2>How the calculator works</h2><p>The web app reproduces the Version 3 workbook's free-space link budget, distance sweep, selectable Tx/Rx gain sweep, and placement comparison. Web 1.8.0 turns the Link workspace into a terrain-aware map of Singapore: place up to six transmitters and receivers, see where terrain shadows each transmitter's coverage, and check every receiver for its desired links and for interference. All calculations run locally in your browser.</p><a className="primary-button" href={WORKBOOK_URL}><FileDown size={18} /> Download the source workbook</a></section><section className="panel"><h3>Core equations</h3><div className="formula"><span>Free-space path loss</span><code>32.44 + 20 log₁₀(f MHz) + 20 log₁₀(d km)</code></div><div className="formula"><span>Received power</span><code>Pᵣ = Pₜ + Gₜ + Gᵣ − FSPL − total losses</code></div><div className="formula"><span>Link margin</span><code>Pᵣ − receiver sensitivity</code></div><div className="formula"><span>Interference margin</span><code>interference threshold − Pᵣ</code></div></section><section className="panel"><h3>Objective-based interpretation</h3><ul className="guide-list"><li><b>Desired communication:</b> acceptable when received power is above sensitivity by at least the fade target; the receiver meter shows sensitivity and the required receive level (sensitivity + fade-margin target).</li><li><b>Interference avoidance:</b> possible interference when predicted power meets or exceeds the screening threshold; the receiver meter shows sensitivity and the interference threshold.</li><li>The objective changes status interpretation and the relevant meter reference only. It does not change FSPL, received power, or either margin.</li></ul></section><section className="panel"><h3>Engineering limits</h3><p className="muted">Friis assumes free-space propagation and gains in the direction of the other antenna. The Calculator itself does not calculate antenna patterns, side-lobe coupling, multipath, rain fade, receiver bandwidth, duty cycle, true SNR, or aggregate interference. Add those effects as justified losses or use a dedicated propagation study.</p></section><section className="panel"><h3>Link workspace: Singapore map</h3><ul className="guide-list"><li><b>Sensors:</b> place up to six on the map. Each one is a transmitter or a receiver; switch with the TX/RX toggle. Drag a sensor, nudge it with the arrow keys (Shift for 10 m), or type its latitude and longitude.</li><li><b>Objectives per receiver:</b> each receiver has a set of desired transmitters: Auto (the nearest) unless you tick one or more. Those links are judged for desired communication; every other transmitter it hears is judged for interference.</li><li><b>Propagation model:</b> Terrain diffraction (default for new scenarios) adds an ITU-R P.526 Bullington knife-edge loss over the ground profile between each pair, with a 4/3 effective Earth radius; the result is frequency dependent and is added to Other loss. Free space ignores terrain and reproduces web 1.5.0 results.</li><li><b>Objectives:</b> the workspace default (Desired or Avoidance) applies to every receiver unless it has its own override. An avoidance receiver has no desired links; its Rx meter shows the displayed pair against the interference threshold.</li><li><b>Coverage map:</b> select a transmitter (or a receiver, to see its strongest desired transmitter) to draw a radial coverage map where a receiver with the linked receiver&apos;s settings would get an acceptable or weak link, or reach its interference threshold. Terrain shadows it; grey hatching marks unknown ground. In Free space, dashed rings show the reference ranges. With Terrain diffraction, choose Gradient (continuous received power) or Bands (acceptable, weak, interference) in the legend. Show all bands displays both objectives.</li><li><b>Link budget drawer:</b> every Calculator input, result and one Rx meter bar per desired transmitter (strongest first) with a Showing link from selector, plus a path profile (ground, Earth bulge, direct ray, 60 % first Fresnel zone). Drag its top edge to resize it (double-click to reset), or use Expand to fill the workspace.</li><li><b>Full screen:</b> the Full screen button in the map toolbar gives the workspace the whole screen, with every card; press F or Esc to toggle it.</li><li><b>Map:</b> OneMap street map, or Plain terrain (terrain shading only, no road or transit labels). Each desired link shows its distance at its midpoint.</li><li><b>View preferences</b> (coverage style, basemap, Show all bands, hidden panels, drawer size) are remembered on this device; they are not part of a scenario file.</li><li><b>Animation:</b> packets on desired links travel faster at higher frequencies, and stop under reduced motion.</li><li><b>Elevation:</b> antenna elevation = ground elevation + height above ground, from ALOS AW3D30 v4 (about 30 m resolution, a surface model that partly includes buildings and trees). Switch off Use terrain elevation to compare with flat ground.</li><li><b>Shared settings:</b> all sensors use one operating frequency and the shared polarization, environment and other losses, under Link settings.</li><li><b>Calculator, sweeps and placements</b> show the active link: the selected receiver and its strongest desired transmitter, or the one chosen in the Link budget drawer.</li><li><b>Limits:</b> diffraction uses one Bullington equivalent edge per path and no building heights, clutter, foliage, rain or multipath, and is not a substitute for a propagation study. If elevation tiles are missing the pair is flagged unknown rather than shown as a confident link. The map needs an internet connection. Map ©OneMap Singapore ODL v1.0; elevation ©JAXA, ALOS World 3D-30m (AW3D30).</li></ul></section><section className="panel"><h3>Scenario files</h3><p className="muted">Changes auto-save only on this device, including antenna positions and terrain settings. Scenarios from web 1.5.0 and earlier open with the terrain model; 1.4.0 and earlier open as two map sensors with terrain elevation off, so their results are unchanged. Switch Model to Free space to reproduce 1.5.0 numbers. A 1.6.0 receiver&apos;s intended transmitter becomes a one-item desired list. Export a JSON scenario to move it to another browser or keep a reviewed snapshot; importing replaces the current browser state.</p></section></div>;
}

export default App;
