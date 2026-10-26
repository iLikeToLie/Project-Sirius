// Run against pnpm dev --host 127.0.0.1 --port 5199 with public/dem built.
// Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, E2E_URL, E2E_SCREENSHOT.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const basemap = new PNG({ width: 256, height: 256 });
  for (let k = 0; k < basemap.data.length; k += 4) basemap.data.set([200, 204, 210, 255], k);
  await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body: PNG.sync.write(basemap), headers: { 'access-control-allow-origin': '*' } }));
  await context.addInitScript(() => localStorage.removeItem('friis-rf-planner-v3-state'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.includes('favicon')) errors.push(`${m.text()} (${m.location().url})`); });
  await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  await page.waitForSelector('.sensor-marker.role-rx');
  const drawer = page.locator('.link-budget-drawer');
  const field = label => drawer.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
  await drawer.getByRole('button', { name: /^Link budget/ }).click();

  // Every Calculator field exists in the drawer.
  const labels = ['Scenario or link name', 'Tx location / identifier', 'Rx location / identifier', 'Transmit power', 'Operating frequency', 'Tx-to-Rx 3D separation', 'Fade margin target',
    'Tx antenna gain', 'Rx antenna gain', 'Tx cable & connector loss', 'Rx cable & connector loss', 'Polarization mismatch', 'Obstruction / environment', 'Other miscellaneous loss', 'Receiver sensitivity', 'Interference threshold'];
  for (const label of labels) assert.equal(await field(label).count(), 1, `drawer has ${label}`);
  for (const metric of ['Received power', 'Link margin', 'Interference margin', 'Free-space path loss', 'Diffraction loss', 'Total system losses', 'Wavelength']) assert.ok(await drawer.locator('.metric', { hasText: metric }).count() >= 1, `drawer shows ${metric}`);
  assert.equal(await drawer.locator('.power-meter').count(), 1, 'Rx power meter');
  await page.waitForSelector('.path-profile canvas');
  const box = await page.locator('.path-profile canvas').boundingBox();
  assert.ok(box.width > 100 && box.height > 100, 'path profile has size');

  // Editing a drawer field changes the map result.
  const received = () => drawer.locator('.metric').first().locator('strong').innerText();
  const before = await received();
  await field('Transmit power').fill('40');
  await page.waitForFunction(([b]) => document.querySelector('.link-budget-drawer .metric strong').innerText !== b, [before]);
  assert.notEqual(await received(), before, 'Tx power edit changes received power');
  await page.locator('.sensor-marker.role-tx').click();
  await page.locator('.selected-sensor-card').getByLabel(/Transmit power/).inputValue().then(v => assert.equal(v, '40', 'edit wrote back to the sensor'));

  // The profile draws for an obstructed path: put Tx on Bukit Timah and Rx beyond it at sea level.
  const card = page.locator('.selected-sensor-card');
  await card.getByLabel('Latitude').fill('1.3540'); await card.getByLabel('Latitude').press('Enter');
  await card.getByLabel('Longitude').fill('103.7760'); await card.getByLabel('Longitude').press('Enter');
  await page.locator('.sensor-list-card').getByRole('button', { name: /RX/ }).first().click();
  await card.getByLabel('Latitude').fill('1.3300'); await card.getByLabel('Latitude').press('Enter');
  await card.getByLabel('Longitude').fill('103.7600'); await card.getByLabel('Longitude').press('Enter');
  await page.waitForFunction(() => !document.querySelector('.refining'), null, { timeout: 30000 });
  const diffraction = await drawer.locator('.metric', { hasText: /^Diffraction loss/ }).innerText();
  console.log('Diffraction metric:', diffraction.replace(/\n/g, ' '));
  await page.waitForSelector('.path-profile canvas');
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });

  // Free-space values match the Calculator tab.
  await page.getByLabel(/^Model/).selectOption('free-space');
  await page.waitForFunction(() => /off/.test(document.querySelector('.link-budget-drawer')?.innerText ?? ''));
  const drawerPower = (await received()).trim();
  await page.getByRole('button', { name: 'Calculator', exact: true }).click();
  const hero = (await page.locator('.result-hero .power-value').innerText()).replace(/\s*dBm\s*/, '').trim();
  assert.equal(hero, drawerPower.replace(/\s*dBm\s*/, '').trim(), 'free-space drawer power equals Calculator power');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('Task 6 browser checks PASS');
} finally { await browser.close(); }
