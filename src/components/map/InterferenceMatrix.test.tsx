import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { freshDefaultState } from '../../data/defaults';
import { assessAll } from '../../lib/interference';
import { evaluatePairs } from '../../lib/sensors';
import { InterferenceMatrix } from './InterferenceMatrix';

function render(intended: boolean, power: number, unknown = false, interfered = false) {
  const state = freshDefaultState();
  const [tx, rx] = state.map.sensors;
  Object.assign(rx, { sensitivityDbm: -80, fadeMarginTargetDb: 10, interferenceThresholdDbm: -65 });
  state.map.useTerrainElevation = false;
  const pairs = evaluatePairs(state.map, state.inputs, () => 0).map(p => ({ ...p, intended, elevationKnown: !unknown, result: { ...p.result, receivedPowerDbm: power } }));
  const assessments = assessAll(state.map, pairs);
  if (interfered) assessments.get(rx.id)!.links[0].status = 'Interfered link';
  return { tx, rx, html: renderToStaticMarkup(<InterferenceMatrix sensors={state.map.sensors} pairs={pairs} assessments={assessments} onPin={() => undefined} />) };
}

describe('interference matrix', () => {
  it('renders a semantic table with transmitter rows and receiver columns', () => {
    const { tx, rx, html } = render(true, -60);
    expect(html).toContain('<table');
    expect(html).toContain(`scope="row">${tx.name}`);
    expect(html).toContain(`scope="col">${rx.name}`);
    expect(html).toContain('Interference matrix');
  });
  it('subtracts sensitivity and fade target from desired power and shows C/I warnings', () => {
    const { html } = render(true, -60, false, true);
    expect(html).toContain('10.00 dB C/I');
    expect(html).toContain('tone-danger');
    expect(html).toContain('desired link margin 10.00 dB; Interfered link');
  });
  it('uses protected margin and pair verdict rather than aggregate verdict in each cell', () => {
    const { html } = render(false, -67);
    expect(html).toContain('-1.00 dB');
    expect(html).toContain('protected margin -1.00 dB; Marginal interference');
    expect(html).toContain('tone-warning');
    expect(html).toContain('Total interference: -67.00 dBm');
  });
  it('treats exactly the protected limit as safe', () => {
    const { html } = render(false, -68);
    expect(html).toContain('protected margin 0.00 dB; Below interference threshold');
    expect(html).toContain('tone-safe');
  });
  it('marks unknown paths with a tooltip and incomplete footer', () => {
    const { html } = render(false, -67, true);
    expect(html).toContain('Elevation unavailable for this path');
    expect(html).toContain('>—</button>');
    expect(html).toContain('1 paths unknown');
    expect(html).not.toContain('-1.00 dB');
  });
});
