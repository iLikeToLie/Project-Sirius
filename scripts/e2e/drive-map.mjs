import { chromium } from 'playwright-core';
import zlib from 'node:zlib';

const OUT = process.argv[2];
const URL = 'http://localhost:5199/friis-rf-calculator/';

// Minimal PNG encoder for solid 256×256 tiles.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png([r, g, b]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(256 * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(256).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const GREY = png([200, 204, 210]);
const DEM_20M = png([128, 20, 0]); // terrarium: 128*256 + 20 - 32768 = 20 m

const errors = [];
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route('https://www.onemap.gov.sg/**', (r) => r.fulfill({ contentType: 'image/png', body: GREY, headers: { 'access-control-allow-origin': '*' } }));
await context.route('**/elevation-tiles-prod/**', (r) => r.fulfill({ contentType: 'image/png', body: DEM_20M, headers: { 'access-control-allow-origin': '*' } }));
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole('button', { name: 'Link workspace' }).click();
await page.waitForSelector('.sensor-marker', { timeout: 20000 });
await page.waitForTimeout(1500);
const markers = await page.locator('.sensor-marker').count();
log('markers', markers, markers === 2 ? 'PASS' : 'FAIL');
await page.screenshot({ path: `${OUT}/m1-initial.png` });

const rxRow = page.locator('.sensor-row', { hasText: 'Building B RX-02' });
await rxRow.click();
await page.waitForSelector('.selected-sensor-card');
const status = async () => (await page.locator('.selected-sensor-card .result-line').first().innerText()).replace(/\s+/g, ' ');
log('R1 before drag:', await status());
log('ground readout:', (await page.locator('.selected-sensor-card .readouts').innerText()).replace(/\s+/g, ' '));

// Drag the transmitter marker 200 px left.
const tx = page.locator('.sensor-marker.role-tx');
const box = await tx.boundingBox();
await page.mouse.move(box.x + 20, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x - 80, box.y + 20, { steps: 10 });
await page.mouse.move(box.x - 180, box.y + 20, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
await rxRow.click();
log('R1 after drag:', await status());

// Add a sensor (becomes RX since a TX exists), toggle it to TX, point R1 at it.
await page.getByRole('button', { name: /Sensor$/ }).click();
await page.waitForTimeout(300);
log('after add: rows', await page.locator('.sensor-row').count());
await page.locator('.selected-sensor-card').getByRole('button', { name: 'Transmitter' }).click();
const newName = await page.locator('.selected-sensor-card .sensor-name-input').inputValue();
log('new sensor', newName, 'role toggled');
await rxRow.click();
await page.locator('.selected-sensor-card select').first().selectOption({ label: newName });
await page.waitForTimeout(300);
log('R1 intended now:', await status());

// Zones for selected transmitter
await page.locator('.sensor-row', { hasText: newName }).click();
await page.waitForFunction(() => !document.querySelector('.refining'), null, { timeout: 15000 });
await page.waitForTimeout(800);
const zoneSource = await page.evaluate(() => !!document.querySelector('.zone-legend'));
log('zone legend shown', zoneSource ? 'PASS' : 'FAIL');
log('legend copy:', (await page.locator('.zone-legend .field-note').innerText()).slice(0, 160));
await page.screenshot({ path: `${OUT}/m2-zones.png` });

// Terrain toggle
await rxRow.click();
await page.getByLabel('Use terrain elevation').uncheck();
log('terrain off:', (await page.locator('.selected-sensor-card .readouts').innerText()).replace(/\s+/g, ' '));
await page.getByLabel('Use terrain elevation').check();
await page.waitForTimeout(500);
log('terrain on:', (await page.locator('.selected-sensor-card .readouts').innerText()).replace(/\s+/g, ' '));

// Fill to six
for (let i = 0; i < 6; i += 1) { const b = page.locator('.add-sensor'); if (await b.isEnabled()) await b.click(); }
const rows = await page.locator('.sensor-row').count();
log('rows', rows, 'add disabled', await page.locator('.add-sensor').isDisabled(), rows === 6 ? 'PASS' : 'FAIL');
await page.locator('.sensor-row').nth(1).click();
await page.screenshot({ path: `${OUT}/m3-six.png` });

// Calculator shows the active pair
await page.locator('.sensor-row', { hasText: 'Building B RX-02' }).click();
await page.getByRole('button', { name: 'Calculator' }).click();
log('calculator Tx/Rx ids:', await page.getByLabel('Tx location / identifier').inputValue(), '→', await page.getByLabel('Rx location / identifier').inputValue());

log('console errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
