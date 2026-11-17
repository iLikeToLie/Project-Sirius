// Regression: a transient building-height tile outage recovers without sensor edits or reload.
// Run against production preview with PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE and E2E_URL overrides.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
import assert from 'node:assert/strict';
const browser = await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[],responses=[],failed=[];
 page.on('pageerror', e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{if(r.url().includes('/buildings/'))responses.push([r.status(),r.url()]);});
 page.on('requestfailed',r=>failed.push([r.url(),r.failure()]));
 let failedTile, attempts=0;
 await page.route('**/buildings/15/**/*.png', route=>{
   failedTile ??= route.request().url();
   if(route.request().url()===failedTile && ++attempts===1) return route.fulfill({status:503,body:'Temporary outage'});
   return route.continue();
 });
 await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
 await page.getByRole('button',{name:'Link workspace',exact:true}).click();
 await page.getByRole('checkbox',{name:'Buildings',exact:true}).check();
 await page.waitForTimeout(15000);
 console.log(JSON.stringify({notices:await page.locator('.map-notice').allTextContents(),errors,failed,responses:responses.filter(r=>r[0]!==200),successfulTiles:responses.filter(r=>r[0]===200).length},null,2));
 assert.ok(attempts>1,'a transiently failed source tile must retry without moving sensors');
 assert.equal(await page.getByText('Some building tiles failed to load: those buildings are missing.').count(),0,'recovered tiles must clear the warning');
 assert.ok(responses.some(([status,url])=>status===200 && url===failedTile),'the failed tile must eventually load');
 assert.deepEqual(failed, [], 'no failed network requests');
 assert.deepEqual(errors.filter(e=>!e.includes('503') && !e.includes('favicon')), [], 'no unexpected console errors');
 console.log('PASS building tiles recover after a temporary 503');
 // An exhausted tile must still report missing buildings, then clear after a successful new request.
 await page.unroute('**/buildings/15/**/*.png');
 let unavailable = true, outageAttempts = 0;
 await page.route('**/buildings/15/**/*.png', route => {
   if (route.request().url() === failedTile && unavailable) {
     outageAttempts += 1;
     return route.fulfill({status:503,body:'Persistent outage'});
   }
   return route.continue();
 });
 await page.reload();
 await page.getByRole('button',{name:'Link workspace',exact:true}).click();
 const warning = page.getByText('Some building tiles failed to load: those buildings are missing.');
 await warning.waitFor({state:'visible',timeout:35000});
 const exhaustedAttempts = outageAttempts;
 await page.waitForTimeout(2000);
 assert.equal(outageAttempts,exhaustedAttempts,'automatic retries stop after backoff is exhausted');
 unavailable = false;
 await page.getByRole('checkbox',{name:'Buildings',exact:true}).uncheck();
 await page.getByRole('checkbox',{name:'Buildings',exact:true}).check();
 await warning.waitFor({state:'hidden',timeout:10000});
 console.log(`PASS persistent outage reports missing data, stops retrying (${exhaustedAttempts} requests including display), and clears after recovery`);
} finally {await browser.close();}
