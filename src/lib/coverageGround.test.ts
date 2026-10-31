import { describe, expect, it } from 'vitest';
import { computeCoverage, gridGroundAt } from './coverage';
import { sampleGrid } from './contours';
import { groundForCoverage } from './coverageGround';
import { SG_REFERENCE } from './geo';
import type { LinkInputs } from '../types';

const flat = () => 10;
const view = sampleGrid({ minX: 1000, maxX: 1100, minY: 0, maxY: 100 }, 20, 20, flat);

describe('groundForCoverage', () => {
  it('returns the view grid untouched when the transmitter is inside it', () => {
    expect(groundForCoverage(view, { xM: 1050, yM: 50 }, flat)).toBe(view);
  });

  it('extends the grid to contain a transmitter outside the view', () => {
    const grid = groundForCoverage(view, { xM: -3000, yM: 40 }, flat);
    expect(gridGroundAt(grid, -3000, 40)).toBe(10);
    expect(gridGroundAt(grid, 1050, 50)).toBe(10);
  });

  it('caps the grid size for a distant transmitter', () => {
    const grid = groundForCoverage(view, { xM: -60000, yM: 40 }, flat, 100);
    expect(grid.cols).toBeLessThanOrEqual(101);
    expect(grid.rows).toBeLessThanOrEqual(101);
  });

  it('keeps coverage known in the view when the transmitter is off-screen', () => {
    const inputs = { frequencyGhz: 2.4, txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, txCableLossDb: 0, rxCableLossDb: 0, polarizationLossDb: 0, obstructionLossDb: 0, otherLossDb: 0, distanceM: 1 } as unknown as LinkInputs;
    const run = (grid: typeof view) => computeCoverage({ jobId: 1, tx: { ...SG_REFERENCE, elevationM: 20 }, rxAglM: 2, inputs, maxRangeM: 3200, radials: 90, stepM: 40, ground: { origin: SG_REFERENCE, grid } });
    expect(run(view).unknown.every(Boolean)).toBe(true); // the bug: no ground under the transmitter
    expect(run(groundForCoverage(view, { xM: 0, yM: 0 }, flat)).unknown.some((u) => !u)).toBe(true);
  });
});
