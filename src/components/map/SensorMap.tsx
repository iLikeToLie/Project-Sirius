import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ELEVATION_TILE_URL } from '../../lib/elevation';
import { type LatLon, SG_REFERENCE } from '../../lib/geo';
import { signalColour } from '../../lib/signalColour';
import { PLACEMENT } from '../../lib/interference';
import { ZONE, type ZoneResult } from '../../lib/zones';
import type { Sensor } from '../../types';
import { lightStyle, lightSourceIds, installLightBasemap, showBasemap, type Basemap } from './lightBasemap';
export type { Basemap } from './lightBasemap';
import { SignalOverlay } from './SignalOverlay';
import { showBuildings } from './buildingLayer';
import { placeLabels } from './markerLabels';
import type { LinkObjective } from '../../types';
import { SG_BOUNDS } from './SelectedSensorCard';

export const ONEMAP_TILE_URL = 'https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png';
const ONEMAP_ATTRIBUTION = '©OneMap Singapore ODL v1.0';
const ELEVATION_ATTRIBUTION = '©JAXA, ALOS World 3D-30m (AW3D30)';
// Pan margin beyond Singapore (about 33 km), so a setup near the coast can still be centred in view.
const PAD = 0.3;

export interface MapLink { from: LatLon; to: LatLon; kind: 'intended' | 'interference'; tone: string; emphasis: boolean; label?: string }
export interface MapZones {
  result: ZoneResult;
  totalInterference?: boolean;
  placement?: boolean;
  /** Grid corners: north-west, north-east, south-east, south-west. */
  corners: [LatLon, LatLon, LatLon, LatLon];
  objective?: LinkObjective;
  showAll?: boolean;
  /** dBm span of the signal gradient; set for terrain coverage. */
  range?: { lo: number; hi: number };
  outlines: { sensitivity: LatLon[][]; required: LatLon[][]; interference: LatLon[][] };
}
export interface MapView { southWest: LatLon; northEast: LatLon; center: LatLon; width: number; height: number; zoom: number }
export interface SensorMapHandle { fitSensors(): void; zoomBy(delta: number): void }

const RADIO_TOWER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9M7.8 4.7a6.14 6.14 0 0 0-.8 7.5M16.2 4.8c2 2 2.26 5.11.8 7.47M19.1 1.9a9.96 9.96 0 0 1 0 14.1M9.5 18h5m-6.5 4 4-11 4 11"/><circle cx="12" cy="9" r="2"/></svg>';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const rgb = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** All segments of one outline as a single feature: far fewer features for MapLibre to tile than one per segment. */
const outlineFeature = (lines: LatLon[][], props: Record<string, unknown>) => ({
  type: 'Feature' as const, properties: props, geometry: { type: 'MultiLineString' as const, coordinates: lines.map((line) => line.map((p) => [p.lon, p.lat])) },
});

type ZoneImage = { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] };
/** `sent` is the image MapLibre is loading, `shown` the last one it finished; both are object URLs to revoke once replaced. */
interface ZoneImageQueue { loading: boolean; next: ZoneImage | null; timer: number; sent: string | null; shown: string | null }
/** MapLibre does not always report the end of an image update; never let one missed event pin an old layer on screen. */
const ZONE_IMAGE_TIMEOUT_MS = 400;

function pushZoneImage(queue: ZoneImageQueue, source: ImageSource, image: ZoneImage) {
  queue.loading = true;
  queue.sent = image.url;
  window.clearTimeout(queue.timer);
  queue.timer = window.setTimeout(() => settleZoneImage(queue, source), ZONE_IMAGE_TIMEOUT_MS);
  source.updateImage(image);
}

/** Marks the in-flight image as finished and sends the newest queued one, if any. */
function settleZoneImage(queue: ZoneImageQueue, source: ImageSource | undefined) {
  window.clearTimeout(queue.timer);
  queue.loading = false;
  if (queue.sent) {
    if (queue.shown && queue.shown !== queue.sent) URL.revokeObjectURL(queue.shown);
    queue.shown = queue.sent;
    queue.sent = null;
  }
  const next = queue.next;
  queue.next = null;
  if (next && source) pushZoneImage(queue, source, next);
}

/** Drops every pending and shown image, releasing their object URLs. */
function clearZoneImages(queue: ZoneImageQueue) {
  window.clearTimeout(queue.timer);
  for (const url of [queue.next?.url, queue.sent, queue.shown]) if (url) URL.revokeObjectURL(url);
  Object.assign(queue, { loading: false, next: null, sent: null, shown: null });
}

