// Run with: node design-exploration/check-animation.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/antenna-workspace.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new Function(script);
function definition(name) {
  const start = script.indexOf('function ' + name + '(');
  assert(start >= 0, 'Missing function ' + name);
  let depth = 0;
  const brace = script.indexOf('{', start);
  for (let end = brace; end < script.length; end++) {
    if (script[end] === '{') depth++;
    if (script[end] === '}' && --depth === 0) return script.slice(start, end + 1);
  }
  throw Error('Incomplete function ' + name);
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const speed = new Function('clamp', definition('signalSpeedPxPerSec') + ';return signalSpeedPxPerSec;')(clamp);
let previous = 0;
for (let i = 0; i <= 1000; i++) {
  const current = speed(.001 * 10 ** (5 * i / 1000));
  assert(current >= 100 && current <= 500, 'Visual speed escapes its requested 1×–5× bounds');
  assert(current >= previous, 'Frequency mapping reverses');
  previous = current;
}
assert.equal(speed(.001), 100);
assert.equal(speed(100), 500);
for (const value of [NaN, Infinity, -1, 0]) assert(Number.isFinite(speed(value)));
const intersects = new Function(definition('circleIntersectsViewport') + ';return circleIntersectsViewport;')();
assert.equal(intersects(10000000, 50, 50, 100, 100), false, 'Huge invisible boundary is not culled');
assert.equal(intersects(20, 50, 50, 100, 100), true);
assert.equal(intersects(10, -100, 50, 100, 100), false);
assert.equal(intersects(100, -100, 50, 100, 100), true);

const pending = [];
let draws = 0, renders = 0;
const context2d = new Proxy({}, {get: () => () => {draws++;}});
const forbid = () => {throw Error('Animation attempted layout, RF or terrain work');};
const sandbox = {
  Math, document: {hidden: false}, reducedMotion: {matches: false},
  signalContext: context2d, signalInView: true, signalFrameId: 0,
  signalTravel: 0, lastSignalFrame: 0,
  signalGeometry: {x:20,y:20,length:800,width:900,height:480,dpr:1,valid:true,color:'#34d399',targetSpeed:100,speed:100},
  requestAnimationFrame: callback => {pending.push(callback);return pending.length;},
  screen: forbid, dims: forbid, $: forbid, result: forbid, drawTerrain: forbid,
  render: () => {renders++;}, syncFrequency: () => {}, frequencyRenderPending: false,
};
vm.createContext(sandbox);
vm.runInContext(['paintSignals','animateSignals','wakeSignalAnimation','scheduleFrequencyRender'].map(definition).join('\n'), sandbox);
// One hundred slider events in a frame must produce one UI render.
for (let i = 0; i < 100; i++) sandbox.scheduleFrequencyRender();
assert.equal(pending.length, 1);
pending.shift()();
assert.equal(renders, 1);
// Actual frame code must paint while never touching layout, RF or terrain.
for (let i = 1; i <= 120; i++) {
  sandbox.animateSignals(i * 16);
  pending.length = 0;
}
assert(draws > 0);
assert.equal(renders, 1, 'Animation triggers application renders');
const before = draws;
sandbox.document.hidden = true;
sandbox.animateSignals(3000);
assert.equal(draws, before);
assert.equal(pending.length, 0);
sandbox.document.hidden = false;
sandbox.reducedMotion.matches = true;
sandbox.animateSignals(3016);
assert.equal(draws, before);
assert.equal(pending.length, 0);
console.log('PASS: speed bounded 100–500 px/s (1×–5×) across 1,001 frequencies; smooth monotonic mapping.');
console.log('PASS: 100 slider events coalesce to one render; 120 animation frames perform no RF, terrain or layout reads.');
console.log('PASS: hidden/reduced-motion frames stop without drawing or scheduling another frame.');
