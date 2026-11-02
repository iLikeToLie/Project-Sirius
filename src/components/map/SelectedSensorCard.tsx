import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatNumber } from '../../lib/rf';
import { mitigations, pairVerdict, transmitterPowerRange, type ReceiverAssessment } from '../../lib/interference';
import { effectiveObjective, groundOf, type PairResult, receiverSummary, toggleDesired } from '../../lib/sensors';
import type { GroundAt } from '../../lib/elevation';
import type { MapScenario, Sensor, SensorRole } from '../../types';
import { CommitField, StatusBadge } from '../ui';
import { SensorChannel } from './SensorChannel';
import { noiseFloorDbm } from '../../lib/isolation';

/** OneMap coverage (Global Constraints bounds). */
export const SG_BOUNDS = { minLon: 103.596, minLat: 1.1443, maxLon: 104.4309, maxLat: 1.4835 };

const formatDistance = (m: number) => !Number.isFinite(m) ? '—' : m >= 1000 ? `${formatNumber(m / 1000, 2)} km` : `${formatNumber(m, 1)} m`;

export function SelectedSensorCard({ sensor, map, pairs, assessments, groundAt, zoneInfo, onChange, onRoleChange, onZonesFor, defaultFrequencyGhz }: {
  defaultFrequencyGhz: number;
  sensor: Sensor;
  map: MapScenario;
  pairs: PairResult[];
  assessments: Map<string, ReceiverAssessment>;
  groundAt: GroundAt;
  zoneInfo: { txName: string; rxName: string; reason: 'linked' | 'nearest'; aglM: number; linkedRxIds: string[] } | null;
  onChange: (patch: Partial<Sensor>) => string | undefined;
  onRoleChange: (role: SensorRole) => void;
  onZonesFor: (rxId: string) => void;
}) {
  const [tab, setTab] = useState('Sensor');
  const [collapsed, setCollapsed] = useState(false);
  const [noiseFigureDb, setNoiseFigureDb] = useState(6);
  const [interferenceToNoiseDb, setInterferenceToNoiseDb] = useState(-6);
  const noiseDbm = noiseFloorDbm(sensor.bandwidthMhz, noiseFigureDb);
  const derivedThresholdDbm = noiseDbm + interferenceToNoiseDb;
  const ground = groundOf(sensor, groundAt, map.useTerrainElevation);
  const name = (id: string) => map.sensors.find((s) => s.id === id)?.name ?? '—';
  const transmitters = map.sensors.filter((s) => s.role === 'tx');
  const summary = sensor.role === 'rx' ? receiverSummary(pairs, sensor.id) : null;
  const assessment = assessments.get(sensor.id);
  const suggestions = sensor.role === 'rx' && assessment ? mitigations(map, assessment, pairs).slice(0, 3) : [];
  const link = summary?.links[0];
  const served = pairs.filter((p) => p.txId === sensor.id && p.intended);
  const interferes = pairs.filter((p) => {
    if (p.txId !== sensor.id || p.intended) return false;
    const a = assessments.get(p.rxId)!;
    const verdict = pairVerdict(p, map.sensors.find(s => s.id === p.rxId)!, a.marginDb);
    return verdict === 'Possible interference' || verdict === 'Marginal interference' || (a.aggregate && a.status !== 'Below interference threshold' && a.contributors.some(c => c.txId === sensor.id && c.share >= 0.1));
  });
  const nearestTx = sensor.role === 'rx' ? link && sensor.desiredTxIds === 'auto' ? name(link.txId) : null : null;
  const num = (key: keyof Sensor, v: number, check?: (v: number) => string | undefined) => check?.(v) ?? onChange({ [key]: v });
  const nonNegative = (label: string) => (v: number) => (v < 0 ? `${label} cannot be negative.` : undefined);
  const powerRange = sensor.role === 'tx' ? transmitterPowerRange(map, sensor.id, pairs) : null;
  const roundedMax = powerRange ? Math.floor(powerRange.maxDbm * 10) / 10 : NaN;
  const infeasible = powerRange !== null && (powerRange.maxDbm === -Infinity || (powerRange.minDbm !== null && powerRange.minDbm > powerRange.maxDbm));
  const roundedBelowMin = powerRange?.minDbm !== null && powerRange?.minDbm !== undefined && roundedMax < powerRange.minDbm;

  return (
    <section className={`map-card selected-sensor-card${collapsed ? ' collapsed' : ''}`} aria-label={`Selected sensor ${sensor.name}`}>
      <div className="map-card-heading">
        <input className="sensor-name-input" aria-label="Sensor name" value={sensor.name} onChange={(event) => onChange({ name: event.target.value })} />
        <button type="button" className="icon-button" aria-label={collapsed ? 'Expand sensor' : 'Collapse sensor'} title={collapsed ? 'Expand' : 'Collapse'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
      </div>
      <div className="segmented role-toggle" role="group" aria-label="Sensor role">
        {(['tx', 'rx'] as const).map((role) => (
          <button key={role} type="button" className={sensor.role === role ? 'active' : ''} aria-pressed={sensor.role === role} onClick={() => onRoleChange(role)}>
            {role === 'tx' ? 'Transmitter' : 'Receiver'}
          </button>
        ))}
      </div>
      {!collapsed && <>
      <div className="tabs" role="tablist" aria-label="Sensor details">{['Sensor', 'Link', 'Coverage'].map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div hidden={tab !== 'Sensor'}>
      <div className="form-grid two">
        <label className="field"><span>Polarization</span><select aria-label="Sensor polarization" value={sensor.polarization} onChange={e => onChange({ polarization: e.target.value as Sensor['polarization'] })}>
          <option value="V">V (vertical)</option><option value="H">H (horizontal)</option><option value="RHCP">RHCP (right circular)</option><option value="LHCP">LHCP (left circular)</option>
        </select></label>
        <CommitField label="Latitude" unit="°" value={sensor.lat} onCommit={(v) => num('lat', v, (x) => (x < SG_BOUNDS.minLat || x > SG_BOUNDS.maxLat ? 'Keep within the Singapore map area.' : undefined))} />
        <CommitField label="Longitude" unit="°" value={sensor.lon} onCommit={(v) => num('lon', v, (x) => (x < SG_BOUNDS.minLon || x > SG_BOUNDS.maxLon ? 'Keep within the Singapore map area.' : undefined))} />
        <CommitField label="Height above ground" unit="m" value={sensor.aglM} onCommit={(v) => num('aglM', v, nonNegative('Height above ground'))} />
        <CommitField label="Antenna gain" unit="dBi" value={sensor.gainDbi} onCommit={(v) => num('gainDbi', v)} />
        <CommitField label="Cable & connector loss" unit="dB" value={sensor.cableLossDb} onCommit={(v) => num('cableLossDb', v, nonNegative('Cable loss'))} />
        {sensor.role === 'tx'
          ? <CommitField label="Transmit power" unit="dBm" value={sensor.powerDbm} onCommit={(v) => num('powerDbm', v)} />
          : <CommitField label="Sensitivity" unit="dBm" value={sensor.sensitivityDbm} onCommit={(v) => num('sensitivityDbm', v)} />}
        {sensor.role === 'rx' && <>
          <CommitField label="Fade margin target" unit="dB" value={sensor.fadeMarginTargetDb} onCommit={(v) => num('fadeMarginTargetDb', v, nonNegative('Fade margin'))} />
          <CommitField label="Interference threshold" unit="dBm" value={sensor.interferenceThresholdDbm} onCommit={(v) => num('interferenceThresholdDbm', v)} />
        </>}
      </div>

      <SensorChannel sensor={sensor} model={map.rejectionModel} defaultFrequencyGhz={defaultFrequencyGhz} onChange={onChange} />
      {sensor.role === 'rx' && <details className="noise-floor-derivation">
        <summary>Derive from noise floor</summary>
        <p className="field-note">Using this receiver’s {formatNumber(sensor.bandwidthMhz)} MHz bandwidth and −174 dBm/Hz thermal noise. The threshold is N + I/N; applying it keeps the receiver’s protection margin.</p>
        <div className="form-grid two">
          <CommitField label="Noise figure" unit="dB" value={noiseFigureDb} onCommit={v => { if (v < 0) return 'Noise figure cannot be negative.'; setNoiseFigureDb(v); return undefined; }} />
          <CommitField label="I/N" unit="dB" value={interferenceToNoiseDb} help="Allowed interference relative to noise" onCommit={v => { setInterferenceToNoiseDb(v); return undefined; }} />
        </div>
        <dl className="readouts">
          <div><dt>Noise floor (N)</dt><dd>{formatNumber(noiseDbm, 1)} dBm</dd></div>
          <div><dt>Derived threshold (N + I/N)</dt><dd>{formatNumber(derivedThresholdDbm, 1)} dBm</dd></div>
        </dl>
        <button type="button" className="ghost" disabled={!Number.isFinite(derivedThresholdDbm)} onClick={() => onChange({ interferenceThresholdDbm: derivedThresholdDbm })}>Use as interference threshold</button>
      </details>}
      <dl className="readouts">
        <div><dt>Ground elevation</dt><dd>{!map.useTerrainElevation ? '0 m (terrain off)' : ground === null ? 'Elevation unavailable' : `${formatNumber(ground, 1)} m`}</dd></div>
        <div><dt>Total antenna elevation</dt><dd>{formatNumber((ground ?? 0) + sensor.aglM, 1)} m{map.useTerrainElevation && ground === null ? ' (ground taken as 0)' : ''}</dd></div>
      </dl>

      </div>
      <div hidden={tab !== 'Link'}>
      {sensor.role === 'rx' && <label className="field"><span>Objective</span><select value={sensor.objective} onChange={e => onChange({ objective: e.target.value as Sensor['objective'] })}><option value="default">Default ({map.defaultObjective === 'desired' ? 'Desired' : 'Avoidance'})</option><option value="desired">Desired</option><option value="avoidance">Avoidance</option></select></label>}
      {sensor.role === 'rx' && effectiveObjective(map, sensor) === 'desired' && (
        <fieldset className="desired-transmitters">
          <legend>Desired transmitters</legend>
          <label className="switch"><input type="checkbox" checked={sensor.desiredTxIds === 'auto'} disabled={sensor.desiredTxIds === 'auto'} onChange={() => onChange({ desiredTxIds: 'auto' })} />{nearestTx ? `Auto (nearest: ${nearestTx})` : 'Auto (nearest)'}</label>
          {transmitters.map((tx) => <label className="switch" key={tx.id}><input type="checkbox" checked={sensor.desiredTxIds !== 'auto' && sensor.desiredTxIds.includes(tx.id)} onChange={() => onChange({ desiredTxIds: toggleDesired(sensor.desiredTxIds, tx.id, transmitters.map((s) => s.id)) })} />{tx.name}</label>)}
        </fieldset>
      )}

      <div className="sensor-results" aria-live="polite">
        {sensor.role === 'rx' && assessment && <>
          <div className="form-grid two interference-controls">
            <CommitField label="Required C/I" unit="dB" value={sensor.requiredCiDb} onCommit={v => num('requiredCiDb', v, nonNegative('Required C/I'))} />
            <CommitField label="Protection margin" unit="dB" value={assessment.marginDb} disabled={sensor.protectionMarginDb === 'default'} onCommit={v => num('protectionMarginDb', v, nonNegative('Protection margin'))} />
          </div>
          <label className="switch"><input type="checkbox" checked={sensor.protectionMarginDb === 'default'} onChange={e => onChange({ protectionMarginDb: e.target.checked ? 'default' : assessment.marginDb })} />Use scenario ({map.protectionMarginDb} dB)</label>
          <dl className="readouts">
            <div><dt>Interference ({assessment.aggregate ? `aggregate of ${assessment.contributors.length}` : 'worst single'})</dt><dd>{assessment.interferenceDbm === -Infinity ? 'None' : `${formatNumber(assessment.interferenceDbm)} dBm`}</dd></div>
            <div><dt>Protected limit</dt><dd>{formatNumber(assessment.limitDbm)} dBm (threshold − {formatNumber(assessment.marginDb)} dB)</dd></div>
          </dl>
          <StatusBadge status={assessment.status} />
          {assessment.contributors.length > 0 && <ul className="interference-contributors" aria-label="Interference contributors">{assessment.contributors.map(c => <li key={c.txId}>{name(c.txId)}: {formatNumber(c.powerDbm)} dBm · {formatNumber(c.share * 100, 0)}%</li>)}</ul>}
          {assessment.unknownPaths > 0 && <p className="field-note" role="status">{assessment.unknownPaths} paths unknown; excluded from interference assessment.</p>}
        </>}
        {sensor.role === 'rx' && summary && (link ? (
          <>
            {summary.links.map((desired) => <div key={desired.txId}>
              <div className="result-line"><span>Link from {name(desired.txId)}</span><strong>{desired.elevationKnown ? `${formatNumber(desired.result.receivedPowerDbm)} dBm` : 'Unknown'}</strong>{desired.elevationKnown && <StatusBadge status={assessment!.links.find(l => l.txId === desired.txId)!.status} />}</div>
              {desired.rejectionDb > 0 && <p className="field-note warning">Off-channel for {sensor.name} (−{formatNumber(desired.rejectionDb)} dB)</p>}
              <p className="field-note">C/I {desired.elevationKnown ? assessment!.links.find(l => l.txId === desired.txId)!.ciDb === Infinity ? '∞' : formatNumber(assessment!.links.find(l => l.txId === desired.txId)!.ciDb) : 'Unknown'} dB · Required {formatNumber(sensor.requiredCiDb)} dB</p>
              <p className="field-note">{desired.clearance} · Diffraction {formatNumber(desired.propagationLossDb)} dB · {formatDistance(desired.distanceM)} 3D separation{desired.elevationKnown ? '' : '. Elevation unavailable for this path; terrain prediction is unknown.'}</p>
            </div>)}
          </>
        ) : <p className="field-note">{effectiveObjective(map, sensor) === 'avoidance' ? 'Avoidance: every transmitter is assessed as interference.' : 'No intended transmitter available.'}</p>)}

        {suggestions.length > 0 && <div className="receiver-fixes">
          <p className="field-note"><b>Possible fixes</b></p>
          <ul className="interference-contributors" aria-label="Fix suggestions">{suggestions.map(s => <li key={`${s.kind}-${s.txId}`}>{s.text}</li>)}</ul>
        </div>}

        {sensor.role === 'tx' && (
          <>
            {powerRange && <div className="transmitter-power-range" aria-label="Transmitter power range">
              <p><b>Power range:</b> {powerRange.minDbm === null ? '−∞' : formatNumber(powerRange.minDbm, 1)} to {powerRange.maxDbm === Infinity ? '+∞' : powerRange.maxDbm === -Infinity ? '−∞' : formatNumber(powerRange.maxDbm, 1)} dBm</p>
              {powerRange.limitedBy && <p className="field-note">Limited by {name(powerRange.limitedBy)} ({powerRange.limitKind === 'ci' ? 'C/I requirement' : 'protected limit'}){powerRange.maxDbm === -Infinity ? '; other transmitters already reach this limit.' : '.'}</p>}
              {powerRange.minFor && <p className="field-note">Minimum required by {name(powerRange.minFor)} for sensitivity plus fade margin and required C/I.</p>}
              {powerRange.maxDbm === Infinity && <p className="field-note">No upper limit from known receiver paths.</p>}
              {infeasible && <p className="field-note danger" role="status">No power level satisfies both; move or retune.</p>}
              {!infeasible && roundedBelowMin && <p className="field-note" role="status">Rounding the maximum down to 0.1 dBm would fall below the required minimum.</p>}
              {powerRange.unknownPaths > 0 && <p className="field-note" role="status">{powerRange.unknownPaths} paths unknown; power range is incomplete.</p>}
              <button type="button" className="ghost" disabled={!Number.isFinite(roundedMax) || infeasible || roundedBelowMin || powerRange.unknownPaths > 0} onClick={() => onChange({ powerDbm: roundedMax })}>Set to max</button>
            </div>}
            <p className="field-note">{served.length ? `Serves ${served.map((p) => `${name(p.rxId)} (${assessments.get(p.rxId)!.links.find(l => l.txId === sensor.id)!.status.toLowerCase()})`).join(', ')}.` : 'No receiver has this transmitter as its intended link.'}</p>
            {served.filter(p => p.rejectionDb > 0).map(p => <p key={p.rxId} className="field-note warning">Off-channel for {name(p.rxId)} (−{formatNumber(p.rejectionDb)} dB)</p>)}
            {interferes.length > 0 && <p className="field-note danger">Interferes with {interferes.map((p) => `${name(p.rxId)} at ${formatNumber(p.result.receivedPowerDbm, 1)} dBm`).join(', ')}.</p>}
          </>
        )}
      </div>

      </div>
      <div hidden={tab !== 'Coverage'}>
      {zoneInfo && (
        <div className="zone-legend">
          <div className="map-card-heading"><h4>Range of {zoneInfo.txName}</h4>
            {sensor.role === 'tx' && zoneInfo.linkedRxIds.length > 1 && (
              <label className="inline-select"><span>Zones for</span>
                <select value={map.zonesForRxId !== 'auto' && zoneInfo.linkedRxIds.includes(map.zonesForRxId) ? map.zonesForRxId : 'auto'} onChange={(event) => onZonesFor(event.target.value)}>
                  <option value="auto">Nearest linked</option>
                  {zoneInfo.linkedRxIds.map((id) => <option key={id} value={id}>{name(id)}</option>)}
                </select>
              </label>
            )}
          </div>
          <ul>
            <li><span className="swatch swatch-acceptable" aria-hidden="true" />Acceptable link</li>
            <li><span className="swatch swatch-weak" aria-hidden="true" />Weak link (above sensitivity)</li>
            <li><span className="swatch swatch-interference" aria-hidden="true" />Possible interference</li>
          </ul>
          <p className="field-note">Using {zoneInfo.rxName}’s settings{zoneInfo.reason === 'nearest' ? ' (nearest receiver; none is linked to this transmitter)' : ''}. {map.propagationModel === 'terrain' ? 'Terrain diffraction at Rx height' : 'Free-space boundary at Rx height'} {formatNumber(zoneInfo.aglM, 1)} m above ground.{map.propagationModel === 'terrain' ? '' : ' Dashed rings are free-space reference ranges.'}</p>
        </div>
      )}
      </div></>}
    </section>
  );
}
