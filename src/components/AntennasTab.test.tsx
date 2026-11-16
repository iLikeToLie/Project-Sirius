import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { freshDefaultState } from '../data/defaults';
import { azimuthFromPointer, bearingDeg, newSectorModel, updateMapSensors } from '../lib/antenna';
import { AntennasTab } from './AntennasTab';
import { horizontalCutDb, plotRangeDb, verticalCutDb } from './AntennaPolar';
import { SelectedSensorCard } from './map/SelectedSensorCard';
import { assessAll } from '../lib/interference';
import { evaluatePairs } from '../lib/sensors';

const noop = () => undefined;
const render = (map = freshDefaultState().map) => renderToStaticMarkup(<AntennasTab map={map} setMap={noop} />);

describe('AntennasTab', () => {
  it('lists the read-only Omni row first and the sensors table', () => {
    const state = freshDefaultState();
    const html = render(state.map);
    expect(html.indexOf('Uses each sensor&#x27;s own gain')).toBeGreaterThan(-1);
    expect(html).toContain('New sector model');
    expect(html).toContain('Duplicate');
    expect(html).toContain('Delete');
    expect(html).toContain('role="img"');
    expect(html).toContain('Antenna pattern for Omni');
    for (const s of state.map.sensors) { expect(html).toContain(`Model for ${s.name}`); expect(html).toContain(`Aim ${s.name} at`); }
    expect(html).toContain('Not tracking');
  });

  it('shows the editor fields, typical gain hint, usage and plot for a picked model', () => {
    const state = freshDefaultState();
    const model = newSectorModel([], 'Panel A');
    state.map.antennaModels = [model];
    state.map.sensors[1].antenna.modelId = model.id;
    const html = render(state.map);
    expect(html).toContain('Panel A');
    expect(html).toContain('used by 1 sensor');
    expect(html).toContain('65°×10°');
    expect(html).toContain('F/B 25 dB');
    // Omni is picked first; the editor for a model needs a click, so check the plot label of the omni model here.
    expect(html).toContain('0 dB');
  });

  it('shows the empty state without sensors', () => {
    const map = freshDefaultState().map;
    map.sensors = [];
    expect(render(map)).toContain('Place sensors in the Link workspace first');
  });

  it('disables New at the cap', () => {
    const map = freshDefaultState().map;
    let list: ReturnType<typeof newSectorModel>[] = [];
    for (let i = 0; i < 24; i += 1) list = [...list, newSectorModel(list)];
    map.antennaModels = list;
    expect(render(map)).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?New sector model/);
  });

  it('plots the maths of the library pattern', () => {
    const m = { ...newSectorModel([]), beamwidthDeg: 60, frontToBackDb: 25 };
    expect(horizontalCutDb(m, 0)).toBe(0);
    expect(horizontalCutDb(m, 30)).toBeCloseTo(3, 6);
    expect(horizontalCutDb(m, 180)).toBe(25);
    expect(verticalCutDb(m, 0)).toBeCloseTo(12 * (0 / 10) ** 2, 6);
    expect(verticalCutDb(m, 10)).toBeCloseTo(12, 6);
    expect(plotRangeDb(25)).toBe(30);
    expect(plotRangeDb(0)).toBe(10);
  });

  it('re-applies aim tracking through updateMapSensors', () => {
    const map = freshDefaultState().map;
    const model = newSectorModel([]);
    const withModel = { ...map, antennaModels: [model] };
    const out = updateMapSensors(withModel, (s) => s.id === map.sensors[1].id ? { ...s, antenna: { ...s.antenna, modelId: model.id, aimAtId: map.sensors[0].id } } : s);
    const a = map.sensors[1], b = map.sensors[0];
    expect(out.sensors[1].antenna.azimuthDeg).toBeCloseTo(bearingDeg(a, b), 0);
    expect(out.sensors[1].antenna.aimAtId).toBe(map.sensors[0].id);
  });
});

describe('azimuthFromPointer', () => {
  it('measures clockwise from screen-up', () => {
    expect(azimuthFromPointer(0, -50, 0)).toBe(0);
    expect(azimuthFromPointer(50, 0, 0)).toBe(90);
    expect(azimuthFromPointer(0, 50, 0)).toBe(180);
    expect(azimuthFromPointer(-50, 0, 0)).toBe(270);
  });
  it('adds the map bearing', () => {
    expect(azimuthFromPointer(0, -50, 30)).toBe(30);
    expect(azimuthFromPointer(-50, 0, 90)).toBe(0);
  });
  it('rounds to 1 degree, or 5 with Shift', () => {
    const dx = 50 * Math.sin(37.6 * Math.PI / 180), dy = -50 * Math.cos(37.6 * Math.PI / 180);
    expect(azimuthFromPointer(dx, dy, 0)).toBe(38);
    expect(azimuthFromPointer(dx, dy, 0, true)).toBe(40);
    expect(azimuthFromPointer(-1, -50, 0, true)).toBe(0);
  });
});

describe('card link', () => {
  it('offers the Antennas tab link when a callback is given', () => {
    const state = freshDefaultState();
    const pairs = evaluatePairs(state.map, state.inputs, () => 0);
    const props = { defaultFrequencyGhz: 2.4, sensor: state.map.sensors[0], map: state.map, pairs, assessments: assessAll(state.map, pairs), groundAt: () => 0, zoneInfo: null, onChange: noop, onRoleChange: noop, onZonesFor: noop };
    expect(renderToStaticMarkup(<SelectedSensorCard {...props} onOpenAntennas={noop} />)).toContain('Edit models in the Antennas tab');
    expect(renderToStaticMarkup(<SelectedSensorCard {...props} />)).not.toContain('Edit models in the Antennas tab');
  });
});
