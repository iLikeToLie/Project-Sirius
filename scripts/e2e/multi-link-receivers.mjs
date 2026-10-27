// Run against the production preview on port 5199. Uses the same browser overrides as link-budget-drawer.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const legacy = JSON.parse(readFileSync(new URL('./fixtures/v4-single-link.json', import.meta.url)));
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const tile = new PNG({ width: 256, height: 256 });
for (let k = 0; k < tile.data.length; k += 4) tile.data.set([128, 0, 0, 255], k); // Terrarium zero metres.
const tileBody = PNG.sync.write(tile);
const errors = [];
let context;
async function open(state, missingX = null) {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body: tileBody, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('**/dem/**/*.png', r => {
    const x = Number(new URL(r.request().url()).pathname.split('/').at(-2));
    return x === missingX ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ contentType: 'image/png', body: tileBody });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
  await page.locator('input[type=file]').setInputFiles({ name: 'scenario.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  const card = page.locator('.selected-sensor-card');
  await card.getByRole('tab', { name: 'Link', exact: true }).click();
  const drawer = page.locator('.link-budget-drawer');
  await drawer.getByRole('button', { name: /^Link budget/ }).click();
  return { page, card, drawer };
}
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('friis-rf-planner-v3-state')));
const waitRows = (page, count) => page.waitForFunction(n => document.querySelectorAll('.link-budget-drawer .power-meter').length === n, count);
try {
  // This schema 4 fixture comes from a04bc24 defaults; its old RF engine gives -51.18795995798126 dBm.
  let { page, card, drawer } = await open(legacy);
  await waitRows(page, 1);
  assert.match(await drawer.locator('.metric').first().innerText(), /-51\.19/);
  assert.deepEqual((await saved(page)).map.sensors[1].desiredTxIds, ['sensor-1']);
  console.log('PASS schema 4 import retains the original single-link result');

  const missing = structuredClone(legacy);
  missing.map.sensors[1].intendedTxId = 'deleted-transmitter';
  ({ page, card, drawer } = await open(missing));
  await waitRows(page, 1);
  assert.equal((await saved(page)).map.sensors[1].desiredTxIds, 'auto');
  assert.equal(await card.getByRole('checkbox', { name: /^Auto/ }).isChecked(), true);
  console.log('PASS missing legacy transmitter falls back to auto');

  const multi = structuredClone(legacy);
  multi.schemaVersion = 5;
  const [tx, rx] = multi.map.sensors;
  for (const s of [tx, rx]) { delete s.intendedTxId; s.desiredTxIds = 'auto'; }
  tx.name = 'Zulu';
  const alpha = { ...tx, id: 'alpha-tx', name: 'Alpha' };
  const weak = { ...tx, id: 'weak-tx', name: 'Weak', powerDbm: -10 };
  rx.desiredTxIds = [tx.id, alpha.id, weak.id];
  multi.map.sensors = [tx, alpha, weak, rx];
  ({ page, card, drawer } = await open(multi));
  await waitRows(page, 3);
  assert.deepEqual(await drawer.locator('.meter-title span').allTextContents(), ['Alpha', 'Zulu', 'Weak']);
  assert.match(await drawer.locator('.drawer-summary').innerText(), /^Alpha →/);
  const scales = await drawer.locator('.meter-scale').allTextContents();
  assert.equal(new Set(scales).size, 1, 'all rows share a scale');
  const positions = await drawer.locator('.meter-fill').evaluateAll(nodes => nodes.map(n => parseFloat(n.style.width)));
  assert.equal(positions[0], positions[1]);
  assert.ok(positions[1] > positions[2], 'weaker power has a shorter bar');
  assert.equal(await drawer.locator('.sensitivity-marker').count(), 3);
  assert.equal(await drawer.locator('.required-marker').count(), 3);
  console.log('PASS equal-power name order, strongest summary, shared scale and row markers');

  await card.getByLabel(/^Objective/).selectOption('avoidance');
  await waitRows(page, 0);
  assert.match(await drawer.innerText(), /Avoidance: no desired link/);
  assert.deepEqual((await saved(page)).map.sensors.find(s => s.role === 'rx').desiredTxIds, rx.desiredTxIds);
  await card.getByLabel(/^Objective/).selectOption('desired');
  await waitRows(page, 3);
  console.log('PASS avoidance hides rows and preserves the list on return');

  for (const name of ['Alpha', 'Zulu', 'Weak']) await card.getByRole('checkbox', { name, exact: true }).uncheck();
  await waitRows(page, 1);
  assert.equal(await card.getByRole('checkbox', { name: /^Auto/ }).isChecked(), true);
  assert.equal((await saved(page)).map.sensors.find(s => s.role === 'rx').desiredTxIds, 'auto');
  console.log('PASS unticking the final transmitter returns to auto and one meter');

  await card.getByRole('checkbox', { name: 'Alpha', exact: true }).check();
  await card.getByRole('checkbox', { name: 'Zulu', exact: true }).check();
  await waitRows(page, 2);
  await page.locator('.sensor-list-card .sensor-row').filter({ hasText: 'Alpha' }).click();
  await card.getByRole('button', { name: 'Receiver', exact: true }).click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('friis-rf-planner-v3-state')).map.sensors.some(s => Array.isArray(s.desiredTxIds) && s.desiredTxIds.includes('alpha-tx')));
  await page.locator('.sensor-list-card .sensor-row').filter({ hasText: rx.name }).click();
  await waitRows(page, 1);
  await page.locator('.sensor-list-card .sensor-row').filter({ hasText: 'Zulu' }).click();
  await card.getByRole('button', { name: 'Receiver', exact: true }).click();
  await page.locator('.sensor-list-card .sensor-row').filter({ hasText: rx.name }).click();
  await waitRows(page, 1);
  assert.equal((await saved(page)).map.sensors.find(s => s.id === rx.id).desiredTxIds, 'auto');
  console.log('PASS role changes remove desired ids and emptied lists return to auto');

  const terrain = structuredClone(multi);
  terrain.map.propagationModel = 'terrain';
  terrain.map.useTerrainElevation = true;
  terrain.map.sensors.find(s => s.id === 'weak-tx').lon = 103.86;
  const missingX = Math.floor((103.86 + 180) / 360 * 2 ** 14);
  ({ page, card, drawer } = await open(terrain, missingX));
  await waitRows(page, 3);
  await page.waitForFunction(() => [...document.querySelectorAll('.power-meter')].some(n => n.getAttribute('aria-label') === 'Rx power from Alpha' && !n.textContent.includes('Unknown')));
  const unknown = drawer.getByLabel('Rx power from Weak', { exact: true });
  assert.match(await unknown.innerText(), /Unknown/);
  assert.match(await unknown.innerText(), /terrain prediction is unknown/);
  assert.equal(await unknown.locator('.meter-fill, .meter-needle').count(), 0);
  assert.equal(await drawer.getByLabel('Rx power from Alpha', { exact: true }).locator('.meter-fill').count(), 1);
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });
  console.log('PASS missing elevation is unknown only on the affected row, without a confident bar');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('Multi-link receiver browser checks PASS');
} finally { await browser.close(); }
