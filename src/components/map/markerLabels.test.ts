import { expect, it } from 'vitest';
import { placeLabels } from './markerLabels';

it('keeps labels below when markers are far apart', () => {
  const sides = placeLabels([{ id: 'a', x: 100, y: 100, width: 80 }, { id: 'b', x: 400, y: 300, width: 80 }]);
  expect([...sides.values()]).toEqual(['below', 'below']);
});

it('moves labels of side-by-side markers so they do not collide', () => {
  const sides = placeLabels([{ id: 'a', x: 100, y: 100, width: 90 }, { id: 'b', x: 150, y: 100, width: 90 }]);
  expect(sides.get('a')).toBe('below');
  expect(sides.get('b')).not.toBe('below');
});

it('avoids a neighbour sitting under the marker', () => {
  const sides = placeLabels([{ id: 'a', x: 100, y: 100, width: 80 }, { id: 'b', x: 100, y: 150, width: 80 }]);
  expect(sides.get('a')).not.toBe('below');
});
