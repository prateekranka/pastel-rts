export { NavigationGrid } from './grid';
export { NavigationService } from './navigationService';
export {
  GridPathfinder,
  clampSubunitToMapBounds,
  navCellCenterSubunits,
  pathAvoidsBlocked,
  pathCellsInBounds,
  subunitToNavCell,
  type PathSearchResult,
} from './pathfinder';
export {
  cellSpacingSubunits,
  formationSlotCellsUnique,
  planFormationSlots,
  snapSubunitToCellCenter,
  walkableNeighbors,
  type FormationPlanInput,
} from './formation';
export {
  applyLocalSeparation,
  separationRespectsBlockers,
  type SeparationResult,
} from './separation';
export {
  DEFAULT_FORMATION_SPACING_SUBUNITS,
  DIAGONAL_CORNER_DELTAS,
  NEIGHBOR_DELTAS,
  cellKey,
  compareEntityIds,
  entityIdKey,
  unpackCellKey,
  type CellTerrainKind,
  type FormationKind,
  type FormationSlot,
  type GridPath,
  type GridPathStatus,
  type NavCell,
  type NavDebugPath,
  type NavDebugSnapshot,
  type PathFailure,
  type PathFailureCode,
  type PathId,
  type SeparationUnit,
} from './types';

/** Alias for contract documentation: units do not block the grid in M1. */
export const M1_UNITS_DO_NOT_BLOCK_GRID = true as const;
