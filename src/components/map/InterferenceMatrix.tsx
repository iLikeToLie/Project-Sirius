import type { Sensor } from '../../types';
import type { LinkPin } from '../../lib/activeLink';
import { pairVerdict, sumDbm, type ReceiverAssessment } from '../../lib/interference';
import { formatNumber } from '../../lib/rf';
import type { PairResult } from '../../lib/sensors';
import { statusTone } from '../ui';

/** Pair margins use the same assessments as the map; totals remain receiver-level. */
export function InterferenceMatrix({ sensors, pairs, assessments, onPin }: {
  sensors: Sensor[];
  pairs: PairResult[];
  assessments: Map<string, ReceiverAssessment>;
  onPin: (pin: LinkPin) => void;
}) {
  const transmitters = sensors.filter(s => s.role === 'tx');
  const receivers = sensors.filter(s => s.role === 'rx');
  return (
    <div className="interference-matrix">
      <table>
        <caption>Interference matrix — desired: fade-adjusted link margin; interferer: protected margin. Select a cell to inspect its link budget.</caption>
        <thead><tr><th scope="col">Transmitter / Receiver</th>{receivers.map(rx => <th key={rx.id} scope="col">{rx.name}</th>)}</tr></thead>
        <tbody>{transmitters.map(tx => (
          <tr key={tx.id}><th scope="row">{tx.name}</th>{receivers.map(rx => {
            const pair = pairs.find(p => p.txId === tx.id && p.rxId === rx.id);
            const assessment = assessments.get(rx.id);
            const known = pair?.elevationKnown && pair.result.valid && Number.isFinite(pair.result.receivedPowerDbm) && assessment;
            const status = known ? pair.intended
              ? assessment.links.find(l => l.txId === tx.id)?.status ?? pair.result.status
              : pairVerdict(pair, rx, assessment.marginDb) : 'Invalid input';
            const margin = known ? pair.intended
              ? pair.result.receivedPowerDbm - (rx.sensitivityDbm + rx.fadeMarginTargetDb)
              : assessment.limitDbm - pair.result.receivedPowerDbm : NaN;
            const explanation = !pair ? 'Pair unavailable' : !pair.elevationKnown ? 'Elevation unavailable for this path' : 'Prediction unavailable for this path';
            const label = `${tx.name} to ${rx.name}: ${known ? `${pair.intended ? 'desired link' : 'protected'} margin ${formatNumber(margin, 2)} dB; ${status}` : explanation}. Open link budget.`;
            return <td key={rx.id}><button type="button" className={`matrix-cell tone-${statusTone(status)}`} aria-label={label} title={known ? label : explanation} disabled={!pair} onClick={() => onPin({ txId: tx.id, rxId: rx.id })}>
              {known ? `${formatNumber(margin, 2)} dB${status === 'Interfered link' ? ' C/I' : ''}` : '—'}
            </button></td>;
          })}</tr>
        ))}</tbody>
        <tfoot><tr><th scope="row">Receiver assessment</th>{receivers.map(rx => {
          const a = assessments.get(rx.id);
          return <td key={rx.id}>{a ? <>
            <span className={`tone-${statusTone(a.status)}`}>{a.status}</span>
            <span>Total interference: {a.contributors.length ? `${formatNumber(sumDbm(a.contributors.map(c => c.powerDbm)), 2)} dBm` : 'No known interferers'}</span>
            {!a.aggregate && <span>Assessment uses worst single: {a.contributors.length ? `${formatNumber(a.interferenceDbm, 2)} dBm` : 'none'}</span>}
            {a.unknownPaths > 0 && <span>{a.unknownPaths} paths unknown; excluded from total.</span>}
          </> : 'Assessment unavailable'}</td>;
        })}</tr></tfoot>
      </table>
    </div>
  );
}

