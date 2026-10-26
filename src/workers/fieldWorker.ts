import { computeCoverage, type CoverageRequest } from '../lib/coverage';
import { computeZones, type ZoneRequest } from '../lib/zones';
export type FieldRequest = ({ kind: 'zones' } & ZoneRequest) | ({ kind: 'coverage' } & CoverageRequest);
self.onmessage = (event: MessageEvent<FieldRequest>) => {
  const req = event.data;
  const result = req.kind === 'coverage' ? computeCoverage(req) : computeZones(req);
  self.postMessage(result);
};
