import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { formatNumber } from '../lib/rf';
import {
  findModel, MAX_ANTENNA_MODELS, newSectorModel, OMNI_MODEL_ID, resolveAntenna, trackMap, typicalGainDbi, updateMapSensors, deleteModel, normAzimuth,
} from '../lib/antenna';
import type { AntennaModel, MapScenario, Sensor } from '../types';
import { CommitField } from './ui';
import { AntennaPolar } from './AntennaPolar';

type SetMap = (update: (current: MapScenario) => MapScenario) => void;

const usedBy = (map: MapScenario, id: string) => map.sensors.filter((s) => s.antenna.modelId === id).length;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const OMNI_PLOT: AntennaModel = { id: OMNI_MODEL_ID, name: 'Omni', kind: 'omni', gainDbi: 0, beamwidthDeg: 360, verticalBeamwidthDeg: 90, frontToBackDb: 0 };

/** First "<name> copy", "<name> copy 2"… not taken. */
function copyName(models: AntennaModel[], name: string) {
  const taken = new Set(models.map((m) => m.name));
  let candidate = `${name} copy`;
  for (let k = 2; taken.has(candidate); k += 1) candidate = `${name} copy ${k}`;
  return candidate;
}

/** Text field that validates on commit (Enter or blur), like CommitField. */
function NameField({ value, onCommit }: { value: string; onCommit: (value: string) => string | undefined }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : value;
  const commit = () => {
    setEditing(false);
    const message = onCommit(text.trim());
    setError(message ?? '');
  };
  return (
    <label className="field"><span>Name</span>
      <input type="text" aria-label="Model name" value={shown} aria-invalid={error ? true : undefined}
        onFocus={() => { setText(value); setEditing(true); }} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setEditing(false); setError(''); } }} />
      {error && <small className="field-error" role="alert">{error}</small>}
    </label>
  );
}

function ModelEditor({ model, models, update }: { model: AntennaModel; models: AntennaModel[]; update: (patch: Partial<AntennaModel>) => void }) {
  const range = (label: string, key: 'beamwidthDeg' | 'verticalBeamwidthDeg' | 'frontToBackDb', min: number, max: number) => (v: number) => {
    if (v < min || v > max) return `${label} must be between ${min} and ${max}.`;
    update({ [key]: v });
    return undefined;
  };
  const sector = model.kind === 'sector';
  return (
    <div className="form-grid two antenna-editor">
      <NameField value={model.name} onCommit={(name) => {
        if (!name) return 'Enter a name.';
        if (name.toLowerCase() === 'omni' || models.some((m) => m.id !== model.id && m.name === name)) return 'That name is already used.';
        update({ name });
        return undefined;
      }} />
      <label className="field"><span>Kind</span>
        <select aria-label="Model kind" value={model.kind} onChange={(e) => update({ kind: e.target.value as AntennaModel['kind'] })}>
          <option value="sector">Sector</option><option value="omni">Omni</option>
        </select>
      </label>
      <CommitField label="Gain (dBi)" ariaLabel="Gain" unit="dBi" value={model.gainDbi} help={`Typical for this beam: ${formatNumber(typicalGainDbi(model.beamwidthDeg, model.verticalBeamwidthDeg), 1)} dBi`}
        onCommit={(v) => { update({ gainDbi: v }); return undefined; }} />
      <CommitField label="Horizontal beamwidth" ariaLabel="Horizontal beamwidth" unit="°" value={model.beamwidthDeg} disabled={!sector} help="3 dB width, 1–180" onCommit={range('Horizontal beamwidth', 'beamwidthDeg', 1, 180)} />
      <CommitField label="Vertical beamwidth" ariaLabel="Vertical beamwidth" unit="°" value={model.verticalBeamwidthDeg} disabled={!sector} help="3 dB width, 1–90" onCommit={range('Vertical beamwidth', 'verticalBeamwidthDeg', 1, 90)} />
      <CommitField label="Front-to-back" ariaLabel="Front-to-back" unit="dB" value={model.frontToBackDb} disabled={!sector} help="Pattern loss cap, 0–60" onCommit={range('Front-to-back', 'frontToBackDb', 0, 60)} />
    </div>
  );
}

