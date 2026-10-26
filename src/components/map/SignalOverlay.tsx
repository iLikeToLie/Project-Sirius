import { useEffect, useRef } from 'react';
import type { Map } from 'maplibre-gl';
import { signalSpeedPxPerSec } from '../../lib/viewport';
import type { MapLink } from './SensorMap';

export function SignalOverlay({ map, links, frequencyGhz }: { map: Map; links: MapLink[]; frequencyGhz: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!, context = canvas.getContext('2d')!;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const colours = getComputedStyle(document.documentElement);
    const tokens: Record<string, string> = { good: '--green', warning: '--yellow', danger: '--red', safe: '--blue', neutral: '--mute' };
    let visible = true, inView = false;
    const render = () => {
      const { width, height } = map.getContainer().getBoundingClientRect();
      const scale = devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) { canvas.width = width * scale; canvas.height = height * scale; }
      context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, width, height);
      inView = false;
      if (!visible || document.hidden) return;
      const phase = motion.matches ? 0 : performance.now() / 1000 * signalSpeedPxPerSec(frequencyGhz);
      let packets = 0;
      for (const link of links) {
        if (link.kind !== 'intended') continue;
        const a = map.project([link.from.lon, link.from.lat]), b = map.project([link.to.lon, link.to.lat]);
        if (Math.max(a.x, b.x) < 0 || Math.min(a.x, b.x) > width || Math.max(a.y, b.y) < 0 || Math.min(a.y, b.y) > height) continue;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 1) continue;
        inView = true;
        context.fillStyle = colours.getPropertyValue(tokens[link.tone] ?? '--mute').trim();
        for (let d = phase % 60; d < length; d += 60) { context.beginPath(); context.arc(a.x + (b.x - a.x) * d / length, a.y + (b.y - a.y) * d / length, 3, 0, 2 * Math.PI); context.fill(); packets++; }
      }
      canvas.dataset.packets = String(packets);
      canvas.dataset.animating = String(inView && !motion.matches && visible && !document.hidden);
      if (inView && !motion.matches) map.triggerRepaint();
    };
    const wake = () => { render(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; wake(); });
    observer.observe(canvas); map.on('render', render); document.addEventListener('visibilitychange', wake); motion.addEventListener('change', wake); render();
    return () => { observer.disconnect(); map.off('render', render); document.removeEventListener('visibilitychange', wake); motion.removeEventListener('change', wake); };
  }, [map, links, frequencyGhz]);
  return <canvas ref={canvasRef} className="signal-overlay" aria-hidden="true" />;
}
