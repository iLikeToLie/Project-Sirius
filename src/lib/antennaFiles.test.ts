import { describe, expect, it } from 'vitest';
import { exportModelsJson, importAntennaFile } from './antennaFiles';
import { ANTENNA_PRESETS, addPreset } from './antennaPresets';
import { isAntennaModel, newSectorModel, resolveAntenna, verticalTermDb } from './antenna';
import { DEFAULT_STATE } from '../data/defaults';
import type { AntennaModel } from '../types';

const custom = (): AntennaModel => ({ ...newSectorModel([]), kind: 'custom', pattern: {
  horizontal: [[0, 0], [90, 12], [180, 25], [270, 15]], vertical: [[-90, 30], [0, 0], [90, 35]],
} });
const file = (models: unknown[]) => JSON.stringify({ format: 'lbw-antenna-models', version: 1, models });
const msi = (gain = '10 dBd') => `NAME Sample Yagi\nFREQUENCY 900\nGAIN ${gain}\nHORIZONTAL 4\n0 0\n90 12\n180 25\n270 15\nVERTICAL 8\n0 0\n45 10\n90 30\n135 35\n180 40\n225 35\n270 20\n315 5\n`;
const imported = (text: string, existing: AntennaModel[] = [], filename = 'models.json') => {
  const result = importAntennaFile(text, filename, existing);
  if ('error' in result) throw new Error(result.error);
  return result;
};

describe('antenna JSON files', () => {
  it('round-trips all kinds and retained inactive tables, omitting ids', () => {
    const models = [newSectorModel([]), custom(), { ...custom(), kind: 'omni' as const }];
    const text = exportModelsJson(models), parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ format: 'lbw-antenna-models', version: 1 });
    expect(parsed.models.every((m: Record<string, unknown>) => !('id' in m))).toBe(true);
    const result = imported(text);
    expect(result.added).toBe(3); expect(result.skipped).toBe(0);
    expect(result.models.map(({ id: _id, name: _name, ...m }) => m)).toEqual(models.map(({ id: _id, name: _name, ...m }) => m));
    expect(new Set(result.models.map(m => m.id)).size).toBe(3);
    expect(imported(exportModelsJson([])).models).toEqual([]);
  });
  it('sorts tables and imports independent copies, without trusting supplied ids', () => {
    const m = custom(); m.pattern!.horizontal.reverse();
    const result = imported(file([{ ...m, id: 'omni' }]));
    expect(result.models[0].id).toBe('ant-1');
    expect(result.models[0].pattern!.horizontal[0]).toEqual([0, 0]);
    expect(m.pattern!.horizontal[0]).toEqual([270, 15]);
  });
  it('deduplicates names and ids, reports the library cap and validates skipped models too', () => {
    const existing = [newSectorModel([])];
    const result = imported(file([existing[0], existing[0]]), existing);
    expect(result.models.map(m => m.name)).toEqual(['Sector 1', 'Sector 1 (2)', 'Sector 1 (3)']);
    expect(result.models.map(m => m.id)).toEqual(['ant-1', 'ant-2', 'ant-3']);
    expect(existing).toHaveLength(1);
    const full = Array.from({ length: 23 }, (_, i) => ({ ...newSectorModel([]), id: `ant-${i + 1}`, name: `A ${i}` }));
    const capped = imported(file([custom(), custom(), custom()]), full);
    expect(capped.models).toHaveLength(24); expect(capped.added).toBe(1); expect(capped.skipped).toBe(2);
    expect(imported(file([custom()]), capped.models).skipped).toBe(1);
    expect(importAntennaFile(file([custom(), { ...custom(), gainDbi: null }]), 'm.json', full)).toHaveProperty('error');
  });
  it.each([
    '', '{', 'null', '{}', '[]', JSON.stringify({ format: 'other', version: 1, models: [] }),
    JSON.stringify({ format: 'lbw-antenna-models', version: 2, models: [] }), file([null]),
    ...[{ name: '' }, { name: ' ' }, { kind: 'dish' }, { gainDbi: null }, { beamwidthDeg: 0 }, { beamwidthDeg: 181 },
      { verticalBeamwidthDeg: 0 }, { verticalBeamwidthDeg: 91 }, { frontToBackDb: -1 }, { frontToBackDb: 61 },
      { pattern: null }, { pattern: undefined }, { pattern: {} },
      ...[[], [[0, 0]], [[0, 0], [0, 3]], [[-1, 0], [30, 2]], [[0, 0], [361, 2]], [[0, -1], [30, 0]], [[0, 0], [30, 61]], [[0, 0, 1], [30, 3]],
        Array.from({ length: 722 }, (_, i) => [i / 3, 0])].map(horizontal => ({ pattern: { ...custom().pattern, horizontal } })),
      { pattern: { ...custom().pattern, vertical: [[-91, 0], [0, 0]] } },
      { pattern: { ...custom().pattern, vertical: [[0, 0], [91, 0]] } },
    ].map(change => file([{ ...custom(), ...change }]))
  ])('rejects malformed or invalid files atomically (%#)', text => {
    const existing = [newSectorModel([])], before = JSON.stringify(existing);
    expect(importAntennaFile(text, 'bad.json', existing)).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(existing)).toBe(before);
  });
});

