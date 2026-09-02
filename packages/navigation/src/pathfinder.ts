import { SUBUNITS_PER_CELL, subunitToCell } from '@pastel-rts/content-schema';
import type { SubunitCoord } from '@pastel-rts/content-schema';

import type { NavigationGrid } from './grid';
import { NEIGHBOR_DELTAS, type NavCell } from './types';

const UNVISITED = -1;

export type PathSearchResult =
  | { ok: true; cells: NavCell[]; goal: NavCell; usedFallback: boolean }
  | { ok: false; code: 'unreachable' | 'out-of-bounds'; goal: NavCell };

type HeapEntry = { index: number; f: number; cx: number; cz: number };

export class GridPathfinder {
  private gScore: Int32Array = new Int32Array(0);
  private cameFrom: Int32Array = new Int32Array(0);
  private visitStamp: Int32Array = new Int32Array(0);
  private currentStamp = 1;
  private openHeap: HeapEntry[] = [];
  private readonly scratchPath: NavCell[] = [];

  resize(cellCount: number): void {
    this.gScore = new Int32Array(cellCount);
    this.cameFrom = new Int32Array(cellCount);
    this.visitStamp = new Int32Array(cellCount);
  }

  findPath(
    grid: NavigationGrid,
    start: NavCell,
    requestedGoal: NavCell,
  ): PathSearchResult {
    if (!grid.inBounds(requestedGoal.cx, requestedGoal.cz)) {
      return { ok: false, code: 'out-of-bounds', goal: requestedGoal };
    }

    if (!grid.isWalkable(start.cx, start.cz)) {
      return { ok: false, code: 'unreachable', goal: requestedGoal };
    }

    const resolved = this.resolveGoal(grid, start, requestedGoal);
    if (resolved === null) {
      return { ok: false, code: 'unreachable', goal: requestedGoal };
    }

    const usedFallback =
      resolved.cx !== requestedGoal.cx || resolved.cz !== requestedGoal.cz;

    const path = this.runAStar(grid, start, resolved);
    if (path.length === 0) {
      return { ok: false, code: 'unreachable', goal: requestedGoal };
    }

    return { ok: true, cells: path, goal: resolved, usedFallback };
  }

  /**
   * When the requested cell is blocked, pick the nearest walkable cell that is
   * reachable from start. When the requested cell is walkable but separated by
   * walls, return null (structured unreachable failure).
   */
  private resolveGoal(
    grid: NavigationGrid,
    start: NavCell,
    requestedGoal: NavCell,
  ): NavCell | null {
    if (grid.isWalkable(requestedGoal.cx, requestedGoal.cz)) {
      const direct = this.runAStar(grid, start, requestedGoal);
      if (direct.length > 0) {
        return requestedGoal;
      }
      return null;
    }
    return this.nearestReachableWalkableNearGoal(grid, start, requestedGoal);
  }

