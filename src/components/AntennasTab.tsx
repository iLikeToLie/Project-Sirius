import { Fragment, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { formatNumber } from '../lib/rf';
import {
  findModel, MAX_ANTENNA_MODELS, newSectorModel, OMNI_MODEL_ID, resolveAntenna, trackMap, typicalGainDbi, updateMapSensors, deleteModel, normAzimuth,
} from '../lib/antenna';
import { derivedBeamwidthDeg, sectorToPoints } from '../lib/antenna';
import { exportModelsJson, importAntennaFile } from '../lib/antennaFiles';
import { addPreset, ANTENNA_PRESETS, PRESET_FAMILIES } from '../lib/antennaPresets';
import type { AntennaModel, MapScenario, Sensor } from '../types';
import { CommitField } from './ui';
import { AntennaPolar, isSymmetric, MAX_LOSS_DB, MAX_POINTS, withAngle, withLoss, withoutPoint, withPoint, interpLoss, type Cut } from './AntennaPolar';

type SetMap = (update: (current: MapScenario) => MapScenario) => void;

const usedBy = (map: MapScenario, id: string) => map.sensors.filter((s) => s.antenna.modelId === id).length;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const OMNI_PLOT: AntennaModel = { id: OMNI_MODEL_ID, name: 'Omni', kind: 'omni', gainDbi: 0, beamwidthDeg: 360, verticalBeamwidthDeg: 90, frontToBackDb: 0 };

const KIND_LABEL: Record<AntennaModel['kind'], string> = { omni: 'Omni', sector: 'Sector', custom: 'Custom' };
type Pattern = NonNullable<AntennaModel['pattern']>;
const clamp = (v: number, lo: number, hi: number) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : hi;

/** Model fields that follow a pattern edit: the tables, their derived 3 dB widths, and a cap no lower than the largest horizontal loss. */
export function patternPatch(model: AntennaModel, pattern: Pattern): Partial<AntennaModel> {
  const maxH = Math.max(0, ...pattern.horizontal.map((p) => p[1]));
  return {
    pattern,
    beamwidthDeg: Math.round(clamp(derivedBeamwidthDeg(pattern.horizontal), 1, 180) * 10) / 10,
    verticalBeamwidthDeg: Math.round(clamp(derivedBeamwidthDeg(pattern.vertical), 1, 90) * 10) / 10,
    frontToBackDb: maxH > model.frontToBackDb ? Math.min(MAX_LOSS_DB, Math.ceil(maxH * 10) / 10) : model.frontToBackDb,
  };
}

/** Fields to change when the kind select changes: switching to Custom seeds the tables from the sector curve unless a pattern is already kept. */
export const kindPatch = (model: AntennaModel, kind: AntennaModel['kind']): Partial<AntennaModel> =>
  kind === 'custom' && !model.pattern ? { kind, pattern: sectorToPoints(model) } : { kind };

/** Message for the library panel after an import attempt. */
export function describeImport(result: { added: number; skipped: number; notes: string[] } | { error: string }): { ok: boolean; text: string } {
  if ('error' in result) return { ok: false, text: result.error };
  const added = `${result.added} model${result.added === 1 ? '' : 's'}`;
  return { ok: true, text: [`Added ${added}${result.skipped ? `, skipped ${result.skipped} (the library holds ${MAX_ANTENNA_MODELS})` : ''}.`, ...result.notes].join(' ') };
}

/** Parses "angle, loss" lines (comma, semicolon, tab or space separated) for one cut; per-line errors, and nothing applied when any line fails. */
export function parsePastedPoints(text: string, cut: 'h' | 'v'): { points: Cut } | { errors: string[] } {
  const [lo, hi] = cut === 'h' ? [0, 360] : [-90, 90];
  const errors: string[] = [];
  const points: Cut = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[\s,;]+/);
    const angle = Number(parts[0]), loss = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(angle) || !Number.isFinite(loss)) errors.push(`Line ${i + 1}: expected "angle, loss".`);
    else if (angle < lo || angle > hi) errors.push(`Line ${i + 1}: angle must be between ${lo} and ${hi}.`);
    else if (loss < 0 || loss > MAX_LOSS_DB) errors.push(`Line ${i + 1}: loss must be between 0 and ${MAX_LOSS_DB} dB.`);
    else if (points.some(([a]) => a === angle)) errors.push(`Line ${i + 1}: angle ${angle} is repeated.`);
    else points.push([angle, loss]);
  });
  if (!errors.length && (points.length < 2 || points.length > MAX_POINTS)) errors.push(`Enter between 2 and ${MAX_POINTS} points.`);
  return errors.length ? { errors } : { points: points.sort((a, b) => a[0] - b[0]) };
}

