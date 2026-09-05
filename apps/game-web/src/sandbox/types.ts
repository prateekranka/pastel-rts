import type { CommandEnvelopeV1, CommandResult, MapDef, PackV2, ScenarioDef } from '@pastel-rts/content-schema';
import type { NavDebugSnapshot } from '@pastel-rts/navigation';
import type { StateChecksum } from '@pastel-rts/simulation';
import type { RuntimeContentIdentity } from '../content/PublishedContentClient';

export type LabInitMessage = {
  type: 'initLab';
  seed: number;
  pack: PackV2;
  scenarioId?: string;
  map?: MapDef;
  scenario?: ScenarioDef;
  commandLog?: CommandEnvelopeV1[];
  replayToTick?: number;
};

export type LabControlMessage =
  | LabInitMessage
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'terminate' }
  | { type: 'command'; envelope: CommandEnvelopeV1 }
  | { type: 'setNavDebug'; enabled: boolean }
  | { type: 'stepOne' };

export type LabSnapshotMessage = {
  type: 'snapshot';
  tick: number;
  simTimeMs: number;
  producedAtMs: number;
  tickDurationMs: number;
  /** Time spent serializing navigation debug state, not GPU time. */
  navDurationMs?: number;
  entityCount: number;
  payload: Float32Array;
};

export type LabNavDebugMessage = {
  type: 'navDebug';
  snapshot: NavDebugSnapshot;
};

export type LabChecksumsMessage = {
  type: 'checksums';
  checksums: StateChecksum[];
};

export type LabWorkerOutbound =
  | LabSnapshotMessage
  | CommandResult
  | LabNavDebugMessage
  | LabChecksumsMessage;

export type LabSnapshotSlot = {
  tick: number;
  simTimeMs: number;
  receivedAtMs: number;
  tickDurationMs: number;
  navDurationMs: number;
  producedAtMs: number;
  entityCount: number;
  payload: Float32Array;
};

export type EntityArchetypeRecord = {
  archetypeId: string;
  kind: 'unit' | 'building';
};

export type ScenarioSaveDocument = {
  schemaVersion: 1;
  scenarioId: string;
  scenario: ScenarioDef;
  mapId: string;
  map: MapDef;
  seed: number;
  replayToTick: number;
  packId: string;
  /** Legacy field retained as an alias for the exact PackV2 content hash. */
  packHash: string;
  contentHash: string;
  revision: string;
  manifestHash: string | null;
  visualContentHash: string;
  simulationRulesHash: string;
  mapHash: string;
  scenarioHash: string;
  commandLog: CommandEnvelopeV1[];
  commandResults: CommandResult[];
  checksums: StateChecksum[];
  contentSource: RuntimeContentIdentity['source'];
};

export type DebugOverlayFlags = {
  navCells: boolean;
  walkable: boolean;
  buildable: boolean;
  staticBlockers: boolean;
  dynamicBlockers: boolean;
  collisionCircles: boolean;
  selectionCircles: boolean;
  paths: boolean;
  formationSlots: boolean;
  groupDestination: boolean;
  separationVectors: boolean;
  commandQueue: boolean;
  tick: boolean;
  checksumHistory: boolean;
  spriteBounds: boolean;
  anchors: boolean;
  touchTargets: boolean;
};

export const DEFAULT_DEBUG_OVERLAYS: DebugOverlayFlags = {
  navCells: false,
  walkable: false,
  buildable: false,
  staticBlockers: false,
  dynamicBlockers: false,
  collisionCircles: false,
  selectionCircles: false,
  paths: false,
  formationSlots: false,
  groupDestination: false,
  separationVectors: false,
  commandQueue: false,
  tick: false,
  checksumHistory: false,
  spriteBounds: false,
  anchors: false,
  touchTargets: false,
};
