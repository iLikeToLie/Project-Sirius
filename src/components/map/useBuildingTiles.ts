import { useCallback, useMemo, useRef, useState } from 'react';
import { BUILDING_BOUNDS, BUILDING_TILE_URL, BUILDING_ZOOM, createBuildingSampler, type BuildingLookup, type BuildingTile } from '../../lib/buildings';
import { tilePixel } from '../../lib/elevation';
import type { LatLon } from '../../lib/geo';

export type BuildingStatus = 'idle' | 'loading' | 'ready' | 'offline';
const MAX_TILES_PER_REQUEST = 96;

function insideBounds(z: number, x: number, y: number) {
  const nw = tilePixel({ lat: BUILDING_BOUNDS.maxLat, lon: BUILDING_BOUNDS.minLon }, z);
  const se = tilePixel({ lat: BUILDING_BOUNDS.minLat, lon: BUILDING_BOUNDS.maxLon }, z);
  return x >= nw.x && x <= se.x && y >= nw.y && y <= se.y;
}

/** A 404 is a tile with no buildings: the build script writes only tiles that hold some. */
async function fetchTile(z: number, x: number, y: number): Promise<BuildingTile | 'empty'> {
  const response = await fetch(BUILDING_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
  if (response.status === 404) return 'empty';
  if (!response.ok) throw new Error(`Building tile ${z}/${x}/${y}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(256, 256);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D canvas for building decoding');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { z, x, y, data: context.getImageData(0, 0, 256, 256).data };
}

/**
 * Building-height tiles fetched on demand and cached for the session. Until a tile arrives its
 * buildings read as absent; `version` changes as tiles arrive so consumers recompute.
 */
export function useBuildingTiles() {
  const cache = useRef(new Map<string, BuildingTile | 'empty' | 'pending'>());
  const inFlight = useRef(0);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<BuildingStatus>('idle');

  const lookup: BuildingLookup = useCallback((z, x, y) => {
    const entry = cache.current.get(`${z}/${x}/${y}`);
    return entry === 'pending' ? undefined : entry;
  }, []);

  const load = useCallback((tiles: Iterable<string>) => {
    for (const key of tiles) {
      if (cache.current.has(key)) continue;
      const [z, x, y] = key.split('/').map(Number);
      if (!insideBounds(z, x, y)) { cache.current.set(key, 'empty'); continue; }
      cache.current.set(key, 'pending');
      inFlight.current += 1;
      setStatus((current) => (current === 'offline' ? current : 'loading'));
      fetchTile(z, x, y)
        .then((tile) => { cache.current.set(key, tile); if (tile !== 'empty') setVersion((v) => v + 1); })
        // A failed tile is retried on the next request rather than read as empty for the session.
        .catch(() => { cache.current.delete(key); setStatus('offline'); })
        .finally(() => {
          inFlight.current -= 1;
          if (inFlight.current === 0) setStatus((current) => (current === 'offline' ? current : 'ready'));
        });
    }
  }, []);

  /** Tiles along each segment (and under single points), at the source zoom. */
  const ensurePaths = useCallback((segments: [LatLon, LatLon][]) => {
    const keys = new Set<string>();
    for (const [a, b] of segments) {
      const pa = tilePixel(a, BUILDING_ZOOM), pb = tilePixel(b, BUILDING_ZOOM);
      const ax = pa.x * 256 + pa.px, ay = pa.y * 256 + pa.py, bx = pb.x * 256 + pb.px, by = pb.y * 256 + pb.py;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 64));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        keys.add(`${BUILDING_ZOOM}/${Math.floor((ax + (bx - ax) * t) / 256)}/${Math.floor((ay + (by - ay) * t) / 256)}`);
      }
    }
    load(keys);
  }, [load]);

  /** Every tile covering a lat/lon box at zoom z, skipped when it would exceed the request cap. */
  const ensureBox = useCallback((southWest: LatLon, northEast: LatLon, z: number) => {
    const a = tilePixel({ lat: northEast.lat, lon: southWest.lon }, z);
    const b = tilePixel({ lat: southWest.lat, lon: northEast.lon }, z);
    if ((b.x - a.x + 1) * (b.y - a.y + 1) > MAX_TILES_PER_REQUEST) return false;
    const keys: string[] = [];
    for (let x = a.x; x <= b.x; x += 1) for (let y = a.y; y <= b.y; y += 1) keys.push(`${z}/${x}/${y}`);
    load(keys);
    return true;
  }, [load]);

  // version is a dependency on purpose: a new function identity tells consumers tiles changed.
  const buildingAt = useMemo(() => createBuildingSampler(lookup, BUILDING_ZOOM), [lookup, version]);
  const samplerAt = useCallback((z: number) => createBuildingSampler(lookup, z), [lookup, version]);

  return { buildingAt, samplerAt, ensurePaths, ensureBox, version, status };
}

export type BuildingTiles = ReturnType<typeof useBuildingTiles>;
