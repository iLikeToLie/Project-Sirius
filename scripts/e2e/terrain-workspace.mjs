// Run against pnpm dev --host 127.0.0.1 --port 5199.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const basemap = new PNG({ width: 256, height: 256 });
  for (let k = 0; k < basemap.data.length; k += 4) basemap.data.set([200, 204, 210, 255], k);
  await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body: PNG.sync.write(basemap), headers: { 'access-control-allow-origin': '*' } }));
  await context.addInitScript(() => {
    localStorage.removeItem('friis-rf-planner-v3-state');
    window.coverageProbe = { running: 0, maxRunning: 0, requests: [], replies: [], rasters: 0, raf: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', e => {
          if (!e.data.powerDbm) return;
          window.coverageProbe.running--;
          window.coverageProbe.replies.push({ jobId: e.data.jobId, known: Array.from(e.data.unknown).some(v => v === 0) });
        });
      }
      postMessage(data, ...args) {
        if (data.kind === 'coverage') {
          window.coverageProbe.running++;
          window.coverageProbe.maxRunning = Math.max(window.coverageProbe.maxRunning, window.coverageProbe.running);
          window.coverageProbe.requests.push({ jobId: data.jobId, frequencyGhz: data.inputs.frequencyGhz });
        }
        return super.postMessage(data, ...args);
      }
    };
    const toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      if (this.width > 10 && this.width < 600) window.coverageProbe.rasters++;
      return toDataURL.apply(this, args);
    };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { window.coverageProbe.raf++; return raf(callback); };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.location().url.includes('favicon')) errors.push(`${m.text()} (${m.location().url})`); });
  await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  await page.waitForSelector('.sensor-marker.role-rx');
  await page.waitForFunction(() => window.coverageProbe.replies.some(r => r.known) && window.coverageProbe.rasters > 0 && !document.querySelector('.refining'), null, { timeout: 30000 });
  assert.equal(await page.locator('.range-ring-label').count(), 3, 'three free-space rings');
  await page.locator('.sensor-marker.role-rx').click();
  const card = page.locator('.selected-sensor-card');
  await card.getByRole('tab', { name: 'Link', exact: true }).click();
  await page.getByRole('group', { name: 'Default objective' }).getByRole('button', { name: 'Avoidance', exact: true }).click();
  assert.equal(await card.getByLabel(/^Intended transmitter/).count(), 0, 'avoidance has no intended link');
  assert.match(await card.locator('.sensor-results').innerText(), /Avoidance/);
  await card.getByLabel(/^Objective/).selectOption('desired');
  assert.equal(await card.getByLabel(/^Intended transmitter/).count(), 1, 'receiver override restores intended link');
  await page.waitForFunction(() => Number(document.querySelector('.signal-overlay')?.dataset.packets) > 0);
  await page.getByRole('button', { name: 'Link settings', exact: true }).click();
  const frequency = page.getByLabel('Operating frequency (all sensors)', { exact: true });
  await frequency.fill('433 MHz'); await frequency.press('Enter');
  await frequency.fill('28 GHz'); await frequency.press('Enter');
  await frequency.fill('5.8 GHz'); await frequency.press('Enter');
  await page.waitForFunction(() => { const p = window.coverageProbe, last = p.requests.at(-1); return last?.frequencyGhz === 5.8 && p.replies.at(-1)?.jobId === last.jobId && !document.querySelector('.refining'); });
  const queue = await page.evaluate(() => window.coverageProbe);
  assert.equal(queue.maxRunning, 1, 'one coverage job at a time');
  assert.equal(queue.replies.at(-1).jobId, queue.requests.at(-1).jobId, 'newest frequency job finishes');
  await page.getByRole('button', { name: 'Link settings', exact: true }).click();
  await page.getByLabel(/^Model/).selectOption('free-space');
  assert.equal(await page.locator('.range-ring-label').count(), 3, 'rings remain in free space');
  await page.getByLabel(/^Model/).selectOption('terrain');
  await page.getByRole('button', { name: 'Collapse sensors', exact: true }).click();
  assert.equal(Math.round((await page.locator('.sensor-list-card').boundingBox()).width), 48);
  await page.getByRole('button', { name: 'Expand sensors', exact: true }).click();
  await card.getByRole('button', { name: 'Collapse sensor', exact: true }).click();
  assert.equal(await card.getByRole('tab').count(), 0);
  await card.getByRole('button', { name: 'Expand sensor', exact: true }).click();
  await page.getByRole('button', { name: 'Hide panels', exact: true }).click();
  assert.equal(await page.locator('.map-card:visible').count(), 0);
  await page.getByRole('button', { name: 'Show panels', exact: true }).click();
  const centre = async locator => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const rx = page.locator('.sensor-marker.role-rx'), tx = page.locator('.sensor-marker.role-tx');
  const before = await centre(rx);
  await tx.focus();
  for (const key of ['ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowLeft']) await page.keyboard.press(key);
  const after = await centre(rx);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1, 'nudge does not pan map');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.signal-overlay')?.dataset.animating === 'false');
  await page.waitForFunction(() => !document.querySelector('.refining'));
  await page.waitForTimeout(500);
  const frames = await page.evaluate(() => window.coverageProbe.raf);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.coverageProbe.raf), frames, 'no idle frame loop with reduced motion');
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('Task 5 browser checks PASS');
} finally { await browser.close(); }
