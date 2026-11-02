import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_STATE } from '../data/defaults';
import { sampleGrid } from '../lib/contours';
import { computeCoverage, type CoverageRequest } from '../lib/coverage';
import { SG_REFERENCE } from '../lib/geo';
import { computeMultiField, type MultiFieldRequest } from '../lib/multiField';
import { computeZones, type ZoneRequest } from '../lib/zones';
import type { FieldRequest } from './fieldWorker';

const ground = sampleGrid({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, 4, 4, () => 0);
const scope = { onmessage: null as ((event: MessageEvent<FieldRequest>) => void) | null, postMessage: vi.fn() };

beforeEach(async () => {
  scope.postMessage.mockClear();
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./fieldWorker');
});
afterEach(() => vi.unstubAllGlobals());

it('returns ordered multi-source arrays and echoes the job id through the worker handler', () => {
  const req: MultiFieldRequest & { kind: 'multi' } = { kind: 'multi', jobId: 71, raster: ground, rayGround: ground,
    origin: SG_REFERENCE, mode: 'free-space', rxAglM: 10, radials: 360, sources: [
      { ...SG_REFERENCE, elevationM: 20, inputs: DEFAULT_STATE.inputs },
      { ...SG_REFERENCE, elevationM: 20, inputs: { ...DEFAULT_STATE.inputs, otherLossDb: DEFAULT_STATE.inputs.otherLossDb + 9 } },
    ] };
  scope.onmessage!({ data: req } as MessageEvent<FieldRequest>);
  expect(scope.postMessage).toHaveBeenCalledOnce();
  const result = structuredClone(scope.postMessage.mock.calls[0][0]);
  expect(result).toEqual(computeMultiField(req));
  expect(result.powers[0][0] - result.powers[1][0]).toBeCloseTo(9, 4);
});

it('keeps the existing coverage request path working', () => {
  const req: CoverageRequest & { kind: 'coverage' } = { kind: 'coverage', jobId: 72, tx: { ...SG_REFERENCE, elevationM: 10 },
    rxAglM: 10, inputs: DEFAULT_STATE.inputs, maxRangeM: 100, radials: 4, stepM: 25, ground: { origin: SG_REFERENCE, grid: ground } };
  scope.onmessage!({ data: req } as MessageEvent<FieldRequest>);
  expect(scope.postMessage.mock.calls[0][0]).toEqual(computeCoverage(req));
});

it('keeps the existing zone request path working', () => {
  const req: ZoneRequest & { kind: 'zones' } = { kind: 'zones', jobId: 73, ground, tx: { xM: 0, yM: 0, elevationM: 10 },
    rxAglM: 10, slant: { sensitivityM: 100, requiredM: 50, interferenceM: 75 } };
  scope.onmessage!({ data: req } as MessageEvent<FieldRequest>);
  expect(scope.postMessage.mock.calls[0][0]).toEqual(computeZones(req));
});
