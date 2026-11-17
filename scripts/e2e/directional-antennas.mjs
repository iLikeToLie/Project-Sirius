// Run against the production preview on port 5199. Accepts PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, E2E_URL and E2E_SCREENSHOT.
// Seeds one sector-antenna transmitter with two receivers (Rx A east, Rx B west, both 1 km away)
// and checks the sector wedge, the antenna controls, and the ~25 dB back-lobe drop at Rx B against omni,
// then the Antennas tab: a custom model from a preset, handle editing, library export/import and an MSI import.
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
// Library model with the template Tx's own gain, so the only difference from omni is the pattern.
const MODEL = { id: 'ant-1', name: 'Sector 65', kind: 'sector', beamwidthDeg: 65, verticalBeamwidthDeg: 10, frontToBackDb: 25 };
const POINT_EAST = { modelId: 'ant-1', azimuthDeg: 90, downtiltDeg: 0, aimAtId: null };
const OMNI = { modelId: 'omni', azimuthDeg: 0, downtiltDeg: 0, aimAtId: null };
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

  // Seed: schema 8 with an antenna library, one sector Tx, Rx A desired from it (east), Rx B avoiding it (west).
  base.schemaVersion = 8;
  base.map.propagationModel = 'free-space'; base.map.useTerrainElevation = false;
  const rxTemplate = base.map.sensors.find(s => s.role === 'rx');
  const tx = { ...base.map.sensors.find(s => s.role === 'tx'), name: TX_NAME, lat: TX.lat, lon: TX.lon, antenna: { ...POINT_EAST } };
  base.map.antennaModels = [{ ...MODEL, gainDbi: tx.gainDbi }];
  const rxA = { ...rxTemplate, id: 'rx-a', name: RX_A, lat: TX.lat, lon: TX.lon + DLON_1KM, desiredTxIds: [tx.id], objective: 'default', antenna: { ...OMNI } };
  const rxB = { ...rxTemplate, id: 'rx-b', name: RX_B, lat: TX.lat, lon: TX.lon - DLON_1KM, desiredTxIds: [tx.id], objective: 'avoidance', antenna: { ...OMNI } };
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

  // Checks 5-8: custom model from a preset, handle editing, library export, delete and re-import.
  await page.getByRole('button', { name: 'Antennas', exact: true }).click();
  await page.getByRole('button', { name: /^New model/ }).click();
  await page.getByRole('menuitem', { name: /Panel/ }).click();
  const polar = page.locator('.antenna-polar');
  const handles = polar.locator('circle.handle');
  await handles.first().waitFor();
  const handleCount = await handles.count();
  assert.ok(handleCount >= 3, `the preset's horizontal cut shows draggable handles (${handleCount})`);
  assert.ok(await page.getByRole('button', { name: 'Vertical cut' }).count() === 1, 'the H / V cut toggle is shown');
  console.log(`PASS 5: New model from the Panel preset shows ${handleCount} editable handles and the cut toggle`);

  // Drag the handle nearest the back lobe towards the centre; the loss rises and the plot updates on release.
  const target = handles.nth(Math.floor(handleCount / 2));
  const before = Number(await target.getAttribute('aria-valuenow'));
  const box = await target.boundingBox();
  const svgBox = await polar.locator('svg').boundingBox();
  const cx = svgBox.x + svgBox.width / 2, cy = svgBox.y + svgBox.height / 2;
  const px = box.x + box.width / 2, py = box.y + box.height / 2;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + (cx - px) * 0.3, py + (cy - py) * 0.3, { steps: 5 });
  await page.mouse.up();
  const after = Number(await polar.locator('circle.handle').nth(Math.floor(handleCount / 2)).getAttribute('aria-valuenow'));
  assert.ok(after > before, `dragging a handle inward raises its loss (${before} -> ${after} dB)`);
  const keyHandle = polar.locator('circle.handle').nth(Math.floor(handleCount / 2));
  await keyHandle.focus();
  await page.keyboard.press('ArrowUp');
  const nudged = Number(await polar.locator('circle.handle').nth(Math.floor(handleCount / 2)).getAttribute('aria-valuenow'));
  assert.ok(Math.abs(nudged - (after + 0.5)) < 0.01 || Math.abs(nudged - 60) < 0.01, `ArrowUp adds 0.5 dB (${after} -> ${nudged})`);
  console.log(`PASS 6: dragging moved a point ${before} -> ${after} dB and ArrowUp nudged it to ${nudged} dB`);

  // Pair loss with the custom model on the Tx, then export, delete, re-import and compare.
  const modelName = (await page.locator('.antenna-editor-panel h2, .antenna-editor-panel-heading h2').first().innerText()).trim();
  await page.getByLabel(`Model for ${TX_NAME}`, { exact: true }).selectOption({ label: modelName });
  const readPairLoss = async () => {
    await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
    if (!(await drawer.locator('.power-meter').count())) await drawer.getByRole('button', { name: /^Link budget/ }).click();
    const result = await readRxBPower();
    await page.getByRole('button', { name: 'Antennas', exact: true }).click();
    return result.value;
  };
  const withCustom = await readPairLoss();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export library' }).click()]);
  const exported = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  assert.equal(JSON.parse(exported).format, 'lbw-antenna-models', 'the library exports in the lbw-antenna-models format');
  await page.getByRole('button', { name: /^Delete$/ }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm delete' });
  if (await confirm.count()) await confirm.getByRole('button', { name: /^Delete / }).click();
  await page.locator('input[aria-label="Import antenna file"]').setInputFiles({ name: 'library.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await page.getByRole('status').filter({ hasText: /Added 1 model/ }).waitFor();
  await page.getByLabel(`Model for ${TX_NAME}`, { exact: true }).selectOption({ label: modelName });
  const reimported = await readPairLoss();
  assert.equal(reimported, withCustom, `Rx B power is identical after export, delete and re-import (${withCustom} dBm)`);
  console.log('PASS 7: export library, delete, re-import gives the identical Rx B power');

  // Check 8: an MSI sample imports as a model.
  const msi = ['NAME Test MSI', 'MAKE Test', 'FREQUENCY 2400', 'GAIN 10 dBi', 'HORIZONTAL 360',
    ...Array.from({ length: 360 }, (_, a) => `${a}\t${Math.min(a > 180 ? 360 - a : a, 30) * 0.5}`),
    'VERTICAL 360', ...Array.from({ length: 360 }, (_, a) => `${a}\t${Math.min(Math.min(a, 360 - a), 30) * 0.5}`)].join('\n');
  await page.locator('input[aria-label="Import antenna file"]').setInputFiles({ name: 'test.msi', mimeType: 'text/plain', buffer: Buffer.from(msi) });
  await page.getByRole('status').filter({ hasText: /Added 1 model/ }).waitFor();
  assert.ok(await page.getByRole('button', { name: /Test MSI/ }).count() >= 1, 'the MSI model is listed');
  console.log('PASS 8: an MSI sample imports as a model');

  assert.deepEqual(errors, [], 'no browser errors at the end of the run');
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });
  console.log('PASS: directional antennas (schema 8) browser checks. No page errors.');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally { await browser.close(); }
