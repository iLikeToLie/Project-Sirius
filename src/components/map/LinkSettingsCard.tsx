import { useEffect, useState } from 'react';
import { formatFrequency, FREQUENCY_SLIDER_MAX, frequencyFromSlider, parseFrequency, sliderFromFrequency } from '../../lib/viewport';
import type { LinkInputs, MapScenario } from '../../types';
import { CommitField, NumberField } from '../ui';

// Labels sit where the logarithmic slider puts each frequency (1 GHz is at 60 %, not the middle).
const SCALE_MARKS = [{ ghz: 0.001, label: '1 MHz' }, { ghz: 1, label: '1 GHz' }, { ghz: 100, label: '100 GHz' }];

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
        <span>Default frequency</span>
        <input
          type="text" value={text} aria-invalid={error ? true : undefined}
          onFocus={() => setEditing(true)} onChange={(event) => setText(event.target.value)} onBlur={apply}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }}
        />
      </label>
      <input
        type="range" min={0} max={FREQUENCY_SLIDER_MAX} step={1} aria-label="Default frequency, logarithmic"
        value={valid ? sliderFromFrequency(frequencyGhz) : 0} aria-valuetext={valid ? formatFrequency(frequencyGhz) : 'Invalid frequency'}
        onChange={(event) => { setError(''); onChange(Number(frequencyFromSlider(Number(event.target.value)).toPrecision(6))); }}
      />
      <div className="range-scale log-scale" aria-hidden="true">{SCALE_MARKS.map((m) => <span key={m.label} style={{ left: `${(sliderFromFrequency(m.ghz) / FREQUENCY_SLIDER_MAX) * 100}%` }}>{m.label}</span>)}</div>
      {error && <small className="field-error" role="alert">{error}</small>}
    </div>
  );
}

/** Scenario defaults, shared path losses and interference models. */
export function LinkSettingsCard({ inputs, onChange, map, setMap }: { inputs: LinkInputs; onChange: <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => void; map: MapScenario; setMap: (update: (map: MapScenario) => MapScenario) => void }) {
  return (
    <section className="map-card link-settings-card" aria-label="Link settings">
      <h3>Link settings</h3>
      <FrequencyControl frequencyGhz={inputs.frequencyGhz} onChange={(ghz) => onChange('frequencyGhz', ghz)} />
      <div className="loss-rows">
        <NumberField label="Polarization" unit="dB" min={0} value={inputs.polarizationLossDb} onChange={(v) => onChange('polarizationLossDb', v)} />
        <NumberField label="Environment" unit="dB" min={0} value={inputs.obstructionLossDb} onChange={(v) => onChange('obstructionLossDb', v)} />
        <NumberField label="Other" unit="dB" min={0} value={inputs.otherLossDb} onChange={(v) => onChange('otherLossDb', v)} />
      </div>
      <h4>Interference</h4>
      <label className="field"><span>Rejection model</span><select aria-label="Rejection model" value={map.rejectionModel} onChange={e => { const value = e.target.value as MapScenario['rejectionModel']; setMap(m => ({ ...m, rejectionModel: value })); }}>
        <option value="simple">Simple (ACR)</option><option value="mask">Stepped mask</option>
      </select></label>
      <CommitField label="Protection margin" unit="dB" value={map.protectionMarginDb} onCommit={(v) => {
        if (v < 0) return 'Protection margin cannot be negative.';
        setMap(m => ({ ...m, protectionMarginDb: v })); return undefined;
      }} />
      <label className="field"><span>Aggregate interference</span><select value={map.aggregateInterference} onChange={e => { const value = e.target.value as MapScenario['aggregateInterference']; setMap(m => ({ ...m, aggregateInterference: value })); }}>
        <option value="objective">Avoidance receivers only</option><option value="always">All receivers</option><option value="never">Off</option>
      </select></label>
      <p className="field-note">Default frequency applies to sensors using the scenario default. Each sensor has its own bandwidth; receivers keep both ACR and mask settings when the model changes. Receivers can override the protection margin. Antenna gains and cable losses belong to each sensor.</p>
    </section>
  );
}
