// Run against the production preview; accepts the standard PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE overrides.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/v4-single-link.json', import.meta.url)));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tile = new PNG({ width: 256, height: 256 });
for (let i = 0; i < tile.data.length; i += 4) tile.data.set([128, 0, 0, 255], i);
const body = PNG.sync.write(tile);
const errors = [];
let context;
const basePower = -51.18795995798126;
function scenario(desired = false, unknown = false) {
  const s = structuredClone(fixture);
  s.schemaVersion = 6;
  const [tx, rx] = s.map.sensors;
  const transmitters = [0, 1, 2].map(i => ({ ...tx, id: `tx-${i}`, name: `T${i + 1}`, powerDbm: tx.powerDbm + ((desired ? i === 0 ? -60 : -71 : -67) - basePower), desiredTxIds: 'auto' }));
  Object.assign(rx, { objective: desired ? 'desired' : 'avoidance', desiredTxIds: desired ? ['tx-0'] : 'auto', requiredCiDb: 10 });
  Object.assign(s.map, { sensors: [...transmitters, rx], selectedId: rx.id, defaultObjective: 'desired', propagationModel: unknown ? 'terrain' : 'free-space', useTerrainElevation: unknown, protectionMarginDb: 3, aggregateInterference: 'objective' });
  return s;
}
async function open(s, unknown = false) {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('**/dem/**/*.png', r => unknown ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ contentType: 'image/png', body }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
  await page.locator('input[type=file]').setInputFiles({ name: 'scenario.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(s)) });
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  const card = page.locator('.selected-sensor-card');
  await card.getByRole('tab', { name: 'Link', exact: true }).click();
  const drawer = page.locator('.link-budget-drawer');
  const drawerToggle = drawer.getByRole('button', { name: /^Link budget/ });
  if (await drawerToggle.count() && await drawerToggle.getAttribute('aria-expanded') !== 'true') await drawerToggle.click();
  await page.getByRole('button', { name: 'Link settings', exact: true }).click();
  return { page, card, drawer, settings: page.locator('.link-settings-card') };
}
async function commit(field, value) { await field.fill(value); await field.press('Enter'); }
try {
  let { page, card, drawer, settings } = await open(scenario());
  await card.getByText('aggregate of 3', { exact: false }).waitFor();
  assert.match(await card.locator('.readouts').last().innerText(), /-62\.23/);
  assert.match(await page.locator('.sensor-list-card').innerText(), /3 interferers \(aggregate\)/);
  assert.equal(await drawer.locator('.power-meter').count(), 2);
  assert.match(await drawer.getByLabel('Rx power from Total interference', { exact: true }).innerText(), /-62\.23/);
  assert.match(await drawer.locator('.status').innerText(), /Marginal interference/i);
  assert.match(await drawer.locator('.metric').filter({ hasText: 'Protected margin' }).innerText(), /-1\.00/);
  assert.equal(await drawer.locator('.protected-marker').count(), 2);
  const colors = await drawer.locator('.power-meter').first().evaluate(el => ['.protected-marker', '.threshold-marker'].map(s => getComputedStyle(el.querySelector(s)).backgroundColor));
  assert.notEqual(colors[0], colors[1], 'protected limit must differ visually from the threshold');
  console.log('PASS aggregate total, contributors, pair badge and protected meter');

  await settings.getByLabel(/^Aggregate interference/).selectOption('never');
  await card.getByText('worst single', { exact: false }).waitFor();
  assert.match(await card.locator('.status').first().innerText(), /Marginal interference/i);
  assert.equal(await drawer.locator('.power-meter').count(), 1);
  await page.locator('.sensor-marker.role-rx.tone-warning').waitFor();
  await card.getByRole('checkbox', { name: 'Use scenario (3 dB)' }).uncheck();
  await commit(card.getByLabel(/^Protection margin/), '0');
  await card.locator('.status-below-interference-threshold').waitFor();
  await commit(settings.getByLabel(/^Protection margin/), '5');
  assert.equal(await card.getByLabel(/^Protection margin/).inputValue(), '0');
  await card.getByRole('checkbox', { name: 'Use scenario (5 dB)' }).check();
  await card.locator('.status-marginal-interference').waitFor();
  await commit(settings.getByLabel(/^Protection margin/), '-1');
  assert.match(await settings.getByRole('alert').innerText(), /cannot be negative/);
  console.log('PASS aggregate toggle, override, scenario reset and negative validation');

  ({ page, card, drawer, settings } = await open(scenario(true)));
  await card.locator('.status-acceptable-link').waitFor();
  await settings.getByLabel(/^Aggregate interference/).selectOption('always');
  await card.locator('.status-interfered-link').waitFor();
  assert.match(await drawer.locator('.drawer-bar .status').innerText(), /Interfered link/i);
  assert.match(await page.locator('.sensor-list-card').innerText(), /Interfered/);
  await commit(card.getByLabel(/^Required C\/I/), '7');
  await card.locator('.status-acceptable-link').waitFor();
  console.log('PASS C/I status updates in card, list and drawer');

  const single = scenario();
  single.map.sensors = single.map.sensors.filter(s => s.role === 'rx' || s.id === 'tx-0');
  single.map.selectedId = 'tx-0';
  ({ page, card } = await open(single));
  const powerCard = card.getByLabel('Transmitter power range');
  assert.match(await powerCard.innerText(), /Limited by .*protected limit/);
  const expectedMax = Math.floor((single.map.sensors[0].powerDbm - 1) * 10) / 10;
  await powerCard.getByRole('button', { name: 'Set to max' }).click();
  await page.waitForFunction(expected => JSON.parse(localStorage.getItem('friis-rf-planner-v3-state')).map.sensors.find(s => s.id === 'tx-0').powerDbm === expected, expectedMax);
  await page.locator('.sensor-list-card .sensor-row').filter({ hasText: single.map.sensors[1].name }).click();
  await card.locator('.status-below-interference-threshold').waitFor();
  console.log('PASS Set to max rounds down and clears interference');

  const impossible = scenario();
  impossible.map.selectedId = 'tx-0';
  ({ card } = await open(impossible));
  assert.match(await card.getByLabel('Transmitter power range').innerText(), /other transmitters already reach this limit/);
  assert.equal(await card.getByRole('button', { name: 'Set to max' }).isDisabled(), true);
  const conflict = structuredClone(single);
  const served = { ...conflict.map.sensors[1], id: 'served-rx', name: 'Served', objective: 'desired', sensitivityDbm: -50 };
  conflict.map.sensors.push(served);
  ({ card } = await open(conflict));
  await card.getByText('No power level satisfies both; move or retune.').waitFor();
  assert.equal(await card.getByRole('button', { name: 'Set to max' }).isDisabled(), true);
  console.log('PASS exhausted aggregate allowance and conflicting bounds disable Set to max');

  const ciLimited = scenario(true);
  ciLimited.map.selectedId = 'tx-1';
  ({ card } = await open(ciLimited));
  assert.match(await card.getByLabel('Transmitter power range').innerText(), /C\/I requirement/);
  console.log('PASS limiting receiver identifies the C/I requirement');

  ({ page, card, drawer } = await open(scenario(false, true), true));
  await card.getByText('3 paths unknown; excluded from interference assessment.').waitFor();
  assert.match(await drawer.locator('.rx-meter-stack').innerText(), /Unknown/);
  await page.locator('.sensor-list-card .sensor-row').filter({ hasText: 'T1' }).click();
  assert.match(await card.getByLabel('Transmitter power range').innerText(), /paths unknown; power range is incomplete/);
  assert.equal(await card.getByRole('button', { name: 'Set to max' }).isDisabled(), true);
  console.log('PASS unknown paths remain visible and excluded');
  assert.deepEqual(errors, []);
} finally { await context?.close(); await browser.close(); }
