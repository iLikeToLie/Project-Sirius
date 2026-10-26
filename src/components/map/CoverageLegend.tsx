import type { LinkObjective } from '../../types';
import { signalColour } from '../../lib/signalColour';

export function CoverageLegend({ objective, showAll, onShowAll, terrain, range }: { objective: LinkObjective; showAll: boolean; onShowAll: (show: boolean) => void; terrain: boolean; range?: { lo: number; hi: number } }) {
  const stops = range ? Array.from({ length: 12 }, (_, i) => { const [r, g, b] = signalColour(range.lo + (range.hi - range.lo) * (i / 11), range.lo, range.hi); return `rgb(${r} ${g} ${b})`; }).join(', ') : '';
  return <aside className="coverage-legend" aria-label="Coverage legend">
    <b>{terrain ? 'Terrain coverage' : 'Free-space zones'} · {objective === 'desired' ? 'Desired' : 'Avoidance'}</b>
    {range
      ? <div className="signal-scale"><i style={{ background: `linear-gradient(to right, ${stops})` }} /><span><em>{Math.round(range.lo)} dBm</em><em>{Math.round(range.hi)} dBm</em></span></div>
      : <span><i className="swatch swatch-acceptable" /> Required <i className="swatch swatch-weak" /> Sensitivity <i className="swatch swatch-interference" /> Interference</span>}
    <span>Dashed rings: free-space reference · Grey hatch: unknown</span>
    <label><input type="checkbox" checked={showAll} onChange={e => onShowAll(e.target.checked)} /> Show all bands</label>
  </aside>;
}
