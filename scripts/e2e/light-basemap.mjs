import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/light-basemap', { recursive: true });
// Run against a production preview. Optional PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, E2E_URL.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const browser=await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
page.on('console',m=>{if(m.type()==='error')console.log('ERROR',m.text())});page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto(process.env.E2E_URL ?? 'http://127.0.0.1:5199/friis-rf-calculator/');
const moduleUrl=await page.evaluate(async()=>{const entry=document.querySelector('script[type=module]').src;const js=await(await fetch(entry)).text();return new URL(js.match(/maplibre-[^"']*\.js/)[0],entry).href;});
console.log('url',moduleUrl);
await page.evaluate(async(url)=>{const mod=await import(url); const lib=Object.values(mod).find(x=>x?.Map); const original=lib.Map.prototype.addLayer;lib.Map.prototype.addLayer=function(...args){window.testMap=this;return original.apply(this,args);};},moduleUrl);
await page.getByRole('button',{name:'Link workspace',exact:true}).click();await page.waitForSelector('.sensor-marker',{state:'attached',timeout:15000}).catch(async e=>{console.log(await page.locator('body').innerText());await page.screenshot({path:'/tmp/sirius-debug.png'});throw e;});

await page.waitForFunction(()=>window.testMap?.getSource('zones'));
const overlayIds=['dem','links','range-rings','zone-outlines'];
await page.evaluate(ids=>window.originalSources=ids.map(id=>window.testMap.getSource(id)),overlayIds);
for(let i=0;i<5;i++)for(const base of ['light','onemap','plain'])await page.getByLabel('Basemap').selectOption(base);
assert.equal(await page.evaluate(ids=>ids.every((id,i)=>window.testMap.getSource(id)===window.originalSources[i]),overlayIds),true);
assert.equal(await page.locator('.sensor-marker').count(),2);
await page.getByLabel('Basemap').selectOption('light');
await page.waitForFunction(()=>window.testMap.isStyleLoaded());
assert.match(await page.locator('.maplibregl-ctrl-attrib').innerText(),/OpenStreetMap/);
const views=[['marina-bay',103.858,1.283,14],['jurong-west',103.705,1.34,13],['changi',103.99,1.35,12],['singapore',103.82,1.35,11]];
for(const [name,lon,lat,zoom] of views){
  await page.evaluate(([lon,lat,zoom])=>window.testMap.jumpTo({center:[lon,lat],zoom}),[lon,lat,zoom]);
  for(const base of ['onemap','light']){
    await page.getByLabel('Basemap').selectOption(base);
    await page.waitForFunction(()=>window.testMap.loaded(),{},{timeout:45000});
    await page.waitForTimeout(1500);
    await page.screenshot({path:`artifacts/light-basemap/${name}-${base}.png`});
  }
}
// Persistence and legacy preferences.
const reopen=async()=>{
  await page.reload();
  await page.evaluate(async(url)=>{const mod=await import(url);const lib=Object.values(mod).find(x=>x?.Map);const original=lib.Map.prototype.addLayer;lib.Map.prototype.addLayer=function(...args){window.testMap=this;return original.apply(this,args);};},moduleUrl);
  await page.getByRole('button',{name:'Link workspace',exact:true}).click();
  await page.waitForSelector('.sensor-marker');
};
for(const base of ['light','plain','onemap']){await page.getByLabel('Basemap').selectOption(base);await reopen();assert.equal(await page.getByLabel('Basemap').inputValue(),base);}
await page.getByRole('button',{name:'Fit all sensors',exact:true}).click();
const marker=page.locator('.sensor-marker').first();await marker.focus();await page.keyboard.press('ArrowRight');
const box=await marker.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20,{steps:5});await page.mouse.up();
await page.getByRole('button',{name:'Zoom in',exact:true}).click();
await page.getByLabel('Basemap').selectOption('light');
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(2000);await page.screenshot({path:'artifacts/light-basemap/mobile-light.png',fullPage:true});
await page.setViewportSize({width:1440,height:900});
// New page with all provider traffic blocked covers TileJSON failure as well as tiles.
await page.route('https://tiles.openfreemap.org/**',r=>r.abort());
await reopen();
await page.waitForFunction(()=>document.querySelector('[aria-label="Basemap"]').value==='onemap',{},{timeout:25000});
assert.match(await page.getByRole('status').allTextContents().then(x=>x.join(' ')),/Light map unavailable/);
await page.screenshot({path:'artifacts/light-basemap/fallback.png'});
console.log('PASS: switching, source preservation, attribution, persistence, sensor interactions, zoom, mobile and blocked-provider fallback; screenshots captured.');
await browser.close();
