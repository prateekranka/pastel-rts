import type { EntityId, SubunitCoord } from '@pastel-rts/content-schema';

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
  setBlocked(cx: number, cz: number, blocked: boolean): void;
  setFootprintBlocked(origin: NavCell, cellsW: number, cellsH: number, blocked: boolean): void;
  isWalkable(cx: number, cz: number): boolean;
  requestPath(entityId: EntityId, from: SubunitCoord, to: SubunitCoord): PathId;
  cancel(entityId: EntityId): void;
  nextWaypoint(entityId: EntityId): SubunitCoord | null;
  debugSnapshot(): NavDebugSnapshot;
}
