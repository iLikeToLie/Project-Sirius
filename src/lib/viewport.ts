import type { Bounds } from './contours';

/** Workspace camera: world centre and visible width, in metres. Never part of saved RF state. */
export interface View { cx: number; cy: number; widthM: number }
export interface Size { width: number; height: number }
export interface WorldPoint { xM: number; yM: number }
export interface ScreenPoint { x: number; y: number }

const scale = (view: View, size: Size) => size.width / view.widthM;

export function worldToScreen(view: View, size: Size, p: WorldPoint): ScreenPoint {
  const s = scale(view, size);
  return { x: (p.xM - view.cx) * s + size.width / 2, y: size.height / 2 - (p.yM - view.cy) * s };
}

export function screenToWorld(view: View, size: Size, p: ScreenPoint): WorldPoint {
  const s = scale(view, size);
  return { xM: view.cx + (p.x - size.width / 2) / s, yM: view.cy - (p.y - size.height / 2) / s };
}

export function viewBounds(view: View, size: Size): Bounds {
  const halfW = view.widthM / 2;
  const halfH = (view.widthM * size.height) / size.width / 2;
  return { minX: view.cx - halfW, maxX: view.cx + halfW, minY: view.cy - halfH, maxY: view.cy + halfH };
}

/** Scales the view by factor while keeping the world point under the pointer fixed. */
export function zoomAt(view: View, size: Size, pointer: ScreenPoint, factor: number): View {
  const anchor = screenToWorld(view, size, pointer);
  const widthM = view.widthM * factor;
  const s = size.width / widthM;
  return { widthM, cx: anchor.xM - (pointer.x - size.width / 2) / s, cy: anchor.yM + (pointer.y - size.height / 2) / s };
}

export function fitView(size: Size, points: WorldPoint[], minWidthM = 200): View {
  const xs = points.map((p) => p.xM);
  const ys = points.map((p) => p.yM);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    widthM: Math.max(minWidthM, (maxX - minX) * 1.5, ((maxY - minY) * 1.5 * size.width) / size.height),
  };
}

/** Grid spacing on a 1/2/5 ladder giving roughly one line per 100 px. */
export function gridStep(widthM: number, pixels: number): number {
  const target = widthM / Math.max(1, Math.floor(pixels / 100));
  const base = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].find((n) => n * base >= target)! * base;
}

export const snapToGrid = (p: WorldPoint, step: number): WorldPoint => ({
  xM: Math.round(p.xM / step) * step + 0,
  yM: Math.round(p.yM / step) * step + 0,
});

/** Logarithmic slider: 0–10,000 spans 1 MHz–100 GHz, 2,000 steps per decade. */
export const FREQUENCY_SLIDER_MAX = 10_000;
export const frequencyFromSlider = (position: number) => 0.001 * 10 ** (position / 2000);
export const sliderFromFrequency = (ghz: number) => 2000 * Math.log10(ghz / 0.001);

export function formatFrequency(ghz: number): string {
  const value = ghz < 1 ? ghz * 1000 : ghz;
  return `${Number(value.toPrecision(9))} ${ghz < 1 ? 'MHz' : 'GHz'}`;
}

/** Accepts "433 MHz", "5.8 GHz" or a bare GHz number; anything else is NaN. */
export function parseFrequency(text: string): number {
  const match = text.trim().match(/^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mhz|ghz)?$/i);
  if (!match) return NaN;
  return Number(match[1]) / (match[2]?.toLowerCase() === 'mhz' ? 1000 : 1);
}

/**
 * Decorative packet speed: a smoothstep over log frequency, 100 px/s at 1 MHz to 500 px/s at
 * 100 GHz. A visual cue only; it does not represent propagation speed.
 */
export function signalSpeedPxPerSec(ghz: number): number {
  const f = Number.isFinite(ghz) && ghz > 0 ? Math.min(100, Math.max(0.001, ghz)) : 0.001;
  const t = Math.log10(f / 0.001) / 5;
  return 100 + 400 * t * t * (3 - 2 * t);
}
