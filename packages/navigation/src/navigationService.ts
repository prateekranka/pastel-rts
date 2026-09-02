import { DEFAULT_MAP_CELLS, SUBUNITS_PER_CELL } from '@pastel-rts/content-schema';
import type { EntityId, MapDef, SubunitCoord } from '@pastel-rts/content-schema';

import type { MoveFormation } from '@pastel-rts/content-schema';
import { NavigationGrid } from './grid';
import {
  GridPathfinder,
  navCellCenterSubunits,
  subunitToNavCell,
} from './pathfinder';
import { planFormationSlots } from './formation';
import {
  compareEntityIds,
  entityIdKey,
  type FormationKind,
  type GridPath,
  type NavDebugSnapshot,
  type PathFailure,
  type PathId,
} from './types';

type ActivePath = {
  pathId: PathId;
  entityId: EntityId;
  cells: Array<{ cx: number; cz: number }>;
  waypointIndex: number;
  status: GridPath['status'];
  failure?: PathFailure;
  usedFallbackGoal: boolean;
  resolvedGoal: { cx: number; cz: number };
  from: SubunitCoord;
  requestedTo: SubunitCoord;
};

export class NavigationService {
  private readonly grid = new NavigationGrid();
  private readonly pathfinder = new GridPathfinder();
  private nextPathId: PathId = 1;
  private readonly pathsByEntity = new Map<string, ActivePath>();
  private readonly pendingReplan: ActivePath[] = [];

  constructor(cellsX = DEFAULT_MAP_CELLS, cellsZ = DEFAULT_MAP_CELLS) {
    this.resize(cellsX, cellsZ);
  }

  resize(cellsX: number, cellsZ: number): void {
    this.grid.resize(cellsX, cellsZ);
    this.pathfinder.resize(this.grid.size);
    this.pathsByEntity.clear();
    this.pendingReplan.length = 0;
  }

  applyMapDef(map: MapDef): void {
    this.grid.applyMapDef(map);
    this.pathfinder.resize(this.grid.size);
    this.replanAll();
  }

  setBlocked(cx: number, cz: number, blocked: boolean): void {
    this.grid.setBlocked(cx, cz, blocked);
    this.replanAll();
  }

  setNonBuildableWalkable(cx: number, cz: number, enabled: boolean): void {
    this.grid.setNonBuildableWalkable(cx, cz, enabled);
  }

  setFootprintBlocked(origin: { cx: number; cz: number }, cellsW: number, cellsH: number, blocked: boolean): void {
    this.grid.setFootprintBlocked(origin, cellsW, cellsH, blocked);
    this.replanAll();
  }

  isWalkable(cx: number, cz: number): boolean {
    return this.grid.isWalkable(cx, cz);
  }

  isBuildable(cx: number, cz: number): boolean {
    return this.grid.isBuildable(cx, cz);
  }

  classifyCell(cx: number, cz: number) {
    return this.grid.classifyCell(cx, cz);
  }

  getGrid(): NavigationGrid {
    return this.grid;
  }

  requestPath(entityId: EntityId, from: SubunitCoord, to: SubunitCoord): PathId {
    this.cancel(entityId);

    const pathId = this.nextPathId;
    this.nextPathId += 1;

    const startCell = subunitToNavCell(from);
    const goalCell = subunitToNavCell(to);

    if (!this.grid.inBounds(goalCell.cx, goalCell.cz)) {
      const failure: PathFailure = {
        code: 'out-of-bounds',
        from,
        requestedTo: to,
        resolvedGoal: goalCell,
      };
      this.storePath({
        pathId,
        entityId,
        cells: [],
        waypointIndex: 0,
        status: 'blocked',
        failure,
        usedFallbackGoal: false,
        resolvedGoal: goalCell,
        from,
        requestedTo: to,
      });
      return pathId;
    }

    const result = this.pathfinder.findPath(this.grid, startCell, goalCell);
    if (!result.ok) {
      const failure: PathFailure = {
        code: result.code,
        from,
        requestedTo: to,
        resolvedGoal: result.goal,
      };
      this.storePath({
        pathId,
        entityId,
        cells: [],
        waypointIndex: 0,
        status: 'blocked',
        failure,
        usedFallbackGoal: false,
        resolvedGoal: result.goal,
        from,
        requestedTo: to,
      });
      return pathId;
    }

    this.storePath({
      pathId,
      entityId,
      cells: result.cells,
      waypointIndex: result.cells.length > 1 ? 1 : 0,
      status: 'found',
      usedFallbackGoal: result.usedFallback,
      resolvedGoal: result.goal,
      from,
      requestedTo: to,
    });
    return pathId;
  }

