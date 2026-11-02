import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { freshDefaultState } from '../../data/defaults';
import { assessAll } from '../../lib/interference';
import { evaluatePairs } from '../../lib/sensors';
import { statusTone } from '../ui';
import { RxMeterStack } from './RxMeterStack';
import { SensorListCard } from './SensorListCard';
import { SelectedSensorCard } from './SelectedSensorCard';
import { LinkSettingsCard } from './LinkSettingsCard';

const noop = () => undefined;
const state = freshDefaultState();
state.map.useTerrainElevation = false;
state.map.propagationModel = 'free-space';
state.map.defaultObjective = 'avoidance';
const pairs = evaluatePairs(state.map, state.inputs, () => 0);
const assessments = assessAll(state.map, pairs);
const rx = state.map.sensors[1];
const assessment = assessments.get(rx.id)!;

describe('interference workspace display', () => {
  it('uses warning and danger for the new statuses', () => {
    expect(statusTone('Marginal interference')).toBe('warning');
    expect(statusTone('Interfered link')).toBe('danger');
  });

  it('shows the aggregate total and protected-limit marker in avoidance meters', () => {
    const html = renderToStaticMarkup(<RxMeterStack links={pairs} inputs={state.inputs} objective="avoidance" assessment={assessment} />);
    expect(html).toContain('Total interference');
    expect(html).toContain('Protected limit');
    expect(html).toContain('protected-marker');
  });

  it('shows receiver aggregate status in the sensor list', () => {
    const html = renderToStaticMarkup(<SensorListCard sensors={state.map.sensors} pairs={pairs} assessments={assessments} selectedId={null} onSelect={noop} onAdd={noop} onRemove={noop} />);
    expect(html).toContain('1 interferer (aggregate)');
  });

  it('shows receiver assessment readouts, contributors, and editable settings', () => {
    const html = renderToStaticMarkup(<SelectedSensorCard sensor={rx} map={state.map} pairs={pairs} assessments={assessments} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
    for (const text of ['aggregate of 1', 'Protected limit', 'Required C/I', 'Protection margin', 'Use scenario (3 dB)', '100%']) expect(html).toContain(text);
  });

  it('exposes scenario interference settings', () => {
    const html = renderToStaticMarkup(<LinkSettingsCard inputs={state.inputs} map={state.map} setMap={noop} onChange={noop} />);
    for (const text of ['Protection margin', 'Avoidance receivers only', 'All receivers', 'Off']) expect(html).toContain(text);
  });
});
