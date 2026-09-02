import type { CellCoord, SubunitCoord } from '@pastel-rts/content-schema';
import type { EntityId } from '@pastel-rts/content-schema';

export type PathId = number;

export type NavCell = CellCoord;

export type GridPathStatus = 'pending' | 'found' | 'blocked' | 'cancelled';

export type PathFailureCode = 'unreachable' | 'out-of-bounds' | 'cancelled';

export type PathFailure = {
  code: PathFailureCode;
  from: SubunitCoord;
  requestedTo: SubunitCoord;
  resolvedGoal?: NavCell;
};

export type GridPath = {
  pathId: PathId;
  entityId: EntityId;
  cells: NavCell[];
  status: GridPathStatus;
  failure?: PathFailure;
  /** True when the requested destination cell was blocked and a nearby cell was used. */
  usedFallbackGoal: boolean;
  resolvedGoal: NavCell;
};

export type CellTerrainKind = 'walkable' | 'blocked' | 'buildable' | 'non-buildable-walkable';

export type NavDebugPath = {
  entityId: EntityId;
  cells: NavCell[];
  status: GridPathStatus;
};

export type NavDebugSnapshot = {
  blocked: Uint8Array;
  paths: NavDebugPath[];
};

export type FormationKind = 'none' | 'line' | 'box';

export type FormationSlot = {
  entityId: EntityId;
  target: SubunitCoord;
  slotIndex: number;
};

export type SeparationUnit = {
  entityId: EntityId;
  position: SubunitCoord;
  radiusSubunits: number;
};

export const DEFAULT_FORMATION_SPACING_SUBUNITS = 512;

/** Deterministic 4-neighbour deltas in N, E, S, W order. */
export const NEIGHBOR_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export const DIAGONAL_CORNER_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
] as const;

export function cellKey(cx: number, cz: number): number {
  return (cz << 16) | (cx & 0xffff);
}

export function unpackCellKey(key: number): NavCell {
  return { cx: key & 0xffff, cz: key >>> 16 };
}

export function compareEntityIds(a: EntityId, b: EntityId): number {
  if (a.index !== b.index) {
    return a.index - b.index;
  }
  return a.generation - b.generation;
}

export function entityIdKey(id: EntityId): string {
  return `${String(id.index)}:${String(id.generation)}`;
}