/** Saves text as a file through a temporary link, like the scenario export. */
function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
const fileSlug = (name: string) => name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'antenna';

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
  const custom = model.kind === 'custom';
  const onKind = (kind: AntennaModel['kind']) => update(kindPatch(model, kind));
  return (
    <div className="form-grid two antenna-editor">
      <NameField value={model.name} onCommit={(name) => {
        if (!name) return 'Enter a name.';
        if (name.toLowerCase() === 'omni' || models.some((m) => m.id !== model.id && m.name === name)) return 'That name is already used.';
        update({ name });
        return undefined;
      }} />
      <label className="field"><span>Kind</span>
        <select aria-label="Model kind" value={model.kind} onChange={(e) => onKind(e.target.value as AntennaModel['kind'])}>
          <option value="sector">Sector</option><option value="custom">Custom (point table)</option><option value="omni">Omni</option>
        </select>
      </label>
      <CommitField label="Gain (dBi)" ariaLabel="Gain" unit="dBi" value={model.gainDbi} help={`Typical for this beam: ${formatNumber(typicalGainDbi(model.beamwidthDeg, model.verticalBeamwidthDeg), 1)} dBi`}
        onCommit={(v) => { update({ gainDbi: v }); return undefined; }} />
      <CommitField label="Horizontal beamwidth" ariaLabel="Horizontal beamwidth" unit="°" value={model.beamwidthDeg} disabled={!sector} help={custom ? 'Derived from the horizontal table' : '3 dB width, 1–180'} onCommit={range('Horizontal beamwidth', 'beamwidthDeg', 1, 180)} />
      <CommitField label="Vertical beamwidth" ariaLabel="Vertical beamwidth" unit="°" value={model.verticalBeamwidthDeg} disabled={!sector} help={custom ? 'Derived from the vertical table' : '3 dB width, 1–90'} onCommit={range('Vertical beamwidth', 'verticalBeamwidthDeg', 1, 90)} />
      <CommitField label="Front-to-back" ariaLabel="Front-to-back" unit="dB" value={model.frontToBackDb} disabled={!sector && !custom} help="Pattern loss cap, 0–60" onCommit={range('Front-to-back', 'frontToBackDb', 0, 60)} />
    </div>
  );
}

