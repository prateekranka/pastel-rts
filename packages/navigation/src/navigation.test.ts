import { createEntityId } from '@pastel-rts/content-schema';
import { describe, expect, it } from 'vitest';

import { NavigationGrid } from './grid';
import { NavigationService } from './navigationService';
import {
  GridPathfinder,
  pathAvoidsBlocked,
  pathCellsInBounds,
  subunitToNavCell,
} from './pathfinder';
import { DIAGONAL_CORNER_DELTAS } from './types';

function cellCenter(cx: number, cz: number) {
  return { x: cx * 1024 + 512, z: cz * 1024 + 512 };
}

describe('NavigationService pathfinding', () => {
  it('keeps paths within map bounds on a small fixture map', () => {
    const nav = new NavigationService(8, 8);
    const from = cellCenter(0, 0);
    const to = cellCenter(7, 7);
    const pathId = nav.requestPath(createEntityId(0, 1), from, to);
    const path = nav.getPathById(pathId);
    expect(path?.status).toBe('found');
    expect(pathCellsInBounds(path!.cells, 8, 8)).toBe(true);
  });

  it('avoids static blockers', () => {
    const nav = new NavigationService(8, 8);
    for (let cz = 1; cz <= 6; cz += 1) {
      nav.setBlocked(3, cz, true);
    }

    const pathId = nav.requestPath(createEntityId(1, 1), cellCenter(0, 3), cellCenter(7, 3));
    const path = nav.getPathById(pathId);
    expect(path?.status).toBe('found');
    expect(pathAvoidsBlocked(path!.cells, nav.getGrid())).toBe(true);
    for (const cell of path!.cells) {
      if (cell.cx === 3) {
        expect(cell.cz === 0 || cell.cz === 7).toBe(true);
      }
    }
  });

  it('avoids dynamic building blockers', () => {
    const nav = new NavigationService(8, 8);
    nav.setFootprintBlocked({ cx: 4, cz: 4 }, 2, 2, true);

    const pathId = nav.requestPath(createEntityId(2, 1), cellCenter(0, 0), cellCenter(7, 7));
    const path = nav.getPathById(pathId);
    expect(path?.status).toBe('found');
    expect(pathAvoidsBlocked(path!.cells, nav.getGrid())).toBe(true);
    for (const cell of path!.cells) {
      const inFootprint = cell.cx >= 4 && cell.cx <= 5 && cell.cz >= 4 && cell.cz <= 5;
      expect(inFootprint).toBe(false);
    }
  });

  it('prevents diagonal corner cutting through blocked orthogonals', () => {
    const grid = new NavigationGrid();
    grid.resize(5, 5);
    grid.setBlocked(2, 1, true);
    grid.setBlocked(1, 2, true);

    expect(grid.allowsDiagonalCorner(1, 1, 2, 2)).toBe(false);

    for (const [dx, dz] of DIAGONAL_CORNER_DELTAS) {
      const fromCx = 1;
      const fromCz = 1;
      const toCx = fromCx + dx;
      const toCz = fromCz + dz;
      grid.setBlocked(fromCx + dx, fromCz, false);
      grid.setBlocked(fromCx, fromCz + dz, false);
      grid.setBlocked(fromCx + dx, fromCz, true);
      grid.setBlocked(fromCx, fromCz + dz, true);
      expect(grid.allowsDiagonalCorner(fromCx, fromCz, toCx, toCz)).toBe(false);
      grid.setBlocked(fromCx + dx, fromCz, false);
      grid.setBlocked(fromCx, fromCz + dz, false);
    }
  });

  it('falls back predictably when destination is blocked', () => {
    const nav = new NavigationService(8, 8);
    nav.setBlocked(7, 7, true);

    const from = cellCenter(0, 0);
    const to = cellCenter(7, 7);
    const pathId = nav.requestPath(createEntityId(3, 1), from, to);
    const path = nav.getPathById(pathId);

    expect(path?.status).toBe('found');
    expect(path?.usedFallbackGoal).toBe(true);
    expect(path?.resolvedGoal).toEqual({ cx: 6, cz: 7 });

    const repeatId = nav.requestPath(createEntityId(4, 1), from, to);
    const repeat = nav.getPathById(repeatId);
    expect(repeat?.resolvedGoal).toEqual(path?.resolvedGoal);
  });

  it('returns structured failure when destination is unreachable', () => {
    const nav = new NavigationService(3, 3);
    for (let cz = 0; cz < 3; cz += 1) {
      nav.setBlocked(1, cz, true);
    }

    const pathId = nav.requestPath(createEntityId(5, 1), cellCenter(0, 0), cellCenter(2, 0));
    const path = nav.getPathById(pathId);

    expect(path?.status).toBe('blocked');
    expect(path?.failure?.code).toBe('unreachable');
    expect(path?.failure?.requestedTo).toEqual(cellCenter(2, 0));
    expect(path?.cells).toEqual([]);
  });

  it('replans deterministically after building placement', () => {
    const nav = new NavigationService(8, 8);
    const entityA = createEntityId(10, 1);
    const entityB = createEntityId(11, 1);
    const fromA = cellCenter(0, 3);
    const fromB = cellCenter(0, 4);
    const to = cellCenter(7, 3);

    nav.requestPath(entityA, fromA, to);
    nav.requestPath(entityB, fromB, to);
    const beforeA = nav.getPath(entityA)!.cells.map((c) => `${c.cx},${c.cz}`).join('|');
    const beforeB = nav.getPath(entityB)!.cells.map((c) => `${c.cx},${c.cz}`).join('|');

    nav.setFootprintBlocked({ cx: 5, cz: 2 }, 1, 3, true);

    const afterA = nav.getPath(entityA)!.cells.map((c) => `${c.cx},${c.cz}`).join('|');
    const afterB = nav.getPath(entityB)!.cells.map((c) => `${c.cx},${c.cz}`).join('|');

    expect(afterA).not.toBe(beforeA);
    expect(pathAvoidsBlocked(nav.getPath(entityA)!.cells, nav.getGrid())).toBe(true);
    expect(pathAvoidsBlocked(nav.getPath(entityB)!.cells, nav.getGrid())).toBe(true);

    nav.setFootprintBlocked({ cx: 5, cz: 2 }, 1, 3, false);
    nav.requestPath(entityA, fromA, to);
    nav.requestPath(entityB, fromB, to);
    nav.setFootprintBlocked({ cx: 5, cz: 2 }, 1, 3, true);
    const replayA = nav.getPath(entityA)!.cells.map((c) => `${c.cx},${c.cz}`).join('|');
    const replayB = nav.getPath(entityB)!.cells.map((c) => `${c.cx},${c.cz}`).join('|');
    expect(replayA).toBe(afterA);
    expect(replayB).toBe(afterB);
  });

  it('cancels stale path requests', () => {
    const nav = new NavigationService(8, 8);
    const entity = createEntityId(20, 1);
    nav.requestPath(entity, cellCenter(0, 0), cellCenter(7, 7));
    expect(nav.getPath(entity)?.status).toBe('found');

    nav.cancel(entity);
    expect(nav.getPath(entity)).toBeNull();
    expect(nav.nextWaypoint(entity)).toBeNull();
  });

  it('peeks nextWaypoint and advances when current position is supplied', () => {
    const nav = new NavigationService(8, 8);
    const entity = createEntityId(30, 1);
    nav.requestPath(entity, cellCenter(0, 0), cellCenter(2, 0));

    const first = nav.nextWaypoint(entity);
    expect(first).toEqual(cellCenter(1, 0));
    expect(nav.nextWaypoint(entity)).toEqual(first);

    expect(first).not.toBeNull();
    const second = nav.nextWaypoint(entity, first!);
    expect(second).toEqual(cellCenter(2, 0));
  });

  it('replans from the unit current position rather than the original request from', () => {
    const nav = new NavigationService(8, 8);
    const entity = createEntityId(40, 1);
    nav.requestPath(entity, cellCenter(0, 0), cellCenter(7, 0));
    nav.nextWaypoint(entity, cellCenter(3, 0));
    nav.setBlocked(0, 0, true);
    const path = nav.getPath(entity);
    expect(path?.status).toBe('found');
    expect(path?.cells[0]).toEqual({ cx: 3, cz: 0 });
  });

  it('blocks only masked footprint cells', () => {
    const nav = new NavigationService(8, 8);
    const mask = [
      [true, false],
      [true, true],
    ];
    nav.setFootprintBlocked({ cx: 2, cz: 2 }, 2, 2, true, mask);
    expect(nav.isWalkable(2, 2)).toBe(false);
    expect(nav.isWalkable(3, 2)).toBe(true);
    expect(nav.isWalkable(2, 3)).toBe(false);
    expect(nav.isWalkable(3, 3)).toBe(false);
  });
});

describe('GridPathfinder', () => {
  it('uses only 4-connected moves (no diagonal steps in path)', () => {
    const grid = new NavigationGrid();
    grid.resize(6, 6);
    const pathfinder = new GridPathfinder();
    pathfinder.resize(grid.size);

    const result = pathfinder.findPath(grid, { cx: 0, cz: 0 }, { cx: 5, cz: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    for (let i = 1; i < result.cells.length; i += 1) {
      const prev = result.cells[i - 1]!;
      const curr = result.cells[i]!;
      const dx = Math.abs(curr.cx - prev.cx);
      const dz = Math.abs(curr.cz - prev.cz);
      expect(dx + dz).toBe(1);
    }
  });
});

describe('subunitToNavCell', () => {
  it('maps subunits to cell coordinates using schema scale', () => {
    expect(subunitToNavCell({ x: 0, z: 0 })).toEqual({ cx: 0, cz: 0 });
    expect(subunitToNavCell({ x: 1023, z: 1023 })).toEqual({ cx: 0, cz: 0 });
    expect(subunitToNavCell({ x: 1024, z: 2048 })).toEqual({ cx: 1, cz: 2 });
  });
});
