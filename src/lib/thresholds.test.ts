import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, DEFAULT_TERRAIN } from '../data/defaults';
import type { LinkWorkspace } from '../types';
import { antennaElevationM } from './linkGeometry';
import { calculateLink } from './rf';
import { computeFields, flatGroundRadiusM, thresholdReferences, thresholdSlantRangeM } from './thresholds';

const inputs = DEFAULT_STATE.inputs;
const bounds = { minX: -6000, maxX: 6000, minY: -6000, maxY: 6000 };

describe('threshold references', () => {
  it('inverts the link budget at all three reference levels', () => {
    const [sensitivity, required, interference] = thresholdReferences(inputs, 'desired');
    expect(thresholdSlantRangeM(inputs, sensitivity.levelDbm)).toBeCloseTo(24522.91, 1);
    expect(thresholdSlantRangeM(inputs, required.levelDbm)).toBeCloseTo(4360.86, 1);
    expect(thresholdSlantRangeM(inputs, interference.levelDbm)).toBeCloseTo(2452.29, 1);
    const d = thresholdSlantRangeM(inputs, required.levelDbm);
    expect(calculateLink({ ...inputs, distanceM: d }).receivedPowerDbm).toBeCloseTo(-70, 9);
  });

  it('marks the references that drive status for each objective', () => {
    expect(thresholdReferences(inputs, 'desired').map((r) => r.active)).toEqual([true, true, false]);
    expect(thresholdReferences(inputs, 'avoidance').map((r) => r.active)).toEqual([false, false, true]);
  });

  it('has no slant range for invalid inputs', () => {
    expect(thresholdSlantRangeM({ ...inputs, frequencyGhz: 0 }, -85)).toBeNaN();
  });

  it('converts slant range to a flat-ground radius', () => {
    expect(flatGroundRadiusM(5, 3)).toBe(4);
    expect(flatGroundRadiusM(2, 3)).toBeNaN();
  });
});

describe('threshold and terrain fields', () => {
  const tx = { xM: 0, yM: 0, aglM: 10 };
  const rx = { xM: -500, yM: 0, aglM: 10 };

  it('matches the analytic circle on flat ground', () => {
    const ws: LinkWorkspace = { tx, rx, terrain: { ...DEFAULT_TERRAIN, enabled: true, reliefScale: 0 } };
    const result = computeFields({ jobId: 1, workspace: ws, inputs, objective: 'avoidance', bounds, cols: 240, rows: 240 });
    const interference = result.thresholds.find((t) => t.id === 'interference')!;
    expect(interference.state).toBe('visible');
    const radius = flatGroundRadiusM(thresholdSlantRangeM(inputs, inputs.interferenceThresholdDbm), 0);
    for (const [x, y] of interference.segments.map(([x1, y1]) => [x1, y1])) expect(Math.abs(Math.hypot(x, y) - radius)).toBeLessThan(1);
  });

  it('places terrain boundaries where received power equals each threshold, in both objectives', () => {
    const ws: LinkWorkspace = { tx: { xM: 300, yM: 900, aglM: 20 }, rx, terrain: { ...DEFAULT_TERRAIN, enabled: true } };
    for (const objective of ['desired', 'avoidance'] as const) {
      const result = computeFields({ jobId: 2, workspace: ws, inputs, objective, bounds, cols: 300, rows: 300 });
      for (const reference of thresholdReferences(inputs, objective).filter((r) => r.id !== 'sensitivity')) {
        const field = result.thresholds.find((t) => t.id === reference.id)!;
        expect(field.state).toBe('visible');
        for (const [x, y] of field.segments.slice(0, 200).map(([x1, y1]) => [x1, y1])) {
          const candidate = { xM: x, yM: y, aglM: rx.aglM };
          const d = Math.hypot(x - ws.tx.xM, y - ws.tx.yM, antennaElevationM(ws.terrain, candidate) - antennaElevationM(ws.terrain, ws.tx));
          expect(Math.abs(calculateLink({ ...inputs, distanceM: d }, objective).receivedPowerDbm - reference.levelDbm)).toBeLessThan(0.05);
        }
      }
    }
  });

  it('reports a boundary outside the evaluated view', () => {
    const ws: LinkWorkspace = { tx, rx, terrain: { ...DEFAULT_TERRAIN, enabled: true } };
    const result = computeFields({ jobId: 3, workspace: ws, inputs, objective: 'desired', bounds, cols: 60, rows: 60 });
    expect(result.thresholds.find((t) => t.id === 'sensitivity')!.state).toBe('outside-view');
  });

  it('draws terrain contours only when terrain is enabled, at the chosen interval', () => {
    const flat: LinkWorkspace = { tx, rx, terrain: { ...DEFAULT_TERRAIN } };
    expect(computeFields({ jobId: 4, workspace: flat, inputs, objective: 'desired', bounds, cols: 60, rows: 60 }).terrainContours).toEqual([]);
    const hilly: LinkWorkspace = { ...flat, terrain: { ...DEFAULT_TERRAIN, enabled: true, contourIntervalM: 50 } };
    const contours = computeFields({ jobId: 5, workspace: hilly, inputs, objective: 'desired', bounds, cols: 60, rows: 60 }).terrainContours;
    expect(contours.length).toBeGreaterThan(3);
    for (const contour of contours) expect(contour.level % 50).toBe(0);
  });

  it('keeps threshold geometry independent of contour interval', () => {
    const base: LinkWorkspace = { tx, rx, terrain: { ...DEFAULT_TERRAIN, enabled: true } };
    const a = computeFields({ jobId: 6, workspace: base, inputs, objective: 'desired', bounds, cols: 80, rows: 80 });
    const b = computeFields({ jobId: 7, workspace: { ...base, terrain: { ...base.terrain, contourIntervalM: 100 } }, inputs, objective: 'desired', bounds, cols: 80, rows: 80 });
    expect(b.thresholds).toEqual(a.thresholds);
  });
});