export function PatternEditor({ model, cut, setCut, symmetric, setSymmetric, onPoints }: {
  model: AntennaModel; cut: 'h' | 'v'; setCut: (cut: 'h' | 'v') => void; symmetric: boolean; setSymmetric: (on: boolean) => void; onPoints: (points: Cut) => void;
}) {
  const [pasteText, setPasteText] = useState('');
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const pattern = model.pattern;
  if (!pattern) return null;
  const horizontal = cut === 'h';
  const points = horizontal ? pattern.horizontal : pattern.vertical;
  const sym = horizontal && symmetric;
  const [angleMin, angleMax] = horizontal ? [0, 360] : [-90, 90];
  const addPoint = () => {
    let at = 0, gap = -1;
    points.forEach(([a], i) => {
      const next = i + 1 < points.length ? points[i + 1][0] : horizontal ? points[0][0] + 360 : a;
      if (next - a > gap) { gap = next - a; at = a + gap / 2; }
    });
    if (gap < 0.2) return;
    const angle = Math.round((horizontal ? ((at % 360) + 360) % 360 : at) * 10) / 10;
    onPoints(withPoint(points, angle, Math.round(interpLoss(points, angle, horizontal) * 10) / 10, sym));
  };
  const applyPaste = () => {
    const parsed = parsePastedPoints(pasteText, cut);
    if ('errors' in parsed) { setPasteErrors(parsed.errors); return; }
    setPasteErrors([]); setPasteText(''); onPoints(parsed.points);
  };
  return (
    <div className="pattern-editor" aria-label="Pattern points">
      <div className="pattern-toolbar">
        <div className="segmented" role="group" aria-label="Pattern cut">
          <button type="button" className={horizontal ? 'active' : ''} aria-pressed={horizontal} onClick={() => setCut('h')}>Horizontal cut</button>
          <button type="button" className={!horizontal ? 'active' : ''} aria-pressed={!horizontal} onClick={() => setCut('v')}>Vertical cut</button>
        </div>
        {horizontal && <label className="check"><input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} />Symmetric</label>}
        <button type="button" className="ghost" onClick={addPoint} disabled={points.length >= MAX_POINTS}><Plus size={15} aria-hidden="true" />Add point</button>
        <span className="muted">{points.length} points · {horizontal ? 'bearing from boresight, clockwise' : 'elevation from boresight, up is positive'}</span>
      </div>
      <div className="table-scroll point-table"><table>
        <thead><tr><th>Angle (°)</th><th>Loss (dB)</th><th><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>{points.map(([angle, loss]) => <tr key={`${cut}-${angle}`}>
          <td><CommitField label="Angle" ariaLabel={`Angle of point ${angle}`} unit="°" value={angle} onCommit={(v) => {
            if (v < angleMin || v > angleMax) return `Angle must be between ${angleMin} and ${angleMax}.`;
            const next = withAngle(points, angle, v, sym);
            if (!next) return 'That angle is already in the table.';
            onPoints(next); return undefined;
          }} /></td>
          <td><CommitField label="Loss" ariaLabel={`Loss at ${angle}°`} unit="dB" value={loss} onCommit={(v) => {
            if (v < 0 || v > MAX_LOSS_DB) return `Loss must be between 0 and ${MAX_LOSS_DB} dB.`;
            onPoints(withLoss(points, angle, v, sym)); return undefined;
          }} /></td>
          <td><button type="button" className="ghost" aria-label={`Delete point at ${angle}°`} disabled={points.length <= 2} onClick={() => onPoints(withoutPoint(points, angle, sym))}><Trash2 size={14} aria-hidden="true" /></button></td>
        </tr>)}</tbody>
      </table></div>
      <details className="paste-values">
        <summary>Paste values</summary>
        <p className="field-note">One point per line as “angle, loss”. This replaces the {horizontal ? 'horizontal' : 'vertical'} cut.</p>
        <textarea aria-label="Paste values" rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={horizontal ? '0, 0\n10, 0.4\n180, 30' : '-90, 25\n0, 0\n90, 25'} />
        <div className="antenna-actions"><button type="button" className="ghost" onClick={applyPaste} disabled={!pasteText.trim()}>Replace cut</button></div>
        {pasteErrors.length > 0 && <ul className="field-error" role="alert">{pasteErrors.slice(0, 6).map((m) => <li key={m}>{m}</li>)}{pasteErrors.length > 6 && <li>…and {pasteErrors.length - 6} more.</li>}</ul>}
      </details>
    </div>
  );
}

