import type { LinkObjective } from '../../types';
export function CoverageLegend({ objective, showAll, onShowAll, terrain }: { objective: LinkObjective; showAll: boolean; onShowAll: (show: boolean) => void; terrain: boolean }) {
  return <aside className="coverage-legend" aria-label="Coverage legend">
    <b>{terrain ? 'Terrain coverage' : 'Free-space zones'} · {objective === 'desired' ? 'Desired' : 'Avoidance'}</b>
    <span><i className="swatch swatch-acceptable" /> Required <i className="swatch swatch-weak" /> Sensitivity <i className="swatch swatch-interference" /> Interference</span>
    <span>Dashed rings: free-space reference · Grey hatch: unknown</span>
    <label><input type="checkbox" checked={showAll} onChange={e => onShowAll(e.target.checked)} /> Show all bands</label>
  </aside>;
}
