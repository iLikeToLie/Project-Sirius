// Buildings: toggle, roof/street mount, diffraction over towers, building layer and path profile.
// Run against a preview on 127.0.0.1:5199. Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, E2E_URL, E2E_SCREENSHOT.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const KEY = 'friis-rf-planner-v3-state';
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const basemap = new PNG({ width: 256, height: 256 });
  for (let k = 0; k < basemap.data.length; k += 4) basemap.data.set([200, 204, 210, 255], k);
  await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body: PNG.sync.write(basemap), headers: { 'access-control-allow-origin': '*' } }));
  const page = await context.newPage(), errors = [], tiles = new Set();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.includes('favicon')) errors.push(`${m.text()} (${m.location().url})`); });
  page.on('response', r => { if (r.url().includes('/buildings/')) tiles.add(`${r.status()} ${r.url().split('/buildings/')[1]}`); });
  const url = process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/';
  await page.goto(url);
  // Seed: T1 on the Marina Bay Sands hotel roof, R1 at street level 1.1 km west among the CBD towers.
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key));
    const [tx, rx] = s.map.sensors;
    Object.assign(tx, { lat: 1.2834, lon: 103.8607, aglM: 5, mount: 'roof' });
    Object.assign(rx, { lat: 1.2812, lon: 103.8505, aglM: 1.5, mount: 'street' });
    s.map.selectedId = rx.id; s.map.propagationModel = 'terrain'; s.map.useTerrainElevation = true; s.map.buildings = false;
    localStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  await page.waitForSelector('.sensor-marker.role-rx');
  const toggle = page.getByRole('checkbox', { name: 'Buildings' });
  assert.equal(await toggle.isChecked(), false, 'buildings start off (D8)');
  assert.equal(await page.getByRole('combobox', { name: 'Sensor mount' }).count(), 0, 'no mount choice while buildings are off');
  await page.getByRole('button', { name: /Link budget/ }).first().click();
  const diffraction = async () => Number((await page.locator('.metric', { hasText: 'Diffraction loss' }).locator('strong, .metric-value, b').first().innerText()).replace(/[^\d.-]/g, ''));
  await page.waitForTimeout(1500);
  const off = await diffraction();
  await toggle.check();
  await page.waitForFunction(() => !document.querySelector('.refining') , null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const on = await diffraction();
  assert.ok(on > off + 5, `towers add diffraction loss (off ${off} dB, on ${on} dB)`);
  assert.ok(await page.locator('.path-profile').count() === 1, 'path profile shown');
  assert.ok([...tiles].some(t => t.startsWith('200 15/')), `zoom-15 building tiles load: ${[...tiles].slice(0, 5)}`);
  const mount = page.getByRole('combobox', { name: 'Sensor mount' });
  assert.equal(await mount.inputValue(), 'street');
  await mount.selectOption('roof');
  await page.waitForTimeout(1500);
  const roof = await diffraction();
  assert.notEqual(roof, on, `mounting the receiver on its roof changes the loss (street ${on} dB, roof ${roof} dB)`);
  assert.ok(await page.locator('.readouts', { hasText: 'Building here' }).count() >= 1, 'sensor card shows the building under it');
  assert.ok((await page.locator('.maplibregl-ctrl-attrib').innerText()).includes('Overture'), 'building attribution shown');
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });
  assert.deepEqual(errors, [], 'no console errors');
  console.log(`PASS buildings: diffraction off ${off} dB, street ${on} dB, roof ${roof} dB; ${tiles.size} building tile responses`);
} finally { await browser.close(); }
