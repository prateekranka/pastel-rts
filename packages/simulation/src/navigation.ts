import type { EntityId, MapDef, SubunitCoord } from '@pastel-rts/content-schema';

export type PathId = number;

export type NavCell = {
  cx: number;
  cz: number;
};

export type GridPath = {
  entityId: EntityId;
  cells: NavCell[];
  status: 'pending' | 'found' | 'blocked' | 'cancelled';
};

export type NavDebugSnapshot = {
  blocked: Uint8Array;
  paths: Array<{ entityId: EntityId; cells: NavCell[] }>;
};

/**
 * Navigation service injected by worker glue. Simulation requests occupancy and
 * paths through this interface; A* implementation lives in `@pastel-rts/navigation`.
 *
 * M1 default: buildings block the grid; units do not block walkability.
 */
export interface NavigationService {
  resize(cellsX: number, cellsZ: number): void;
  /** Apply authored static blockers. Called after Simulation construction (which resizes). */
  applyMapDef(map: MapDef): void;
  setBlocked(cx: number, cz: number, blocked: boolean): void;
  setFootprintBlocked(
    origin: NavCell,
    cellsW: number,
    cellsH: number,
    blocked: boolean,
    mask?: ReadonlyArray<readonly boolean[]>,
  ): void;
  isWalkable(cx: number, cz: number): boolean;
  requestPath(entityId: EntityId, from: SubunitCoord, to: SubunitCoord): PathId;
  cancel(entityId: EntityId): void;
  /**
   * Next follow waypoint in subunits.
   * When `current` is supplied, the implementation may advance along a multi-cell path.
   */
  nextWaypoint(entityId: EntityId, current?: SubunitCoord): SubunitCoord | null;
  /** Distinct legal formation destinations, one per entity, deterministic order. */
  planFormation(
    entityIds: readonly EntityId[],
    destination: SubunitCoord,
    formation: { kind: 'none' | 'line' | 'box'; spacingSubunits?: number; facingMilli?: number },
  ): ReadonlyArray<{ entityId: EntityId; target: SubunitCoord }>;
  debugSnapshot(): NavDebugSnapshot;
}
