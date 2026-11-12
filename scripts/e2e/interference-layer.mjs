// Run against production preview; accepts PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE and E2E_URL.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tile = new PNG({ width: 256, height: 256 });
for (let i = 0; i < tile.data.length; i += 4) tile.data.set([128, 0, 0, 255], i);
const body = PNG.sync.write(tile);
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('**/dem/**/*.png', r => r.fulfill({ contentType: 'image/png', body }));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.jobs = [];
    window.Worker = class extends NativeWorker {
      postMessage(req, ...args) {
        if (req.kind === 'multi') {
          const record = { req, done: false };
          window.jobs.push(record);
          this.addEventListener('message', e => {
            if (e.data.jobId === req.jobId) { record.done = true; record.powers = e.data.powers.map(p => [...p]); }
          });
        }
        return super.postMessage(req, ...args);
      }
    };
    const put = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (image, ...args) {
      window.zonePixels = [...image.data];
      return put.call(this, image, ...args);
    };
  });
  const url = process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/';
  const open = async () => {
    await page.goto(url);
    await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  };
  await open();
  const base = await page.evaluate(() => JSON.parse(localStorage.getItem('friis-rf-planner-v3-state')));
  base.map.propagationModel = 'free-space'; base.map.useTerrainElevation = false;
  base.map.defaultObjective = 'avoidance'; base.map.aggregateInterference = 'always';
  const tx = base.map.sensors.find(s => s.role === 'tx'), rx = base.map.sensors.find(s => s.role === 'rx');
  rx.name = 'R1'; rx.aglM = 7; rx.interferenceThresholdDbm = -65; rx.protectionMarginDb = 3;
  const second = { ...tx, id: 'extra-tx', name: 'T2' };
  base.map.sensors = [tx, rx, second]; base.map.selectedId = rx.id;
  // `recompute` is false for edits that only change classification (thresholds, aggregation): the field key ignores them, so no new job is sent.
  const upload = async (state, recompute = true) => {
    const count = await page.evaluate(() => window.jobs.length);
    await page.locator('input[type=file]').setInputFiles({ name: 'layer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
    if (count && recompute) await page.waitForFunction(n => window.jobs.length > n, count);
  };
  const waitField = async () => {
    await page.waitForFunction(() => window.jobs.length && window.jobs.at(-1).done);
    await page.getByText('Refining coverage…', { exact: true }).waitFor({ state: 'hidden' });
  };
  const checkBands = async aggregate => page.waitForFunction(({ threshold, margin, aggregate }) => {
    const job = window.jobs.at(-1), pixels = window.zonePixels;
    if (!job?.done || !pixels || pixels.length !== job.req.raster.values.length * 4) return false;
    const { cols, rows } = job.req.raster;
    for (let k = 0; k < job.req.raster.values.length; k++) {
      const powers = job.powers.map(p => p[k]);
      const max = Math.max(...powers);
      const power = aggregate ? max + 10 * Math.log10(powers.reduce((sum, p) => sum + 10 ** ((p - max) / 10), 0)) : max;
      const alpha = power >= threshold ? 54 : power > threshold - margin ? 46 : 0;
      const row = Math.floor(k / (cols + 1)), col = k % (cols + 1);
      if (pixels[((rows - row) * (cols + 1) + col) * 4 + 3] !== alpha) return false;
    }
    return true;
  }, { threshold: rx.interferenceThresholdDbm, margin: rx.protectionMarginDb, aggregate });
  await upload(base);
  const legend = page.getByRole('complementary', { name: 'Coverage legend' });
  await legend.getByRole('button', { name: 'Interference', exact: true }).click();
  await legend.getByRole('button', { name: 'Bands', exact: true }).click();
  await waitField();
  assert.match(await legend.innerText(), /Total interference at R1's settings \(aggregate\)/);
  assert.equal(await page.locator('.range-ring-label').count(), 0);
  assert.equal(await legend.getByRole('button', { name: 'Placement', exact: true }).isDisabled(), true);
  assert.equal(await legend.getByText('Show all bands').count(), 0);
  const job = await page.evaluate(() => window.jobs.at(-1));
  assert.equal(job.req.sources.length, 2); assert.equal(job.req.rxAglM, 7);
  assert.equal(job.req.radials, 360); assert.equal(job.req.mode, 'free-space');
  // Coincident transmitters contribute equal powers. The map must show their sum.
  const index = job.powers[0].findIndex(Number.isFinite);
  const expected = job.powers[0][index] + 10 * Math.log10(2);
  assert.ok(Number.isFinite(expected));
  const sorted = job.powers[0].filter(Number.isFinite).sort((a, b) => a - b);
  const jobsBefore = await page.evaluate(() => window.jobs.length);
  rx.interferenceThresholdDbm = sorted[Math.floor(sorted.length / 2)] + 10 * Math.log10(2) + 3;
  await upload(base, false); await waitField();
  assert.equal(await page.evaluate(() => window.jobs.length), jobsBefore, 'a threshold edit reclassifies without a new field job');
  await checkBands(true);
  const colours = await page.evaluate(() => {
    const counts = { red: 0, amber: 0, clear: 0 };
    for (let k = 0; k < window.zonePixels.length; k += 4) {
      if (window.zonePixels[k + 3] === 54) counts.red++;
      if (window.zonePixels[k + 3] === 46) counts.amber++;
      if (window.zonePixels[k + 3] === 0) counts.clear++;
    }
    return counts;
  });
  assert.ok(colours.red > 0 && colours.amber > 0 && colours.clear > 0, JSON.stringify(colours));
  await open(); await waitField();
  assert.equal(await legend.getByRole('button', { name: 'Interference', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await legend.getByRole('button', { name: 'Bands', exact: true }).getAttribute('aria-pressed'), 'true');
  base.map.aggregateInterference = 'never';
  await upload(base, false); await waitField();
  await checkBands(false);
  assert.match(await legend.innerText(), /worst single/);
  base.map.defaultObjective = 'desired'; rx.desiredTxIds = [tx.id];
  await upload(base); await waitField();
  assert.equal(await page.evaluate(() => window.jobs.at(-1).req.sources.length), 1);
  const otherRx = { ...rx, id: 'other-rx', name: 'R2', aglM: 11 };
  base.map.sensors.push(otherRx); base.map.selectedId = otherRx.id;
  await upload(base); await waitField();
  assert.match(await legend.innerText(), /R2's settings/);
  assert.equal(await page.evaluate(() => window.jobs.at(-1).req.rxAglM), 11);
  base.map.propagationModel = 'terrain';
  await upload(base); await waitField();
  assert.equal(await page.evaluate(() => window.jobs.at(-1).req.mode), 'terrain');
  await legend.getByRole('button', { name: 'Gradient', exact: true }).click();
  await legend.locator('.signal-scale').waitFor();
  base.map.propagationModel = 'free-space';
  await upload(base); await waitField();
  await legend.getByRole('button', { name: 'Range', exact: true }).click();
  await legend.getByText('Show all bands').waitFor();
  await page.locator('.range-ring-label').first().waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: interference fields, red/amber/clear bands, reference settings, source exclusion, modes, gradient, rings and persistence. No page errors.');
} finally { await browser.close(); }
