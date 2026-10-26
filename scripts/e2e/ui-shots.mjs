// Screenshots of the Link workspace states for visual review. Usage: node scripts/e2e/ui-shots.mjs <out-dir>
// Run against pnpm dev --host 127.0.0.1 --port 5199. Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, E2E_URL.
import { PNG } from 'pngjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const [name, width, height] of [['wide', 1440, 900], ['narrow', 1024, 768]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const basemap = new PNG({ width: 256, height: 256 });
    for (let k = 0; k < basemap.data.length; k += 4) basemap.data.set([200, 204, 210, 255], k);
    await context.route('https://www.onemap.gov.sg/**', r => r.fulfill({ contentType: 'image/png', body: PNG.sync.write(basemap), headers: { 'access-control-allow-origin': '*' } }));
    await context.addInitScript(() => localStorage.removeItem('friis-rf-planner-v3-state'));
    const page = await context.newPage();
    await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
    await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
    await page.waitForSelector('.sensor-marker.role-rx');
    await page.waitForFunction(() => !document.querySelector('.refining'), null, { timeout: 30000 });
    await page.locator('.sensor-marker.role-rx').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-1-selected.png` });
    await page.locator('.selected-sensor-card').getByRole('tab', { name: 'Link', exact: true }).click();
    await page.getByRole('button', { name: 'Link settings', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-2-link-settings.png` });
    await page.getByRole('button', { name: 'Link settings', exact: true }).click();
    await page.getByRole('button', { name: /^Link budget/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}-3-drawer.png` });
    await context.close();
  }
} finally { await browser.close(); }
