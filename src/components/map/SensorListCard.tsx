import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, List, Plus, Trash2 } from 'lucide-react';
import { MAX_SENSORS, type PairResult, receiverSummary } from '../../lib/sensors';
import { worstAssessedLink, type ReceiverAssessment } from '../../lib/interference';
import type { Sensor } from '../../types';
import { statusTone } from '../ui';

function sensorStatus(sensor: Sensor, pairs: PairResult[], assessments: Map<string, ReceiverAssessment>): { text: string; tone: string } {
  if (sensor.role === 'tx') {
    const served = pairs.filter((p) => p.txId === sensor.id && p.intended).length;
    return { text: served === 1 ? 'serves 1' : `serves ${served}`, tone: 'neutral' };
  }
  const a = assessments.get(sensor.id)!;
  const { links } = receiverSummary(pairs, sensor.id);
  const link = worstAssessedLink(a, links);
  const status = a.links.find(l => l.txId === link?.txId)?.status;
  const base = status === 'Acceptable link' ? 'OK' : status === 'Interfered link' ? 'Interfered' : status === 'Weak link' ? 'Weak' : status === 'No link' ? 'No link' : status ? 'Invalid' : 'No intended link';
  const suffix = a.unknownPaths ? `, ${a.unknownPaths} paths unknown` : '';
  if (a.status === 'Possible interference') {
    const n = a.aggregate ? a.contributors.length : a.contributors.filter(c => c.powerDbm >= a.thresholdDbm).length;
    return { text: `${link ? `${base}, ` : ''}${n} interferer${n === 1 ? '' : 's'}${a.aggregate ? ' (aggregate)' : ''}${suffix}`, tone: 'danger' };
  }
  const tone = status && ['No link', 'Interfered link'].includes(status) ? 'danger' : a.status === 'Marginal interference' ? 'warning' : status ? statusTone(status) : 'safe';
  return { text: `${base}${a.status === 'Marginal interference' ? ', marginal' : ''}${suffix}`, tone };
}

export function SensorListCard({ sensors, pairs, assessments, selectedId, onSelect, onAdd, onRemove }: {
  sensors: Sensor[]; pairs: PairResult[]; assessments: Map<string, ReceiverAssessment>; selectedId: string | null;
  onSelect: (id: string) => void; onAdd: () => void; onRemove: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const rowsRef = useRef<HTMLUListElement>(null);
  // Keep the selected sensor visible when the list is short enough to scroll (for example, with the drawer open),
  // and mark the list when rows overflow so a fade shows there is more to scroll.
  useEffect(() => {
    const list = rowsRef.current;
    if (!list) return;
    const sync = () => {
      const row = list.querySelector<HTMLElement>('li.selected');
      if (row) {
        const top = row.offsetTop, bottom = top + row.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      }
      fade();
    };
    // The fade only shows while rows remain below the visible part of the list.
    const fade = () => list.toggleAttribute('data-overflow', list.scrollHeight - list.scrollTop > list.clientHeight + 1);
    sync();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    observer?.observe(list);
    list.addEventListener('scroll', fade, { passive: true });
    return () => { observer?.disconnect(); list.removeEventListener('scroll', fade); };
  }, [selectedId, sensors.length]);
  return (
    <section className={`map-card sensor-list-card${collapsed ? ' collapsed' : ''}`} aria-label="Sensors">
      <div className="map-card-heading"><button type="button" className="ghost" aria-label={collapsed ? 'Expand sensors' : 'Collapse sensors'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <List size={15} /> : <><ChevronLeft size={14} /> Sensors</>}</button><span className="tag">{sensors.length} of {MAX_SENSORS}</span></div>
      <ul className="sensor-rows" ref={rowsRef}>
        {sensors.map((sensor) => {
          const status = sensorStatus(sensor, pairs, assessments);
          return (
            <li key={sensor.id} className={sensor.id === selectedId ? 'selected' : ''}>
              <button type="button" className="sensor-row" aria-pressed={sensor.id === selectedId} onClick={() => onSelect(sensor.id)}>
                <span className={`role-badge role-${sensor.role}`}>{sensor.role.toUpperCase()}</span>
                <span className="sensor-text" title={`${sensor.name}: ${status.text}`}>
                  <span className="sensor-name">{sensor.name}</span>
                  <span className={`sensor-status tone-${status.tone}`}>{status.text}</span>
                </span>
              </button>
              <button type="button" className="icon-button" aria-label={`Delete ${sensor.name}`} onClick={() => onRemove(sensor.id)}><Trash2 size={14} /></button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="ghost add-sensor" onClick={onAdd} disabled={sensors.length >= MAX_SENSORS}>
        <Plus size={15} /> {sensors.length >= MAX_SENSORS ? `${MAX_SENSORS} sensors placed` : 'Sensor'}
      </button>
    </section>
  );
}
