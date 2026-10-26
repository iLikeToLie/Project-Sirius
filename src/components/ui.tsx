import { useEffect, useState } from 'react';
import type { ScreeningStatus } from '../types';

export function StatusBadge({ status }: { status: ScreeningStatus }) {
  return <span className={`status status-${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>;
}

export function statusTone(status: ScreeningStatus): 'good' | 'safe' | 'warning' | 'danger' | 'neutral' {
  if (status === 'Acceptable link') return 'good';
  if (status === 'Below interference threshold') return 'safe';
  if (status === 'Weak link') return 'warning';
  if (status === 'Invalid input') return 'neutral';
  return 'danger';
}

export function NumberField({ label, value, unit, onChange, min, step = 'any', help }: {
  label: string; value: number; unit: string; onChange: (value: number) => void; min?: number; step?: number | 'any'; help?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-with-unit">
        <input type="number" value={Number.isFinite(value) ? value : ''} min={min} step={step} onChange={(event) => onChange(event.target.value === '' ? NaN : Number(event.target.value))} />
        <b>{unit}</b>
      </div>
      {help && <small>{help}</small>}
    </label>
  );
}

export function Metric({ label, value, unit, note }: { label: string; value: string; unit: string; note?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value} <small>{unit}</small></strong>{note && <p>{note}</p>}</div>;
}

/** A numeric field that validates and commits on Enter or blur, so partial typing never moves anything. */
export function CommitField({ label, value, unit, onCommit, help, disabled }: {
  label: string; value: number; unit: string; onCommit: (value: number) => string | undefined; help?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(Number.isFinite(value) ? String(Number(value.toFixed(2))) : ''); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const parsed = text.trim() === '' ? NaN : Number(text);
    const message = Number.isFinite(parsed) ? onCommit(parsed) : 'Enter a number.';
    setError(message ?? '');
    if (message) setText(String(Number(value.toFixed(2))));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-with-unit">
        <input
          type="text" inputMode="decimal" value={text} disabled={disabled} aria-invalid={error ? true : undefined}
          onFocus={() => setEditing(true)} onChange={(event) => setText(event.target.value)} onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') { setEditing(false); setError(''); } }}
        />
        <b>{unit}</b>
      </div>
      {error ? <small className="field-error" role="alert">{error}</small> : help && <small>{help}</small>}
    </label>
  );
}
