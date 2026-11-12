import { memo } from 'react';
import { formatNumber } from '../../lib/rf';
import { meterScale, type PairResult } from '../../lib/sensors';
import type { LinkInputs, LinkObjective } from '../../types';
import type { ReceiverAssessment } from '../../lib/interference';

/** The Rx power meter: one bar per link on a shared -95..-55 dBm scale (wider only when a level falls outside it). */
export const RxMeterStack = memo(function RxMeterStack({ links, inputs, objective, assessment }: { links: PairResult[]; inputs: LinkInputs; objective: LinkObjective; assessment: ReceiverAssessment }) {
  const rows = objective === 'avoidance' && assessment.aggregate ? [...links, {
    ...links[0], txId: 'total-interference', txName: 'Total interference',
    elevationKnown: assessment.contributors.length > 0,
    result: { ...links[0]?.result, receivedPowerDbm: assessment.interferenceDbm },
  } as PairResult] : links;
  const { scaleMin, scaleMax } = meterScale(rows, inputs, objective === 'avoidance' ? [assessment.limitDbm] : []);
  const referenceDbm = objective === 'desired' ? inputs.sensitivityDbm + inputs.fadeMarginTargetDb : inputs.interferenceThresholdDbm;
  const referenceTitle = objective === 'desired' ? `Required receive level: sensitivity + ${inputs.fadeMarginTargetDb} dB fade margin` : `Interference threshold ${referenceDbm} dBm`;
  const position = (value: number) => Math.max(0, Math.min(100, (value - scaleMin) / (scaleMax - scaleMin) * 100));

  if (!links.length) return <p className="field-note">{objective === 'avoidance' ? 'Avoidance: no transmitter' : 'No desired transmitter'}</p>;

  return <div className="rx-meter-stack" aria-label={objective === 'desired' ? 'Desired link Rx meters' : 'Interference Rx meter'}>
    {rows.map((link) => {
      const known = link.elevationKnown && Number.isFinite(link.result.receivedPowerDbm);
      return <div className="power-meter" key={link.txId} aria-label={`Rx power from ${link.txName}`}>
        <div className="meter-title"><span>{link.txName}</span><b>{known ? `${formatNumber(link.result.receivedPowerDbm)} dBm` : 'Unknown'}</b></div>
        <div className="meter-track" role="img" aria-label={known ? `${link.txName}: ${formatNumber(link.result.receivedPowerDbm)} dBm; sensitivity ${inputs.sensitivityDbm} dBm; ${objective === 'desired' ? `required level ${referenceDbm} dBm; interference threshold ${inputs.interferenceThresholdDbm}` : `interference threshold ${referenceDbm}`} dBm` : `${link.txName}: received power unknown`}>
          {known && <><span className="meter-fill" style={{ width: `${position(link.result.receivedPowerDbm)}%` }} /><span className="meter-needle" style={{ left: `${position(link.result.receivedPowerDbm)}%` }} /></>}
          <span className="meter-marker sensitivity-marker" style={{ left: `${position(inputs.sensitivityDbm)}%` }} title={`Sensitivity ${inputs.sensitivityDbm} dBm`} />
          <span className={`meter-marker ${objective === 'desired' ? 'required-marker' : 'threshold-marker'}`} style={{ left: `${position(referenceDbm)}%` }} title={referenceTitle} />
          {objective === 'desired' && <span className="meter-marker threshold-marker" style={{ left: `${position(inputs.interferenceThresholdDbm)}%` }} title={`Interference threshold ${inputs.interferenceThresholdDbm} dBm`} />}
          {objective === 'avoidance' && <span className="meter-marker protected-marker" style={{ left: `${position(assessment.limitDbm)}%` }} title={`Protected limit ${formatNumber(assessment.limitDbm)} dBm`} />}
        </div>
        <div className="meter-scale"><span>{scaleMin} dBm</span><span>{scaleMax} dBm</span></div>
        <div className="threshold-key"><span className="sensitivity-key">Sensitivity <b>{formatNumber(inputs.sensitivityDbm)} dBm</b></span><span className={objective === 'desired' ? 'required-key' : 'threshold-key-item'} title={referenceTitle}>{objective === 'desired' ? 'Required level' : 'Interference'} <b>{formatNumber(referenceDbm)} dBm</b></span>{objective === 'desired' && <span className="threshold-key-item">Interference <b>{formatNumber(inputs.interferenceThresholdDbm)} dBm</b></span>}</div>
        {objective === 'avoidance' && <p className="protected-key">Protected limit <b>{formatNumber(assessment.limitDbm)} dBm</b></p>}
        {!link.elevationKnown && <p className="field-note" role="status">Elevation unavailable for this path; terrain prediction is unknown.</p>}
      </div>;
    })}
    {assessment.unknownPaths > 0 && <p className="field-note" role="status">{assessment.unknownPaths} paths unknown; excluded from interference assessment.</p>}
  </div>;
});
