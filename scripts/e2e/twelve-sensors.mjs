// Run against production preview; standard PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE / E2E_URL overrides.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tile = new PNG({ width: 256, height: 256 });
for (let i = 0; i < tile.data.length; i += 4) tile.data.set([128, 0, 0, 255], i);
const body = PNG.sync.write(tile);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/v4-single-link.json', import.meta.url)));
fixture.schemaVersion = 6;
const [tx, rx] = fixture.map.sensors;
fixture.map.sensors = Array.from({ length: 12 }, (_, i) => ({
  ...(i < 6 ? tx : rx), id: `sensor-${i + 1}`, name: `${i < 6 ? 'T' : 'R'}${i % 6 + 1}`,
  lat: 1.3 + (i % 6) * .001, lon: i < 6 ? 103.8 : 103.81,
  desiredTxIds: 'auto', objective: 'default', protectionMarginDb: 'default', requiredCiDb: 10,
}));
Object.assign(fixture.map, { selectedId: 'sensor-12', useTerrainElevation: false, propagationModel: 'free-space', protectionMarginDb: 3, aggregateInterference: 'objective' });
const errors = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/dem/**/*.png', r => r.fulfill({ contentType: 'image/png', body }));
    await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
    await page.locator('input[type=file]').setInputFiles({ name: 'twelve.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
    await page.setViewportSize({ width, height: 1000 });
    const list = page.getByRole('region', { name: 'Sensors', exact: true });
    await list.getByText('12 of 12', { exact: true }).waitFor();
    assert.equal(await list.locator('.sensor-row').count(), 12);
    assert.equal(await list.getByRole('button', { name: '12 sensors placed' }).isDisabled(), true);
    const drawer = page.locator('.link-budget-drawer');
    const toggle = drawer.getByRole('button', { name: /^Link budget/ });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await drawer.getByRole('tab', { name: 'Matrix', exact: true }).click();
    assert.equal(await drawer.locator('tbody tr').count(), 6);
    assert.equal(await drawer.locator('tbody .matrix-cell').count(), 36);
    const panel = drawer.locator('.drawer-matrix-panel');
    const scroll = await panel.evaluate(el => {
      el.scrollLeft = el.scrollWidth;
      el.scrollTop = el.scrollHeight;
      return { x: el.scrollLeft, y: el.scrollTop, needsX: el.scrollWidth > el.clientWidth, needsY: el.scrollHeight > el.clientHeight };
    });
    if (scroll.needsX) assert.ok(scroll.x > 0, 'matrix scrolls horizontally');
    if (scroll.needsY) assert.ok(scroll.y > 0, 'matrix scrolls vertically');
    await drawer.locator('tbody .matrix-cell').last().scrollIntoViewIfNeeded();
    await drawer.locator('tbody .matrix-cell').last().click();
    await drawer.getByRole('tab', { name: 'Link budget', exact: true }).click();
    await list.getByRole('button', { name: 'Delete R6', exact: true }).scrollIntoViewIfNeeded();
    await list.getByRole('button', { name: 'Delete R6', exact: true }).click();
    await list.getByText('11 of 12', { exact: true }).waitFor();
    assert.equal(await list.locator('.add-sensor').isEnabled(), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `no page overflow at ${width}px: ${overflow}`);
    console.log(`PASS 12 sensors, 36 matrix cells, scroll, pin, remove and no page overflow at ${width}px`);
    await page.close();
  }
  assert.deepEqual(errors, [], 'no uncaught page errors');
} finally {
  await browser.close();
}