  /**
   * Expands rings from a blocked requested goal in deterministic order:
   * increasing Manhattan distance, then cx, then cz.
   */
  nearestReachableWalkableNearGoal(
    grid: NavigationGrid,
    start: NavCell,
    requestedGoal: NavCell,
  ): NavCell | null {
    const maxRadius = grid.width + grid.height;
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      const candidates: NavCell[] = [];
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.abs(dx) + Math.abs(dz) !== radius) {
            continue;
          }
          const cx = requestedGoal.cx + dx;
          const cz = requestedGoal.cz + dz;
          if (grid.isWalkable(cx, cz)) {
            candidates.push({ cx, cz });
          }
        }
      }
      candidates.sort((a, b) => {
        if (a.cx !== b.cx) {
          return a.cx - b.cx;
        }
        return a.cz - b.cz;
      });
      for (const candidate of candidates) {
        const path = this.runAStar(grid, start, candidate);
        if (path.length > 0) {
          return candidate;
        }
      }
    }
    return null;
  }

  private runAStar(grid: NavigationGrid, start: NavCell, goal: NavCell): NavCell[] {
    this.currentStamp += 1;
    if (this.currentStamp >= 0x7ffffff0) {
      this.visitStamp.fill(0);
      this.currentStamp = 1;
    }

    const startIndex = grid.toIndex(start.cx, start.cz);
    const goalIndex = grid.toIndex(goal.cx, goal.cz);

    this.openHeap.length = 0;
    this.markVisited(startIndex, 0, UNVISITED);

    const startF = this.heuristic(start, goal);
    this.pushOpen(startIndex, startF, start.cx, start.cz);

    while (this.openHeap.length > 0) {
      const current = this.popOpen();
      const currentIndex = current.index;
      if (currentIndex === goalIndex) {
        return this.reconstructPath(grid, currentIndex);
      }

      const currentCell = grid.fromIndex(currentIndex);
      for (const [dx, dz] of NEIGHBOR_DELTAS) {
        const ncx = currentCell.cx + dx;
        const ncz = currentCell.cz + dz;
        if (!grid.inBounds(ncx, ncz) || !grid.isWalkable(ncx, ncz)) {
          continue;
        }
        const neighborIndex = grid.toIndex(ncx, ncz);
        const tentativeG = this.gScore[currentIndex]! + 1;
        if (!this.isVisited(neighborIndex) || tentativeG < this.gScore[neighborIndex]!) {
          this.markVisited(neighborIndex, tentativeG, currentIndex);
          const f = tentativeG + this.heuristic({ cx: ncx, cz: ncz }, goal);
          this.pushOpen(neighborIndex, f, ncx, ncz);
        }
      }
    }

    this.scratchPath.length = 0;
    return this.scratchPath;
  }

  private reconstructPath(grid: NavigationGrid, goalIndex: number): NavCell[] {
    this.scratchPath.length = 0;
    let current = goalIndex;
    while (current !== UNVISITED) {
      this.scratchPath.push(grid.fromIndex(current));
      current = this.cameFrom[current]!;
    }
    this.scratchPath.reverse();
    return this.scratchPath.slice();
  }

  private heuristic(a: NavCell, b: NavCell): number {
    return Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
  }

  private isVisited(index: number): boolean {
    return this.visitStamp[index] === this.currentStamp;
  }

  private markVisited(index: number, g: number, from: number): void {
    this.visitStamp[index] = this.currentStamp;
    this.gScore[index] = g;
    this.cameFrom[index] = from;
  }

  private pushOpen(index: number, f: number, cx: number, cz: number): void {
    this.openHeap.push({ index, f, cx, cz });
    this.bubbleUp(this.openHeap.length - 1);
  }

  private popOpen(): HeapEntry {
    const top = this.openHeap[0]!;
    const last = this.openHeap.pop();
    if (this.openHeap.length > 0 && last !== undefined) {
      this.openHeap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private compareOpen(a: HeapEntry, b: HeapEntry): number {
    if (a.f !== b.f) {
      return a.f - b.f;
    }
    if (a.cz !== b.cz) {
      return a.cz - b.cz;
    }
    return a.cx - b.cx;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compareOpen(this.openHeap[index]!, this.openHeap[parent]!) >= 0) {
        break;
      }
      this.swapOpen(index, parent);
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.openHeap.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.compareOpen(this.openHeap[left]!, this.openHeap[smallest]!) < 0) {
        smallest = left;
      }
      if (right < length && this.compareOpen(this.openHeap[right]!, this.openHeap[smallest]!) < 0) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      this.swapOpen(index, smallest);
      index = smallest;
    }
  }

  private swapOpen(a: number, b: number): void {
    const tmp = this.openHeap[a]!;
    this.openHeap[a] = this.openHeap[b]!;
    this.openHeap[b] = tmp;
  }
}

export function subunitToNavCell(coord: SubunitCoord): NavCell {
  return {
    cx: subunitToCell(coord.x),
    cz: subunitToCell(coord.z),
  };
}

export function navCellCenterSubunits(cell: NavCell): SubunitCoord {
  return {
    x: cell.cx * SUBUNITS_PER_CELL + Math.floor(SUBUNITS_PER_CELL / 2),
    z: cell.cz * SUBUNITS_PER_CELL + Math.floor(SUBUNITS_PER_CELL / 2),
  };
}

export function clampSubunitToMapBounds(coord: SubunitCoord, cellsX: number, cellsZ: number): SubunitCoord {
  const maxX = cellsX * SUBUNITS_PER_CELL - 1;
  const maxZ = cellsZ * SUBUNITS_PER_CELL - 1;
  return {
    x: Math.max(0, Math.min(maxX, coord.x)),
    z: Math.max(0, Math.min(maxZ, coord.z)),
  };
}

export function pathCellsInBounds(cells: NavCell[], cellsX: number, cellsZ: number): boolean {
  for (const cell of cells) {
    if (cell.cx < 0 || cell.cz < 0 || cell.cx >= cellsX || cell.cz >= cellsZ) {
      return false;
    }
  }
  return true;
}

export function pathAvoidsBlocked(cells: NavCell[], grid: NavigationGrid): boolean {
  for (const cell of cells) {
    if (!grid.isWalkable(cell.cx, cell.cz)) {
      return false;
    }
  }
  return true;
}
