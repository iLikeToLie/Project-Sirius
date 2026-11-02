import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoverageLegend } from './CoverageLegend';

it('offers layer selection and interference bands with the reference receiver and combination mode', () => {
  const html = renderToStaticMarkup(<CoverageLegend objective="avoidance" showAll={false} onShowAll={() => {}} terrain={false} coverageStyle="bands" onCoverageStyle={() => {}} coverageLayer="interference" onCoverageLayer={() => {}} referenceName="R1" aggregate />);
  for (const label of ['Range', 'Interference', 'Placement', 'Total interference at R1', '(aggregate)', 'Protected margin', 'Coverage style']) expect(html).toContain(label);
  expect(html).not.toContain('Show all bands');
  expect(html).toMatch(/disabled[^>]*>Placement/);
});
