import { sampleGrid, type ScalarGrid } from './contours';

/**
 * Ground grid for the terrain coverage rays. The rays start at the transmitter, so the grid must
 * contain it: when the transmitter is outside the visible map (zoomed in or panned away) the view
 * grid alone has no ground under it and every radial would read as unknown. Returns the view grid
 * unchanged when it already contains the transmitter; otherwise a grid over the view plus the
 * transmitter, no finer than the view grid and no larger than `maxCols` columns or rows.
 */
export function groundForCoverage(
  view: ScalarGrid,
  tx: { xM: number; yM: number },
  sample: (xM: number, yM: number) => number,
  maxCols = 480,
): ScalarGrid {
  const maxX = view.x0 + view.cols * view.dx;
  const maxY = view.y0 + view.rows * view.dy;
  if (tx.xM >= view.x0 && tx.xM <= maxX && tx.yM >= view.y0 && tx.yM <= maxY) return view;
  const pad = 2 * Math.max(view.dx, view.dy);
  const bounds = {
    minX: Math.min(view.x0, tx.xM - pad), maxX: Math.max(maxX, tx.xM + pad),
    minY: Math.min(view.y0, tx.yM - pad), maxY: Math.max(maxY, tx.yM + pad),
  };
  const cell = Math.max(view.dx, view.dy, (bounds.maxX - bounds.minX) / maxCols, (bounds.maxY - bounds.minY) / maxCols);
  return sampleGrid(bounds, Math.ceil((bounds.maxX - bounds.minX) / cell), Math.ceil((bounds.maxY - bounds.minY) / cell), sample);
}
