import { offsetLatLon, SG_REFERENCE } from '../lib/geo';
import type { AppState, LinkInputs, LinkWorkspace, MapScenario, PlacementScenario, TerrainSettings } from '../types';

const placementRows: Omit<PlacementScenario, 'id'>[] = [
  { name: 'Rooftop direct LOS', distanceM: 250, txGainDbi: 14, rxGainDbi: 15, txLossDb: 1.2, rxLossDb: 0.8, polarizationLossDb: 0.2, obstructionLossDb: 0.5, otherLossDb: 0.3 },
  { name: 'Rooftop alternate', distanceM: 450, txGainDbi: 12, rxGainDbi: 15, txLossDb: 1.5, rxLossDb: 1, polarizationLossDb: 0.5, obstructionLossDb: 2, otherLossDb: 0.5 },
  { name: 'Pole north', distanceM: 800, txGainDbi: 10, rxGainDbi: 12, txLossDb: 1.5, rxLossDb: 1.2, polarizationLossDb: 1, obstructionLossDb: 3, otherLossDb: 1 },
  { name: 'Pole south', distanceM: 1200, txGainDbi: 9, rxGainDbi: 12, txLossDb: 2, rxLossDb: 1.2, polarizationLossDb: 0.5, obstructionLossDb: 4, otherLossDb: 1 },
  { name: 'Building C', distanceM: 2000, txGainDbi: 8, rxGainDbi: 10, txLossDb: 2, rxLossDb: 1.5, polarizationLossDb: 1, obstructionLossDb: 6, otherLossDb: 1.5 },
  { name: 'Warehouse edge', distanceM: 3500, txGainDbi: 6, rxGainDbi: 9, txLossDb: 2.5, rxLossDb: 1.5, polarizationLossDb: 1.5, obstructionLossDb: 8, otherLossDb: 2 },
  { name: 'Tower sector A', distanceM: 5000, txGainDbi: 16, rxGainDbi: 16, txLossDb: 1, rxLossDb: 1, polarizationLossDb: 0.2, obstructionLossDb: 1, otherLossDb: 0.5 },
  { name: 'Tower sector B', distanceM: 7500, txGainDbi: 12, rxGainDbi: 13, txLossDb: 1.5, rxLossDb: 1.5, polarizationLossDb: 0.5, obstructionLossDb: 3, otherLossDb: 1 },
  { name: 'Remote shed', distanceM: 12000, txGainDbi: 3, rxGainDbi: 6, txLossDb: 3, rxLossDb: 2, polarizationLossDb: 2, obstructionLossDb: 10, otherLossDb: 3 },
  { name: 'Valley test point', distanceM: 20000, txGainDbi: 2, rxGainDbi: 2, txLossDb: 3, rxLossDb: 3, polarizationLossDb: 3, obstructionLossDb: 15, otherLossDb: 4 },
];

export const DEFAULT_TERRAIN: TerrainSettings = { enabled: false, model: 'synthetic-v1', offsetM: 0, reliefScale: 1, contourIntervalM: 25 };
export const DEFAULT_ANTENNA_AGL_M = 10;

/** Places Tx and Rx symmetrically on the X axis so flat-ground 3D separation equals distanceM exactly. */
export function workspaceForDistance(distanceM: number): LinkWorkspace {
  const half = Number.isFinite(distanceM) && distanceM > 0 ? distanceM / 2 : 250;
  return {
    tx: { xM: half, yM: 0, aglM: DEFAULT_ANTENNA_AGL_M },
    rx: { xM: -half, yM: 0, aglM: DEFAULT_ANTENNA_AGL_M },
    terrain: { ...DEFAULT_TERRAIN },
  };
}

/**
 * Tx and Rx sensors at plan-view offsets (metres) from the Singapore reference point, carrying the
 * calculator's values and names. Also used to migrate plan-view scenarios.
 */
export function mapForPlacements(inputs: LinkInputs, tx: { xM: number; yM: number; aglM: number }, rx: { xM: number; yM: number; aglM: number }, useTerrainElevation: boolean): MapScenario {
  const common = {
    powerDbm: inputs.transmitPowerDbm,
    sensitivityDbm: inputs.sensitivityDbm,
    fadeMarginTargetDb: inputs.fadeMarginTargetDb,
    interferenceThresholdDbm: inputs.interferenceThresholdDbm,
    desiredTxIds: 'auto' as const,
    objective: 'default' as const,
  };
  return {
    sensors: [
      { ...common, id: 'sensor-1', name: inputs.txId || 'T1', role: 'tx', ...offsetLatLon(SG_REFERENCE, tx.xM, tx.yM), aglM: tx.aglM, gainDbi: inputs.txGainDbi, cableLossDb: inputs.txLossDb },
      { ...common, id: 'sensor-2', name: inputs.rxId || 'R1', role: 'rx', ...offsetLatLon(SG_REFERENCE, rx.xM, rx.yM), aglM: rx.aglM, gainDbi: inputs.rxGainDbi, cableLossDb: inputs.rxLossDb },
    ],
    selectedId: null,
    zonesForRxId: 'auto',
    useTerrainElevation,
    defaultObjective: 'desired',
    propagationModel: 'terrain',
  };
}

const DEFAULT_INPUTS: LinkInputs = {
  scenarioName: 'Campus Backhaul A',
  txId: 'Rooftop TX-01',
  rxId: 'Building B RX-02',
  transmitPowerDbm: 30,
  txGainDbi: 12,
  rxGainDbi: 15,
  frequencyGhz: 5.8,
  distanceM: 500,
  txLossDb: 1.5,
  rxLossDb: 1,
  polarizationLossDb: 0.5,
  obstructionLossDb: 3,
  otherLossDb: 0.5,
  sensitivityDbm: -85,
  interferenceThresholdDbm: -65,
  fadeMarginTargetDb: 15,
};

const defaultPlacements = workspaceForDistance(500);

export const DEFAULT_STATE: AppState = {
  schemaVersion: 5,
  linkObjective: 'desired',
  inputs: DEFAULT_INPUTS,
  distanceSweep: { minDistanceM: 10, maxDistanceM: 2000, stepM: 10 },
  gainSweep: { gainToSweep: 'tx', minGainDbi: 0, maxGainDbi: 30, stepDb: 1, distancesM: [250, 500, 2000] },
  placements: placementRows.map((row, index) => ({ ...row, id: `placement-${index + 1}` })),
  map: mapForPlacements(DEFAULT_INPUTS, defaultPlacements.tx, defaultPlacements.rx, true),
};

export const freshDefaultState = (): AppState => JSON.parse(JSON.stringify(DEFAULT_STATE)) as AppState;
