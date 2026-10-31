import type { Map, StyleSpecification } from 'maplibre-gl';
import style from '../../../public/styles/sirius-light.json';

export type Basemap = 'onemap' | 'plain' | 'light';
export const lightStyle = style as unknown as StyleSpecification;
export const lightSourceIds = Object.keys(lightStyle.sources).map(id => `light-${id}`);

/** Insert geometry below hillshade and labels above all WebGL RF overlays. Never replace the style. */
export function installLightBasemap(map: Map) {
  for (const [id, source] of Object.entries(lightStyle.sources)) {
    if (!map.getSource(`light-${id}`)) map.addSource(`light-${id}`, source);
  }
  for (const layer of lightStyle.layers) {
    const id = `light-${layer.id}`;
    if (map.getLayer(id)) continue;
    const copy = { ...layer, id, layout: { ...layer.layout, visibility: 'none' as const } };
    if ('source' in copy && typeof copy.source === 'string') copy.source = `light-${copy.source}`;
    map.addLayer(copy, layer.type === 'symbol' ? undefined : 'hillshade');
  }
}

export function showBasemap(map: Map, basemap: Basemap) {
  map.setLayoutProperty('onemap', 'visibility', basemap === 'onemap' ? 'visible' : 'none');
  for (const layer of lightStyle.layers) {
    if (map.getLayer(`light-${layer.id}`)) map.setLayoutProperty(`light-${layer.id}`, 'visibility', basemap === 'light' ? 'visible' : 'none');
  }
  map.setPaintProperty('hillshade', 'hillshade-exaggeration', basemap === 'light' ? 0.18 : 0.45);
  map.setPaintProperty('hillshade', 'hillshade-shadow-color', basemap === 'light' ? '#8A8278' : getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim());
  map.setPaintProperty('hillshade', 'hillshade-highlight-color', basemap === 'light' ? '#FFFFFF' : getComputedStyle(document.documentElement).getPropertyValue('--ink').trim());
}
