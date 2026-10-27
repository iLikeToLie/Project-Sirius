export function encodeTerrarium(m) {
  if (!Number.isFinite(m) || m < -32768 || m >= 32768) throw new Error(`Invalid elevation: ${m}`);
  const v = Math.round((m + 32768) * 256);
  return [Math.floor(v / 65536), Math.floor(v / 256) % 256, v % 256];
}

// AW3D30 MSK lower two bits identify sea (3); cloud/gap-filled pixels retain their DSM height.
export function mosaicSample(tiles, lat, lon) {
  const base = tiles.find(t => lon >= t.west && lon < t.west + t.width * t.cellSize && lat <= t.north && lat > t.north - t.height * t.cellSize);
  if (!base) throw new Error(`Missing DEM at ${lat}, ${lon}`);
  const x = (lon - base.west) / base.cellSize - 0.5;
  const y = (base.north - lat) / base.cellSize - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y);
  const sample = (i, j) => {
    const plon = base.west + (i + 0.5) * base.cellSize;
    const plat = base.north - (j + 0.5) * base.cellSize;
    const t = tiles.find(t => plon >= t.west && plon < t.west + t.width * t.cellSize && plat <= t.north && plat > t.north - t.height * t.cellSize) ?? base;
    const col = Math.max(0, Math.min(t.width - 1, Math.floor((plon - t.west) / t.cellSize)));
    const row = Math.max(0, Math.min(t.height - 1, Math.floor((t.north - plat) / t.cellSize)));
    const k = row * t.width + col;
    if ((t.mask[k] & 3) === 3) return 0;
    if (t.dsm[k] === -9999) throw new Error(`Unfilled DEM pixel at ${plat}, ${plon}`);
    return t.dsm[k];
  };
  const a = x - ix, b = y - iy;
  return (sample(ix, iy) * (1 - a) + sample(ix + 1, iy) * a) * (1 - b) + (sample(ix, iy + 1) * (1 - a) + sample(ix + 1, iy + 1) * a) * b;
}
