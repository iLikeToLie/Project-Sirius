// Production preview check; accepts PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE and E2E_URL.
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
            if (e.data.jobId === req.jobId) {
              // Inject one missing ray to verify conservative hatching alongside real computed powers.
              if (e.data.powers.length) e.data.powers[0][0] = NaN;
              record.done = true; record.powers = e.data.powers.map(p => [...p]);
            }
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
  const tx = base.map.sensors.find(s => s.role === 'tx'), served = base.map.sensors.find(s => s.role === 'rx');
  tx.name = 'T1'; tx.aglM = 13;
  served.name = 'R1'; served.objective = 'desired'; served.desiredTxIds = [tx.id]; served.aglM = 7;
  served.lon = tx.lon + 0.001;
  const victim = { ...served, id: 'victim', name: 'R2', objective: 'avoidance', aglM: 11, lon: tx.lon - 0.001, interferenceThresholdDbm: -65, protectionMarginDb: 3 };
  base.map.sensors = [tx, served, victim]; base.map.selectedId = tx.id;
  const upload = async state => {
    const count = await page.evaluate(() => window.jobs.length);
    await page.locator('input[type=file]').setInputFiles({ name: 'placement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
    if (count && state.map.selectedId === tx.id) await page.waitForFunction(n => window.jobs.length > n, count);
  };
  const waitField = async () => {
    await page.waitForFunction(() => window.jobs.length && window.jobs.at(-1).done);
    await page.getByText('Refining coverage…', { exact: true }).waitFor({ state: 'hidden' });
  };
  await upload(base);
  const legend = page.getByRole('complementary', { name: 'Coverage legend' });
  await legend.getByRole('button', { name: 'Placement', exact: true }).click();
  await waitField();
  assert.match(await legend.innerText(), /Placement for T1/);
  assert.match(await legend.innerText(), /Victims: R2/);
  assert.match(await legend.innerText(), /Served: R1/);
  assert.match(await legend.innerText(), /reciprocal.*approximation/s);
  assert.equal(await legend.getByRole('group', { name: 'Coverage style' }).count(), 0);
  assert.equal(await page.locator('.range-ring-label').count(), 0);
  let job = await page.evaluate(() => window.jobs.at(-1));
  assert.equal(job.req.sources.length, 2);
  assert.equal(job.req.rxAglM, tx.aglM);
  assert.equal(job.req.sources[0].lat, victim.lat); assert.equal(job.req.sources[0].lon, victim.lon);
  assert.equal(job.req.sources[0].elevationM, victim.aglM);
  assert.equal(job.req.sources[1].elevationM, served.aglM);
  assert.equal(job.req.sources[0].inputs.transmitPowerDbm, tx.powerDbm);
  assert.equal(job.req.sources[0].inputs.txId, 'T1'); assert.equal(job.req.sources[0].inputs.rxId, 'R2');
  const sorted = job.powers[0].filter(Number.isFinite).sort((a, b) => a - b);
  victim.interferenceThresholdDbm = sorted[Math.floor(sorted.length * 0.65)];
  const safeServed = job.powers[1].filter((p, i) => Number.isFinite(p) && job.powers[0][i] <= victim.interferenceThresholdDbm - 3).sort((a, b) => a - b);
  served.fadeMarginTargetDb = 10;
  served.sensitivityDbm = safeServed[Math.floor(safeServed.length / 2)] - 10;
  await upload(base); await waitField();
  const counts = await page.evaluate(({ threshold, required }) => {
    const job = window.jobs.at(-1), pixels = window.zonePixels, { cols, rows } = job.req.raster;
    const counts = { unsafe: 0, marginal: 0, safe: 0, recommended: 0, unknown: 0 };
    const token = name => {
      const n = parseInt(getComputedStyle(document.documentElement).getPropertyValue(name).trim().slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    for (let k = 0; k < job.req.raster.values.length; k++) {
      const v = job.powers[0][k], s = job.powers[1][k];
      const kind = !Number.isFinite(v) || !Number.isFinite(s) ? 'unknown' : v > threshold ? 'unsafe' : v > threshold - 3 ? 'marginal' : s >= required ? 'recommended' : 'safe';
      counts[kind]++;
      const row = Math.floor(k / (cols + 1)), col = k % (cols + 1);
      const expected = kind === 'unknown' ? [...token('--mute'), (col + row) % 6 < 2 ? 130 : 35]
        : kind === 'unsafe' ? [...token('--red'), 54] : kind === 'marginal' ? [...token('--yellow'), 46]
        : kind === 'safe' ? [163, 217, 165, 95] : [...token('--green'), 95];
      const at = ((rows - row) * (cols + 1) + col) * 4;
      if (expected.some((value, i) => pixels[at + i] !== value)) throw new Error(`Pixel ${k}: expected ${kind}`);
    }
    return counts;
  }, { threshold: victim.interferenceThresholdDbm, required: served.sensitivityDbm + served.fadeMarginTargetDb });
  for (const [kind, count] of Object.entries(counts)) assert.ok(count > 0, `${kind} absent: ${JSON.stringify(counts)}`);
  await open(); await waitField();
  assert.equal(await legend.getByRole('button', { name: 'Placement', exact: true }).getAttribute('aria-pressed'), 'true');
  base.map.selectedId = served.id;
  await upload(base);
  await legend.getByText('Select a transmitter to show safe placement', { exact: true }).waitFor();
  assert.equal(await legend.getByRole('button', { name: 'Placement', exact: true }).isDisabled(), true);
  base.map.selectedId = tx.id; base.map.propagationModel = 'terrain'; base.map.useTerrainElevation = true;
  await upload(base); await waitField();
  await page.waitForFunction(() => window.jobs.at(-1)?.done && window.jobs.at(-1).req.sources.every(s => Number.isFinite(s.elevationM)));
  await waitField();
  job = await page.evaluate(() => window.jobs.at(-1));
  assert.equal(job.req.mode, 'terrain'); assert.equal(job.req.rxAglM, 13);
  assert.equal(job.req.sources[0].elevationM, 11); // Terrarium fixture is zero ground.
  base.map.propagationModel = 'free-space'; base.map.useTerrainElevation = false;
  victim.polarization = 'H'; tx.frequencyGhz = 2.4; victim.frequencyGhz = 5.8; victim.acrDb = 25;
  await upload(base); await waitField();
  job = await page.evaluate(() => window.jobs.at(-1));
  assert.equal(job.req.sources[0].inputs.frequencyGhz, 2.4);
  assert.equal(job.req.sources[0].inputs.otherLossDb, base.inputs.otherLossDb + base.map.crossPolarDiscriminationDb + 25);
  await legend.getByRole('button', { name: 'Range', exact: true }).click();
  await legend.getByText('Show all bands').waitFor();
  await page.locator('.range-ring-label').first().waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: placement worker geometry/budgets, all five classes and every RGBA pixel, selection gating, terrain/free-space, isolation, rings and persistence. Counts: ${JSON.stringify(counts)}. No page errors.`);
} finally { await browser.close(); }
