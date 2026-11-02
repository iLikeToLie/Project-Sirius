import { describe, expect, it } from 'vitest';
import { freshDefaultState } from '../data/defaults';
import { centreMhz, frequencyRejectionDb, noiseFloorDbm, polarizationMismatchDb } from './isolation';

describe('polarization mismatch', () => {
  it('covers every ordered polarization pairing with adjustable XPD', () => {
    const polarizations = ['V', 'H', 'RHCP', 'LHCP'] as const;
    for (const xpd of [0, 7, 15, 30]) for (const a of polarizations) for (const b of polarizations) {
      const sameFamily = (a === 'V' || a === 'H') === (b === 'V' || b === 'H');
      expect(polarizationMismatchDb(a, b, xpd), `${a} to ${b}, XPD ${xpd}`).toBeCloseTo(a === b ? 0 : sameFamily ? xpd : 10 * Math.log10(2), 10);
    }
  });
});

const mask = [{ offsetMhz: 20, rejectionDb: 30 }, { offsetMhz: 40, rejectionDb: 45 }, { offsetMhz: 60, rejectionDb: 60 }];
const rx = { fMhz: 5800, bwMhz: 20, acrDb: 27, mask };
describe('receiver noise floor', () => {
  it('derives about -95 dBm noise and -101 dBm interference threshold for 20 MHz, NF 6 and I/N -6', () => {
    const noise = noiseFloorDbm(20, 6);
    expect(noise).toBeCloseTo(-95, 1);
    expect(noise - 6).toBeCloseTo(-101, 1);
  });
  it('rises by 3.0103 dB for doubled bandwidth and one dB per dB of noise figure', () => {
    expect(noiseFloorDbm(40, 6) - noiseFloorDbm(20, 6)).toBeCloseTo(3.0103, 4);
    expect(noiseFloorDbm(20, 9) - noiseFloorDbm(20, 6)).toBeCloseTo(3, 10);
  });
  it('uses MHz as the input bandwidth unit', () => {
    expect(noiseFloorDbm(1, 0)).toBe(-114);
  });
});
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
