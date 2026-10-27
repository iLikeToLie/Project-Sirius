import { useMemo, useState } from 'react';
import { activePair, type LinkPin } from '../../lib/activeLink';
import type { GroundAt } from '../../lib/elevation';
import { calculateLink, formatNumber } from '../../lib/rf';
import { effectiveObjective, evaluatePairs, groundOf, pairInputs, pairPropagation, receiverSummary, separationM } from '../../lib/sensors';
import type { AppState, LinkInputs } from '../../types';
import { CommitField, Metric, NumberField, StatusBadge, statusTone } from '../ui';
import { PathProfileChart } from './PathProfileChart';
import { RxMeterStack } from './RxMeterStack';

const TEXT_LABELS = { scenarioName: 'Scenario or link name', txId: 'Tx location / identifier', rxId: 'Rx location / identifier' } as const;

/** The Calculator's inputs, results and Rx meter for the active link, writing back through `onEdit`. */
export function LinkBudgetDrawer({ state, groundAt, onEdit, pin, onPin }: {
  state: AppState;
  groundAt: GroundAt;
  pin: LinkPin | null;
  onPin: (pin: LinkPin | null) => void;
  onEdit: <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { map } = state;
  const pair = useMemo(() => activePair(map, groundAt, state.inputs, pin), [map, groundAt, state.inputs, pin]);
  const model = useMemo(() => {
    if (!pair) return null;
    const distanceM = separationM(pair.tx, pair.rx, groundAt, map.useTerrainElevation);
    const inputs = pairInputs(state.inputs, pair.tx, pair.rx, distanceM);
    const propagation = pairPropagation(map, pair.tx, pair.rx, inputs.frequencyGhz, groundAt);
    const objective = effectiveObjective(map, pair.rx);
    const result = calculateLink({ ...inputs, otherLossDb: inputs.otherLossDb + propagation.lossDb }, objective);
    const known = [pair.tx, pair.rx].every((s) => groundOf(s, groundAt, map.useTerrainElevation) !== null) && Number.isFinite(propagation.lossDb);
    return { inputs, propagation, objective, result, known };
  }, [pair, map, state.inputs, groundAt]);

  const links = useMemo(() => (pair ? receiverSummary(evaluatePairs(map, state.inputs, groundAt), pair.rx.id).links : []), [pair, map, state.inputs, groundAt]);

  if (!pair || !model) {
    return <section className="map-card link-budget-drawer collapsed" aria-label="Link budget"><div className="drawer-bar"><b>Link budget</b><span className="field-note">Add a transmitter and a receiver to see the link budget.</span></div></section>;
  }
  const { inputs, propagation, objective, result, known } = model;
  const num = <K extends keyof LinkInputs>(key: K) => (v: number) => { onEdit(key, v as LinkInputs[K]); };
  const text = (key: keyof typeof TEXT_LABELS) => (
    <label className="field"><span>{TEXT_LABELS[key]}</span><input type="text" value={inputs[key]} onChange={(e) => { onEdit(key, e.target.value); }} /></label>
  );
  const tone = statusTone(result.status);

  return (
    <section className={`map-card link-budget-drawer${open ? '' : ' collapsed'} link-tone-${tone}`} aria-label="Link budget">
      <div className="drawer-bar">
        <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Link budget −' : 'Link budget +'}</button>
        <span className="drawer-summary">{inputs.txId} → {inputs.rxId} · <b>{formatNumber(result.receivedPowerDbm)} dBm</b></span>
        <StatusBadge status={result.status} />
      </div>
      {open && (
        <div className="drawer-body">
          <div className="drawer-inputs">
            <p className="field-note"><b>{objective === 'desired' ? 'Desired communication' : 'Interference avoidance'}.</b> {objective === 'desired' ? 'Tx and Rx should communicate. Received power above sensitivity with the required fade margin is desirable.' : 'Tx and Rx should remain isolated. Received power below the interference threshold is desirable.'}</p>
            {links.length > 1 && (
              <label className="field link-pin"><span>Showing link from</span>
                <select value={pin?.rxId === pair.rx.id && pin.txId === pair.tx.id ? pair.tx.id : ''} onChange={(e) => onPin(e.target.value ? { rxId: pair.rx.id, txId: e.target.value } : null)}>
                  <option value="">Strongest (re-ranks as you edit)</option>
                  {links.map((l) => <option key={l.txId} value={l.txId}>{l.txName}</option>)}
                </select>
              </label>
            )}
            <div className="form-grid three">{text('scenarioName')}{text('txId')}{text('rxId')}</div>
            <div className="form-grid four">
              <NumberField label="Transmit power" unit="dBm" value={inputs.transmitPowerDbm} onChange={num('transmitPowerDbm')} />
              <NumberField label="Operating frequency" unit="GHz" min={0.000001} value={inputs.frequencyGhz} onChange={num('frequencyGhz')} />
              <CommitField label="Tx-to-Rx 3D separation" unit="m" value={inputs.distanceM} onCommit={(v) => onEdit('distanceM', v)} />
              <NumberField label="Fade margin target" unit="dB" min={0} value={inputs.fadeMarginTargetDb} onChange={num('fadeMarginTargetDb')} />
              <NumberField label="Tx antenna gain" unit="dBi" value={inputs.txGainDbi} onChange={num('txGainDbi')} />
              <NumberField label="Rx antenna gain" unit="dBi" value={inputs.rxGainDbi} onChange={num('rxGainDbi')} />
              <NumberField label="Tx cable & connector loss" unit="dB" min={0} value={inputs.txLossDb} onChange={num('txLossDb')} />
              <NumberField label="Rx cable & connector loss" unit="dB" min={0} value={inputs.rxLossDb} onChange={num('rxLossDb')} />
              <NumberField label="Polarization mismatch" unit="dB" min={0} value={inputs.polarizationLossDb} onChange={num('polarizationLossDb')} />
              <NumberField label="Obstruction / environment" unit="dB" min={0} value={inputs.obstructionLossDb} onChange={num('obstructionLossDb')} />
              <NumberField label="Other miscellaneous loss" unit="dB" min={0} value={inputs.otherLossDb} onChange={num('otherLossDb')} />
              <NumberField label="Receiver sensitivity" unit="dBm" value={inputs.sensitivityDbm} onChange={num('sensitivityDbm')} />
              <NumberField label="Interference threshold" unit="dBm" value={inputs.interferenceThresholdDbm} onChange={num('interferenceThresholdDbm')} />
            </div>
          </div>
          <div className="drawer-results">
            <div className="metric-grid drawer-metrics">
              <Metric label="Received power" value={formatNumber(result.receivedPowerDbm, 2)} unit="dBm" note={`${result.receivedPowerMw < 0.001 ? result.receivedPowerMw.toExponential(3) : formatNumber(result.receivedPowerMw, 6)} mW`} />
              <Metric label="Link margin" value={formatNumber(result.linkMarginDb)} unit="dB" note="Power above sensitivity" />
              <Metric label="Interference margin" value={formatNumber(result.interferenceMarginDb)} unit="dB" note="Threshold minus received power" />
              <Metric label="Free-space path loss" value={formatNumber(result.fsplDb)} unit="dB" />
              <Metric label="Diffraction loss" value={map.propagationModel === 'terrain' ? formatNumber(propagation.lossDb) : 'off'} unit={map.propagationModel === 'terrain' ? 'dB' : ''} note={map.propagationModel === 'terrain' ? `Clearance: ${propagation.clearance}` : 'Free-space model'} />
              <Metric label="Total system losses" value={formatNumber(result.totalLossDb)} unit="dB" />
              <Metric label="Wavelength" value={formatNumber(result.wavelengthM, 4)} unit="m" />
            </div>
            {!known && map.useTerrainElevation && <p className="field-note" role="status">Elevation unavailable for this path; terrain prediction is unknown.</p>}
            <RxMeterStack links={links} inputs={inputs} objective={objective} />
            {map.propagationModel === 'terrain' && <PathProfileChart tx={pair.tx} rx={pair.rx} groundAt={map.useTerrainElevation ? groundAt : () => 0} frequencyGhz={inputs.frequencyGhz} />}
          </div>
        </div>
      )}
    </section>
  );
}
