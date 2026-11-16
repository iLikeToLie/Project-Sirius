// Run against the production preview on port 5199. Accepts PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, E2E_URL and E2E_SCREENSHOT.
// Seeds one sector-antenna transmitter with two receivers (Rx A east, Rx B west, both 1 km away)
// and checks the sector wedge, the antenna controls, and the ~25 dB back-lobe drop at Rx B against omni.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const basemap = new PNG({ width: 256, height: 256 });
for (let k = 0; k < basemap.data.length; k += 4) basemap.data.set([200, 204, 210, 255], k);
const basemapBody = PNG.sync.write(basemap);
const tile = new PNG({ width: 256, height: 256 });
for (let k = 0; k < tile.data.length; k += 4) tile.data.set([128, 0, 0, 255], k); // Terrarium zero metres.
const demBody = PNG.sync.write(tile);

// Tx at Bukit Timah; 1 km east/west is about 0.00898 degrees of longitude at this latitude.
const TX = { lat: 1.3521, lon: 103.8198 };
const DLON_1KM = 0.00898;
const TX_NAME = 'Sector TX', RX_A = 'Rx A', RX_B = 'Rx B';
const SECTOR = { kind: 'sector', azimuthDeg: 90, beamwidthDeg: 65, frontToBackDb: 25 };
const EXPECTED_DROP_DB = 25, TOLERANCE_DB = 1;

const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body: basemapBody, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('**/dem/**/*.png', r => r.fulfill({ contentType: 'image/png', body: demBody }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.includes('favicon')) errors.push(`${m.text()} (${m.location().url})`); });
  const url = process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/';

  await page.goto(url);
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  const base = await page.evaluate(() => JSON.parse(localStorage.getItem('friis-rf-planner-v3-state')));

  // Seed: schema 8, one sector Tx, Rx A desired from it (east), Rx B avoiding it (west).
  base.schemaVersion = 8;
  base.map.propagationModel = 'free-space'; base.map.useTerrainElevation = false;
  const rxTemplate = base.map.sensors.find(s => s.role === 'rx');
  const tx = { ...base.map.sensors.find(s => s.role === 'tx'), name: TX_NAME, lat: TX.lat, lon: TX.lon, antenna: { ...SECTOR } };
  const rxA = { ...rxTemplate, id: 'rx-a', name: RX_A, lat: TX.lat, lon: TX.lon + DLON_1KM, desiredTxIds: [tx.id], objective: 'default', antenna: { kind: 'omni', azimuthDeg: 0, beamwidthDeg: 360, frontToBackDb: 25 } };
  const rxB = { ...rxTemplate, id: 'rx-b', name: RX_B, lat: TX.lat, lon: TX.lon - DLON_1KM, desiredTxIds: [tx.id], objective: 'avoidance', antenna: { kind: 'omni', azimuthDeg: 0, beamwidthDeg: 360, frontToBackDb: 25 } };
  base.map.sensors = [tx, rxA, rxB];
  base.map.selectedId = tx.id;

  await page.locator('input[type=file]').setInputFiles({ name: 'directional.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(base)) });
  await page.locator('.sensor-list-card .sensor-row').filter({ hasText: RX_B }).waitFor();
  await page.locator('.sensor-marker.role-tx').first().waitFor();

  const card = page.locator('.selected-sensor-card');
  const drawer = page.locator('.link-budget-drawer');
  await drawer.getByRole('button', { name: /^Link budget/ }).click();

  // Check 1: the page loads with no console errors.
  assert.deepEqual(errors, [], 'no console or page errors after load');
  console.log('PASS 1: page loads with no console errors');

  // Check 2: a sector wedge is drawn on the Tx marker.
  await page.locator('.sensor-marker.role-tx').first().click();
  await card.waitFor();
  const txMarker = page.locator('.sensor-marker.role-tx').first();
  const markerSvgs = await txMarker.locator('svg').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, cls: n.getAttribute('class') })));
  const parentSvgs = await txMarker.locator('xpath=ancestor::*[contains(@class,"maplibregl-marker")][1]//svg').count();
  console.log('Tx marker svg elements found:', JSON.stringify(markerSvgs), `| svgs in enclosing maplibre marker: ${parentSvgs}`);
  assert.ok(markerSvgs.length + parentSvgs > 0, 'a sector wedge svg is drawn on the Tx marker');
  console.log('PASS 2: sector wedge is drawn on the Tx marker');

  // Check 4: antenna controls exist once the Tx is selected.
  for (const label of ['Sensor antenna', 'Antenna azimuth', 'Aim antenna at']) {
    const count = await card.getByLabel(label, { exact: true }).count();
    assert.ok(count >= 1, `selected Tx shows "${label}"`);
  }
  console.log('PASS 4: Sensor antenna, Antenna azimuth and Aim antenna at controls exist after selecting the Tx');

  // Check 3: Rx B power from the Tx, sector versus omni.
  const readRxBPower = async (prev = null) => {
    await page.locator('.sensor-list-card .sensor-row').filter({ hasText: RX_B }).click();
    await page.waitForFunction(({ name, prev }) => {
      const meter = [...document.querySelectorAll('.link-budget-drawer .power-meter')].find(n => n.getAttribute('aria-label') === `Rx power from ${name}`);
      return !!meter && /-?\d+(\.\d+)?\s*dBm/.test(meter.innerText) && meter.innerText !== prev;
    }, { name: TX_NAME, prev }, { timeout: 30000 });
    const text = await drawer.locator('.power-meter', { hasText: TX_NAME }).first().innerText();
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*dBm/);
    assert.ok(match, `Rx B meter text has a dBm value: ${JSON.stringify(text)}`);
    return { value: Number(match[1]), text };
  };
  const sector = await readRxBPower();
  await page.locator('.sensor-marker.role-tx').first().click();
  await card.getByLabel('Sensor antenna', { exact: true }).selectOption({ value: 'omni' });
  const omni = await readRxBPower(sector.text);
  const drop = omni.value - sector.value;
  console.log(`Rx B from Tx: sector ${sector.value} dBm, omni ${omni.value} dBm, drop ${drop.toFixed(2)} dB`);
  assert.ok(Math.abs(drop - EXPECTED_DROP_DB) <= TOLERANCE_DB, `Rx B drop ${drop.toFixed(2)} dB is within ${TOLERANCE_DB} dB of ${EXPECTED_DROP_DB} dB`);
  console.log('PASS 3: Rx B received power is about 25 dB lower with the sector antenna than with omni');

  assert.deepEqual(errors, [], 'no browser errors at the end of the run');
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });
  console.log('PASS: directional antennas (schema 8) browser checks. No page errors.');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally { await browser.close(); }
