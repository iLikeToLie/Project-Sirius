import { computeFields, type FieldRequest } from '../lib/thresholds';

// Terrain contours and threshold boundaries run here so dragging never waits on grid evaluation.
self.onmessage = (event: MessageEvent<FieldRequest>) => {
  self.postMessage(computeFields(event.data));
};
