/** Browser-safe subset of @pastel-rts/content-schema (excludes node:crypto pack helpers). */
export {
  UNIT_FACTIONS,
  UNIT_MANIFEST_SCHEMA_VERSION,
  createUnitManifest,
  isValidAnchor,
  isValidUnitId,
  validateUnitManifest,
  type PixelBounds,
  type UnitAnchor,
  type UnitFaction,
  type UnitManifest,
} from '../../../../packages/content-schema/src/unitManifest';
export { detectOpaqueBounds } from '../../../../packages/content-schema/src/pngBounds';
export {
  DIRECTION_COUNTS,
  DIRECTION_ORDER_4,
  DIRECTION_ORDER_8,
  countSpriteSheetFrames,
  resolveFrameIndexes,
  type AnimClipId,
  type AnimationDef,
  type DirectionCount,
  type SpriteClip,
  type UnitAnimationDef,
} from '../../../../packages/content-schema/src/animation';
export type {
  BuildingArchetype,
  FactionDef,
  FactionId,
  Footprint,
  PackV2,
  UnitArchetype,
  UnitMovementDef,
} from '../../../../packages/content-schema/src/pack';
