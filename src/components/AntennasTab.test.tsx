import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { freshDefaultState } from '../data/defaults';
import { azimuthFromPointer, bearingDeg, newSectorModel, updateMapSensors } from '../lib/antenna';
import type { AntennaModel } from '../types';
import { ANTENNA_PRESETS, PRESET_FAMILIES } from '../lib/antennaPresets';
import { AntennaPresetMenu, AntennasTab, describeImport, kindPatch, parsePastedPoints, PatternEditor, patternPatch } from './AntennasTab';
import {
  AntennaPolar, horizontalCutDb, interpLoss, isSymmetric, lossFromRadius, mirrorAngle, nudgedLoss, plotRangeDb, verticalCutDb, withAngle, withLoss, withoutPoint, withPoint,
} from './AntennaPolar';
import { SelectedSensorCard } from './map/SelectedSensorCard';
import { assessAll } from '../lib/interference';
import { evaluatePairs } from '../lib/sensors';

const noop = () => undefined;
const render = (map = freshDefaultState().map) => renderToStaticMarkup(<AntennasTab map={map} setMap={noop} />);
const renderMenu = (previewId: string | null = null) => renderToStaticMarkup(
  <AntennaPresetMenu previewId={previewId} setPreviewId={noop} onAddBlank={noop} onAddPreset={noop} />,
);