  cancel(entityId: EntityId): void {
    const key = entityIdKey(entityId);
    const existing = this.pathsByEntity.get(key);
    if (existing === undefined) {
      return;
    }
    existing.status = 'cancelled';
    existing.cells.length = 0;
    this.pathsByEntity.delete(key);
  }

  getPath(entityId: EntityId): GridPath | null {
    const active = this.pathsByEntity.get(entityIdKey(entityId));
    if (active === undefined) {
      return null;
    }
    return this.toGridPath(active);
  }

  getPathById(pathId: PathId): GridPath | null {
    for (const active of this.pathsByEntity.values()) {
      if (active.pathId === pathId) {
        return this.toGridPath(active);
      }
    }
    return null;
  }

  advanceWaypoint(entityId: EntityId, current: SubunitCoord): void {
    const active = this.pathsByEntity.get(entityIdKey(entityId));
    if (active === undefined || active.status !== 'found') {
      return;
    }
    const targetCell = active.cells[active.waypointIndex];
    if (targetCell === undefined) {
      return;
    }
    const target = navCellCenterSubunits(targetCell);
    const dx = current.x - target.x;
    const dz = current.z - target.z;
    const threshold = Math.floor(SUBUNITS_PER_CELL / 4);
    if (dx * dx + dz * dz > threshold * threshold) {
      return;
    }
    if (active.waypointIndex >= active.cells.length - 1) {
      active.waypointIndex = active.cells.length - 1;
      return;
    }
    active.waypointIndex += 1;
  }

  /**
   * Contract follow API. Peeks the current cell-center waypoint.
   * When `current` is provided, advances the path if the unit is close enough
   * so simulation can follow multi-cell routes without calling `advanceWaypoint`.
   */
  planFormation(
    entityIds: readonly EntityId[],
    destination: SubunitCoord,
    formation: Pick<MoveFormation, 'kind'> & { spacingSubunits?: number },
  ): ReadonlyArray<{ entityId: EntityId; target: SubunitCoord }> {
    const input = {
      entityIds: [...entityIds],
      destination,
      kind: formation.kind as FormationKind,
      ...(formation.spacingSubunits !== undefined ? { spacingSubunits: formation.spacingSubunits } : {}),
    };
    return planFormationSlots(this.grid, input).map((slot) => ({
      entityId: slot.entityId,
      target: slot.target,
    }));
  }

  nextWaypoint(entityId: EntityId, current?: SubunitCoord): SubunitCoord | null {
    if (current !== undefined) {
      this.advanceWaypoint(entityId, current);
    }
    const active = this.pathsByEntity.get(entityIdKey(entityId));
    if (active === undefined || active.status !== 'found' || active.cells.length === 0) {
      return null;
    }
    const cell = active.cells[active.waypointIndex];
    if (cell === undefined) {
      return null;
    }
    return navCellCenterSubunits(cell);
  }

  /** Deterministic replan after dynamic/static blocker changes. */
  replanAll(): void {
    this.pendingReplan.length = 0;
    for (const active of this.pathsByEntity.values()) {
      if (active.status === 'found' || active.status === 'blocked') {
        this.pendingReplan.push(active);
      }
    }
    this.pendingReplan.sort((a, b) => compareEntityIds(a.entityId, b.entityId));
    for (const previous of this.pendingReplan) {
      this.requestPath(previous.entityId, previous.from, previous.requestedTo);
    }
  }

  debugSnapshot(): NavDebugSnapshot {
    const paths = [...this.pathsByEntity.values()]
      .sort((a, b) => compareEntityIds(a.entityId, b.entityId))
      .map((active) => ({
        entityId: active.entityId,
        cells: active.cells.map((cell) => ({ cx: cell.cx, cz: cell.cz })),
        status: active.status,
      }));
    return {
      blocked: this.grid.blockedMask(),
      paths,
    };
  }

  private storePath(active: ActivePath): void {
    this.pathsByEntity.set(entityIdKey(active.entityId), active);
  }

  private toGridPath(active: ActivePath): GridPath {
    const path: GridPath = {
      pathId: active.pathId,
      entityId: active.entityId,
      cells: active.cells.map((cell) => ({ cx: cell.cx, cz: cell.cz })),
      status: active.status,
      usedFallbackGoal: active.usedFallbackGoal,
      resolvedGoal: { cx: active.resolvedGoal.cx, cz: active.resolvedGoal.cz },
    };
    if (active.failure !== undefined) {
      path.failure = active.failure;
    }
    return path;
  }
}

export type { NavigationService as NavigationServiceInterface };
