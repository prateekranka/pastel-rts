export {
  UNIT_FACTIONS,
  UNIT_MANIFEST_SCHEMA_VERSION,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  createUnitManifest,
  isValidAnchor,
  isValidUnitId,
  validateUnitManifest,
  type PixelBounds,
  type UnitAnchor,
  type UnitFaction,
  type UnitManifest,
} from './unitManifest';
export { detectOpaqueBounds } from './pngBounds';
export { isSafeAssetPath, isValidContentId, requireSafeAssetPath } from './validation';

export {
  SUBUNITS_PER_CELL,
  subunitToCell,
  subunitToWorldFloat,
  worldFloatToSubunit,
  type CellCoord,
  type SubunitCoord,
  type Tick,
} from './coords';

export {
  createEntityId,
  entityIdsEqual,
  isNilEntity,
  packEntityId,
  unpackEntityId,
  type EntityGeneration,
  type EntityId,
  type EntityIndex,
} from './ids';

export {
  DIRECTION_COUNTS,
  DIRECTION_ORDER_4,
  DIRECTION_ORDER_8,
  countSpriteSheetFrames,
  resolveFrameIndexes,
  validateAnimationDef,
  validateSpriteClip,
  type AnimClipId,
  type AnimationDef,
  type AnimationValidationOptions,
  type DirectionCount,
  type FallbackAnimationRules,
  type SpriteClip,
  type SpriteFrameRef,
  type UnitAnimationDef,
} from './animation';

export {
  BUILDING_ARCHETYPE_SCHEMA_VERSION,
  DEFAULT_V1_UPGRADE_SPEED_SUBUNITS_PER_TICK,
  FACTION_IDS,
  PACK_V2_SCHEMA_VERSION,
  PLAYABLE_FACTION_IDS,
  UNIT_ARCHETYPE_SCHEMA_VERSION,
  bumpRevision,
  computeContentHash,
  createInitialRevision,
  isValidFactionId,
  mapLegacyFactionToFactionId,
  normalizeRevision,
  upgradePackV1ToV2,
  validateBuildingArchetype,
  validatePackV2,
  validateUnitArchetype,
  type BuildingArchetype,
  type BuildableTerrainRules,
  type CellMaskFootprint,
  type FactionDef,
  type FactionId,
  type Footprint,
  type MapReference,
  type PackV1,
  type PackV2,
  type PlayableFactionId,
  type RectFootprint,
  type ScenarioReference,
  type ShadowDef,
  type UnitArchetype,
  type UnitMovementDef,
  type Vec2,
} from './pack';

export {
  COMMAND_PROTOCOL_VERSION,
  COMMAND_SCHEMA_VERSION,
  MOVE_FORMATION_KINDS,
  validateCommandEnvelope,
  validateCommandPayload,
  type CommandEnvelopeV1,
  type CommandKind,
  type CommandPayload,
  type CommandRejectReason,
  type CommandResult,
  type CommandResultStatus,
  type MoveFormation,
  type MoveFormationKind,
  type MovePayload,
  type PlaceBuildingPayload,
  type RemoveBuildingPayload,
  type RemoveEntityPayload,
  type SpawnUnitPayload,
  type StopPayload,
} from './commands';

export {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAP_CELLS,
  MAP_SCHEMA_VERSION,
  validateMapDef,
  type MapDef,
} from './map';

export {
  SCENARIO_SCHEMA_VERSION,
  validateScenarioDef,
  type ScenarioBuildingSpawn,
  type ScenarioDef,
  type ScenarioUnitSpawn,
} from './scenario';

export {
  canonicalize,
  computeSimulationRulesHash,
  computeVisualContentHash,
} from './contentHash';

export {
  PUBLICATION_SCHEMA_VERSION,
  isValidRevision,
  validatePublicationState,
  validateReferenceAttachmentMetadata,
  validateRevisionMetadata,
  type ImmutableAssetReference,
  type PublicationState,
  type ReferenceAttachmentMetadata,
  type RevisionAssetKind,
  type RevisionMetadata,
} from './publication';
