import { describe, expect, it } from 'vitest';
import {
  fitView, formatFrequency, frequencyFromSlider, gridStep, parseFrequency, screenToWorld, signalSpeedPxPerSec, sliderFromFrequency,
  snapToGrid, viewBounds, worldToScreen, zoomAt,
} from './viewport';

const size = { width: 800, height: 500 };
const view = { cx: 100, cy: -50, widthM: 2000 };

describe('viewport transforms', () => {
  it('round-trips world and screen coordinates with Y pointing up', () => {
    const screen = worldToScreen(view, size, { xM: 600, yM: 200 });
    expect(screen.y).toBeLessThan(size.height / 2);
    const back = screenToWorld(view, size, screen);
    expect(back.xM).toBeCloseTo(600, 9);
    expect(back.yM).toBeCloseTo(200, 9);
  });

  it('zooms around the pointer without moving the world point under it', () => {
    const pointer = { x: 620, y: 140 };
    const before = screenToWorld(view, size, pointer);
    const zoomed = zoomAt(view, size, pointer, 0.5);
    expect(zoomed.widthM).toBe(1000);
    const after = screenToWorld(zoomed, size, pointer);
    expect(after.xM).toBeCloseTo(before.xM, 9);
    expect(after.yM).toBeCloseTo(before.yM, 9);
  });

  it('fits a set of points with margin', () => {
    const fitted = fitView(size, [{ xM: -250, yM: 0 }, { xM: 250, yM: 300 }]);
    const bounds = viewBounds(fitted, size);
    expect(bounds.minX).toBeLessThan(-250);
    expect(bounds.maxX).toBeGreaterThan(250);
    expect(bounds.minY).toBeLessThan(0);
    expect(bounds.maxY).toBeGreaterThan(300);
  });

  it('chooses 1-2-5 grid steps', () => {
    expect(gridStep(2000, 800)).toBe(500);
    for (const width of [37, 480, 9_000, 120_000]) {
      const step = gridStep(width, 800);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });

  it('snaps to 25 m', () => {
    expect(snapToGrid({ xM: 37, yM: -12 }, 25)).toEqual({ xM: 25, yM: 0 });
  });
});

describe('frequency control', () => {
  it('maps the log slider across 1 MHz – 100 GHz', () => {
    expect(frequencyFromSlider(0)).toBeCloseTo(0.001, 12);
    expect(frequencyFromSlider(10_000)).toBeCloseTo(100, 9);
    for (const ghz of [0.001, 0.01, 0.1, 1, 10, 100, 5.8]) expect(frequencyFromSlider(sliderFromFrequency(ghz))).toBeCloseTo(ghz, 9);
  });

  it('parses precise MHz and GHz entries', () => {
    expect(parseFrequency('433 MHz')).toBeCloseTo(0.433, 12);
    expect(parseFrequency('5.8 ghz')).toBe(5.8);
    expect(parseFrequency('2.4')).toBe(2.4);
    expect(parseFrequency('fast')).toBeNaN();
    expect(parseFrequency('')).toBeNaN();
  });

  it('formats below 1 GHz in MHz', () => {
    expect(formatFrequency(0.433)).toBe('433 MHz');
    expect(formatFrequency(5.8)).toBe('5.8 GHz');
  });
});

describe('decorative signal speed', () => {
  it('is bounded to 100–500 px/s and rises with frequency', () => {
    expect(signalSpeedPxPerSec(0.001)).toBeCloseTo(100, 9);
    expect(signalSpeedPxPerSec(100)).toBeCloseTo(500, 9);
    expect(signalSpeedPxPerSec(NaN)).toBe(100);
    let previous = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const speed = signalSpeedPxPerSec(0.001 * 10 ** (i / 200));
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
  });
});
