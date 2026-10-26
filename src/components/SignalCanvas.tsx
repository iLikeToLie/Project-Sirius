import { useEffect, useRef } from 'react';
import { signalSpeedPxPerSec } from '../lib/viewport';
import type { ScreenPoint } from '../lib/viewport';

const PACKET_SPACING_PX = 64;

/**
 * Decorative wave packets from Tx to Rx in the current status colour. The animation frame only
 * advances travel and paints; geometry arrives through refs and no RF or terrain work runs here.
 * Stops when hidden or off screen; reduced motion shows static packets.
 */
export function SignalCanvas({ from, to, frequencyGhz, visible }: { from: ScreenPoint; to: ScreenPoint; frequencyGhz: number; visible: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometry = useRef({ from, to, visible, speed: signalSpeedPxPerSec(frequencyGhz) });
  const paintRef = useRef<() => void>(() => {});
  const cache = useRef({ width: 0, height: 0, color: '' });
  geometry.current = { from, to, visible, speed: signalSpeedPxPerSec(frequencyGhz) };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = 0;
    let travel = 0;
    let inView = true;

    const paint = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const { width, height, color } = cache.current;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const g = geometry.current;
      const dx = g.to.x - g.from.x;
      const dy = g.to.y - g.from.y;
      const length = Math.hypot(dx, dy);
      if (!g.visible || length < 56) return;
      const ux = dx / length;
      const uy = dy / length;
      context.strokeStyle = color;
      context.lineCap = 'round';
      for (let d = (travel % PACKET_SPACING_PX) + 28; d < length - 28; d += PACKET_SPACING_PX) {
        const x = g.from.x + ux * d;
        const y = g.from.y + uy * d;
        const fade = Math.min(1, (d - 28) / 40, (length - 28 - d) / 40);
        context.globalAlpha = 0.85 * Math.max(0, fade);
        context.lineWidth = 2;
        for (const radius of [5, 9]) {
          context.beginPath();
          context.arc(x, y, radius, Math.atan2(uy, ux) - 0.7, Math.atan2(uy, ux) + 0.7);
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      travel += geometry.current.speed * dt;
      paint();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
    const sync = () => {
      stop();
      paint();
      if (!document.hidden && inView && !reducedMotion.matches) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
    observer.observe(canvas);
    const resize = new ResizeObserver(([entry]) => {
      cache.current.width = entry.contentRect.width;
      cache.current.height = entry.contentRect.height;
      paint();
    });
    resize.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    paintRef.current = paint;
    sync();
    return () => {
      stop();
      observer.disconnect();
      resize.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
    };
  }, []);

  // Colour follows the status class; read once per React render, never per animation frame.
  // Static frames (reduced motion, paused) still follow the endpoints.
  useEffect(() => {
    if (canvasRef.current) cache.current.color = getComputedStyle(canvasRef.current).color;
    paintRef.current();
  });

  return <canvas ref={canvasRef} className="signal-canvas" aria-hidden="true" />;
}
