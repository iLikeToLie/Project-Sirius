import { describe, expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import { centreMhz, frequencyRejectionDb } from './isolation';

const mask = [{ offsetMhz: 20, rejectionDb: 30 }, { offsetMhz: 40, rejectionDb: 45 }, { offsetMhz: 60, rejectionDb: 60 }];
const rx = { fMhz: 5800, bwMhz: 20, acrDb: 27, mask };
describe('frequency rejection', () => {
  it('resolves inherited and explicit sensor centres in MHz', () => {
    const s = freshDefaultState();
    expect(centreMhz(s.map.sensors[0], s.inputs)).toBe(5800);
    expect(centreMhz({ ...s.map.sensors[0], frequencyGhz: 2.4 }, s.inputs)).toBe(2400);
  });
  it('has zero rejection for equal co-channel bandwidths', () => {
    for (const model of ['simple', 'mask'] as const) expect(frequencyRejectionDb({ fMhz: 5800, bwMhz: 20 }, rx, model)).toBe(0);
  });
  it('attenuates half overlap by 3.01 dB in both models', () => {
    for (const model of ['simple', 'mask'] as const) expect(frequencyRejectionDb({ fMhz: 5810, bwMhz: 20 }, rx, model)).toBeCloseTo(3.0103, 4);
  });
  it('passes a narrow transmitter inside a wide receiver without rejection', () => {
    expect(frequencyRejectionDb({ fMhz: 5802, bwMhz: 5 }, rx, 'simple')).toBe(0);
  });
  it('accounts for a receiver narrower than a co-centred transmitter', () => {
    expect(frequencyRejectionDb({ fMhz: 5800, bwMhz: 40 }, rx, 'simple')).toBeCloseTo(3.0103, 4);
  });
  it('uses ACR for touching or disjoint bands, on either side', () => {
    for (const fMhz of [5780, 5820, 5900]) expect(frequencyRejectionDb({ fMhz, bwMhz: 20 }, rx, 'simple')).toBe(27);
  });
  it('looks up the last mask step at, between, beyond, or below offsets', () => {
    for (const [offset, rejection] of [[10, 30], [20, 30], [39, 30], [40, 45], [59, 45], [60, 60], [100, 60]]) {
      expect(frequencyRejectionDb({ fMhz: 5800 + offset, bwMhz: 2 }, { ...rx, bwMhz: 2 }, 'mask')).toBe(rejection);
      expect(frequencyRejectionDb({ fMhz: 5800 - offset, bwMhz: 2 }, { ...rx, bwMhz: 2 }, 'mask')).toBe(rejection);
    }
  });
});
