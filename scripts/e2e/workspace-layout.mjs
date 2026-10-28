// Browser checks for the workspace layout: drawer resize, full screen, remembered view preferences,
// basemap switch, link distance labels and the log-true frequency scale.
// Run against `vite preview --host 127.0.0.1 --port 5199 --strictPort`. Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, E2E_URL.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const open = async () => {
  await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
  await page.getByRole('button', { name: 'Link workspace', exact: true }).click();
  await page.waitForSelector('.coverage-legend', { timeout: 30000 });
};
const height = async (locator) => Math.round((await locator.boundingBox()).height);

await open();
const ws = page.locator('.map-workspace');
const drawer = page.locator('.link-budget-drawer');
const legend = page.locator('.coverage-legend');

// Distance label on the default desired link (about 500 m).
await page.waitForSelector('.link-distance-label');
assert.match(await page.locator('.link-distance-label').first().innerText(), /^\d+ m$|^\d+\.\d{2} km$/, 'desired link shows its distance');

// Drawer: drag, keyboard, expand, restore, reset.
await page.getByRole('button', { name: 'Link budget +' }).click();
const base = await height(drawer);
const handle = await page.locator('.drawer-resize').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + 4);
await page.mouse.down();
await page.mouse.move(handle.x + handle.width / 2, handle.y - 196, { steps: 8 });
await page.mouse.up();
const dragged = await height(drawer);
assert.ok(Math.abs(dragged - (base + 200)) <= 6, `drag grows the drawer by the pointer distance (${base} -> ${dragged})`);
const lb = await legend.boundingBox(), db = await drawer.boundingBox();
assert.ok(lb.y + lb.height <= db.y, 'legend stays above the resized drawer');
await page.locator('.drawer-resize').focus();
await page.keyboard.press('ArrowDown');
assert.equal(await height(drawer), dragged - 40, 'arrow key shrinks the drawer by 40 px');

// Preferences survive a reload: drawer open at its size, bands style, plain basemap.
await page.getByRole('group', { name: 'Coverage style' }).getByRole('button', { name: 'Bands', exact: true }).click();
await page.getByLabel('Basemap').selectOption('plain');
await open();
assert.equal(await height(drawer), dragged - 40, 'drawer size is remembered');
assert.equal(await page.getByRole('group', { name: 'Coverage style' }).getByRole('button', { name: 'Bands', exact: true }).getAttribute('aria-pressed'), 'true', 'coverage style is remembered');
assert.equal(await page.getByLabel('Basemap').inputValue(), 'plain', 'basemap is remembered');

await page.getByRole('button', { name: 'Expand', exact: true }).click();
assert.ok(await height(drawer) >= await height(ws) - 24, 'Expand fills the workspace');
assert.equal(await legend.isVisible(), false, 'legend is hidden behind the expanded drawer');
await page.getByRole('button', { name: 'Restore', exact: true }).click();
await page.locator('.drawer-resize').dblclick();
assert.equal(await height(drawer), base, 'double-click returns the drawer to its default height');
await page.getByRole('button', { name: 'Link budget −' }).click();
await page.getByRole('group', { name: 'Coverage style' }).getByRole('button', { name: 'Gradient', exact: true }).click();
await page.getByLabel('Basemap').selectOption('onemap');

// Full screen from the button and from the F key.
await page.getByRole('button', { name: 'Full screen', exact: true }).click();
await page.waitForFunction(() => document.querySelector('.map-workspace').classList.contains('map-fullscreen'));
const box = await ws.boundingBox();
assert.ok(box.height >= 850 && box.y <= 1, 'workspace fills the screen');
await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
await page.waitForFunction(() => !document.querySelector('.map-workspace').classList.contains('map-fullscreen'));
await page.locator('.map-canvas').click({ position: { x: 700, y: 120 } });
await page.keyboard.press('f');
await page.waitForFunction(() => document.querySelector('.map-workspace').classList.contains('map-fullscreen'));
await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();

// Frequency scale: 1 GHz sits at 60 % of the logarithmic track.
await page.getByRole('button', { name: 'Link settings', exact: true }).click();
const scale = await page.locator('.log-scale').boundingBox();
const ghz = await page.locator('.log-scale span', { hasText: /^1 GHz$/ }).boundingBox();
const at = (ghz.x + ghz.width / 2 - scale.x) / scale.width;
assert.ok(Math.abs(at - 0.6) < 0.02, `1 GHz label at ${(at * 100).toFixed(1)} % of the scale`);

assert.deepEqual(errors, [], 'no uncaught page errors');
console.log('Workspace layout browser checks PASS');
await browser.close();
