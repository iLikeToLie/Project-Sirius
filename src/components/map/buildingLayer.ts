import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { BUILDING_BOUNDS, BUILDING_TILE_URL, decodeBuildingDm } from '../../lib/buildings';

export const BUILDING_ATTRIBUTION = 'Buildings © OpenStreetMap contributors, Overture Maps Foundation (ODbL); HDB heights NUS Urban Analytics Lab';
const PROTOCOL = 'sirius-buildings';
let registered = false;

/** Height to a blue-grey shade, lighter as buildings rise; estimated heights are fainter. */
function shade(heightM: number, kind: number): [number, number, number, number] {
  const t = Math.min(1, Math.log1p(heightM) / Math.log1p(200));
  return [Math.round(70 + 150 * t), Math.round(85 + 140 * t), Math.round(120 + 120 * t), kind === 3 ? 110 : 190];
}

let blank: Promise<ArrayBuffer> | null = null;
/** A clear tile for places with no buildings (the build script writes no file there). */
const transparent = () => (blank ??= new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/png' }).then((b) => b.arrayBuffer()));

/** Serves the height tiles recoloured for display; the model reads the raw tiles itself. */
function register() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(PROTOCOL, async (params, abort) => {
    const path = params.url.replace(`${PROTOCOL}://`, '');
    const response = await fetch(BUILDING_TILE_URL.replace('{z}/{x}/{y}', path), { signal: abort.signal });
    if (response.status === 404) return { data: await transparent() };
    if (!response.ok) throw new Error(`Building tile ${path}: HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(256, 256);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, 256, 256), px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      const h = decodeBuildingDm(px[i], px[i + 1]) / 10;
      const [r, g, b, a] = h > 0 ? shade(h, px[i + 2]) : [0, 0, 0, 0];
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
    context.putImageData(image, 0, 0);
    return { data: await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

/** Shows or hides the building footprint layer, under the coverage image. */
export function showBuildings(map: MapLibreMap, visible: boolean) {
  if (!visible && !map.getLayer('buildings')) return;
  if (!map.getSource('buildings')) {
    register();
    map.addSource('buildings', { type: 'raster', tiles: [`${PROTOCOL}://{z}/{x}/{y}`], tileSize: 256, minzoom: 13, maxzoom: 15,
      bounds: [BUILDING_BOUNDS.minLon, BUILDING_BOUNDS.minLat, BUILDING_BOUNDS.maxLon, BUILDING_BOUNDS.maxLat], attribution: BUILDING_ATTRIBUTION });
    map.addLayer({ id: 'buildings', type: 'raster', source: 'buildings', minzoom: 13, paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } },
      map.getLayer('zones') ? 'zones' : 'zone-outlines');
  }
  map.setLayoutProperty('buildings', 'visibility', visible ? 'visible' : 'none');
}