describe('MSI/Planet files', () => {
  it.each(['sample.msi', 'sample.pln', 'sample.ant', 'sample.txt'])('maps front vertical elevations and dBd gain (%s)', filename => {
    const { models } = imported(msi(), [], filename), m = models[0];
    expect(m.name).toBe('Sample Yagi'); expect(m.gainDbi).toBe(12.15); expect(m.frontToBackDb).toBe(25);
    expect(m.pattern!.vertical).toEqual([[-90, 30], [-45, 10], [0, 0], [45, 5], [90, 20]]);
    expect(isAntennaModel(m)).toBe(true);
    const p = resolveAntenna({ antennaModels: models }, { ...DEFAULT_STATE.map.sensors[0], antenna: { modelId: m.id, azimuthDeg: 0, downtiltDeg: 0, aimAtId: null } });
    expect(verticalTermDb(p, -45)).toBe(10); expect(verticalTermDb(p, 45)).toBe(5);
  });
  it('keeps dBi, notes assumed dBd and accepts a real 360-sample block', () => {
    expect(imported(msi('10 dBi'), [], 'x.msi').models[0].gainDbi).toBe(10);
    const assumed = imported(msi('10'), [], 'x.msi');
    expect(assumed.models[0].gainDbi).toBe(12.15); expect(assumed.notes.join(' ')).toMatch(/assum.*dBd/i);
    const block = Array.from({ length: 360 }, (_, a) => `${a} ${Math.min(a, 30)}`).join('\n');
    const full = imported(`NAME Full\nGAIN 5 DBI\nHORIZONTAL 360\n${block}\nVERTICAL 360\n${block}`, [], 'full.msi');
    expect(full.models[0].pattern!.horizontal).toHaveLength(360);
    expect(full.models[0].pattern!.vertical).toHaveLength(181);
  });
  it.each([
    'junk', msi().replace('GAIN 10 dBd', 'GAIN nope'), msi().replace('GAIN 10 dBd', 'GAIN 10 watts'),
    msi().replace('0 0\n90 12', '0 0\n0 12'), msi().replace('90 12', '90 -1'),
    msi().replace('90 12', '90 61'), msi().replace('HORIZONTAL 4', 'HORIZONTAL 5'),
    msi().replace('HORIZONTAL 4', 'HORIZONTAL 722'), msi().replace('VERTICAL 8', 'VERTICAL 7'),
    msi().replace('90 12', '361 12'), msi().replace('315 5', ''),
  ])('rejects invalid blocks and metadata (%#)', text => {
    expect(importAntennaFile(text, 'bad.msi', [])).toEqual({ error: expect.any(String) });
  });
});

describe('illustrative presets', () => {
  it('loads all eight presets through the importer and makes editable copies', () => {
    expect(ANTENNA_PRESETS).toHaveLength(8);
    for (const preset of ANTENNA_PRESETS) {
      expect(preset.description).toMatch(/illustrative.*manufacturer/i);
      const a = addPreset([], preset.id), b = addPreset([a], preset.id);
      expect(isAntennaModel(a)).toBe(true); expect(a.id).not.toBe(b.id); expect(a.name).not.toBe(b.name);
      if (a.pattern) {
        const before = JSON.stringify(preset.model.pattern);
        a.pattern.horizontal[0][1] = 57;
        expect(JSON.stringify(preset.model.pattern)).toBe(before);
        expect(b.pattern!.horizontal[0][1]).not.toBe(57);
      }
    }
    expect(() => addPreset([], 'missing')).toThrow();
    expect(() => addPreset(Array(24).fill(newSectorModel([])), ANTENNA_PRESETS[0].id)).toThrow();
  });
});