/** Placement "Safe" fill; the legend's .swatch-safe uses the same colour. */
const PLACEMENT_SAFE_RGB = [163, 217, 165];

/** Paints zone classes into an image, north row first (grid row 0 is the south edge). Resolves to an object URL. */
function paintZones(result: ZoneResult, objective: LinkObjective = 'desired', showAll = false, range?: { lo: number; hi: number }, totalInterference = false, placement = false): Promise<string> {
  const width = result.cols + 1;
  const height = result.rows + 1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  // Style lookups are slow; read each token once per paint, never per pixel.
  const [green, yellow, red, mute] = [rgb(token('--green')), rgb(token('--yellow')), rgb(token('--red')), rgb(token('--mute'))];
  const clear = [0, 0, 0, 0], hatch = [...mute, 130], hatchFaint = [...mute, 35];
  const acceptable = [...green, 58], weak = [...yellow, 46], interfered = [...red, 54];
  const recommended = [...green, 95], safe = [...PLACEMENT_SAFE_RGB, 95];
  for (let j = 0; j <= result.rows; j += 1) {
    for (let i = 0; i <= result.cols; i += 1) {
      const node = j * width + i;
      const pixel = ((result.rows - j) * width + i) * 4;
      const cls = result.classes[node];
      const gradient = !placement && range && result.powerDbm && cls !== ZONE.unknown ? signalColour(result.powerDbm[node], range.lo, range.hi) : null;
      const colour = gradient ?? (cls === ZONE.unknown ? (i + j) % 6 < 2 ? hatch : hatchFaint
        : placement ? cls === PLACEMENT.recommended ? recommended : cls === PLACEMENT.safe ? safe : cls === PLACEMENT.marginal ? weak : interfered
        : totalInterference ? result.interference[node] ? interfered : cls === ZONE.weak ? weak : clear : (objective === 'avoidance' || showAll) && result.interference[node] ? interfered : (objective === 'desired' || showAll) && cls === ZONE.acceptable ? acceptable : (objective === 'desired' || showAll) && cls === ZONE.weak ? weak : clear);
      image.data.set(colour, pixel);
    }
  }
  context.putImageData(image, 0, 0);
  // toBlob encodes off the main thread, unlike toDataURL.
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL())));
}

