import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoverageLegend } from './CoverageLegend';

it('offers layer selection and interference bands with the reference receiver and combination mode', () => {
  const html = renderToStaticMarkup(<CoverageLegend objective="avoidance" showAll={false} onShowAll={() => {}} terrain={false} coverageStyle="bands" onCoverageStyle={() => {}} coverageLayer="interference" onCoverageLayer={() => {}} referenceName="R1" aggregate />);
  for (const label of ['Range', 'Interference', 'Placement', 'Total interference at R1', '(aggregate)', 'Protected margin', 'Coverage style']) expect(html).toContain(label);
  expect(html).not.toContain('Show all bands');
  expect(html).toMatch(/disabled[^>]*>Placement/);
});

it('enables Placement for a selected transmitter and explains categories, membership and reciprocity', () => {
  const html = renderToStaticMarkup(<CoverageLegend objective="avoidance" showAll={false} onShowAll={() => {}} terrain={true} coverageStyle="gradient" onCoverageStyle={() => {}} coverageLayer="placement" onCoverageLayer={() => {}} placementName="T1" victimNames={['R2']} servedNames={['R1']} />);
  for (const label of ['Placement for T1', 'Victims: R2', 'Served: R1', 'Recommended', 'Safe', 'Marginal', 'Unsafe', 'Unknown', 'reciprocal', 'approximation']) expect(html).toContain(label);
  expect(html).not.toMatch(/disabled[^>]*>Placement/);
  expect(html).not.toContain('Show all bands');
  expect(html).not.toContain('Coverage style');
});
