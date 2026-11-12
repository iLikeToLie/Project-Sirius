import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGroundSampler, elevationRetryDelayMs, ELEVATION_TILE_URL, ELEVATION_ZOOM, tilePixel, type ElevationTile, type GroundAt, type TileLookup } from '../../lib/elevation';
import type { LatLon } from '../../lib/geo';

export type ElevationStatus = 'idle' | 'loading' | 'ready' | 'offline';
const MAX_TILES_PER_REQUEST = 64;
// Extent of the bundled AW3D30 tiles (public/dem/manifest.json). The map can pan beyond it; no tiles exist there.
const DEM_BOUNDS = { minLon: 103.596, minLat: 1.1443, maxLon: 104.4309, maxLat: 1.4835 };

/** A tile the server has no data for (outside the DEM or not generated): unknown ground, not an outage. */
class MissingTile extends Error {}

function insideDem(z: number, x: number, y: number) {
  const nw = tilePixel({ lat: DEM_BOUNDS.maxLat, lon: DEM_BOUNDS.minLon }, z);
  const se = tilePixel({ lat: DEM_BOUNDS.minLat, lon: DEM_BOUNDS.maxLon }, z);
  return x >= nw.x && x <= se.x && y >= nw.y && y <= se.y;
}

async function fetchTile(z: number, x: number, y: number): Promise<ElevationTile> {
  const url = ELEVATION_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const response = await fetch(url);
  if (response.status === 404) throw new MissingTile(`Elevation tile ${z}/${x}/${y}: no data`);
  if (!response.ok) throw new Error(`Elevation tile ${z}/${x}/${y}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(256, 256);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D canvas for elevation decoding');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { z, x, y, data: context.getImageData(0, 0, 256, 256).data };
}

/**
 * Terrarium elevation tiles fetched on demand and cached for the session. `version` changes as
 * tiles arrive so consumers recompute; a missing tile reads as unknown ground (null).
 */
export function useElevationTiles() {
  const cache = useRef(new Map<string, ElevationTile | 'pending' | 'failed'>());
  const inFlight = useRef(0);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<ElevationStatus>('idle');

  const lookup: TileLookup = useCallback((z, x, y) => {
    const entry = cache.current.get(`${z}/${x}/${y}`);
    return typeof entry === 'object' ? entry : undefined;
  }, []);

  // Tiles that failed for network reasons are retried with backoff; `inFlight` counts them while they wait.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const networkFailures = useRef(new Set<string>());
  useEffect(() => { const pending = timers.current; return () => { pending.forEach(clearTimeout); pending.clear(); }; }, []);

  const settle = useCallback(() => {
    inFlight.current -= 1;
    if (inFlight.current === 0) setStatus(networkFailures.current.size ? 'offline' : 'ready');
  }, []);

  const fetchWithRetry = useCallback((z: number, x: number, y: number, key: string, failures: number) => {
    fetchTile(z, x, y)
      .then((tile) => { cache.current.set(key, tile); networkFailures.current.delete(key); setVersion((v) => v + 1); settle(); })
      .catch((error) => {
        const delay = error instanceof MissingTile ? null : elevationRetryDelayMs(failures + 1);
        if (delay === null) {
          cache.current.set(key, 'failed');
          if (!(error instanceof MissingTile)) networkFailures.current.add(key);
          settle();
          return;
        }
        // Stay pending (and in flight) while waiting, so nothing re-requests the tile meanwhile.
        const timer = setTimeout(() => { timers.current.delete(timer); fetchWithRetry(z, x, y, key, failures + 1); }, delay);
        timers.current.add(timer);
      });
  }, [settle]);

  const load = useCallback((tiles: [number, number, number][]) => {
    for (const [z, x, y] of tiles) {
      const key = `${z}/${x}/${y}`;
      if (cache.current.has(key)) continue;
      if (!insideDem(z, x, y)) { cache.current.set(key, 'failed'); continue; }
      cache.current.set(key, 'pending');
      inFlight.current += 1;
      setStatus('loading');
      fetchWithRetry(z, x, y, key, 0);
    }
  }, [fetchWithRetry]);

  /** Tiles under each point plus the neighbours bilinear sampling may reach across an edge. */
  const ensure = useCallback((points: LatLon[], z = ELEVATION_ZOOM) => {
    const tiles: [number, number, number][] = [];
    for (const p of points) {
      const { x, y, px, py } = tilePixel(p, z);
      for (const dx of px < 1 ? [-1, 0] : px > 255 ? [0, 1] : [0]) {
        for (const dy of py < 1 ? [-1, 0] : py > 255 ? [0, 1] : [0]) tiles.push([z, x + dx, y + dy]);
      }
    }
    load(tiles);
  }, [load]);

  /** Every tile covering a lat/lon box at zoom z, skipped when it would exceed the request cap. */
  const ensureBox = useCallback((southWest: LatLon, northEast: LatLon, z: number) => {
    const a = tilePixel({ lat: northEast.lat, lon: southWest.lon }, z);
    const b = tilePixel({ lat: southWest.lat, lon: northEast.lon }, z);
    if ((b.x - a.x + 1) * (b.y - a.y + 1) > MAX_TILES_PER_REQUEST) return;
    const tiles: [number, number, number][] = [];
    for (let x = a.x; x <= b.x; x += 1) for (let y = a.y; y <= b.y; y += 1) tiles.push([z, x, y]);
    load(tiles);
  }, [load]);

  // version is a dependency on purpose: a new function identity tells consumers tiles changed.
  const groundAt: GroundAt = useMemo(() => createGroundSampler(lookup, ELEVATION_ZOOM), [lookup, version]);
  const samplerAt = useCallback((z: number) => createGroundSampler(lookup, z), [lookup, version]);

  return { groundAt, samplerAt, ensure, ensureBox, version, status };
}