describe('AntennasTab', () => {
  it('lists every preset under its family heading with its description linked', () => {
    const html = renderMenu();
    const groups = html.split(/<li role="presentation" class="menu-heading">/);
    expect(groups).toHaveLength(PRESET_FAMILIES.length + 1);
    expect(groups[0]).toContain('>Blank sector</button>');
    PRESET_FAMILIES.forEach((family, i) => {
      const group = groups[i + 1];
      const presets = ANTENNA_PRESETS.filter((preset) => preset.family === family);
      expect(group).toMatch(new RegExp(`^${family}</li>`));
      expect(group.match(/role="menuitem"/g)).toHaveLength(presets.length);
      for (const preset of presets) {
        expect(group).toContain(`>${preset.label}</button>`);
        const descriptionId = group.match(new RegExp(`aria-describedby="([^"]+-${preset.id})"`))?.[1];
        expect(descriptionId).toBeDefined();
        expect(group).toContain(`id="${descriptionId}" hidden="">${preset.description}</span>`);
      }
    });
  });

  it('renders a single compact, decorative plot for the hovered or focused preset', () => {
    expect(renderMenu()).not.toContain('antenna-polar');
    const horizontalPath = (id: string) => {
      const html = renderMenu(id);
      expect(html).toContain('class="preset-preview" aria-hidden="true"');
      expect(html.match(/class="antenna-polar compact"/g)).toHaveLength(1);
      expect(html).toContain('width="140" height="140"');
      expect(html).not.toMatch(/<figcaption|<text|class="handle/);
      const trace = html.match(/<path d="([^"]+)" class="trace trace-h"/)?.[1];
      expect(trace).toBeDefined();
      return trace;
    };
    expect(horizontalPath('dish-30')).not.toBe(horizontalPath('horn-15'));
  });

  it('lists the read-only Omni row first and the sensors table', () => {
    const state = freshDefaultState();
    const html = render(state.map);
    expect(html.indexOf('Uses each sensor&#x27;s own gain')).toBeGreaterThan(-1);
    expect(html).toContain('New model');
    expect(html).toContain('Import file');
    expect(html).toContain('Export library');
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
    expect(render(map)).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?New model/);
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

const CUSTOM: AntennaModel = {
  id: 'ant-9', name: 'Panel', kind: 'custom', gainDbi: 14, beamwidthDeg: 40, verticalBeamwidthDeg: 20, frontToBackDb: 30,
  pattern: {
    horizontal: [[0, 0], [20, 3], [90, 20], [180, 30], [270, 20], [340, 3]],
    vertical: [[-90, 25], [-10, 3], [0, 0], [10, 3], [90, 25]],
  },
};

describe('custom model editing', () => {
  it('switching sector to custom seeds the tables once and keeps an existing pattern', () => {
    const sector = newSectorModel([]);
    const seeded = kindPatch(sector, 'custom');
    expect(seeded.kind).toBe('custom');
    expect(seeded.pattern?.horizontal.length).toBeGreaterThan(2);
    expect(seeded.pattern?.vertical.length).toBeGreaterThan(2);
    const kept = kindPatch({ ...sector, pattern: CUSTOM.pattern }, 'custom');
    expect(kept.pattern).toBeUndefined();
    expect(kindPatch(CUSTOM, 'sector')).toEqual({ kind: 'sector' });
  });

  it('derives the beamwidths and a cap from an edited table', () => {
    const next = patternPatch({ ...CUSTOM, frontToBackDb: 10 }, CUSTOM.pattern!);
    expect(next.frontToBackDb).toBe(30);
    expect(next.beamwidthDeg).toBeGreaterThan(1);
    expect(next.verticalBeamwidthDeg).toBeGreaterThan(1);
    expect(patternPatch(CUSTOM, CUSTOM.pattern!).frontToBackDb).toBe(30);
  });

  it('renders the point table, cut toggle, Symmetric and Paste values', () => {
    const html = renderToStaticMarkup(<PatternEditor model={CUSTOM} cut="h" setCut={noop} symmetric setSymmetric={noop} onPoints={noop} />);
    expect(html).toContain('Horizontal cut');
    expect(html).toContain('Vertical cut');
    expect(html).toContain('Symmetric');
    expect(html).toContain('Add point');
    expect(html).toContain('Paste values');
    expect(html).toContain('Loss at 90°');
    expect(html).toContain('Delete point at 270°');
    const v = renderToStaticMarkup(<PatternEditor model={CUSTOM} cut="v" setCut={noop} symmetric setSymmetric={noop} onPoints={noop} />);
    expect(v).not.toContain('Symmetric');
    expect(v).toContain('Angle of point -90');
  });

  it('table edits: loss, angle, add, delete, with and without Symmetric', () => {
    const h = CUSTOM.pattern!.horizontal;
    expect(withLoss(h, 20, 5).find(([a]) => a === 340)?.[1]).toBe(3);
    const mirrored = withLoss(h, 20, 5, true);
    expect(mirrored.find(([a]) => a === 20)?.[1]).toBe(5);
    expect(mirrored.find(([a]) => a === 340)?.[1]).toBe(5);
    expect(mirrorAngle(0)).toBe(0);
    expect(mirrorAngle(90)).toBe(270);
    expect(withoutPoint(h, 90, true).map(([a]) => a)).toEqual([0, 20, 180, 340]);
    expect(withoutPoint([[0, 0], [10, 1]], 0)).toEqual([[0, 0], [10, 1]]);
    expect(withPoint(h, 45, 8, true).map(([a]) => a)).toEqual([0, 20, 45, 90, 180, 270, 315, 340]);
    expect(withPoint(h, 20, 9)).toBe(h);
    expect(withAngle(h, 20, 30, true)?.map(([a]) => a)).toEqual([0, 30, 90, 180, 270, 330]);
    expect(withAngle(h, 20, 90)).toBeNull();
    expect(isSymmetric(h)).toBe(true);
    expect(isSymmetric(withLoss(h, 20, 5))).toBe(false);
  });

  it('interpolates a cut linearly, wrapping the horizontal one', () => {
    const h = CUSTOM.pattern!.horizontal;
    expect(interpLoss(h, 10, true)).toBeCloseTo(1.5, 6);
    expect(interpLoss(h, 350, true)).toBeCloseTo(1.5, 6);
    expect(interpLoss(h, 360, true)).toBeCloseTo(0, 6);
    expect(interpLoss(CUSTOM.pattern!.vertical, -50, false)).toBeCloseTo(14, 6);
    expect(interpLoss(CUSTOM.pattern!.vertical, 120, false)).toBe(25);
  });

  it('snaps drag losses to 0.5 dB (0.1 with Shift) inside the plot range', () => {
    expect(lossFromRadius(104, 30)).toBe(0);
    expect(lossFromRadius(0, 30)).toBe(30);
    expect(lossFromRadius(52, 30)).toBe(15);
    expect(lossFromRadius(104 * (1 - 7.3 / 30), 30)).toBe(7.5);
    expect(lossFromRadius(104 * (1 - 7.3 / 30), 30, true)).toBe(7.3);
    expect(lossFromRadius(500, 30)).toBe(0);
  });

  it('nudges a handle with the arrow keys', () => {
    expect(nudgedLoss(3, 'ArrowUp', false)).toBe(3.5);
    expect(nudgedLoss(3, 'ArrowDown', false)).toBe(2.5);
    expect(nudgedLoss(3, 'ArrowUp', true)).toBe(3.1);
    expect(nudgedLoss(0, 'ArrowDown', false)).toBe(0);
    expect(nudgedLoss(59.8, 'ArrowUp', false)).toBe(60);
    expect(nudgedLoss(3, 'a', false)).toBeNull();
  });

  it('draws labelled, focusable handles only in edit mode', () => {
    const edit = renderToStaticMarkup(<AntennaPolar model={CUSTOM} edit={{ cut: 'h', symmetric: true, onChange: noop }} />);
    expect(edit).toContain('aria-label="Horizontal point at 90°"');
    expect(edit).toContain('tabindex="0"');
    expect(edit.match(/class="handle /g)).toHaveLength(6);
    const vertical = renderToStaticMarkup(<AntennaPolar model={CUSTOM} edit={{ cut: 'v', symmetric: true, onChange: noop }} />);
    expect(vertical).toContain('aria-label="Vertical point at -10°"');
    expect(renderToStaticMarkup(<AntennaPolar model={CUSTOM} />)).not.toContain('class="handle');
    expect(renderToStaticMarkup(<AntennaPolar compact model={CUSTOM} edit={{ cut: 'h', symmetric: true, onChange: noop }} />)).not.toContain('class="handle');
  });

  it('plots a custom table through the library maths', () => {
    expect(horizontalCutDb(CUSTOM, 90)).toBeCloseTo(20, 6);
    expect(horizontalCutDb(CUSTOM, 10)).toBeCloseTo(1.5, 6);
    expect(verticalCutDb(CUSTOM, 5)).toBeCloseTo(1.5, 6);
  });

  it('parses pasted values and reports each bad line', () => {
    const ok = parsePastedPoints('0, 0\n90\t12\n 45 6 \n\n180;30', 'h');
    expect(ok).toEqual({ points: [[0, 0], [45, 6], [90, 12], [180, 30]] });
    const bad = parsePastedPoints('0, 0\nabc, 3\n400, 3\n10, 99\n0, 5', 'h');
    expect('errors' in bad && bad.errors).toEqual([
      'Line 2: expected "angle, loss".', 'Line 3: angle must be between 0 and 360.', 'Line 4: loss must be between 0 and 60 dB.', 'Line 5: angle 0 is repeated.',
    ]);
    expect(parsePastedPoints('0, 0', 'h')).toEqual({ errors: ['Enter between 2 and 721 points.'] });
    expect(parsePastedPoints('-95, 3\n0, 0', 'v')).toEqual({ errors: ['Line 1: angle must be between -90 and 90.'] });
  });

  it('describes import results', () => {
    expect(describeImport({ added: 2, skipped: 0, notes: [] })).toEqual({ ok: true, text: 'Added 2 models.' });
    expect(describeImport({ added: 1, skipped: 3, notes: ['Gain assumed dBd.'] })).toEqual({ ok: true, text: 'Added 1 model, skipped 3 (the library holds 24). Gain assumed dBd.' });
    expect(describeImport({ error: 'Not an antenna file.' })).toEqual({ ok: false, text: 'Not an antenna file.' });
  });
});
