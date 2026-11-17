import type { AntennaModel } from '../types';
import { derivedBeamwidthDeg, interpolateLossDb, isAntennaModel, MAX_ANTENNA_MODELS, MAX_PATTERN_POINTS } from './antenna';

const FORMAT = 'lbw-antenna-models';
type ImportResult = { models: AntennaModel[]; added: number; skipped: number; notes: string[] } | { error: string };
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copy known file fields only, sorting cuts without retaining caller-owned arrays. */
function copyModel(m: AntennaModel): AntennaModel {
  return { id: m.id, name: m.name, kind: m.kind, gainDbi: m.gainDbi, beamwidthDeg: m.beamwidthDeg,
    verticalBeamwidthDeg: m.verticalBeamwidthDeg, frontToBackDb: m.frontToBackDb,
    ...(m.pattern ? { pattern: {
      horizontal: m.pattern.horizontal.map(([a, l]): [number, number] => [a, l]).sort((a, b) => a[0] - b[0]),
      vertical: m.pattern.vertical.map(([a, l]): [number, number] => [a, l]).sort((a, b) => a[0] - b[0]),
    } } : {}),
  };
}

/** Portable versioned library file; ids are local to a scenario and never exported. */
export function exportModelsJson(models: AntennaModel[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, models: models.map(m => {
    const { id: _id, ...shape } = copyModel(m);
    return shape;
  }) }, null, 2);
}

function readJson(raw: unknown): AntennaModel[] {
  if (!record(raw) || raw.format !== FORMAT || raw.version !== 1 || !Array.isArray(raw.models)) {
    throw new Error('Expected an lbw-antenna-models version 1 file with a models array.');
  }
  return raw.models.map((value: unknown, i: number) => {
    if (!record(value)) throw new Error(`Model ${i + 1}: expected an antenna model object.`);
    const candidate = { ...value, id: 'import' };
    if (!isAntennaModel(candidate)) throw new Error(`Model ${i + 1}: invalid name, kind, gain, beamwidth, cap or point table (2–721 unique angles, loss 0–60 dB; H 0–360°, V −90–90°).`);
    return copyModel(candidate);
  });
}

/** Planet angles run clockwise downwards in V; only the front elevation half is used. */
function readMsi(text: string, notes: string[]): AntennaModel[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.startsWith(';'));
  let name: string | undefined, gainDbi: number | undefined;
  const cuts: Partial<Record<'horizontal' | 'vertical', [number, number][]>> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^NAME\b/i.test(line)) {
      if (name !== undefined) throw new Error('MSI: duplicate NAME header.');
      name = line.replace(/^NAME\s*/i, '').trim();
    } else if (/^GAIN\b/i.test(line)) {
      if (gainDbi !== undefined) throw new Error('MSI: duplicate GAIN header.');
      const match = /^GAIN\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(dBi|dBd)?$/i.exec(line);
      if (!match || !Number.isFinite(Number(match[1]))) throw new Error('MSI: GAIN must be finite, with dBi or dBd units.');
      const unit = match[2]?.toLowerCase();
      gainDbi = Number(match[1]) + (unit === 'dbi' ? 0 : 2.15);
      if (!unit) notes.push('MSI GAIN has no unit: assumed dBd (Planet convention), adding 2.15 dB to convert to dBi.');
    } else if (/^(HORIZONTAL|VERTICAL)\b/i.test(line)) {
      const match = /^(HORIZONTAL|VERTICAL)\s+(\d+)$/i.exec(line);
      if (!match) throw new Error('MSI: invalid cut header.');
      const key = match[1].toLowerCase() as 'horizontal' | 'vertical', count = Number(match[2]);
      if (cuts[key] || count < 2 || count > MAX_PATTERN_POINTS) throw new Error(`MSI: ${key} needs one block with 2–${MAX_PATTERN_POINTS} points.`);
      const cut: [number, number][] = [];
      const angles = new Set<number>();
      for (let n = 0; n < count; n++) {
        const row = lines[++i]?.split(/\s+/);
        const angle = Number(row?.[0]), loss = Number(row?.[1]);
        if (!row || row.length !== 2 || !Number.isFinite(angle) || !Number.isFinite(loss)
          || angle < 0 || angle > 360 || loss < 0 || loss > 60 || angles.has(angle)) {
          throw new Error(`MSI: invalid ${key} point ${n + 1}; expected unique angles 0–360 and losses 0–60 dB.`);
        }
        angles.add(angle); cut.push([angle, loss]);
      }
      cuts[key] = cut.sort((a, b) => a[0] - b[0]);
    } else if (/^[+\-\d.]/.test(line)) {
      throw new Error('MSI: unexpected point outside a cut block; check the declared point count.');
    }
    // Other standard MSI headers (frequency, tilt, polarization, etc.) are informational.
  }
  if (!name || gainDbi === undefined || !cuts.horizontal || !cuts.vertical) throw new Error('MSI: NAME, GAIN, HORIZONTAL and VERTICAL blocks are required.');
  const vertical: [number, number][] = cuts.vertical.filter(([a]) => a <= 90 || a >= 270)
    .map(([a, l]) => [a === 0 || a === 360 ? 0 : a <= 90 ? -a : 360 - a, l]);
  // A closing 360-degree row is the same horizon point as 0 in the vertical cut.
  const front = [...new Map(vertical.map(p => [p[0], p])).values()].sort((a, b) => a[0] - b[0]);
  const model: AntennaModel = { id: 'import', name, kind: 'custom', gainDbi,
    beamwidthDeg: Math.max(1, Math.min(180, derivedBeamwidthDeg(cuts.horizontal, true))),
    verticalBeamwidthDeg: Math.max(1, Math.min(90, derivedBeamwidthDeg(front, false))),
    frontToBackDb: interpolateLossDb(cuts.horizontal, 180, true), pattern: { horizontal: cuts.horizontal, vertical: front } };
  if (!isAntennaModel(model)) throw new Error('MSI: the front vertical half needs at least two valid points.');
  notes.push('MSI vertical angles mapped to elevation (positive up); the back half is represented by the horizontal cut and combined-loss cap.');
  return [model];
}

/** Validate the whole file before adding any models; neither failure nor success mutates existing. */
export function importAntennaFile(text: string, filename: string, existing: AntennaModel[]): ImportResult {
  try {
    let raw: unknown;
    let json = false;
    try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); json = true; } catch {
      if (/\.json$/i.test(filename) || /^[\s\uFEFF]*[\[{]/.test(text)) throw new Error('Invalid antenna JSON file.');
    }
    const notes: string[] = [];
    const imported = json ? readJson(raw) : readMsi(text, notes);
    const models = [...existing], ids = new Set(existing.map(m => m.id)), names = new Set(existing.map(m => m.name));
    let added = 0;
    for (const m of imported) {
      if (models.length >= MAX_ANTENNA_MODELS) break;
      let n = 1;
      while (ids.has(`ant-${n}`)) n++;
      const id = `ant-${n}`;
      let name = m.name, suffix = 2;
      while (names.has(name)) name = `${m.name} (${suffix++})`;
      ids.add(id); names.add(name); models.push({ ...m, id, name }); added++;
    }
    const skipped = imported.length - added;
    if (skipped) notes.push(`${skipped} model${skipped === 1 ? '' : 's'} skipped: the library limit is ${MAX_ANTENNA_MODELS}.`);
    return { models, added, skipped, notes };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid antenna file.' };
  }
}
