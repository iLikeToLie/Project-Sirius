// Whole-branch review against production preview. Standard PLAYWRIGHT_MODULE,
// CHROMIUM_EXECUTABLE and E2E_URL overrides; artifacts default to ignored .superpowers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer, transformWithEsbuild } from 'vite';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = resolve(root, process.env.E2E_ARTIFACT_DIR ?? '.superpowers/review-task16');
mkdirSync(artifacts, { recursive: true });
const results = [];
const pass = (focus, detail) => { results.push({ focus, detail }); console.log(`PASS ${focus}: ${detail}`); };
const fixture = JSON.parse(readFileSync(new URL('./fixtures/v4-single-link.json', import.meta.url)));
// Execute the real main-branch pair evaluator without checking out or editing main.
// Its runtime dependencies are unchanged; assert that before sharing them.
assert.equal(execFileSync('git', ['diff', 'main', '--', 'src/lib/rf.ts', 'src/lib/geo.ts', 'src/lib/propagation.ts'], { cwd: root, encoding: 'utf8' }), '');
const baselineSource = execFileSync('git', ['show', 'main:src/lib/sensors.ts'], { cwd: root, encoding: 'utf8' });
const virtual = 'virtual:review-main-sensors.ts';
const server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null }, plugins: [{
    name: 'review-main-sensors',
    resolveId(id) { if (id === virtual) return '\0' + virtual; },
    async load(id) {
      if (id === '\0' + virtual) return transformWithEsbuild(baselineSource.replace(/from '\.\//g, "from '/src/lib/"), 'review-main-sensors.ts', { loader: 'ts' });
    },
  }] });
