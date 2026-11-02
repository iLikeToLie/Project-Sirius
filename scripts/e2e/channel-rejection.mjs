// Production preview check; standard PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE / E2E_URL overrides.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tile = new PNG({ width: 256, height: 256 });
for (let i = 0; i < tile.data.length; i += 4) tile.data.set([128, 0, 0, 255], i);
const body = PNG.sync.write(tile);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/v4-single-link.json', import.meta.url)));
fixture.map.sensors[0].name = 'T1';
fixture.map.sensors[1].name = 'R1';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.fieldRequests = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(data, ...args) {
      if (data.kind === 'coverage' || data.kind === 'zones') window.fieldRequests.push({ kind: data.kind, inputs: data.inputs, slant: data.slant });
      return post.call(this, data, ...args);
    };
  });
  await page.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('**/dem/**/*.png', r => r.fulfill({ contentType: 'image/png', body }));
  const open = async () => {
    await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
    await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  };
  await open();
  await page.locator('input[type=file]').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('friis-rf-planner-v3-state')));
  const commit = async (field, value) => { await field.fill(String(value)); await field.press('Enter'); };
  const card = page.locator('.selected-sensor-card');
  const drawer = page.locator('.link-budget-drawer');
  if (await drawer.getByRole('button', { name: /^Link budget/ }).getAttribute('aria-expanded') !== 'true') await drawer.getByRole('button', { name: /^Link budget/ }).click();
  await drawer.getByRole('tab', { name: 'Link budget', exact: true }).click();
  const power = async () => Number((await drawer.locator('.metric').filter({ has: page.getByText('Received power', { exact: true }) }).locator('strong').innerText()).split(' ')[0]);
  const loss = () => drawer.locator('.metric').filter({ has: page.getByText('Frequency rejection', { exact: true }) });
  assert.ok(Math.abs(await power() - (-51.18795996)) < .01, 'legacy default-channel parity');
  assert.equal((await saved()).map.rejectionModel, 'simple');
  assert.equal(await loss().count(), 0);
  await page.getByRole('button', { name: 'Link settings', exact: true }).click();
  const settings = page.locator('.link-settings-card');
  const select = async name => {
    await page.locator('.sensor-row').filter({ has: page.getByText(name, { exact: true }) }).click();
    await card.getByRole('tab', { name: 'Sensor', exact: true }).click();
  };
  await select('T1');
  await card.getByLabel('Use scenario default', { exact: true }).uncheck();
  await commit(card.getByLabel('Channel frequency', { exact: false }), 5810);
  await loss().getByText('3.01', { exact: false }).waitFor();
  await card.getByRole('tab', { name: 'Link', exact: true }).click();
  await card.getByText('Off-channel for R1 (−3.01 dB)', { exact: true }).waitFor();
  assert.equal(await drawer.getByLabel('Operating frequency', { exact: false }).inputValue(), '5.81');
  // Drawer edits target an explicit Tx, and the editable miscellaneous loss excludes derived rejection.
  await drawer.getByLabel('Operating frequency', { exact: false }).fill('5.82');
  await loss().getByText('30.00', { exact: false }).waitFor();
  let state = await saved();
  assert.equal(state.map.sensors[0].frequencyGhz, 5.82);
  assert.equal(state.inputs.frequencyGhz, 5.8);
  assert.equal(Number(await drawer.getByLabel('Other miscellaneous loss', { exact: false }).inputValue()), .5);
  await drawer.getByLabel('Other miscellaneous loss', { exact: false }).fill('1.5');
  assert.equal((await saved()).inputs.otherLossDb, 1.5);
  await select('R1');
  await commit(card.getByLabel('Adjacent-channel rejection (ACR)', { exact: false }), 24);
  await loss().getByText('24.00', { exact: false }).waitFor();
  await page.waitForFunction(() => window.fieldRequests.some(r => r.kind === 'zones'));
  const radius = await page.evaluate(() => window.fieldRequests.filter(r => r.kind === 'zones').at(-1).slant.interferenceM);
  await settings.getByLabel('Rejection model', { exact: true }).selectOption('mask');
  await card.getByLabel('Offset 1', { exact: false }).waitFor();
  assert.equal(await card.getByLabel('Adjacent-channel rejection (ACR)', { exact: false }).count(), 0);
  await loss().getByText('30.00', { exact: false }).waitFor();
  await page.waitForFunction(previous => window.fieldRequests.filter(r => r.kind === 'zones').at(-1).slant.interferenceM < previous * .6, radius);
  await commit(card.getByLabel('Offset 2', { exact: false }), 10);
  await card.getByRole('alert').waitFor();
  assert.equal((await saved()).map.sensors[1].rejectionMask[1].offsetMhz, 40, 'invalid step is not saved');
  await commit(card.getByLabel('Offset 2', { exact: false }), 35);
  await commit(card.getByLabel('Rejection 1', { exact: false }), 25);
  await loss().getByText('25.00', { exact: false }).waitFor();
  await card.getByRole('button', { name: 'Add mask step' }).click();
  assert.equal(await card.getByRole('button', { name: 'Add mask step' }).isDisabled(), true);
  await card.getByRole('button', { name: 'Remove mask step 4' }).click();
  await settings.getByLabel('Rejection model', { exact: true }).selectOption('simple');
  assert.equal(await card.getByLabel('Adjacent-channel rejection (ACR)', { exact: false }).inputValue(), '24');
  await settings.getByLabel('Rejection model', { exact: true }).selectOption('mask');
  assert.equal(await card.getByLabel('Offset 2', { exact: false }).inputValue(), '35');
  assert.equal(await card.getByLabel('Rejection 1', { exact: false }).inputValue(), '25');
  await open();
  state = await saved();
  assert.equal(state.map.rejectionModel, 'mask');
  assert.equal(state.map.sensors[1].acrDb, 24);
  assert.equal(state.map.sensors[1].rejectionMask[0].rejectionDb, 25);
  // Return Tx to inherited frequency; drawer now edits the shared default.
  await select('T1');
  await card.getByLabel('Use scenario default', { exact: true }).check();
  await drawer.getByRole('tab', { name: 'Link budget', exact: true }).click();
  await drawer.getByLabel('Operating frequency', { exact: false }).fill('5.9');
  state = await saved();
  assert.equal(state.inputs.frequencyGhz, 5.9);
  assert.equal(state.map.sensors[0].frequencyGhz, 'default');
  assert.equal(state.map.sensors[1].frequencyGhz, 'default');
  assert.equal(await loss().count(), 0, 'both inherited channels follow the new default');
  console.log('PASS legacy parity, overlap, ACR/mask switching and persistence, invalid-mask rejection, worker update, drawer frequency/loss edits and inherited default');
  assert.deepEqual(errors, [], 'no uncaught page errors');
} finally {
  await browser.close();
}
