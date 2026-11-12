export type LabelSide = 'below' | 'above' | 'right' | 'left';

export interface LabelItem { id: string; x: number; y: number; width: number }

const MARKER = 40;
const LABEL_H = 20;
const GAP = 4;
const ORDER: LabelSide[] = ['below', 'above', 'right', 'left'];

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const markerBox = (i: LabelItem): Box => ({ x0: i.x - MARKER / 2, y0: i.y - MARKER / 2, x1: i.x + MARKER / 2, y1: i.y + MARKER / 2 });

/** Screen box of a label placed on one side of its marker (marker centre at x, y). */
export function labelBox(item: LabelItem, side: LabelSide): Box {
  const { x, y, width } = item;
  const h = MARKER / 2 + GAP;
  if (side === 'below') return { x0: x - width / 2, y0: y + h, x1: x + width / 2, y1: y + h + LABEL_H };
  if (side === 'above') return { x0: x - width / 2, y0: y - h - LABEL_H, x1: x + width / 2, y1: y - h };
  if (side === 'right') return { x0: x + h + 2, y0: y - LABEL_H / 2, x1: x + h + 2 + width, y1: y + LABEL_H / 2 };
  return { x0: x - h - 2 - width, y0: y - LABEL_H / 2, x1: x - h - 2, y1: y + LABEL_H / 2 };
}

/**
 * Picks the side of each marker on which its label collides least with other markers and already placed labels.
 * Markers keep their positions; only the label moves. Ties keep the preferred order (below, above, right, left).
 */
export function placeLabels(items: LabelItem[]): Map<string, LabelSide> {
  const result = new Map<string, LabelSide>();
  const placed: Box[] = [];
  const sorted = [...items].sort((a, b) => a.id < b.id ? -1 : 1);
  for (const item of sorted) {
    const obstacles = [...sorted.filter(o => o.id !== item.id).map(markerBox), ...placed];
    let best: LabelSide = 'below';
    let bestScore = Infinity;
    for (const side of ORDER) {
      const box = labelBox(item, side);
      const score = obstacles.reduce((n, o) => n + (overlaps(box, o) ? 1 : 0), 0);
      if (score < bestScore) { best = side; bestScore = score; }
      if (score === 0) break;
    }
    result.set(item.id, best);
    placed.push(labelBox(item, best));
  }
  return result;
}