let modules;
try {
  const baseline = await server.ssrLoadModule(virtual);
  const sensors = await server.ssrLoadModule('/src/lib/sensors.ts');
  const interference = await server.ssrLoadModule('/src/lib/interference.ts');
  const state = await server.ssrLoadModule('/src/lib/state.ts');
  const defaults = await server.ssrLoadModule('/src/data/defaults.ts');
  const field = await server.ssrLoadModule('/src/lib/interferenceLayer.ts');
  const multi = await server.ssrLoadModule('/src/lib/multiField.ts');
  const contours = await server.ssrLoadModule('/src/lib/contours.ts');
  const geo = await server.ssrLoadModule('/src/lib/geo.ts');
  modules = { sensors, interference, state, defaults, field, multi, contours, geo };
  const s = defaults.freshDefaultState();
  const before = baseline.evaluatePairs(s.map, s.inputs, () => 0);
  const after = sensors.evaluatePairs(s.map, s.inputs, () => 0);
  assert.deepEqual(after.map(p => p.result), before.map(p => p.result));
  assert.equal(interference.assessReceiver(s.map, s.map.sensors[1], after).links[0].status, before[0].result.status);
  pass(1, 'default powers, margins and statuses equal actual main evaluator');
  const legacy = structuredClone(fixture);
  legacy.schemaVersion = 5;
  legacy.map.sensors.forEach(sensor => { sensor.desiredTxIds = sensor.intendedTxId === 'auto' ? 'auto' : [sensor.intendedTxId]; delete sensor.intendedTxId; });
  const migrated = state.validateImport(legacy);
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.map.protectionMarginDb, 3);
  assert.equal(migrated.map.aggregateInterference, 'objective');
  const oldPairs = baseline.evaluatePairs(migrated.map, migrated.inputs, () => 0);
  const newPairs = sensors.evaluatePairs(migrated.map, migrated.inputs, () => 0);
  assert.deepEqual(newPairs.map(p => p.result), oldPairs.map(p => p.result));
  for (const sensor of migrated.map.sensors) {
    assert.equal(sensor.frequencyGhz, 'default'); assert.equal(sensor.polarization, 'V'); assert.equal(sensor.requiredCiDb, 10);
  }
  // Isolate the margin change from the separately accepted aggregate/C/I changes.
  const rx = { ...migrated.map.sensors[1], objective: 'avoidance' };
  for (const power of [-70, -68, -67, -65, -60]) {
    const p = { ...newPairs[0], intended: false, result: { ...newPairs[0].result, receivedPowerDbm: power } };
    const verdict = interference.pairVerdict(p, rx, 3);
    assert.equal(verdict, power >= -65 ? 'Possible interference' : power > -68 ? 'Marginal interference' : 'Below interference threshold');
  }
  pass(5, 'schema 5 imports with schema 6 defaults; isolated margin boundaries verified');
  const many = structuredClone(s.map);
  many.sensors.push({ ...many.sensors[0], id: 'other', lon: many.sensors[0].lon + .002 });
  assert.deepEqual(sensors.evaluatePairs(many, s.inputs, () => 0).map(p => p.result), baseline.evaluatePairs(many, s.inputs, () => 0).map(p => p.result));
  pass(6, 'all-default frequencies and V polarization preserve main pair results exactly');
  migrated.map.sensors[1].objective = 'avoidance';
  const pairs = sensors.evaluatePairs(migrated.map, migrated.inputs, () => 0);
  const tx = migrated.map.sensors[0], victim = migrated.map.sensors[1];
  const bounds = interference.transmitterPowerRange(migrated.map, tx.id, pairs);
  tx.powerDbm = bounds.maxDbm;
  const atMax = sensors.evaluatePairs(migrated.map, migrated.inputs, () => 0);
  assert.ok(Math.abs(atMax[0].result.receivedPowerDbm - (victim.interferenceThresholdDbm - 3)) < 1e-10);
  assert.equal(interference.assessReceiver(migrated.map, victim, atMax).status, 'Below interference threshold');
  pass(7, 'unrounded maximum meets binding protected limit within 1e-10 dB; UI rounding checked below');
  const partial = [
    { ...atMax[0], txId: 'known', result: { ...atMax[0].result, receivedPowerDbm: -80 } },
    { ...atMax[0], txId: 'unknown', elevationKnown: false, result: { ...atMax[0].result, receivedPowerDbm: -30 } },
  ];
  const assessed = interference.assessReceiver(migrated.map, victim, partial);
  assert.equal(assessed.interferenceDbm, -80); assert.equal(assessed.unknownPaths, 1);
  assert.deepEqual(assessed.contributors.map(c => c.txId), ['known']);
  pass(8, 'unknown high-power path excluded from a partial sum and counted');
} finally { await server.close(); }

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tile = new PNG({ width: 256, height: 256 });
for (let i = 0; i < tile.data.length; i += 4) tile.data.set([128, 0, 0, 255], i);
const body = PNG.sync.write(tile), errors = [];
const key = 'friis-rf-planner-v3-state';
let context;
const normalize = raw => modules.state.validateImport(raw);
const base = normalize(fixture);
base.map.sensors[0].name = 'T1'; base.map.sensors[1].name = 'R1';
const basePower = modules.sensors.evaluatePairs(base.map, base.inputs, () => 0)[0].result.receivedPowerDbm;
function scenario(desired = false) {
  const s = structuredClone(base), [tx, rx] = s.map.sensors;
  const transmitters = [0, 1, 2].map(i => ({ ...tx, id: `tx-${i}`, name: `T${i + 1}`,
    powerDbm: tx.powerDbm + ((desired ? i === 0 ? -60 : -67 : -67) - basePower) }));
  Object.assign(rx, { objective: desired ? 'desired' : 'avoidance', desiredTxIds: desired ? ['tx-0'] : 'auto' });
  Object.assign(s.map, { sensors: [...transmitters, rx], selectedId: rx.id });
  return s;
}
async function open(s, unknown = false) {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('**/dem/**/*.png', r => unknown ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ contentType: 'image/png', body }));
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.reviewJobs = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(req, ...args) {
      if (req.kind === 'multi') {
        const job = { req, start: performance.now(), done: false };
        window.reviewJobs.push(job);
        const listener = event => {
          if (event.data.jobId !== req.jobId) return;
          job.done = true; job.ms = performance.now() - job.start; job.powers = event.data.powers;
          this.removeEventListener('message', listener);
        };
        this.addEventListener('message', listener);
      }
      return post.call(this, req, ...args);
    };
  });
  await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
  await page.locator('input[type=file]').setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(s)) });
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  const card = page.locator('.selected-sensor-card'), drawer = page.locator('.link-budget-drawer');
  await card.getByRole('tab', { name: 'Link', exact: true }).click();
  const toggle = drawer.getByRole('button', { name: /^Link budget/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return { page, card, drawer };
}
const saved = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const shot = (page, name) => page.screenshot({ path: resolve(artifacts, name), fullPage: true });
try {
  const legacy = structuredClone(fixture); legacy.schemaVersion = 5;
  legacy.map.sensors.forEach(s => { s.desiredTxIds = s.intendedTxId === 'auto' ? 'auto' : [s.intendedTxId]; delete s.intendedTxId; });
  let { page, card, drawer } = await open(legacy);
  const restored = await saved(page);
  assert.equal(restored.schemaVersion, 7);
  assert.equal(restored.map.protectionMarginDb, 3);
  assert.equal(restored.map.aggregateInterference, 'objective');
  assert.ok(restored.map.sensors.every(s => s.polarization === 'V' && s.frequencyGhz === 'default'));
  await card.locator('.status-acceptable-link').waitFor();
  await shot(page, '05-schema5-import.png');
  pass('5 UI', 'real schema 5 file imported with new defaults and original desired-link status');
  ({ page, card, drawer } = await open(scenario()));
  await card.getByText('aggregate of 3', { exact: false }).waitFor();
  assert.match(await card.locator('.readouts').last().innerText(), /-62\.23/);
  await card.locator('.status-possible-interference').waitFor();
  await shot(page, '02-aggregate.png');
  await page.getByRole('button', { name: 'Link settings', exact: true }).click();
  await page.locator('.link-settings-card').getByLabel(/^Aggregate interference/).selectOption('never');
  await card.locator('.status-marginal-interference').waitFor();
  pass(2, 'three -67 dBm contributors give -62.23 dBm/Possible; Off gives Marginal');

  ({ page, card, drawer } = await open(scenario(true)));
  await card.getByText('worst single', { exact: false }).waitFor();
  assert.match(await card.locator('.readouts').last().innerText(), /-67\.00/);
  pass(3, 'desired receiver defaults to worst single, not the linear sum');
  await card.locator('.status-interfered-link').waitFor();
  assert.match(await page.locator('.sensor-list-card').innerText(), /Interfered/);
  await page.locator('.sensor-marker.role-rx.tone-danger').waitFor();
  await drawer.getByRole('tab', { name: 'Matrix', exact: true }).click();
  const cell = drawer.getByRole('button', { name: /T1 to R1:.*Interfered link/ });
  assert.match(await cell.getAttribute('class'), /tone-danger/);
  await shot(page, '04-ci-matrix.png');
  pass(4, 'Interfered link in card/list/matrix and danger map tone');

  const single = structuredClone(base);
  single.map.sensors[1].objective = 'avoidance'; single.map.selectedId = single.map.sensors[0].id;
  ({ page, card } = await open(single));
  const range = modules.interference.transmitterPowerRange(single.map, single.map.selectedId, modules.sensors.evaluatePairs(single.map, single.inputs, () => 0));
  await card.getByRole('button', { name: 'Set to max', exact: true }).click();
  const expected = Math.floor(range.maxDbm * 10) / 10;
  await page.waitForFunction(({ k, expected }) => JSON.parse(localStorage.getItem(k)).map.sensors[0].powerDbm === expected, { k: key, expected });
  await page.locator('.sensor-row').filter({ hasText: 'R1' }).click();
  await card.locator('.status-below-interference-threshold').waitFor();
  pass('7 UI', 'Set to max rounds toward safety and receiver clears');

  const fixed = scenario(); fixed.map.aggregateInterference = 'never'; fixed.map.selectedId = 'tx-0';
  ({ page, card } = await open(fixed));
  assert.equal(await card.getByRole('button', { name: 'Set to max', exact: true }).isDisabled(), true);
  assert.match(await card.getByLabel('Transmitter power range').innerText(), /other transmitters already reach/);
  const zero = structuredClone(single); zero.map.sensors[1].protectionMarginDb = 0;
  ({ page, card } = await open(zero));
  await card.getByRole('button', { name: 'Set to max', exact: true }).click();
  await page.locator('.sensor-row').filter({ hasText: 'R1' }).click();
  await card.locator('.status-below-interference-threshold').waitFor();
  pass('review fixes UI', 'fixed worst-single violation disables Set to max; zero-margin maximum clears threshold');

  const unknown = scenario(); unknown.map.propagationModel = 'terrain'; unknown.map.useTerrainElevation = true;
  ({ page, card, drawer } = await open(unknown, true));
  await card.getByText('3 paths unknown; excluded from interference assessment.').waitFor();
  await drawer.getByRole('tab', { name: 'Matrix', exact: true }).click();
  assert.equal(await drawer.getByRole('button', { name: /Elevation unavailable/ }).count(), 3);
  await shot(page, '08-unknown.png');
  pass('8 UI', 'unknown paths visible in card and matrix, not confident values');

  const channels = scenario();
  channels.map.sensors.push({ ...channels.map.sensors.at(-1), id: 'rx-2', name: 'R2', acrDb: 24, rejectionMask: [{ offsetMhz: 25, rejectionDb: 21 }, { offsetMhz: 50, rejectionDb: 47 }] });
  ({ page } = await open(channels));
  await page.getByRole('button', { name: 'Link settings', exact: true }).click();
  const settings = page.locator('.link-settings-card');
  const model = settings.getByLabel(/^Rejection model/);
  const original = (await saved(page)).map.sensors.filter(s => s.role === 'rx').map(s => [s.acrDb, s.rejectionMask]);
  await model.selectOption('mask'); await model.selectOption('simple');
  await page.reload(); await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  assert.deepEqual((await saved(page)).map.sensors.filter(s => s.role === 'rx').map(s => [s.acrDb, s.rejectionMask]), original);
  pass(9, 'ACR and mask retained for every receiver across toggles and reload');

  // A real worker raster near the transmitter must agree with its forward path.
  ({ page, card } = await open(single));
  const legend = page.getByRole('complementary', { name: 'Coverage legend' });
  await legend.getByRole('button', { name: 'Placement', exact: true }).click();
  await page.waitForFunction(() => window.reviewJobs.at(-1)?.done);
  await page.getByText('Refining coverage…', { exact: true }).waitFor({ state: 'hidden' });
  const local = modules.geo.toLocalM(single.map.sensors[0]);
  const current = await page.evaluate(local => {
    const job = window.reviewJobs.at(-1), g = job.req.raster;
    const col = Math.round((local.xM - g.x0) / g.dx), row = Math.round((local.yM - g.y0) / g.dy);
    if (col < 0 || row < 0 || col > g.cols || row > g.rows) throw new Error('Transmitter outside raster');
    return { power: job.powers[0][row * (g.cols + 1) + col], ms: job.ms };
  }, local);
  const victim = single.map.sensors[1];
  assert.ok(current.power > victim.interferenceThresholdDbm, 'current cell must be unsafe');
  assert.match(await card.innerText(), /interfer/i);
  await shot(page, '11-placement.png');
  // Exact zero-margin boundary, with a grid node exactly at the current Tx.
  single.map.sensors[1].protectionMarginDb = 0;
  const forward = modules.sensors.evaluatePairs(single.map, single.inputs, () => 0);
  single.map.sensors[1].interferenceThresholdDbm = forward[0].result.receivedPowerDbm;
  const plan = modules.field.placementPlan(single.map, single.inputs, single.map.sensors[0], () => 0, forward);
  const raster = modules.contours.sampleGrid({ minX: local.xM, maxX: local.xM + 1, minY: local.yM, maxY: local.yM + 1 }, 1, 1, () => 0);
  // Use exact pair power here to test equality independently of Float32 rounding.
  const exact = modules.field.placementZones(plan, raster, { jobId: 1, powers: [Array(4).fill(forward[0].result.receivedPowerDbm)] });
  assert.equal(exact.classes[0], modules.interference.PLACEMENT.marginal);
  pass(11, 'real placement worker marks current interfering position unsafe; exact zero-margin equality is Marginal');

  const twelve = structuredClone(base), [tx, rx] = twelve.map.sensors;
  twelve.map.sensors = Array.from({ length: 12 }, (_, i) => ({ ...(i < 6 ? tx : rx), id: `s-${i}`, name: `${i < 6 ? 'T' : 'R'}${i % 6 + 1}`,
    lat: 1.3 + (i % 6) * .002, lon: i < 6 ? 103.8 : 103.81, desiredTxIds: 'auto' }));
  Object.assign(twelve.map, { selectedId: 's-2', propagationModel: 'terrain', useTerrainElevation: true });
  ({ page } = await open(twelve));
  await page.getByRole('button', { name: 'Fit all sensors', exact: true }).click();
  await page.getByRole('complementary', { name: 'Coverage legend' }).getByRole('button', { name: 'Placement', exact: true }).click();
  await page.waitForFunction(() => window.reviewJobs.at(-1)?.done && window.reviewJobs.at(-1).req.sources.every(s => Number.isFinite(s.elevationM)));
  await page.getByText('Refining coverage…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Hide panels', exact: true }).click();
  const marker = page.getByRole('button', { name: /^Transmitter T3\. Arrow/ });
  await marker.waitFor();
  const box = await marker.boundingBox(); assert.ok(box);
  await page.evaluate(() => {
    window.dragReview = { active: true, frames: [], last: performance.now(), eventToFrame: [], moves: 0 };
    const sample = time => { const d = window.dragReview; if (!d.active) return; d.frames.push(time - d.last); d.last = time; requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
    document.addEventListener('mousemove', () => {
      const d = window.dragReview; if (!d.active) return; const start = performance.now(); d.moves++;
      requestAnimationFrame(() => d.eventToFrame.push(performance.now() - start));
    }, { capture: true });
  });
  const start = performance.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 35, { steps: 40 });
  await page.mouse.up();
  await page.waitForFunction(k => {
    const tx = JSON.parse(localStorage.getItem(k)).map.sensors.find(s => s.id === 's-2');
    return Math.abs(tx.lon - 103.8) > .00001;
  }, key);
  const endToEndMs = performance.now() - start;
  const timing = await page.evaluate(() => {
    window.dragReview.active = false;
    const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { n: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) }; };
    return { frames: stats(window.dragReview.frames.slice(1)), eventToFrame: stats(window.dragReview.eventToFrame), moves: window.dragReview.moves };
  });
  await page.waitForFunction(() => window.reviewJobs.at(-1)?.done);
  await page.getByText('Refining coverage…', { exact: true }).waitFor({ state: 'hidden' });
  const worker = await page.evaluate(() => window.reviewJobs.filter(j => j.done).map(j => ({ ms: j.ms, radials: j.req.radials, sources: j.req.sources.length })));
  assert.ok(timing.moves >= 20, 'real drag input observed');
  assert.ok(timing.frames.n >= 10, 'animation frames continued during drag');
  assert.ok(timing.eventToFrame.p95Ms < 250, 'p95 input-to-frame delay stays below 250 ms on this fixture');
  await page.getByRole('button', { name: 'Show panels', exact: true }).click();
  await page.waitForFunction(() => window.reviewJobs.at(-1)?.done);
  await page.getByText('Refining coverage…', { exact: true }).waitFor({ state: 'hidden' });
  await shot(page, '10-twelve-terrain-drag.png');
  const performanceResult = { endToEndMs, ...timing, worker };
  writeFileSync(resolve(artifacts, 'timing.json'), JSON.stringify(performanceResult, null, 2) + '\n');
  pass(10, JSON.stringify({ endToEndMs, frames: timing.frames, eventToFrame: timing.eventToFrame, moves: timing.moves,
    workerRequests: worker.length, workerMaxMs: Math.max(...worker.map(j => j.ms)) }));
  assert.deepEqual(errors, []);
  writeFileSync(resolve(artifacts, 'results.json'), JSON.stringify({ browser: browser.version(), results, errors }, null, 2) + '\n');
  console.log(`PASS whole-branch browser review; artifacts ${artifacts}`);
} finally { await context?.close(); await browser.close(); }
