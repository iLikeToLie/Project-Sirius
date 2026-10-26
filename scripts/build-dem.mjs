import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';
import { encodeTerrarium, mosaicSample } from './dem-lib.mjs';

const bounds = [103.596, 1.1443, 104.4309, 1.4835];
const zooms = [10, 11, 12, 13, 14];
const input = resolve(process.argv[2] ?? 'Map');
const output = resolve('public/dem');
const temp = await mkdtemp(join(tmpdir(), 'sirius-dem-'));
const mercY = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
try {
  const tiles = [];
  for (const name of ['N001E103', 'N001E104']) {
    execFileSync('unzip', ['-q', join(input, `${name}.zip`), '-d', temp]);
    const dir = join(temp, name);
    const files = await readdir(dir);
    const read = async suffix => {
      const filename = files.find(f => f.endsWith(suffix));
      if (!filename) throw new Error(`Missing ${suffix} in ${name}`);
      const tiff = await fromFile(join(dir, filename));
      try {
        const image = await tiff.getImage();
        const data = await image.readRasters({ interleave: true });
        return { image, data };
      } finally { await tiff.close(); }
    };
    const { image, data: dsm } = await read('_DSM.tif');
    const { data: mask } = await read('_MSK.tif');
    const [west, , , north] = image.getBoundingBox();
    const [cellSize] = image.getResolution();
    tiles.push({ west, north, cellSize, width: image.getWidth(), height: image.getHeight(), dsm, mask });
  }
  let filled = 0, total = 0;
  for (const t of tiles) {
    for (let j = 0; j < t.height; j++) {
      const lat = t.north - (j + 0.5) * t.cellSize;
      if (lat < bounds[1] || lat > bounds[3]) continue;
      for (let i = 0; i < t.width; i++) {
        const lon = t.west + (i + 0.5) * t.cellSize;
        if (lon < bounds[0] || lon > bounds[2]) continue;
        total++;
        const m = t.mask[j * t.width + i];
        if ((m & 3) === 1 || (m & 252) !== 0) filled++;
      }
    }
  }
  let count = 0;
  for (const z of zooms) {
    const n = 2 ** z;
    const x0 = Math.floor((bounds[0] + 180) / 360 * n), x1 = Math.floor((bounds[2] + 180) / 360 * n);
    const y0 = Math.floor(mercY(bounds[3]) * n), y1 = Math.floor(mercY(bounds[1]) * n);
    for (let x = x0; x <= x1; x++) {
      await mkdir(join(output, String(z), String(x)), { recursive: true });
      for (let y = y0; y <= y1; y++) {
        const png = new PNG({ width: 256, height: 256 });
        for (let j = 0; j < 256; j++) {
          const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + 0.5) / 256) / n))) * 180 / Math.PI;
          for (let i = 0; i < 256; i++) {
            const lon = (x + (i + 0.5) / 256) / n * 360 - 180;
            const k = (j * 256 + i) * 4;
            png.data.set([...encodeTerrarium(mosaicSample(tiles, lat, lon)), 255], k);
          }
        }
        await writeFile(join(output, String(z), String(x), `${y}.png`), PNG.sync.write(png));
        count++;
      }
    }
  }
  const manifest = { source: 'ALOS AW3D30 v4 (ALPSMLC30)', version: '4.1', bounds, datum: 'EGM96', zooms, cloudFilledShare: filled / total };
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${count} tiles.`, manifest);
} finally { await rm(temp, { recursive: true, force: true }); }
