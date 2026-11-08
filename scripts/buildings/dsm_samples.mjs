// Bundled DEM values over tall buildings and open ground, to show how much building mass the
// AW3D30 DSM already carries. Run from the repo root: node scripts/buildings/dsm_samples.mjs
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const z = 14, S = 256;
function demAt(lat, lon) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  const gx = (lon + 180) / 360 * n * S, gy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n * S;
  const x = Math.floor(gx / S), y = Math.floor(gy / S);
  const png = PNG.sync.read(readFileSync(`public/dem/${z}/${x}/${y}.png`));
  const i = (Math.floor(gy - y * S) * S + Math.floor(gx - x * S)) * 4;
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
}
const points = [
  ['Raffles Place towers', 1.2842, 103.8513], ['Marina Bay Sands hotel tower', 1.2834, 103.8607],
  ['Padang (open field)', 1.2899, 103.8521], ['Gardens by the Bay lawn', 1.2816, 103.8636],
  ['Punggol HDB blocks', 1.4043, 103.9020], ['Punggol Waterway Park', 1.4085, 103.9050],
];
for (const [name, lat, lon] of points) console.log(`${name.padEnd(30)} ${demAt(lat, lon).toFixed(1)} m`);
