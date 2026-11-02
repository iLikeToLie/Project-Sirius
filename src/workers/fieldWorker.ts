import { computeCoverage, type CoverageRequest } from '../lib/coverage';
import { computeMultiField, type MultiFieldRequest } from '../lib/multiField';
import { computeZones, type ZoneRequest } from '../lib/zones';
export type FieldRequest = ({ kind: 'zones' } & ZoneRequest) | ({ kind: 'coverage' } & CoverageRequest) | ({ kind: 'multi' } & MultiFieldRequest);
self.onmessage = (event: MessageEvent<FieldRequest>) => {
  const req = event.data;
  const result = req.kind === 'multi' ? computeMultiField(req) : req.kind === 'coverage' ? computeCoverage(req) : computeZones(req);
  self.postMessage(result);
};
