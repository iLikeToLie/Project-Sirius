import { Plus, Trash2 } from 'lucide-react';
import { MAX_SENSORS, type PairResult, receiverSummary } from '../../lib/sensors';
import type { Sensor } from '../../types';
import { statusTone } from '../ui';

function sensorStatus(sensor: Sensor, pairs: PairResult[]): { text: string; tone: string } {
  if (sensor.role === 'tx') {
    const served = pairs.filter((p) => p.txId === sensor.id && p.intended).length;
    return { text: served === 1 ? 'serves 1' : `serves ${served}`, tone: 'neutral' };
  }
  const { link, interferersAbove } = receiverSummary(pairs, sensor.id);
  if (!link) return { text: 'No transmitter', tone: 'neutral' };
  const base = link.result.status === 'Acceptable link' ? 'OK' : link.result.status === 'Weak link' ? 'Weak' : link.result.status === 'No link' ? 'No link' : 'Invalid';
  return interferersAbove
    ? { text: `${base}, ${interferersAbove} interferer${interferersAbove > 1 ? 's' : ''}`, tone: 'danger' }
    : { text: base, tone: statusTone(link.result.status) };
}

export function SensorListCard({ sensors, pairs, selectedId, onSelect, onAdd, onRemove }: {
  sensors: Sensor[]; pairs: PairResult[]; selectedId: string | null;
  onSelect: (id: string) => void; onAdd: () => void; onRemove: (id: string) => void;
}) {
  return (
    <section className="map-card sensor-list-card" aria-label="Sensors">
      <div className="map-card-heading"><h3>Sensors</h3><span className="tag">{sensors.length} of {MAX_SENSORS}</span></div>
      <ul className="sensor-rows">
        {sensors.map((sensor) => {
          const status = sensorStatus(sensor, pairs);
          return (
            <li key={sensor.id} className={sensor.id === selectedId ? 'selected' : ''}>
              <button type="button" className="sensor-row" aria-pressed={sensor.id === selectedId} onClick={() => onSelect(sensor.id)}>
                <span className={`role-badge role-${sensor.role}`}>{sensor.role.toUpperCase()}</span>
                <span className="sensor-name">{sensor.name}</span>
                <span className={`sensor-status tone-${status.tone}`} title={status.text}>{status.text}</span>
              </button>
              <button type="button" className="icon-button" aria-label={`Delete ${sensor.name}`} onClick={() => onRemove(sensor.id)}><Trash2 size={14} /></button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="ghost add-sensor" onClick={onAdd} disabled={sensors.length >= MAX_SENSORS}>
        <Plus size={15} /> {sensors.length >= MAX_SENSORS ? 'Six sensors placed' : 'Sensor'}
      </button>
    </section>
  );
}
