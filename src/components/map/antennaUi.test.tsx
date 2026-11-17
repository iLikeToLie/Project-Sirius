import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { freshDefaultState } from '../../data/defaults';
import { assessAll } from '../../lib/interference';
import { evaluatePairs } from '../../lib/sensors';
import { newSectorModel, ZERO_PATTERN_LOSS } from '../../lib/antenna';
import { SelectedSensorCard } from './SelectedSensorCard';
import { LinkBudgetDrawer, patternNote } from './LinkBudgetDrawer';
import { ringIsSector, wedgePath } from './SensorMap';

const noop = () => undefined;
const base = () => { const s = freshDefaultState(); s.map.useTerrainElevation = false; s.map.propagationModel = 'free-space'; return s; };
/** Adds a sector model (with the given shape, gain = the sensor's own) and points the sensor at it. */
const useSector = (state: ReturnType<typeof base>, index: number, azimuthDeg: number, shape: { beamwidthDeg?: number; frontToBackDb?: number } = {}) => {
  const sensor = state.map.sensors[index];
  const model = { ...newSectorModel(state.map.antennaModels), gainDbi: sensor.gainDbi, ...shape };
  state.map.antennaModels = [...state.map.antennaModels, model];
  sensor.antenna = { modelId: model.id, azimuthDeg, downtiltDeg: 0, aimAtId: null };
  return model;
};
const card = (state: ReturnType<typeof base>, index: number) => {
  const pairs = evaluatePairs(state.map, state.inputs, () => 0);
  return renderToStaticMarkup(<SelectedSensorCard defaultFrequencyGhz={state.inputs.frequencyGhz} sensor={state.map.sensors[index]} map={state.map} pairs={pairs} assessments={assessAll(state.map, pairs)} groundAt={() => 0} zoneInfo={null} onChange={noop} onRoleChange={noop} onZonesFor={noop} />);
};

describe('antenna UI', () => {
  it('offers the model select for both roles and hides pointing fields for omni', () => {
    const state = base();
    state.map.antennaModels = [newSectorModel([], 'Panel A')];
    for (const i of [0, 1]) {
      const html = card(state, i);
      expect(html).toContain('aria-label="Sensor antenna"');
      expect(html).toContain('<option value="omni"');
      expect(html).toContain('Panel A');
      expect(html).not.toContain('Antenna azimuth');
      expect(html).not.toContain('Aim antenna at');
    }
  });

  it('shows sector fields and aim-at targets for a sector sensor', () => {
    const state = base();
    const model = useSector(state, 1, 90);
    const html = card(state, 1);
    for (const text of ['Antenna azimuth', 'aria-label="Aim antenna at"', state.map.sensors[0].name, `from ${model.name}`]) expect(html).toContain(text);
    expect(html).not.toContain('Antenna beamwidth');
    expect(html).not.toContain('Antenna front-to-back');
    expect(html).not.toContain(`<option value="${state.map.sensors[1].id}">`);
  });

  it('writes the drawer pattern loss with an off-axis note', () => {
    const state = base();
    useSector(state, 0, 0, { beamwidthDeg: 30 });
    const pairs = evaluatePairs(state.map, state.inputs, () => 0);
    const html = renderToStaticMarkup(<LinkBudgetDrawer state={state} pairs={pairs} assessments={assessAll(state.map, pairs)} groundAt={() => 0} open onToggle={noop} onEdit={noop} pin={null} onPin={noop} size={null} onResize={noop} />);
    expect(html).toContain('Antenna pattern loss');
    expect(html).toMatch(/Tx \d+° off axis · Rx omni/);
  });

  it('formats the pattern note', () => {
    expect(patternNote(ZERO_PATTERN_LOSS)).toBe('omni');
    expect(patternNote({ txDb: 1, rxDb: 0, txOffDeg: 23.4, rxOffDeg: NaN, txElevDeg: 0.4, rxElevDeg: NaN, totalDb: 1 })).toBe('Tx 23° off axis · Rx omni');
    expect(patternNote({ txDb: 1, rxDb: 0, txOffDeg: 23.4, rxOffDeg: NaN, txElevDeg: -3.6, rxElevDeg: NaN, totalDb: 1 })).toBe('Tx 23° off axis, 4° below · Rx omni');
    expect(patternNote({ txDb: 1, rxDb: 1, txOffDeg: 23, rxOffDeg: 4, txElevDeg: -2, rxElevDeg: 2, totalDb: 2 })).toBe('Tx 23° off axis, 2° below · Rx 4° off axis, 2° above');
    expect(patternNote({ txDb: 1, rxDb: 1, txOffDeg: 23, rxOffDeg: 4, txElevDeg: 0, rxElevDeg: 0.5, totalDb: 2 })).toBe('Tx 23° off axis · Rx 4° off axis');
  });

  it('builds a wedge path and detects sector ring owners', () => {
    expect(wedgePath(60)).toMatch(/^M36 36L/);
    expect(wedgePath(180)).toContain('A');
    const state = base();
    const tx = state.map.sensors[0];
    const ring = [{ lat: tx.lat + 0.001, lon: tx.lon }, { lat: tx.lat - 0.001, lon: tx.lon }];
    expect(ringIsSector(ring, state.map.sensors, state.map.antennaModels)).toBe(false);
    useSector(state, 0, 0);
    expect(ringIsSector(ring, state.map.sensors, state.map.antennaModels)).toBe(true);
  });
});
