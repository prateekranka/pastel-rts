import { DEFAULT_MAP_CELLS } from '@pastel-rts/content-schema';
import type { MapDef } from '@pastel-rts/content-schema';

import { NEIGHBOR_DELTAS, type NavCell } from './types';

export class NavigationGrid {
  private cellsX = DEFAULT_MAP_CELLS;
  private cellsZ = DEFAULT_MAP_CELLS;
  private staticBlocked: Uint8Array = new Uint8Array(0);
  private dynamicBlocked: Uint8Array = new Uint8Array(0);
  /** Walkable cells that reject building placement. */
  private nonBuildableWalkable: Uint8Array = new Uint8Array(0);
  private hasAuthoredStaticBlockers = false;

  resize(cellsX: number, cellsZ: number): void {
    this.cellsX = cellsX;
    this.cellsZ = cellsZ;
    const size = cellsX * cellsZ;
    this.staticBlocked = new Uint8Array(size);
    this.dynamicBlocked = new Uint8Array(size);
    this.nonBuildableWalkable = new Uint8Array(size);
    this.hasAuthoredStaticBlockers = false;
  }

  get width(): number {
    return this.cellsX;
  }

  get height(): number {
    return this.cellsZ;
  }

  get size(): number {
    return this.cellsX * this.cellsZ;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.cellsX && cz < this.cellsZ;
  }

  toIndex(cx: number, cz: number): number {
    return cz * this.cellsX + cx;
  }

  fromIndex(index: number): NavCell {
    return { cx: index % this.cellsX, cz: Math.floor(index / this.cellsX) };
  }

  /**
   * Loads static blockers from a map definition. When `blockedCells` is absent,
   * only dynamic building blockers apply (buildings-only extra blockers default).
   */
  applyMapDef(map: MapDef): void {
    this.resize(map.cellsX, map.cellsZ);
    this.staticBlocked.fill(0);
    this.dynamicBlocked.fill(0);
    this.nonBuildableWalkable.fill(0);
    this.hasAuthoredStaticBlockers = map.blockedCells !== undefined;
    if (map.blockedCells !== undefined) {
      for (let cz = 0; cz < map.cellsZ; cz += 1) {
        const row = map.blockedCells[cz];
        if (row === undefined) {
          continue;
        }
        for (let cx = 0; cx < map.cellsX; cx += 1) {
          if (row[cx]) {
            this.staticBlocked[this.toIndex(cx, cz)] = 1;
          }
        }
      }
    }
  }

  usesAuthoredStaticBlockers(): boolean {
    return this.hasAuthoredStaticBlockers;
  }

  setBlocked(cx: number, cz: number, blocked: boolean): void {
    if (!this.inBounds(cx, cz)) {
      return;
    }
    this.staticBlocked[this.toIndex(cx, cz)] = blocked ? 1 : 0;
  }

  setNonBuildableWalkable(cx: number, cz: number, enabled: boolean): void {
    if (!this.inBounds(cx, cz)) {
      return;
    }
    this.nonBuildableWalkable[this.toIndex(cx, cz)] = enabled ? 1 : 0;
  }

  setFootprintBlocked(
    origin: NavCell,
    cellsW: number,
    cellsH: number,
    blocked: boolean,
    mask?: ReadonlyArray<readonly boolean[]>,
  ): void {
    for (let dz = 0; dz < cellsH; dz += 1) {
      for (let dx = 0; dx < cellsW; dx += 1) {
        if (mask !== undefined && !(mask[dz]?.[dx] ?? true)) {
          continue;
        }
        const cx = origin.cx + dx;
        const cz = origin.cz + dz;
        if (!this.inBounds(cx, cz)) {
          continue;
        }
        this.dynamicBlocked[this.toIndex(cx, cz)] = blocked ? 1 : 0;
      }
    }
  }

  isStaticBlocked(cx: number, cz: number): boolean {
    if (!this.inBounds(cx, cz)) {
      return true;
    }
    return this.staticBlocked[this.toIndex(cx, cz)] === 1;
  }

  isDynamicBlocked(cx: number, cz: number): boolean {
    if (!this.inBounds(cx, cz)) {
      return true;
    }
    return this.dynamicBlocked[this.toIndex(cx, cz)] === 1;
  }

  isBlocked(cx: number, cz: number): boolean {
    return this.isStaticBlocked(cx, cz) || this.isDynamicBlocked(cx, cz);
  }

  isWalkable(cx: number, cz: number): boolean {
    return this.inBounds(cx, cz) && !this.isBlocked(cx, cz);
  }

  isBuildable(cx: number, cz: number): boolean {
    if (!this.isWalkable(cx, cz)) {
      return false;
    }
    return this.nonBuildableWalkable[this.toIndex(cx, cz)] === 0;
  }

  classifyCell(cx: number, cz: number): 'walkable' | 'blocked' | 'buildable' | 'non-buildable-walkable' {
    if (!this.inBounds(cx, cz) || this.isBlocked(cx, cz)) {
      return 'blocked';
    }
    if (this.nonBuildableWalkable[this.toIndex(cx, cz)] === 1) {
      return 'non-buildable-walkable';
    }
    return 'buildable';
  }

  /** Combined blocked mask for debug overlays (static | dynamic). */
  blockedMask(): Uint8Array {
    const mask = new Uint8Array(this.size);
    for (let i = 0; i < this.size; i += 1) {
      mask[i] = (this.staticBlocked[i] ?? 0) | (this.dynamicBlocked[i] ?? 0);
    }
    return mask;
  }

  /**
   * Deterministic neighbour list for pathfinding expansions.
   * Skips out-of-bounds neighbours. No diagonal moves.
   */
  forEachNeighbor(cx: number, cz: number, visit: (ncx: number, ncz: number) => void): void {
    for (const [dx, dz] of NEIGHBOR_DELTAS) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (this.inBounds(ncx, ncz)) {
        visit(ncx, ncz);
      }
    }
  }

  /**
   * Returns false when a diagonal step would cut through two blocked orthogonals.
   * Used to guard sub-cell corner cutting during separation projections.
   */
  allowsDiagonalCorner(fromCx: number, fromCz: number, toCx: number, toCz: number): boolean {
    const dx = toCx - fromCx;
    const dz = toCz - fromCz;
    if (dx === 0 || dz === 0) {
      return true;
    }
    if (Math.abs(dx) !== 1 || Math.abs(dz) !== 1) {
      return false;
    }
    const orthABlocked = this.isBlocked(fromCx + dx, fromCz);
    const orthBBlocked = this.isBlocked(fromCx, fromCz + dz);
    return !orthABlocked && !orthBBlocked;
  }
}
