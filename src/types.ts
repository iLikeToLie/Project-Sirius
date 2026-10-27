export type ScreeningStatus =
  | 'Possible interference'
  | 'Acceptable link'
  | 'Weak link'
  | 'No link'
  | 'Below interference threshold'
  | 'Invalid input';

export type LinkObjective = 'desired' | 'avoidance';

export interface LinkInputs {
  scenarioName: string;
  txId: string;
  rxId: string;
  transmitPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  frequencyGhz: number;
  distanceM: number;
  txLossDb: number;
  rxLossDb: number;
  polarizationLossDb: number;
  obstructionLossDb: number;
  otherLossDb: number;
  sensitivityDbm: number;
  interferenceThresholdDbm: number;
  fadeMarginTargetDb: number;
}

export interface DistanceSweepSettings {
  minDistanceM: number;
  maxDistanceM: number;
  stepM: number;
}

export interface GainSweepSettings {
  gainToSweep: 'tx' | 'rx';
  minGainDbi: number;
  maxGainDbi: number;
  stepDb: number;
  distancesM: [number, number, number];
}

export interface PlacementScenario {
  id: string;
  name: string;
  distanceM: number;
  txGainDbi: number;
  rxGainDbi: number;
  txLossDb: number;
  rxLossDb: number;
  polarizationLossDb: number;
  obstructionLossDb: number;
  otherLossDb: number;
}

export interface AntennaPlacement {
  xM: number;
  yM: number;
  aglM: number;
}

export interface TerrainSettings {
  enabled: boolean;
  model: 'synthetic-v1';
  offsetM: number;
  reliefScale: number;
  contourIntervalM: number;
}

export interface LinkWorkspace {
  tx: AntennaPlacement;
  rx: AntennaPlacement;
  terrain: TerrainSettings;
}

export type SensorRole = 'tx' | 'rx';

/** A placed antenna. Both role's fields are kept so toggling TX/RX never loses values. */
export interface Sensor {
  id: string;
  name: string;
  role: SensorRole;
  lat: number;
  lon: number;
  aglM: number;
  gainDbi: number;
  cableLossDb: number;
  powerDbm: number;
  sensitivityDbm: number;
  fadeMarginTargetDb: number;
  interferenceThresholdDbm: number;
  intendedTxId: 'auto' | string;
  objective: 'default' | LinkObjective;
}

export interface MapScenario {
  sensors: Sensor[];
  selectedId: string | null;
  zonesForRxId: 'auto' | string;
  useTerrainElevation: boolean;
  defaultObjective: LinkObjective;
  propagationModel: 'free-space' | 'terrain';
}

export interface AppState {
  schemaVersion: 4;
  linkObjective: LinkObjective;
  inputs: LinkInputs;
  distanceSweep: DistanceSweepSettings;
  gainSweep: GainSweepSettings;
  placements: PlacementScenario[];
  map: MapScenario;
}
