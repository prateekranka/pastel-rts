import type { EntityId, SubunitCoord } from '@pastel-rts/content-schema';
import { SUBUNITS_PER_CELL, entityIdsEqual } from '@pastel-rts/content-schema';
import type { NavCell, NavigationService, PathId } from './navigation.js';

type ActivePath = {
  destination: SubunitCoord;
};

/**
 * Test/stub navigation service. Provides straight-line subunit movement with
 * 4-connected cell paths for debug snapshots. Not a production A* implementation.
 */
export class StubNavigationService implements NavigationService {
  private cellsX = 160;
  private cellsZ = 160;
  private blocked: Uint8Array = new Uint8Array(160 * 160);
  private readonly paths = new Map<string, ActivePath>();
  private nextPathId = 1;

  resize(cellsX: number, cellsZ: number): void {
    this.cellsX = cellsX;
    this.cellsZ = cellsZ;
    this.blocked = new Uint8Array(cellsX * cellsZ);
    this.paths.clear();
  }

  setBlocked(cx: number, cz: number, blocked: boolean): void {
    if (!this.inBounds(cx, cz)) {
      return;
    }
    const index = cz * this.cellsX + cx;
    this.blocked[index] = blocked ? 1 : 0;
  }

  setFootprintBlocked(origin: NavCell, cellsW: number, cellsH: number, blocked: boolean): void {
    for (let dz = 0; dz < cellsH; dz += 1) {
      for (let dx = 0; dx < cellsW; dx += 1) {
        this.setBlocked(origin.cx + dx, origin.cz + dz, blocked);
      }
    }
  }

  isWalkable(cx: number, cz: number): boolean {
    if (!this.inBounds(cx, cz)) {
      return false;
    }
    const index = cz * this.cellsX + cx;
    return (this.blocked[index] ?? 1) === 0;
  }

  requestPath(entityId: EntityId, _from: SubunitCoord, to: SubunitCoord): PathId {
    this.paths.set(entityKey(entityId), { destination: { x: to.x, z: to.z } });
    return this.nextPathId++;
  }

  cancel(entityId: EntityId): void {
    this.paths.delete(entityKey(entityId));
  }

  nextWaypoint(entityId: EntityId): SubunitCoord | null {
    const path = this.paths.get(entityKey(entityId));
    if (path === undefined) {
      return null;
    }
    return path.destination;
  }

  debugSnapshot(): { blocked: Uint8Array; paths: Array<{ entityId: EntityId; cells: NavCell[] }> } {
    const paths: Array<{ entityId: EntityId; cells: NavCell[] }> = [];
    for (const [key, path] of this.paths.entries()) {
      const parsed = parseEntityKey(key);
      if (parsed === null) {
        continue;
      }
      paths.push({
        entityId: parsed,
        cells: [
          {
            cx: Math.floor(path.destination.x / SUBUNITS_PER_CELL),
            cz: Math.floor(path.destination.z / SUBUNITS_PER_CELL),
          },
        ],
      });
    }
    return { blocked: new Uint8Array(this.blocked), paths };
  }

  private inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.cellsX && cz < this.cellsZ;
  }
}

function entityKey(id: EntityId): string {
  return `${String(id.index)}:${String(id.generation)}`;
}

function parseEntityKey(key: string): EntityId | null {
  const parts = key.split(':');
  if (parts.length !== 2) {
    return null;
  }
  const index = Number(parts[0]);
  const generation = Number(parts[1]);
  if (!Number.isInteger(index) || !Number.isInteger(generation)) {
    return null;
  }
  return { index, generation };
}

export function entityIdsMatch(a: EntityId, b: EntityId): boolean {
  return entityIdsEqual(a, b);
}
