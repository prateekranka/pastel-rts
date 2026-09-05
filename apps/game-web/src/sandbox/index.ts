export { createInteractionLab, isInteractionLabMode, INTERACTION_LAB_ALIEN_FANTASY_ID } from './createInteractionLab';
export type { InteractionLab, InteractionLabOptions } from './createInteractionLab';
export { ScenarioController } from './ScenarioController';
export { UnitRenderSystem } from './UnitRenderSystem';
export { NavigationDebugRenderer } from './NavigationDebugRenderer';
export { MatchRuntimeClient } from './MatchRuntimeClient';
export { BuildingPlacementController, PlacementGhost } from './placement/BuildingPlacementController';
export { SpawnPalette, BuildPalette } from './palettes/SpawnPalette';
export { CommandRecorder, ReplayInspector } from './replay/CommandRecorder';
export {
  compareRevisionReplays,
  compareRevisions,
  runRevisionComparison,
} from './replay/RevisionComparison';
export type {
  RevisionComparisonResult,
  RevisionReplayInput,
  RevisionReplayOutcome,
} from './replay/RevisionComparison';
export { EntityRegistry } from './EntityRegistry';
export { parseSnapshotEntity, entityIdKey, INTERACTION_SNAPSHOT_STRIDE } from './snapshot';
