import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ELEVATION_TILE_URL } from '../../lib/elevation';
import { type LatLon, SG_REFERENCE } from '../../lib/geo';
import { ZONE, type ZoneResult } from '../../lib/zones';
import type { Sensor } from '../../types';
import { SG_BOUNDS } from './SelectedSensorCard';

export const ONEMAP_TILE_URL = 'https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png';
const ONEMAP_ATTRIBUTION = '©OneMap Singapore ODL v1.0';
const ELEVATION_ATTRIBUTION = 'Elevation: Terrain Tiles on AWS (Mapzen; SRTM, GMTED, ETOPO1)';
const PAD = 0.05;

export interface MapLink { from: LatLon; to: LatLon; kind: 'intended' | 'interference'; tone: string; emphasis: boolean }
export interface MapZones {
  result: ZoneResult;
  /** Grid corners: north-west, north-east, south-east, south-west. */
  corners: [LatLon, LatLon, LatLon, LatLon];
  outlines: { sensitivity: LatLon[][]; required: LatLon[][]; interference: LatLon[][] };
}
export interface MapView { southWest: LatLon; northEast: LatLon; center: LatLon; width: number; height: number; zoom: number }
export interface SensorMapHandle { fitSensors(): void; zoomBy(delta: number): void }

const RADIO_TOWER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9M7.8 4.7a6.14 6.14 0 0 0-.8 7.5M16.2 4.8c2 2 2.26 5.11.8 7.47M19.1 1.9a9.96 9.96 0 0 1 0 14.1M9.5 18h5m-6.5 4 4-11 4 11"/><circle cx="12" cy="9" r="2"/></svg>';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const rgb = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lineFeatures = (lines: LatLon[][], props: Record<string, unknown>) => lines.map((line) => ({
  type: 'Feature' as const, properties: props, geometry: { type: 'LineString' as const, coordinates: line.map((p) => [p.lon, p.lat]) },
}));

/** Paints zone classes into an image, north row first (grid row 0 is the south edge). */
function paintZones(result: ZoneResult): string {
  const width = result.cols + 1;
  const height = result.rows + 1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  const [green, yellow, red] = [rgb(token('--green')), rgb(token('--yellow')), rgb(token('--red'))];
  for (let j = 0; j <= result.rows; j += 1) {
    for (let i = 0; i <= result.cols; i += 1) {
      const node = j * width + i;
      const pixel = ((result.rows - j) * width + i) * 4;
      const cls = result.classes[node];
      const colour = result.interference[node] ? [...red, 54] : cls === ZONE.acceptable ? [...green, 58] : cls === ZONE.weak ? [...yellow, 46] : [0, 0, 0, 0];
      image.data.set(colour, pixel);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export function SensorMap({ sensors, selectedId, tones, links, zones, handleRef, onSelect, onDrag, onDragEnd, onNudge, onView }: {
  sensors: Sensor[];
  selectedId: string | null;
  tones: Record<string, string>;
  links: MapLink[];
  zones: MapZones | null;
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
  const callbacks = useRef({ onSelect, onDrag, onDragEnd, onNudge, onView });
  callbacks.current = { onSelect, onDrag, onDragEnd, onNudge, onView };
  const sensorsRef = useRef(sensors);
  sensorsRef.current = sensors;
  const [loaded, setLoaded] = useState(false);
  // MapLibre aborts (and logs) an image still loading when updateImage is called again,
  // so zone images are applied one at a time and only the newest waiting one is kept.
  const zoneImage = useRef<{ loading: boolean; next: { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } | null }>({ loading: false, next: null });

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
        sources: {
          onemap: { type: 'raster', tiles: [ONEMAP_TILE_URL], tileSize: 256, minzoom: 11, maxzoom: 19, bounds: [SG_BOUNDS.minLon, SG_BOUNDS.minLat, SG_BOUNDS.maxLon, SG_BOUNDS.maxLat], attribution: ONEMAP_ATTRIBUTION },
          dem: { type: 'raster-dem', tiles: [ELEVATION_TILE_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: ELEVATION_ATTRIBUTION },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': token('--canvas') } },
          { id: 'onemap', type: 'raster', source: 'onemap', paint: { 'raster-brightness-max': 0.92 } },
          { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': token('--canvas'), 'hillshade-highlight-color': token('--ink') } },
        ],
      },
    });
    map.touchZoomRotate.disableRotation();
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
        'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.9,
        'line-color': ['match', ['get', 'id'], 'sensitivity', token('--blue'), 'required', token('--green'), token('--red')],
      } });
      map.addLayer({ id: 'links-intended', type: 'line', source: 'links', filter: ['==', ['get', 'kind'], 'intended'], layout: line, paint: {
        'line-width': ['case', ['get', 'emphasis'], 3, 2],
        'line-opacity': ['case', ['get', 'emphasis'], 1, 0.5],
        'line-color': ['match', ['get', 'tone'], 'good', token('--green'), 'warning', token('--yellow'), 'danger', token('--red'), 'safe', token('--blue'), token('--mute')],
      } });
      map.addLayer({ id: 'links-interference', type: 'line', source: 'links', filter: ['==', ['get', 'kind'], 'interference'], layout: line, paint: {
        'line-width': ['case', ['get', 'emphasis'], 2, 1.25], 'line-dasharray': [2, 2], 'line-color': token('--red'),
        'line-opacity': ['case', ['get', 'emphasis'], 0.95, 0.45],
      } });
      setLoaded(true);
      reportView();
    });
    map.on('sourcedata', (event) => {
      if (event.sourceId !== 'zones' || !event.isSourceLoaded) return;
      const queue = zoneImage.current;
      queue.loading = false;
      const next = queue.next;
      queue.next = null;
      const source = map.getSource('zones') as ImageSource | undefined;
      if (next && source) { queue.loading = true; source.updateImage(next); }
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
        map.fitBounds(bounds, { padding: { top: 110, bottom: 70, left: 320, right: 420 }, maxZoom: 16, duration: reduceMotion ? 0 : 400 });
      },
      zoomBy(delta) { map.easeTo({ zoom: map.getZoom() + delta, duration: reduceMotion ? 0 : 250 }); },
    };
    return () => {
      for (const { marker } of markers.current.values()) marker.remove();
      markers.current.clear();
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
          if (delta) { event.preventDefault(); callbacks.current.onNudge(id, delta[0], delta[1]); }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacks.current.onSelect(id); }
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
      features: zones ? (['sensitivity', 'required', 'interference'] as const).flatMap((id) => lineFeatures(zones.outlines[id], { id })) : [],
    });
    const existing = map.getSource('zones') as ImageSource | undefined;
    const queue = zoneImage.current;
    if (!zones) {
      queue.next = null;
      queue.loading = false;
      if (existing) { map.removeLayer('zones'); map.removeSource('zones'); }
      return;
    }
    const coordinates = zones.corners.map((p) => [p.lon, p.lat]) as [[number, number], [number, number], [number, number], [number, number]];
    const url = paintZones(zones.result);
    if (existing) {
      if (queue.loading) queue.next = { url, coordinates };
      else { queue.loading = true; existing.updateImage({ url, coordinates }); }
    } else {
      queue.loading = true;
      map.addSource('zones', { type: 'image', url, coordinates });
      map.addLayer({ id: 'zones', type: 'raster', source: 'zones', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }, 'zone-outlines');
    }
  }, [zones, loaded]);

  return <div ref={containerRef} className="map-canvas" />;
}
