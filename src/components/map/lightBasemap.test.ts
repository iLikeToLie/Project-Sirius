import { describe, it, expect, vi, afterEach } from 'vitest';
import { lightStyle, installLightBasemap, showBasemap } from './lightBasemap';

describe('Light basemap', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is a valid flat style with hosted fonts and legible labels', () => {
    expect(lightStyle.version).toBe(8);
    expect(lightStyle.glyphs).toContain('https://tiles.openfreemap.org/');
    expect(lightStyle.layers.some(l => l.type === 'fill-extrusion')).toBe(false);
    expect(lightStyle.layers.some(l => l.id.startsWith('poi'))).toBe(false);
  });
  it('adds once, preserves overlays and places labels above them through repeated switches', () => {
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#FFFFFF' }));
    const layers: any[] = [{id:'background'}, {id:'onemap'}, {id:'hillshade'}, {id:'zones'}, {id:'links-intended'}];
    const sources = new Map();
    const map: any = {
      getSource: (id: string) => sources.get(id), addSource: (id: string, s: unknown) => sources.set(id,s),
      getLayer: (id: string) => layers.find(l=>l.id===id),
      addLayer: (l: any, before?: string) => layers.splice(before ? layers.findIndex(x=>x.id===before) : layers.length,0,l),
      setLayoutProperty: (id: string, key: string, value: string) => { const l=layers.find(l=>l.id===id); l.layout={...l.layout,[key]:value}; },
      setPaintProperty: () => {},
    };
    for(let i=0;i<5;i++) { installLightBasemap(map); for(const base of ['light','onemap','plain'] as const) showBasemap(map,base); }
    showBasemap(map,'light');
    expect(new Set(layers.map(l=>l.id)).size).toBe(layers.length);
    expect(layers.findIndex(l=>l.id==='light-water')).toBeLessThan(layers.findIndex(l=>l.id==='hillshade'));
    expect(layers.findIndex(l=>l.id==='light-label_city')).toBeGreaterThan(layers.findIndex(l=>l.id==='links-intended'));
    expect(layers.find(l=>l.id==='onemap').layout.visibility).toBe('none');
    expect(layers.find(l=>l.id==='zones')).toBeDefined();
  });
});
