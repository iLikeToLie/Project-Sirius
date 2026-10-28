import type { LinkObjective } from '../../types';
import { signalColour } from '../../lib/signalColour';

export type CoverageStyle = 'gradient' | 'bands';

export function CoverageLegend({ objective, showAll, onShowAll, terrain, range, coverageStyle, onCoverageStyle }: { objective: LinkObjective; showAll: boolean; onShowAll: (show: boolean) => void; terrain: boolean; range?: { lo: number; hi: number }; coverageStyle: CoverageStyle; onCoverageStyle: (style: CoverageStyle) => void }) {
  const stops = range ? Array.from({ length: 12 }, (_, i) => { const [r, g, b] = signalColour(range.lo + (range.hi - range.lo) * (i / 11), range.lo, range.hi); return `rgb(${r} ${g} ${b})`; }).join(', ') : '';
  return <aside className="coverage-legend" aria-label="Coverage legend" title={terrain ? 'Grey hatching marks ground with no elevation data.' : 'Dashed rings are free-space reference ranges; grey hatching marks ground with no elevation data.'}>
    <div className="legend-head"><b>{terrain ? 'Terrain coverage' : 'Free-space zones'}</b><span>{objective === 'desired' ? 'Desired' : 'Avoidance'}</span></div>
    {terrain && (
      <div className="segmented coverage-style" role="group" aria-label="Coverage style">
        {(['gradient', 'bands'] as const).map((style) => (
          <button key={style} type="button" className={coverageStyle === style ? 'active' : ''} aria-pressed={coverageStyle === style} onClick={() => onCoverageStyle(style)}>
            {style === 'gradient' ? 'Gradient' : 'Bands'}
          </button>
        ))}
      </div>
    )}
    {range
      ? <div className="signal-scale"><i style={{ background: `linear-gradient(to right, ${stops})` }} /><span><em>{Math.round(range.lo)} dBm</em><em>{Math.round(range.hi)} dBm</em></span></div>
      : <span className="legend-swatches"><i className="swatch swatch-acceptable" /> Required <i className="swatch swatch-weak" /> Sensitivity <i className="swatch swatch-interference" /> Interference</span>}
    <label className="legend-check"><input type="checkbox" checked={showAll} onChange={e => onShowAll(e.target.checked)} /> Show all bands</label>
  </aside>;
}
