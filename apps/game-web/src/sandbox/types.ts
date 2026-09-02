import type { CommandEnvelopeV1, CommandResult, MapDef, PackV2, ScenarioDef } from '@pastel-rts/content-schema';
import type { NavDebugSnapshot } from '@pastel-rts/navigation';
import type { StateChecksum } from '@pastel-rts/simulation';

export type LabInitMessage = {
  type: 'initLab';
  seed: number;
  pack: PackV2;
  scenarioId?: string;
  map?: MapDef;
  scenario?: ScenarioDef;
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
  scenario: ScenarioDef;
  seed: number;
  packId: string;
  packHash: string;
  commandLog: CommandEnvelopeV1[];
  checksums: StateChecksum[];
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
