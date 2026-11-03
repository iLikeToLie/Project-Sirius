// Run: node scripts/benchmark-sensors.mjs. Measures computation, excluding module loading.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
});
try {
  const { createSensor, evaluatePairs } = await server.ssrLoadModule('/src/lib/sensors.ts');
  const { freshDefaultState } = await server.ssrLoadModule('/src/data/defaults.ts');
  const { offsetLatLon, SG_REFERENCE, toLocalM } = await server.ssrLoadModule('/src/lib/geo.ts');
  const state = freshDefaultState();
  state.map.sensors = [];
  state.map.useTerrainElevation = true;
  state.map.propagationModel = 'terrain';
  // Long paths exercise the capped 512-sample terrain profiles and diffraction.
  for (let i = 0; i < 12; i += 1) {
    const at = offsetLatLon(SG_REFERENCE, i < 6 ? -12000 : 12000, (i % 6 - 2.5) * 1000);
    state.map.sensors.push(createSensor(state.map.sensors, i < 6 ? 'tx' : 'rx', at, state.inputs));
  }
  const groundAt = p => {
    const { xM, yM } = toLocalM(p);
    return 20 + 80 * Math.exp(-((xM / 1500) ** 2)) + 5 * Math.sin(yM / 400);
  };
  const run = () => evaluatePairs(state.map, state.inputs, groundAt);
  const pairs = run();
  assert.equal(pairs.length, 36);
  assert.ok(pairs.every(p => p.elevationKnown && p.result.valid));
  assert.ok(pairs.some(p => p.propagationLossDb > 0));
  for (let i = 0; i < 20; i += 1) run();
  const times = Array.from({ length: 200 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(JSON.stringify({ node: process.version, paths: pairs.length, samples: times.length, meanMs: mean, medianMs: times[100], p95Ms: times[189], maxMs: times.at(-1), budgetMs: 50 }, null, 2));
} finally {
  await server.close();
}
