import { computeZones, type ZoneRequest } from '../lib/zones';

// Range-zone grids run here so dragging a sensor never waits on grid evaluation.
self.onmessage = (event: MessageEvent<ZoneRequest>) => {
  self.postMessage(computeZones(event.data));
};
