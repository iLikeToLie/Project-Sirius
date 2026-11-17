export type ScreeningStatus =
  | 'Possible interference'
  | 'Marginal interference'
  | 'Interfered link'
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
export interface RejectionStep { offsetMhz: number; rejectionDb: number }

/** A placed antenna. Both role's fields are kept so toggling TX/RX never loses values. */
/** Antenna pattern: horizontal sector plus a vertical beam. */
export interface AntennaPattern {
  kind: 'omni' | 'sector' | 'custom';
  /** Resolved custom samples: H 0..359, V -90..90. */
  hLossDb?: number[]; vLossDb?: number[]; patternKey?: string;
  azimuthDeg: number; beamwidthDeg: number; frontToBackDb: number;
  /** Vertical 3 dB beamwidth, 1–90. */
  verticalBeamwidthDeg: number;
  /** Downtilt, −20..45; positive points below the horizon. */
  downtiltDeg: number;
}

/** A library antenna: shape and gain. Pointing lives on the sensor. */
export interface AntennaModel {
  id: string; name: string; kind: 'omni' | 'sector' | 'custom'; gainDbi: number;
  beamwidthDeg: number; verticalBeamwidthDeg: number; frontToBackDb: number;
  /** Sorted [angle degrees, loss dB] cuts, retained when switching kind. */
  pattern?: { horizontal: [number, number][]; vertical: [number, number][] };
}

/** A sensor's use of the library: which model, and where it points. `modelId` 'omni' is the built-in omni using the sensor's Gain. */
export interface SensorAntenna {
  modelId: string; azimuthDeg: number; downtiltDeg: number;
  /** When set, the azimuth follows the bearing to that sensor. */
  aimAtId: string | null;
}

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
  desiredTxIds: 'auto' | string[];
  objective: 'default' | LinkObjective;
  protectionMarginDb: 'default' | number;
  requiredCiDb: number;
  frequencyGhz: 'default' | number;
  bandwidthMhz: number;
  acrDb: number;
  rejectionMask: RejectionStep[];
  polarization: 'V' | 'H' | 'RHCP' | 'LHCP';
  /** Where the antenna stands when it is on a building: its height counts from the roof, or from the street. */
  mount: 'roof' | 'street';
  antenna: SensorAntenna;
}

export interface MapScenario {
  sensors: Sensor[];
  /** Antenna library (user models, at most 24). */
  antennaModels: AntennaModel[];
  selectedId: string | null;
  zonesForRxId: 'auto' | string;
  useTerrainElevation: boolean;
  defaultObjective: LinkObjective;
  propagationModel: 'free-space' | 'terrain';
  protectionMarginDb: number;
  aggregateInterference: 'objective' | 'always' | 'never';
  rejectionModel: 'simple' | 'mask';
  crossPolarDiscriminationDb: number;
  /** Building heights block paths (terrain diffraction only). */
  buildings: boolean;
}

export interface AppState {
  schemaVersion: 9;
  linkObjective: LinkObjective;
  inputs: LinkInputs;
  distanceSweep: DistanceSweepSettings;
  gainSweep: GainSweepSettings;
  placements: PlacementScenario[];
  map: MapScenario;
}
