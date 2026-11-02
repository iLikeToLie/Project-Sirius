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
  it('offers a collapsed noise-floor derivation only for receivers', () => {
    const render = (sensor: typeof rx) => renderToStaticMarkup(<SelectedSensorCard defaultFrequencyGhz={state.inputs.frequencyGhz} sensor={sensor} map={state.map} pairs={pairs} assessments={assessments} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
    const html = render(rx);
    for (const text of ['Derive from noise floor', 'Noise figure', 'I/N', '-95.0', '-101.0', 'Use as interference threshold']) expect(html).toContain(text);
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(render(state.map.sensors[0])).not.toContain('Derive from noise floor');
  });
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
    const html = renderToStaticMarkup(<SelectedSensorCard defaultFrequencyGhz={state.inputs.frequencyGhz} sensor={rx} map={state.map} pairs={pairs} assessments={assessments} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
    for (const text of ['aggregate of 1', 'Protected limit', 'Required C/I', 'Protection margin', 'Use scenario (3 dB)', '100%']) expect(html).toContain(text);
  });

  it('exposes scenario interference settings', () => {
    const html = renderToStaticMarkup(<LinkSettingsCard inputs={state.inputs} map={state.map} setMap={noop} onChange={noop} />);
    for (const text of ['Protection margin', 'Avoidance receivers only', 'All receivers', 'Off']) expect(html).toContain(text);
  });

  it('shows power and distance fixes below a receiver violation', () => {
    const results = pairs.map(p => ({ ...p, result: { ...p.result, receivedPowerDbm: -67 } }));
    const html = renderToStaticMarkup(<SelectedSensorCard defaultFrequencyGhz={state.inputs.frequencyGhz} sensor={rx} map={state.map} pairs={results} assessments={assessAll(state.map, results)} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
    expect(html).toContain('aria-label="Fix suggestions"');
    expect(html).toContain(`Reduce ${state.map.sensors[0].name} power by 1.00 dB`);
    expect(html).toContain('separation from');
  });

  it('offers a C/I fix even when interference is below the threshold', () => {
    const desired = { ...rx, objective: 'desired' as const, desiredTxIds: [state.map.sensors[0].id], requiredCiDb: 15 };
    const extra = { ...state.map.sensors[0], id: 'extra', name: 'Extra transmitter' };
    const map = { ...state.map, sensors: [state.map.sensors[0], desired, extra] };
    const results = [
      { ...pairs[0], intended: true, result: { ...pairs[0].result, status: 'Acceptable link' as const, receivedPowerDbm: -60 } },
      { ...pairs[0], txId: extra.id, txName: extra.name, intended: false, result: { ...pairs[0].result, receivedPowerDbm: -70 } },
    ];
    const html = renderToStaticMarkup(<SelectedSensorCard defaultFrequencyGhz={state.inputs.frequencyGhz} sensor={desired} map={map} pairs={results} assessments={assessAll(map, results)} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
    expect(html).toContain('Reduce Extra transmitter power by 5.00 dB');
    expect(html).toContain('C/I requirement');
  });

  it('shows conflicting transmitter bounds and prevents applying an infeasible maximum', () => {
    const served = { ...rx, id: 'served', name: 'Served receiver', objective: 'desired' as const, sensitivityDbm: -50 };
    const map = { ...state.map, sensors: [...state.map.sensors, served] };
    const results = evaluatePairs(map, state.inputs, () => 0);
    const html = renderToStaticMarkup(<SelectedSensorCard defaultFrequencyGhz={state.inputs.frequencyGhz} sensor={map.sensors[0]} map={map} pairs={results} assessments={assessAll(map, results)} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
    for (const text of ['Power range:', 'Limited by', 'protected limit', 'No power level satisfies both; move or retune', 'Set to max']) expect(html).toContain(text);
    expect(html).toMatch(/disabled=""[^>]*>Set to max/);
  });
});
