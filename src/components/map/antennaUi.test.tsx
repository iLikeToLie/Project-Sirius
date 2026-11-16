import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { freshDefaultState } from '../../data/defaults';
import { assessAll } from '../../lib/interference';
import { evaluatePairs } from '../../lib/sensors';
import { ZERO_PATTERN_LOSS } from '../../lib/antenna';
import { SelectedSensorCard } from './SelectedSensorCard';
import { LinkBudgetDrawer, patternNote } from './LinkBudgetDrawer';
import { ringIsSector, wedgePath } from './SensorMap';

const noop = () => undefined;
const base = () => { const s = freshDefaultState(); s.map.useTerrainElevation = false; s.map.propagationModel = 'free-space'; return s; };
const card = (state: ReturnType<typeof base>, index: number) => {
  const pairs = evaluatePairs(state.map, state.inputs, () => 0);
  return renderToStaticMarkup(<SelectedSensorCard defaultFrequencyGhz={state.inputs.frequencyGhz} sensor={state.map.sensors[index]} map={state.map} pairs={pairs} assessments={assessAll(state.map, pairs)} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
};

describe('antenna UI', () => {
  it('offers the antenna select for both roles and hides sector fields for omni', () => {
    const state = base();
    for (const i of [0, 1]) {
      const html = card(state, i);
      expect(html).toContain('aria-label="Sensor antenna"');
      expect(html).toContain('value="sector"');
      expect(html).not.toContain('Antenna azimuth');
      expect(html).not.toContain('Aim antenna at');
    }
  });

  it('shows sector fields and aim-at targets for a sector sensor', () => {
    const state = base();
    state.map.sensors[1].antenna = { kind: 'sector', azimuthDeg: 90, beamwidthDeg: 65, frontToBackDb: 25 };
    const html = card(state, 1);
    for (const text of ['Antenna azimuth', 'Antenna beamwidth', 'Antenna front-to-back', 'aria-label="Aim antenna at"', state.map.sensors[0].name]) expect(html).toContain(text);
    expect(html).not.toContain(`<option value="${state.map.sensors[1].id}">`);
  });

  it('writes the drawer pattern loss with an off-axis note', () => {
    const state = base();
    state.map.sensors[0].antenna = { kind: 'sector', azimuthDeg: 0, beamwidthDeg: 30, frontToBackDb: 25 };
    const pairs = evaluatePairs(state.map, state.inputs, () => 0);
    const html = renderToStaticMarkup(<LinkBudgetDrawer state={state} pairs={pairs} assessments={assessAll(state.map, pairs)} groundAt={() => 0} open onToggle={noop} onEdit={noop} pin={null} onPin={noop} size={null} onResize={noop} />);
    expect(html).toContain('Antenna pattern loss');
    expect(html).toMatch(/Tx \d+° off axis · Rx omni/);
  });

  it('formats the pattern note', () => {
    expect(patternNote(ZERO_PATTERN_LOSS)).toBe('omni');
    expect(patternNote({ txDb: 1, rxDb: 0, txOffDeg: 23.4, rxOffDeg: NaN, totalDb: 1 })).toBe('Tx 23° off axis · Rx omni');
    expect(patternNote({ txDb: 1, rxDb: 1, txOffDeg: 23, rxOffDeg: 4, totalDb: 2 })).toBe('Tx 23° off axis · Rx 4° off axis');
  });

  it('builds a wedge path and detects sector ring owners', () => {
    expect(wedgePath(60)).toMatch(/^M36 36L/);
    expect(wedgePath(180)).toContain('A');
    const state = base();
    const tx = state.map.sensors[0];
    const ring = [{ lat: tx.lat + 0.001, lon: tx.lon }, { lat: tx.lat - 0.001, lon: tx.lon }];
    expect(ringIsSector(ring, state.map.sensors)).toBe(false);
    tx.antenna = { ...tx.antenna, kind: 'sector' };
    expect(ringIsSector(ring, state.map.sensors)).toBe(true);
  });
});
