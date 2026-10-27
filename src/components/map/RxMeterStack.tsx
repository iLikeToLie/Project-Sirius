import { formatNumber } from '../../lib/rf';
import { meterScale, type PairResult } from '../../lib/sensors';
import type { LinkInputs, LinkObjective } from '../../types';

export function RxMeterStack({ links, inputs, objective }: { links: PairResult[]; inputs: LinkInputs; objective: LinkObjective }) {
  const { scaleMin, scaleMax } = meterScale(links, inputs);
  const referenceDbm = objective === 'desired' ? inputs.sensitivityDbm + inputs.fadeMarginTargetDb : inputs.interferenceThresholdDbm;
  const referenceTitle = objective === 'desired' ? `Required receive level: sensitivity + ${inputs.fadeMarginTargetDb} dB fade margin` : `Interference threshold ${referenceDbm} dBm`;
  const position = (value: number) => Math.max(0, Math.min(100, (value - scaleMin) / (scaleMax - scaleMin) * 100));

  if (!links.length) return <p className="field-note">{objective === 'avoidance' ? 'Avoidance: no transmitter' : 'No desired transmitter'}</p>;

  return <div className="rx-meter-stack" aria-label={objective === 'desired' ? 'Desired link Rx meters' : 'Interference Rx meter'}>
    {links.map((link) => {
      const known = link.elevationKnown && Number.isFinite(link.result.receivedPowerDbm);
      return <div className="power-meter" key={link.txId} aria-label={`Rx power from ${link.txName}`}>
        <div className="meter-title"><span>{link.txName}</span><b>{known ? `${formatNumber(link.result.receivedPowerDbm)} dBm` : 'Unknown'}</b></div>
        <div className="meter-track" role="img" aria-label={known ? `${link.txName}: ${formatNumber(link.result.receivedPowerDbm)} dBm; sensitivity ${inputs.sensitivityDbm} dBm; ${objective === 'desired' ? 'required level' : 'interference threshold'} ${referenceDbm} dBm` : `${link.txName}: received power unknown`}>
          {known && <><span className="meter-fill" style={{ width: `${position(link.result.receivedPowerDbm)}%` }} /><span className="meter-needle" style={{ left: `${position(link.result.receivedPowerDbm)}%` }} /></>}
          <span className="meter-marker sensitivity-marker" style={{ left: `${position(inputs.sensitivityDbm)}%` }} title={`Sensitivity ${inputs.sensitivityDbm} dBm`} />
          <span className={`meter-marker ${objective === 'desired' ? 'required-marker' : 'threshold-marker'}`} style={{ left: `${position(referenceDbm)}%` }} title={referenceTitle} />
        </div>
        <div className="meter-scale"><span>{scaleMin} dBm</span><span>{scaleMax} dBm</span></div>
        <div className="threshold-key"><span className="sensitivity-key">Sensitivity <b>{formatNumber(inputs.sensitivityDbm)} dBm</b></span><span className={objective === 'desired' ? 'required-key' : 'threshold-key-item'} title={referenceTitle}>{objective === 'desired' ? 'Required level' : 'Interference'} <b>{formatNumber(referenceDbm)} dBm</b></span></div>
        {!link.elevationKnown && <p className="field-note" role="status">Elevation unavailable for this path; terrain prediction is unknown.</p>}
      </div>;
    })}
  </div>;
}