function SensorRow({ sensor, map, commit }: { sensor: Sensor; map: MapScenario; commit: (id: string, patch: (a: Sensor['antenna']) => Sensor['antenna']) => void }) {
  const a = sensor.antenna;
  const sector = resolveAntenna(map, sensor).kind === 'sector';
  const model = findModel(map, a.modelId);
  const target = a.aimAtId ? map.sensors.find((s) => s.id === a.aimAtId) : undefined;
  return (
    <tr>
      <th scope="row">{sensor.name}</th>
      <td>{sensor.role === 'tx' ? 'Transmitter' : 'Receiver'}</td>
      <td><select aria-label={`Model for ${sensor.name}`} value={model ? model.id : OMNI_MODEL_ID} onChange={(e) => commit(sensor.id, (x) => ({ ...x, modelId: e.target.value }))}>
        <option value={OMNI_MODEL_ID}>Omni</option>{map.antennaModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select></td>
      <td><CommitField label="Azimuth" ariaLabel={`Azimuth for ${sensor.name}`} unit="°" value={a.azimuthDeg} disabled={!sector}
        onCommit={(v) => { commit(sensor.id, (x) => ({ ...x, azimuthDeg: normAzimuth(v), aimAtId: null })); return undefined; }} /></td>
      <td><CommitField label="Downtilt" ariaLabel={`Downtilt for ${sensor.name}`} unit="°" value={a.downtiltDeg}
        onCommit={(v) => { if (v < -20 || v > 45) return 'Downtilt must be between −20 and 45.'; commit(sensor.id, (x) => ({ ...x, downtiltDeg: v })); return undefined; }} /></td>
      <td>
        <select aria-label={`Aim ${sensor.name} at`} value={target ? target.id : ''} disabled={!sector}
          onChange={(e) => commit(sensor.id, (x) => ({ ...x, aimAtId: e.target.value || null }))}>
          <option value="">Not tracking</option>
          {map.sensors.filter((s) => s.id !== sensor.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {target && <small className="tracking-note">Tracking {target.name}</small>}
      </td>
    </tr>
  );
}

export function AntennasTab({ map, setMap, onOpenWorkspace }: { map: MapScenario; setMap: SetMap; onOpenWorkspace?: () => void }) {
  const [pickedId, setPickedId] = useState(OMNI_MODEL_ID);
  const [confirming, setConfirming] = useState(false);
  const models = map.antennaModels;
  const picked = pickedId === OMNI_MODEL_ID ? undefined : findModel(map, pickedId);
  const full = models.length >= MAX_ANTENNA_MODELS;
  const pickedUse = picked ? usedBy(map, picked.id) : 0;
  const pick = (id: string) => { setPickedId(id); setConfirming(false); };

  const add = () => {
    const model = newSectorModel(models);
    setMap((m) => m.antennaModels.length >= MAX_ANTENNA_MODELS ? m : { ...m, antennaModels: [...m.antennaModels, model] });
    pick(model.id);
  };
  const duplicate = () => {
    if (!picked || full) return;
    const copy: AntennaModel = { ...picked, id: newSectorModel(models).id, name: copyName(models, picked.name) };
    setMap((m) => m.antennaModels.length >= MAX_ANTENNA_MODELS ? m : { ...m, antennaModels: [...m.antennaModels, copy] });
    pick(copy.id);
  };
  const remove = () => {
    if (!picked) return;
    setMap((m) => trackMap(deleteModel(m, picked.id)));
    pick(OMNI_MODEL_ID);
  };
  const updateModel = (patch: Partial<AntennaModel>) => picked && setMap((m) => ({ ...m, antennaModels: m.antennaModels.map((x) => x.id === picked.id ? { ...x, ...patch } : x) }));
  const commitSensor = (id: string, patch: (a: Sensor['antenna']) => Sensor['antenna']) => setMap((m) => updateMapSensors(m, (s) => s.id === id ? { ...s, antenna: patch(s.antenna) } : s));

  return (
    <div className="antennas-grid">
      <section className="panel antenna-library" aria-label="Antenna library">
        <div className="panel-heading"><div><p className="eyebrow">ANTENNA LIBRARY</p><h2>Models</h2></div><span className="version-chip">{models.length} / {MAX_ANTENNA_MODELS}</span></div>
        <div className="antenna-actions">
          <button type="button" className="ghost" onClick={add} disabled={full}><Plus size={15} aria-hidden="true" />New sector model</button>
          <button type="button" className="ghost" onClick={duplicate} disabled={!picked || full}><Copy size={15} aria-hidden="true" />Duplicate</button>
          <button type="button" className="ghost" onClick={() => pickedUse ? setConfirming(true) : remove()} disabled={!picked}><Trash2 size={15} aria-hidden="true" />Delete</button>
        </div>
        {confirming && picked && <div className="callout" role="alertdialog" aria-label="Confirm delete">
          <p>Used by {plural(pickedUse, 'sensor')}; {pickedUse === 1 ? 'it' : 'they'} will switch to Omni.</p>
          <div className="antenna-actions"><button type="button" className="ghost" onClick={remove}>Delete {picked.name}</button><button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancel</button></div>
        </div>}
        <ul className="model-list" aria-label="Models">
          <li><button type="button" className={pickedId === OMNI_MODEL_ID ? 'active' : ''} aria-pressed={pickedId === OMNI_MODEL_ID} onClick={() => pick(OMNI_MODEL_ID)}>
            <b>Omni</b><span>built-in · read-only</span><small>Uses each sensor&apos;s own gain · used by {plural(usedBy(map, OMNI_MODEL_ID), 'sensor')}</small>
          </button></li>
          {models.map((m) => <li key={m.id}><button type="button" className={pickedId === m.id ? 'active' : ''} aria-pressed={pickedId === m.id} onClick={() => pick(m.id)}>
            <b>{m.name}</b><span>{m.kind === 'sector' ? 'Sector' : 'Omni'} · {formatNumber(m.gainDbi, 1)} dBi{m.kind === 'sector' ? ` · ${m.beamwidthDeg}°×${m.verticalBeamwidthDeg}° · F/B ${m.frontToBackDb} dB` : ''}</span><small>used by {plural(usedBy(map, m.id), 'sensor')}</small>
          </button></li>)}
        </ul>
        {models.length === 0 && <p className="muted">No custom models yet. Add a sector model to give sensors a directional pattern.</p>}
        {full && <p className="field-note">The library holds at most {MAX_ANTENNA_MODELS} models.</p>}
      </section>

      <section className="panel antenna-editor-panel" aria-label="Model editor">
        <div className="panel-heading"><div><p className="eyebrow">MODEL</p><h2>{picked ? picked.name : 'Omni'}</h2></div></div>
        <div className="antenna-editor-body">
          {picked ? <ModelEditor key={picked.id} model={picked} models={models} update={updateModel} /> : <p className="muted">The built-in Omni model has no pattern loss and takes the gain from each sensor&apos;s own Gain field. It cannot be edited.</p>}
          <AntennaPolar model={picked ?? OMNI_PLOT} />
        </div>
      </section>

      <section className="panel antenna-sensors" aria-label="Sensor antennas">
        <div className="panel-heading"><div><p className="eyebrow">SENSORS</p><h2>Pointing</h2></div></div>
        {map.sensors.length === 0
          ? <p className="muted">Place sensors in the Link workspace first.{onOpenWorkspace && <> <button type="button" className="link-button" onClick={onOpenWorkspace}>Open the Link workspace</button></>}</p>
          : <div className="table-scroll"><table className="antenna-table">
            <thead><tr><th>Sensor</th><th>Role</th><th>Model</th><th>Azimuth (°)</th><th>Downtilt (°)</th><th>Aim at</th></tr></thead>
            <tbody>{map.sensors.map((s) => <SensorRow key={s.id} sensor={s} map={map} commit={commitSensor} />)}</tbody>
          </table></div>}
      </section>
    </div>
  );
}
