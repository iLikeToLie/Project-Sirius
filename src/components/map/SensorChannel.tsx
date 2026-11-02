import type { MapScenario, RejectionStep, Sensor } from '../../types';
import { isRejectionMask } from '../../lib/isolation';
import { CommitField } from '../ui';

export function SensorChannel({ sensor, model, defaultFrequencyGhz, onChange }: {
  sensor: Sensor; model: MapScenario['rejectionModel']; defaultFrequencyGhz: number;
  onChange: (patch: Partial<Sensor>) => string | undefined;
}) {
  const frequency = sensor.frequencyGhz === 'default' ? defaultFrequencyGhz : sensor.frequencyGhz;
  const updateMask = (mask: RejectionStep[]) => !isRejectionMask(mask)
    ? 'Use 1–4 steps with positive, increasing offsets and non-negative, non-decreasing rejection.'
    : onChange({ rejectionMask: mask });
  const stepEdit = (i: number, key: keyof RejectionStep, value: number) => updateMask(sensor.rejectionMask.map((s, j) => j === i ? { ...s, [key]: value } : s));
  return <fieldset className="sensor-channel">
    <legend>Channel</legend>
    <label className="switch"><input type="checkbox" checked={sensor.frequencyGhz === 'default'} onChange={e => onChange({ frequencyGhz: e.target.checked ? 'default' : frequency })} />Use scenario default</label>
    <div className="form-grid two">
      <CommitField label="Channel frequency" unit="MHz" value={frequency * 1000} disabled={sensor.frequencyGhz === 'default'} onCommit={v => v <= 0 ? 'Frequency must be positive.' : onChange({ frequencyGhz: v / 1000 })} />
      <CommitField label="Channel bandwidth" unit="MHz" value={sensor.bandwidthMhz} onCommit={v => v <= 0 ? 'Bandwidth must be positive.' : onChange({ bandwidthMhz: v })} />
      {sensor.role === 'rx' && model === 'simple' && <CommitField label="Adjacent-channel rejection (ACR)" unit="dB" value={sensor.acrDb} onCommit={v => v < 0 ? 'ACR cannot be negative.' : onChange({ acrDb: v })} />}
    </div>
    {sensor.role === 'rx' && model === 'mask' && <div aria-label="Rejection mask">
      {sensor.rejectionMask.map((step, i) => <div key={i} className="mask-step">
        <div className="form-grid two">
          <CommitField label={`Offset ${i + 1}`} unit="MHz" value={step.offsetMhz} onCommit={v => stepEdit(i, 'offsetMhz', v)} />
          <CommitField label={`Rejection ${i + 1}`} unit="dB" value={step.rejectionDb} onCommit={v => stepEdit(i, 'rejectionDb', v)} />
        </div>
        <button type="button" className="ghost" aria-label={`Remove mask step ${i + 1}`} disabled={sensor.rejectionMask.length <= 1} onClick={() => updateMask(sensor.rejectionMask.filter((_, j) => j !== i))}>Remove step</button>
      </div>)}
      <button type="button" className="ghost" disabled={sensor.rejectionMask.length >= 4} onClick={() => {
        const last = sensor.rejectionMask.at(-1)!;
        updateMask([...sensor.rejectionMask, { offsetMhz: last.offsetMhz + 20, rejectionDb: last.rejectionDb }]);
      }}>Add mask step</button>
    </div>}
    <p className="field-note">Overlapping channels use the fraction of transmitter bandwidth received. Leakage outside the overlapping band is ignored. Disjoint channels use the receiver’s {model === 'simple' ? 'ACR' : 'stepped mask'}.</p>
  </fieldset>;
}
