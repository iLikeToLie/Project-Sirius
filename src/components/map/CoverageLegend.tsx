import type { LinkObjective } from '../../types';
import { signalColour } from '../../lib/signalColour';

export type CoverageStyle = 'gradient' | 'bands';
export type CoverageLayer = 'range' | 'interference' | 'placement';

export function CoverageLegend({ objective, showAll, onShowAll, terrain, range, coverageStyle, onCoverageStyle, coverageLayer, onCoverageLayer, referenceName, aggregate }: { objective: LinkObjective; showAll: boolean; onShowAll: (show: boolean) => void; terrain: boolean; range?: { lo: number; hi: number }; coverageStyle: CoverageStyle; onCoverageStyle: (style: CoverageStyle) => void; coverageLayer: CoverageLayer; onCoverageLayer: (layer: CoverageLayer) => void; referenceName?: string; aggregate?: boolean }) {
  const total = coverageLayer === 'interference';
  const stops = range ? Array.from({ length: 12 }, (_, i) => { const [r, g, b] = signalColour(range.lo + (range.hi - range.lo) * (i / 11), range.lo, range.hi); return `rgb(${r} ${g} ${b})`; }).join(', ') : '';
  return <aside className="coverage-legend" aria-label="Coverage legend" title={total || terrain ? 'Grey hatching marks unknown paths or ground with no elevation data.' : 'Dashed rings are free-space reference ranges; grey hatching marks ground with no elevation data.'}>
    <div className="segmented coverage-layers" role="group" aria-label="Coverage layer">
      {(['range', 'interference', 'placement'] as const).map(layer => <button key={layer} type="button" className={coverageLayer === layer ? 'active' : ''} aria-pressed={coverageLayer === layer} disabled={layer === 'placement'} title={layer === 'placement' ? 'Placement layer coming next' : undefined} onClick={() => onCoverageLayer(layer)}>{layer === 'range' ? 'Range' : layer === 'interference' ? 'Interference' : 'Placement'}</button>)}
    </div>
    <div className="legend-head"><b>{total ? referenceName ? `Total interference at ${referenceName}'s settings (${aggregate ? 'aggregate' : 'worst single'})` : 'Add a receiver to show total interference' : terrain ? 'Terrain coverage' : 'Free-space zones'}</b>{!total && <span>{objective === 'desired' ? 'Desired' : 'Avoidance'}</span>}</div>
    {(terrain || total) && (
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
      : total ? <span className="legend-swatches"><i className="swatch swatch-weak" /> Protected margin <i className="swatch swatch-interference" /> Interference</span> : <span className="legend-swatches"><i className="swatch swatch-acceptable" /> Required <i className="swatch swatch-weak" /> Sensitivity <i className="swatch swatch-interference" /> Interference</span>}
    {!total && <label className="legend-check"><input type="checkbox" checked={showAll} onChange={e => onShowAll(e.target.checked)} /> Show all bands</label>}
  </aside>;
}