function SensorRow({ sensor, map, commit }: { sensor: Sensor; map: MapScenario; commit: (id: string, patch: (a: Sensor['antenna']) => Sensor['antenna']) => void }) {
  const a = sensor.antenna;
  const sector = resolveAntenna(map, sensor).kind !== 'omni';
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

export function AntennaPresetMenu({ previewId, setPreviewId, onAddBlank, onAddPreset }: {
  previewId: string | null;
  setPreviewId: (id: string | null) => void;
  onAddBlank: () => void;
  onAddPreset: (id: string) => void;
}) {
  const descriptionId = useId();
  const preview = ANTENNA_PRESETS.find((preset) => preset.id === previewId);
  return (
    <div className="preset-menu">
      <ul className="menu-list" role="menu" aria-label="New model">
        <li role="none"><button type="button" role="menuitem" tabIndex={-1} onClick={onAddBlank}>Blank sector</button></li>
        {PRESET_FAMILIES.map((family) => (
          <Fragment key={family}>
            <li role="presentation" className="menu-heading">{family}</li>
            {ANTENNA_PRESETS.filter((preset) => preset.family === family).map((preset) => (
              <li role="none" key={preset.id}>
                <button type="button" role="menuitem" tabIndex={-1} aria-describedby={`${descriptionId}-${preset.id}`}
                  onMouseEnter={() => setPreviewId(preset.id)} onMouseLeave={() => setPreviewId(null)}
                  onFocus={() => setPreviewId(preset.id)} onBlur={() => setPreviewId(null)}
                  onClick={() => onAddPreset(preset.id)}>{preset.label}</button>
                <span id={`${descriptionId}-${preset.id}`} hidden>{preset.description}</span>
              </li>
            ))}
          </Fragment>
        ))}
      </ul>
      {preview && <div className="preset-preview" aria-hidden="true"><AntennaPolar compact model={{ ...preview.model, id: preview.id }} /></div>}
    </div>
  );
}

export function AntennasTab({ map, setMap, onOpenWorkspace }: { map: MapScenario; setMap: SetMap; onOpenWorkspace?: () => void }) {
  const [pickedId, setPickedId] = useState(OMNI_MODEL_ID);
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [cut, setCut] = useState<'h' | 'v'>('h');
  const [symmetric, setSymmetric] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const models = map.antennaModels;
  const picked = pickedId === OMNI_MODEL_ID ? undefined : findModel(map, pickedId);
  const full = models.length >= MAX_ANTENNA_MODELS;
  const pickedUse = picked ? usedBy(map, picked.id) : 0;
  useLayoutEffect(() => {
    const wrap = menuWrapRef.current;
    if (!menuOpen || !wrap) return;
    const fitMenu = () => {
      const { top, bottom } = wrap.getBoundingClientRect();
      const below = window.innerHeight - bottom;
      const opensAbove = below < Math.min(416, window.innerHeight / 2) && top > below;
      wrap.classList.toggle('menu-opens-above', opensAbove);
      wrap.style.setProperty('--preset-menu-space', `${Math.max(0, (opensAbove ? top : below) - 12)}px`);
    };
    fitMenu();
    wrap.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    window.addEventListener('resize', fitMenu);
    window.addEventListener('scroll', fitMenu);
    return () => {
      window.removeEventListener('resize', fitMenu);
      window.removeEventListener('scroll', fitMenu);
    };
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    setPreviewId(null);
  };
  const finishMenuSelection = () => {
    menuButtonRef.current?.focus();
    closeMenu();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault();
      finishMenuSelection();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!menuOpen) {
      if (event.key === 'ArrowDown' && !full) {
        event.preventDefault();
        setMenuOpen(true);
      }
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const index = items.findIndex((item) => item === event.target);
    const last = items.length - 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
      : event.key === 'ArrowDown' ? (index === last ? 0 : index + 1) : (index <= 0 ? last : index - 1);
    event.preventDefault();
    items[next]?.focus();
  };
  const pick = (id: string, list: AntennaModel[] = models) => {
    setPickedId(id); setConfirming(false); setCut('h');
    const next = list.find((m) => m.id === id);
    setSymmetric(next?.pattern ? isSymmetric(next.pattern.horizontal) : true);
  };

  const add = () => {
    const model = newSectorModel(models);
    setMap((m) => m.antennaModels.length >= MAX_ANTENNA_MODELS ? m : { ...m, antennaModels: [...m.antennaModels, model] });
    pick(model.id);
  };
  const addFromPreset = (presetId: string) => {
    finishMenuSelection();
    const model = addPreset(models, presetId);
    setMap((m) => m.antennaModels.length >= MAX_ANTENNA_MODELS ? m : { ...m, antennaModels: [...m.antennaModels, model] });
    pick(model.id, [...models, model]);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const result = importAntennaFile(await file.text(), file.name, models);
    if (!('error' in result)) setMap((m) => ({ ...m, antennaModels: result.models }));
    setMessage(describeImport(result));
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
  const setPoints = (points: Cut) => {
    if (!picked?.pattern) return;
    updateModel(patternPatch(picked, cut === 'h' ? { ...picked.pattern, horizontal: points } : { ...picked.pattern, vertical: points }));
  };
  const commitSensor = (id: string, patch: (a: Sensor['antenna']) => Sensor['antenna']) => setMap((m) => updateMapSensors(m, (s) => s.id === id ? { ...s, antenna: patch(s.antenna) } : s));

  return (
    <div className="antennas-grid">
      <section className="panel antenna-library" aria-label="Antenna library">
        <div className="panel-heading"><div><p className="eyebrow">ANTENNA LIBRARY</p><h2>Models</h2></div><span className="version-chip">{models.length} / {MAX_ANTENNA_MODELS}</span></div>
        <div className="antenna-actions">
          <div className="menu-wrap" ref={menuWrapRef} onKeyDown={onMenuKeyDown}
            onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeMenu(); }}>
            <button type="button" ref={menuButtonRef} className="ghost" aria-haspopup="menu" aria-expanded={menuOpen}
              onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)} disabled={full}><Plus size={15} aria-hidden="true" />New model<ChevronDown size={14} aria-hidden="true" /></button>
            {menuOpen && <AntennaPresetMenu previewId={previewId} setPreviewId={setPreviewId} onAddPreset={addFromPreset}
              onAddBlank={() => { finishMenuSelection(); add(); }} />}
          </div>
          <button type="button" className="ghost" onClick={duplicate} disabled={!picked || full}><Copy size={15} aria-hidden="true" />Duplicate</button>
          <button type="button" className="ghost" onClick={() => pickedUse ? setConfirming(true) : remove()} disabled={!picked}><Trash2 size={15} aria-hidden="true" />Delete</button>
        </div>
        <div className="antenna-actions">
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}><Upload size={15} aria-hidden="true" />Import file</button>
          <input ref={fileRef} type="file" hidden aria-label="Import antenna file" accept=".json,.msi,.pln,.ant,.txt" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="ghost" disabled={!picked} onClick={() => picked && downloadText(exportModelsJson([picked]), `${fileSlug(picked.name)}.json`)}><Download size={15} aria-hidden="true" />Export model</button>
          <button type="button" className="ghost" disabled={!models.length} onClick={() => downloadText(exportModelsJson(models), 'antenna-library.json')}><Download size={15} aria-hidden="true" />Export library</button>
        </div>
        {message && <p className={message.ok ? 'field-note' : 'field-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
        {confirming && picked && <div className="callout" role="alertdialog" aria-label="Confirm delete">
          <p>Used by {plural(pickedUse, 'sensor')}; {pickedUse === 1 ? 'it' : 'they'} will switch to Omni.</p>
          <div className="antenna-actions"><button type="button" className="ghost" onClick={remove}>Delete {picked.name}</button><button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancel</button></div>
        </div>}
        <ul className="model-list" aria-label="Models">
          <li><button type="button" className={pickedId === OMNI_MODEL_ID ? 'active' : ''} aria-pressed={pickedId === OMNI_MODEL_ID} onClick={() => pick(OMNI_MODEL_ID)}>
            <b>Omni</b><span>built-in · read-only</span><small>Uses each sensor&apos;s own gain · used by {plural(usedBy(map, OMNI_MODEL_ID), 'sensor')}</small>
          </button></li>
          {models.map((m) => <li key={m.id}><button type="button" className={pickedId === m.id ? 'active' : ''} aria-pressed={pickedId === m.id} onClick={() => pick(m.id)}>
            <b>{m.name}</b><span>{KIND_LABEL[m.kind]} · {formatNumber(m.gainDbi, 1)} dBi{m.kind !== 'omni' ? ` · ${m.beamwidthDeg}°×${m.verticalBeamwidthDeg}° · F/B ${m.frontToBackDb} dB` : ''}</span><small>used by {plural(usedBy(map, m.id), 'sensor')}</small>
          </button></li>)}
        </ul>
        {models.length === 0 && <p className="muted">No custom models yet. Add a sector model or a preset to give sensors a directional pattern.</p>}
        {full && <p className="field-note">The library holds at most {MAX_ANTENNA_MODELS} models.</p>}
      </section>

      <section className="panel antenna-editor-panel" aria-label="Model editor">
        <div className="panel-heading"><div><p className="eyebrow">MODEL</p><h2>{picked ? picked.name : 'Omni'}</h2></div></div>
        <div className="antenna-editor-body">
          {picked ? <ModelEditor key={picked.id} model={picked} models={models} update={updateModel} /> : <p className="muted">The built-in Omni model has no pattern loss and takes the gain from each sensor&apos;s own Gain field. It cannot be edited.</p>}
          <AntennaPolar model={picked ?? OMNI_PLOT} edit={picked?.kind === 'custom' && picked.pattern ? { cut, symmetric, onChange: setPoints } : undefined} />
        </div>
        {picked?.kind === 'custom' && <PatternEditor key={picked.id} model={picked} cut={cut} setCut={setCut} symmetric={symmetric} setSymmetric={setSymmetric} onPoints={setPoints} />}
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
