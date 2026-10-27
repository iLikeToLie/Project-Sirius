import { useState } from 'react';
import { formatNumber } from '../../lib/rf';
import { effectiveObjective, groundOf, type PairResult, receiverSummary } from '../../lib/sensors';
import type { GroundAt } from '../../lib/elevation';
import type { MapScenario, Sensor, SensorRole } from '../../types';
import { CommitField, StatusBadge } from '../ui';

/** OneMap coverage (Global Constraints bounds). */
export const SG_BOUNDS = { minLon: 103.596, minLat: 1.1443, maxLon: 104.4309, maxLat: 1.4835 };

const formatDistance = (m: number) => !Number.isFinite(m) ? '—' : m >= 1000 ? `${formatNumber(m / 1000, 2)} km` : `${formatNumber(m, 1)} m`;

export function SelectedSensorCard({ sensor, map, pairs, groundAt, zoneInfo, onChange, onRoleChange, onZonesFor }: {
  sensor: Sensor;
  map: MapScenario;
  pairs: PairResult[];
  groundAt: GroundAt;
  zoneInfo: { txName: string; rxName: string; reason: 'linked' | 'nearest'; aglM: number; linkedRxIds: string[] } | null;
  onChange: (patch: Partial<Sensor>) => string | undefined;
  onRoleChange: (role: SensorRole) => void;
  onZonesFor: (rxId: string) => void;
}) {
  const [tab, setTab] = useState('Sensor');
  const [collapsed, setCollapsed] = useState(false);
  const ground = groundOf(sensor, groundAt, map.useTerrainElevation);
  const name = (id: string) => map.sensors.find((s) => s.id === id)?.name ?? '—';
  const transmitters = map.sensors.filter((s) => s.role === 'tx');
  const summary = sensor.role === 'rx' ? receiverSummary(pairs, sensor.id) : null;
  const served = pairs.filter((p) => p.txId === sensor.id && p.intended);
  const interferes = pairs.filter((p) => p.txId === sensor.id && !p.intended && p.result.status === 'Possible interference');
  const nearestTx = sensor.role === 'rx' ? summary?.link && sensor.desiredTxIds === 'auto' ? name(summary.link.txId) : null : null;
  const num = (key: keyof Sensor, v: number, check?: (v: number) => string | undefined) => check?.(v) ?? onChange({ [key]: v });
  const nonNegative = (label: string) => (v: number) => (v < 0 ? `${label} cannot be negative.` : undefined);

  return (
    <section className={`map-card selected-sensor-card${collapsed ? ' collapsed' : ''}`} aria-label={`Selected sensor ${sensor.name}`}>
      <div className="map-card-heading">
        <input className="sensor-name-input" aria-label="Sensor name" value={sensor.name} onChange={(event) => onChange({ name: event.target.value })} />
        <div className="segmented" role="group" aria-label="Sensor role">
          {(['tx', 'rx'] as const).map((role) => (
            <button key={role} type="button" className={sensor.role === role ? 'active' : ''} aria-pressed={sensor.role === role} onClick={() => onRoleChange(role)}>
              {role === 'tx' ? 'Transmitter' : 'Receiver'}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="ghost" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? 'Expand sensor' : 'Collapse sensor'}</button>
      {!collapsed && <>
      <div className="segmented" role="tablist" aria-label="Sensor details">{['Sensor', 'Link', 'Coverage'].map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div hidden={tab !== 'Sensor'}>
      <div className="form-grid two">
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

      <dl className="readouts">
        <div><dt>Ground elevation</dt><dd>{!map.useTerrainElevation ? '0 m (terrain off)' : ground === null ? 'Elevation unavailable' : `${formatNumber(ground, 1)} m`}</dd></div>
        <div><dt>Total antenna elevation</dt><dd>{formatNumber((ground ?? 0) + sensor.aglM, 1)} m{map.useTerrainElevation && ground === null ? ' (ground taken as 0)' : ''}</dd></div>
      </dl>

      </div>
      <div hidden={tab !== 'Link'}>
      {sensor.role === 'rx' && <label className="field"><span>Objective</span><select value={sensor.objective} onChange={e => onChange({ objective: e.target.value as Sensor['objective'] })}><option value="default">Workspace default ({map.defaultObjective})</option><option value="desired">Desired</option><option value="avoidance">Avoidance</option></select></label>}
      {sensor.role === 'rx' && effectiveObjective(map, sensor) === 'desired' && (
        <label className="field">
          <span>Intended transmitter</span>
          <select value={sensor.desiredTxIds === 'auto' ? 'auto' : sensor.desiredTxIds[0] ?? 'auto'} onChange={(event) => onChange({ desiredTxIds: event.target.value === 'auto' ? 'auto' : [event.target.value] })}>
            <option value="auto">{nearestTx ? `Auto (nearest: ${nearestTx})` : 'Auto (nearest)'}</option>
            {transmitters.map((tx) => <option key={tx.id} value={tx.id}>{tx.name}</option>)}
          </select>
        </label>
      )}

      <div className="sensor-results" aria-live="polite">
        {sensor.role === 'rx' && summary && (summary.link ? (
          <>
            <div className="result-line"><span>Link from {name(summary.link.txId)}</span><strong>{formatNumber(summary.link.result.receivedPowerDbm)} dBm</strong><StatusBadge status={summary.link.result.status} /></div>
            <p className="field-note">{summary.link.clearance} · Diffraction {formatNumber(summary.link.propagationLossDb)} dB · {formatDistance(summary.link.distanceM)} 3D separation{summary.link.elevationKnown ? '' : '. Elevation unavailable for this path; terrain prediction is unknown.'}</p>
            {summary.worstInterferer
              ? <div className="result-line danger"><span>Worst interferer {name(summary.worstInterferer.txId)}</span><strong>{formatNumber(summary.worstInterferer.result.receivedPowerDbm)} dBm</strong><StatusBadge status={summary.worstInterferer.result.status} /></div>
              : <p className="field-note">No other transmitter reaches its {formatNumber(sensor.interferenceThresholdDbm, 1)} dBm interference threshold.</p>}
          </>
        ) : <p className="field-note">{effectiveObjective(map, sensor) === 'avoidance' ? `Avoidance: ${summary.interferersAbove} transmitter(s) above interference threshold.` : 'No intended transmitter available.'}</p>)}

        {sensor.role === 'tx' && (
          <>
            <p className="field-note">{served.length ? `Serves ${served.map((p) => `${name(p.rxId)} (${p.result.status.toLowerCase()})`).join(', ')}.` : 'No receiver has this transmitter as its intended link.'}</p>
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
          <p className="field-note">Using {zoneInfo.rxName}’s settings{zoneInfo.reason === 'nearest' ? ' (nearest receiver; none is linked to this transmitter)' : ''}. {map.propagationModel === 'terrain' ? 'Terrain diffraction at Rx height' : 'Free-space boundary at Rx height'} {formatNumber(zoneInfo.aglM, 1)} m above ground. Dashed rings are free-space reference ranges.</p>
        </div>
      )}
      </div></>}
    </section>
  );
}