export function SensorMap({ sensors, selectedId, tones, links, zones, rings, basemap, buildings = false, onBasemapFallback, frequencyGhz, handleRef, onSelect, onDrag, onDragEnd, onNudge, onView }: {
  sensors: Sensor[];
  selectedId: string | null;
  tones: Record<string, string>;
  links: MapLink[];
  zones: MapZones | null;
  rings: { id: string; points: LatLon[]; label: string }[];
  basemap: Basemap;
  /** Shade building footprints by height (when the model uses them). */
  buildings?: boolean;
  onBasemapFallback: () => void;
  frequencyGhz: number;
  handleRef: React.MutableRefObject<SensorMapHandle | null>;
  onSelect: (id: string) => void;
  onDrag: (id: string, at: LatLon) => void;
  onDragEnd: (id: string, at: LatLon) => void;
  onNudge: (id: string, dxM: number, dyM: number) => void;
  onView: (view: MapView) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; element: HTMLDivElement; baseClass: string }>());
  const dragging = useRef<string | null>(null);
  const callbacks = useRef({ onSelect, onDrag, onDragEnd, onNudge, onView, onBasemapFallback });
  callbacks.current = { onSelect, onDrag, onDragEnd, onNudge, onView, onBasemapFallback };
  const sensorsRef = useRef(sensors);
  sensorsRef.current = sensors;
  const [loaded, setLoaded] = useState(false);
  // MapLibre aborts (and logs) an image still loading when updateImage is called again,
  // so zone images are applied one at a time and only the newest waiting one is kept.
  const zoneImage = useRef<ZoneImageQueue>({ loading: false, next: null, timer: 0, sent: null, shown: null });
  // Painting resolves asynchronously; only the newest paint may reach the map.
  const zonePaint = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const map = new maplibregl.Map({
      container,
      center: [SG_REFERENCE.lon, SG_REFERENCE.lat],
      zoom: 14,
      minZoom: 10.5,
      maxZoom: 19,
      maxBounds: [[SG_BOUNDS.minLon - PAD, SG_BOUNDS.minLat - PAD], [SG_BOUNDS.maxLon + PAD, SG_BOUNDS.maxLat + PAD]],
      attributionControl: { compact: false },
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: reduceMotion ? 0 : 300,
      style: {
        version: 8,
        glyphs: lightStyle.glyphs,
        sources: {
          onemap: { type: 'raster', tiles: [ONEMAP_TILE_URL], tileSize: 256, minzoom: 11, maxzoom: 19, bounds: [SG_BOUNDS.minLon, SG_BOUNDS.minLat, SG_BOUNDS.maxLon, SG_BOUNDS.maxLat], attribution: ONEMAP_ATTRIBUTION },
          dem: { type: 'raster-dem', tiles: [ELEVATION_TILE_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 14, bounds: [103.596, 1.1443, 104.4309, 1.4835], attribution: ELEVATION_ATTRIBUTION },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': token('--canvas') } },
          { id: 'onemap', type: 'raster', source: 'onemap', paint: { 'raster-brightness-max': 0.92 } },
          { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': token('--canvas'), 'hillshade-highlight-color': token('--ink') } },
        ],
      },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    const reportView = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      callbacks.current.onView({
        southWest: { lat: b.getSouth(), lon: b.getWest() },
        northEast: { lat: b.getNorth(), lon: b.getEast() },
        center: { lat: c.lat, lon: c.lng },
        width: container.clientWidth,
        height: container.clientHeight,
        zoom: map.getZoom(),
      });
    };
    map.on('load', () => {
      const line = { 'line-cap': 'round' as const, 'line-join': 'round' as const };
      map.addSource('zone-outlines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'zone-outlines', type: 'line', source: 'zone-outlines', layout: line, paint: {
        'line-width': 1.5, 'line-opacity': ['case', ['get', 'faint'], 0.25, 0.9],
        // Each edge takes its band's colour: the sensitivity, protected-margin and safe bands are all yellow.
        'line-color': ['match', ['get', 'id'], 'sensitivity', token('--yellow'), 'required', token('--green'), token('--red')],
      } });
      map.addLayer({ id: 'links-intended', type: 'line', source: 'links', filter: ['==', ['get', 'kind'], 'intended'], layout: line, paint: {
        'line-width': ['case', ['get', 'emphasis'], 3, 2],
        'line-opacity': ['case', ['get', 'emphasis'], 1, 0.5],
        'line-color': ['match', ['get', 'tone'], 'good', token('--green'), 'warning', token('--yellow'), 'danger', token('--red'), 'safe', token('--blue'), token('--mute')],
      } });
      map.addLayer({ id: 'links-interference', type: 'line', source: 'links', filter: ['==', ['get', 'kind'], 'interference'], layout: line, paint: {
        'line-width': ['case', ['get', 'emphasis'], 2, 1.25], 'line-dasharray': [2, 2], 'line-color': ['match', ['get', 'tone'], 'warning', token('--yellow'), token('--red')],
        'line-opacity': ['case', ['get', 'emphasis'], 0.95, 0.45],
      } });
      map.addSource('range-rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'range-rings', type: 'line', source: 'range-rings', paint: { 'line-width': 1.5, 'line-dasharray': [4, 3], 'line-color': ['match', ['get', 'id'], 'required', token('--green'), 'interference', token('--red'), token('--blue')] } });
      map.addSource('range-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      setLoaded(true);
      reportView();
    });
    map.on('sourcedata', (event) => {
      if (event.sourceId !== 'zones' || !event.isSourceLoaded) return;
      settleZoneImage(zoneImage.current, map.getSource('zones') as ImageSource | undefined);
    });
    map.on('moveend', reportView);
    map.on('resize', reportView);
    mapRef.current = map;
    handleRef.current = {
      fitSensors() {
        const list = sensorsRef.current;
        if (!list.length) return;
        const bounds = new maplibregl.LngLatBounds();
        for (const s of list) bounds.extend([s.lon, s.lat]);
        // Leave room for the floating cards only where they float over the map; otherwise the padding can exceed the canvas and the fit is refused.
        const overlaid = container.clientWidth > 1000 && !container.closest('.panels-hidden');
        const padding = overlaid ? { top: 110, bottom: 70, left: 320, right: 420 } : 48;
        map.fitBounds(bounds, { padding, maxZoom: 16, duration: reduceMotion ? 0 : 400 });
      },
      zoomBy(delta) { map.easeTo({ zoom: map.getZoom() + delta, duration: reduceMotion ? 0 : 250 }); },
    };
    return () => {
      for (const { marker } of markers.current.values()) marker.remove();
      markers.current.clear();
      clearZoneImages(zoneImage.current);
      map.remove();
      mapRef.current = null;
      handleRef.current = null;
    };
  }, [handleRef]);

  // Markers: created once per sensor and updated in place; a marker being dragged keeps its own position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = new Set(sensors.map((s) => s.id));
    for (const [id, { marker }] of markers.current) if (!live.has(id)) { marker.remove(); markers.current.delete(id); }
    for (const sensor of sensors) {
      let entry = markers.current.get(sensor.id);
      if (!entry) {
        const element = document.createElement('div');
        element.tabIndex = 0;
        element.setAttribute('role', 'button');
        element.innerHTML = `${RADIO_TOWER}<span class="sensor-marker-label"></span>`;
        const marker = new maplibregl.Marker({ element, draggable: true, anchor: 'center' }).setLngLat([sensor.lon, sensor.lat]).addTo(map);
        const id = sensor.id;
        element.addEventListener('click', () => callbacks.current.onSelect(id));
        element.addEventListener('keydown', (event) => {
          const step = event.shiftKey ? 10 : 1;
          const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[event.key];
          // The map's own keyboard handler listens on the same container; keep these keys from panning it.
          if (delta) { event.preventDefault(); event.stopPropagation(); callbacks.current.onNudge(id, delta[0], delta[1]); }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); callbacks.current.onSelect(id); }
        });
        marker.on('dragstart', () => { dragging.current = id; callbacks.current.onSelect(id); });
        marker.on('drag', () => { const p = marker.getLngLat(); callbacks.current.onDrag(id, { lat: p.lat, lon: p.lng }); });
        marker.on('dragend', () => { dragging.current = null; const p = marker.getLngLat(); callbacks.current.onDragEnd(id, { lat: p.lat, lon: p.lng }); });
        // MapLibre's own marker classes position the element; ours are added alongside them.
        entry = { marker, element, baseClass: element.className };
        markers.current.set(sensor.id, entry);
      }
      if (dragging.current !== sensor.id) entry.marker.setLngLat([sensor.lon, sensor.lat]);
      const tone = tones[sensor.id] ?? 'neutral';
      entry.element.className = `${entry.baseClass} sensor-marker role-${sensor.role} tone-${tone}${sensor.id === selectedId ? ' selected' : ''}`;
      entry.element.setAttribute('aria-label', `${sensor.role === 'tx' ? 'Transmitter' : 'Receiver'} ${sensor.name}. Arrow keys move 1 m, Shift with arrows 10 m.`);
      entry.element.setAttribute('aria-pressed', String(sensor.id === selectedId));
      entry.element.querySelector('.sensor-marker-label')!.textContent = sensor.name;
    }
  }, [sensors, selectedId, tones, loaded]);

  // Marker labels: each label sits on the side of its marker with the least collision against neighbours (markers do not move).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const items = sensors.flatMap((s) => {
        const entry = markers.current.get(s.id);
        const label = entry?.element.querySelector<HTMLElement>('.sensor-marker-label');
        if (!entry || !label) return [];
        const p = map.project(entry.marker.getLngLat());
        return [{ id: s.id, x: p.x, y: p.y, width: label.offsetWidth }];
      });
      const sides = placeLabels(items);
      for (const [id, side] of sides) { const el = markers.current.get(id)?.element; if (el && el.dataset.label !== side) el.dataset.label = side; }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    map.on('move', schedule);
    return () => { map.off('move', schedule); if (frame) cancelAnimationFrame(frame); };
  }, [sensors, loaded]);

  useEffect(() => {
    const source = mapRef.current?.getSource('links') as GeoJSONSource | undefined;
    if (!loaded || !source) return;
    source.setData({
      type: 'FeatureCollection',
      features: links.map((l) => ({ type: 'Feature', properties: { kind: l.kind, tone: l.tone, emphasis: l.emphasis }, geometry: { type: 'LineString', coordinates: [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] } })),
    });
  }, [links, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const outlines = map.getSource('zone-outlines') as GeoJSONSource | undefined;
    outlines?.setData({
      type: 'FeatureCollection',
      features: zones && !zones.range ? (['sensitivity', 'required', 'interference'] as const).filter((id) => zones.outlines[id].length).map((id) => outlineFeature(zones.outlines[id], { id, faint: !zones.showAll && !zones.totalInterference && !zones.placement && zones.objective === 'avoidance' && id !== 'interference' })) : [],
    });
    const queue = zoneImage.current;
    const paint = ++zonePaint.current;
    if (!zones) {
      clearZoneImages(queue);
      if (map.getSource('zones')) { map.removeLayer('zones'); map.removeSource('zones'); }
      return;
    }
    const coordinates = zones.corners.map((p) => [p.lon, p.lat]) as [[number, number], [number, number], [number, number], [number, number]];
    void paintZones(zones.result, zones.objective, zones.showAll, zones.range, zones.totalInterference, zones.placement).then((url) => {
      if (paint !== zonePaint.current || mapRef.current !== map) { URL.revokeObjectURL(url); return; }
      const existing = map.getSource('zones') as ImageSource | undefined;
      if (existing) {
        if (queue.loading) { if (queue.next) URL.revokeObjectURL(queue.next.url); queue.next = { url, coordinates }; }
        else pushZoneImage(queue, existing, { url, coordinates });
      } else {
        clearZoneImages(queue);
        queue.loading = true;
        queue.sent = url;
        queue.timer = window.setTimeout(() => settleZoneImage(queue, map.getSource('zones') as ImageSource | undefined), ZONE_IMAGE_TIMEOUT_MS);
        map.addSource('zones', { type: 'image', url, coordinates });
        map.addLayer({ id: 'zones', type: 'raster', source: 'zones', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }, 'zone-outlines');
      }
    });
  }, [zones, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    (map.getSource('range-rings') as GeoJSONSource).setData({ type: 'FeatureCollection', features: rings.map(r => outlineFeature([r.points], { id: r.id })) });
    const labels = rings.map(r => {
      const el = document.createElement('span'); el.className = `range-ring-label ring-${r.id}`; el.textContent = r.label;
      return new maplibregl.Marker({ element: el }).setLngLat([r.points[0].lon, r.points[0].lat]).addTo(map);
    });
    return () => labels.forEach(m => m.remove());
  }, [rings, loaded]);

  // Distance labels at the midpoint of each labelled link; keyed on text and position so unrelated renders keep them.
  const linkLabels = links.filter((l) => l.label).map((l) => ({ text: l.label!, lon: (l.from.lon + l.to.lon) / 2, lat: (l.from.lat + l.to.lat) / 2, faint: !l.emphasis }));
  const linkLabelKey = linkLabels.map((l) => `${l.lon.toFixed(6)},${l.lat.toFixed(6)},${l.text},${l.faint}`).join(';');
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return undefined;
    const markers = linkLabels.map((l) => {
      const el = document.createElement('span'); el.className = `link-distance-label${l.faint ? ' faint' : ''}`; el.textContent = l.text;
      return new maplibregl.Marker({ element: el, offset: [0, -14] }).setLngLat([l.lon, l.lat]).addTo(map);
    });
    return () => markers.forEach((m) => m.remove());
  }, [linkLabelKey, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    let failures = 0;
    let fallbackSent = false;
    const fallback = () => {
      if (fallbackSent) return;
      fallbackSent = true;
      showBasemap(map, 'onemap');
      callbacks.current.onBasemapFallback();
    };
    const onError = (event: { sourceId?: string }) => {
      if (event.sourceId && lightSourceIds.includes(event.sourceId) && ++failures >= 3) fallback();
    };
    if (basemap === 'light') {
      map.on('error', onError);
      installLightBasemap(map);
    }
    showBasemap(map, basemap);
    // A failed TileJSON request can emit only one error. Also cover stalled tile requests.
    const timeout = basemap === 'light' ? window.setTimeout(() => {
      if (lightSourceIds.some(id => !map.isSourceLoaded(id))) fallback();
    }, 15000) : undefined;
    return () => { map.off('error', onError); window.clearTimeout(timeout); };
  }, [basemap, loaded]);
  useEffect(() => {
    const map = mapRef.current;
    if (loaded && map) showBuildings(map, buildings);
  }, [buildings, loaded]);
  return <><div ref={containerRef} className="map-canvas" />{loaded && mapRef.current && <SignalOverlay map={mapRef.current} links={links} frequencyGhz={frequencyGhz} />}</>;
}
