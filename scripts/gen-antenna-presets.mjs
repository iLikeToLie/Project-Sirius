import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/data/antennaPresets.json', import.meta.url);
const description = 'Illustrative: replace with manufacturer data. Generic shape for preliminary screening.';

// Widths are full half-power widths. For a directional beam, H × V ≈ 32400 / 10^(G/10).
const specs = [
  ['dipole-2', 'Dipole omni 2 dBi', 'custom', 2, 180, 78, 25],
  ['collinear-6', 'Collinear omni 6 dBi', 'custom', 6, 180, 45, 30],
  ['collinear-9', 'Collinear omni 9 dBi', 'custom', 9, 180, 23, 35],
  ['ceiling-omni', 'Ceiling omni 3 dBi (down-looking)', 'custom', 3, 180, 90, 20],
  ['sector-33', 'Sector 33°', 'sector', 20, 33, 10, 30],
  ['sector-45', 'Sector 45°', 'sector', 19, 45, 9, 28],
  ['sector-60-hg', 'Sector 60° high-gain', 'sector', 20, 60, 5.4, 32],
  ['yagi-7', 'Yagi 7 dBi', 'custom', 7, 80, 80, 18],
  ['yagi-16', 'Yagi 16 dBi', 'custom', 16, 29, 28, 26],
  ['lpda-10', 'Log-periodic 10 dBi', 'custom', 10, 60, 54, 22],
  ['helical-13', 'Helical 13 dBi', 'custom', 13, 40, 41, 24],
  ['horn-15', 'Horn 15 dBi', 'custom', 15, 36, 28, 45],
  ['horn-20', 'Horn 20 dBi', 'custom', 20, 20, 16, 55],
  ['dish-30', 'Dish 30 dBi', 'custom', 30, 5.7, 5.7, 55],
  ['dish-34', 'Dish 34 dBi', 'custom', 34, 3.6, 3.6, 60],
];

function cut(start, end, step, landmarks, lossAt) {
  // Include the half-power points explicitly so interpolation preserves narrow beamwidths.
  const samples = new Set(landmarks.map(angle => Number(angle.toFixed(3))));
  for (let angle = start; angle <= end; angle += step) samples.add(angle);
  return [...samples].sort((a, b) => a - b).map(angle => [angle, Number(lossAt(angle).toFixed(2))]);
}

function generate([presetId, name, kind, gainDbi, beamwidthDeg, verticalBeamwidthDeg, frontToBackDb]) {
  const model = { presetId, description, name, kind, gainDbi, beamwidthDeg, verticalBeamwidthDeg, frontToBackDb };
  if (kind === 'sector') return model;

  const omni = beamwidthDeg === 180;
  const dish = presetId.startsWith('dish-');
  const elevation = presetId === 'ceiling-omni' ? -30 : 0;
  const step = dish ? 2 : 5;
  const lossAt = (offset, width) => {
    const gaussianLoss = 12 * (offset / width) ** 2;
    if (!dish || offset === 0) return Math.min(gaussianLoss, frontToBackDb);

    // F.699-style sidelobe envelope: 25 dB/decade roll-off, bounded near the main
    // beam and flat beyond 48°, with a taper to the chosen front-to-back cap.
    const sidelobeLoss = Math.max(15, gainDbi - 32 + 25 * Math.log10(Math.min(offset, 48)));
    const backTaper = Math.max(0, (offset - 90) / 90);
    const envelopeLoss = sidelobeLoss + backTaper * (frontToBackDb - sidelobeLoss);
    return Math.min(gaussianLoss, envelopeLoss, frontToBackDb);
  };

  return {
    ...model,
    pattern: {
      horizontal: cut(0, 360 - step, step, omni ? [] : [beamwidthDeg / 2, 360 - beamwidthDeg / 2],
        angle => omni ? 0 : lossAt(Math.min(angle, 360 - angle), beamwidthDeg)),
      vertical: cut(-90, 90, step, [elevation - verticalBeamwidthDeg / 2, elevation + verticalBeamwidthDeg / 2],
        angle => lossAt(Math.abs(angle - elevation), verticalBeamwidthDeg)),
    },
  };
}

const source = readFileSync(file, 'utf8');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
const entries = [...source.matchAll(/^    \{\r?\n[\s\S]*?^    \}(?=,?\r?$)/gm)];
const data = JSON.parse(source);
if (entries.length !== data.models.length || entries.length === 0) {
  throw new Error('Expected one four-space-indented block per preset.');
}

const generated = new Map(specs.map(spec => [spec[0], generate(spec)]));
const serialize = model => JSON.stringify(model, null, 2)
  .replace(/\[\n\s*(-?[\d.]+),\n\s*([\d.]+)\n\s*\]/g, '[$1, $2]')
  .replace(/^/gm, '    ').replaceAll('\n', newline);

const blocks = entries.map(([block], index) => {
  const { presetId } = data.models[index];
  const model = generated.get(presetId);
  generated.delete(presetId);
  return model ? serialize(model) : block;
});
blocks.push(...[...generated.values()].map(serialize));

const tail = entries.at(-1);
const output = source.slice(0, entries[0].index) + blocks.join(`,${newline}`) + source.slice(tail.index + tail[0].length);
if (output !== source) writeFileSync(file, output);
