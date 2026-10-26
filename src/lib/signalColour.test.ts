import { describe, expect, it } from 'vitest';
import { signalColour, signalRange } from './signalColour';

describe('signalColour', () => {
  it('is transparent below the range and for unknown power', () => {
    expect(signalColour(-120, -100, -40)[3]).toBe(0);
    expect(signalColour(NaN, -100, -40)[3]).toBe(0);
  });
  it('runs blue (weak) to red (strong) with a constant, mostly opaque alpha', () => {
    const weak = signalColour(-100, -100, -40), strong = signalColour(-40, -100, -40), above = signalColour(-10, -100, -40);
    expect(weak[2]).toBeGreaterThan(weak[0]);
    expect(strong[0]).toBeGreaterThan(strong[2]);
    expect(above).toEqual(strong);
    expect(weak[3]).toBe(strong[3]);
    expect(strong[3]).toBeGreaterThanOrEqual(140);
  });
  it('passes through green in the middle', () => {
    const mid = signalColour(-70, -100, -40);
    expect(mid[1]).toBeGreaterThan(mid[0]);
    expect(mid[1]).toBeGreaterThan(mid[2]);
  });
});

describe('signalRange', () => {
  const t = { sensitivityDbm: -90, fadeMarginTargetDb: 10, interferenceThresholdDbm: -65 };
  it('anchors the desired view on sensitivity', () => expect(signalRange(t, 'desired', false)).toEqual({ lo: -100, hi: -40 }));
  it('anchors the avoidance view on the interference threshold', () => expect(signalRange(t, 'avoidance', false)).toEqual({ lo: -95, hi: -35 }));
  it('covers both views when showing all bands', () => expect(signalRange(t, 'desired', true)).toEqual({ lo: -100, hi: -35 }));
});
