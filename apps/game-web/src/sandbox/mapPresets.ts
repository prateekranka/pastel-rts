import type { MapDef } from '@pastel-rts/content-schema';
import { DEFAULT_MAP_CELLS } from '@pastel-rts/content-schema';

export const INTERACTION_LAB_ALIEN_FANTASY_ID = 'interaction-lab-alien-fantasy';

type ObstacleRect = { cx: number; cz: number; w: number; h: number };

/** Authored obstacle layout for the alien-fantasy demo map. */
const ALIEN_FANTASY_OBSTACLES: ObstacleRect[] = [
  { cx: 40, cz: 30, w: 24, h: 8 },
  { cx: 40, cz: 50, w: 24, h: 8 },
  { cx: 52, cz: 38, w: 8, h: 14 },
  { cx: 90, cz: 60, w: 30, h: 6 },
  { cx: 90, cz: 80, w: 30, h: 6 },
  { cx: 70, cz: 100, w: 40, h: 10 },
  { cx: 110, cz: 30, w: 12, h: 40 },
];

/** Cyan landmark cells (neutral props) — protected from building placement. */
export const ALIEN_FANTASY_LANDMARKS: ObstacleRect[] = [
  { cx: 25, cz: 75, w: 2, h: 2 },
  { cx: 130, cz: 45, w: 2, h: 2 },
  { cx: 80, cz: 120, w: 2, h: 2 },
];

export function applyAlienFantasyObstacles(map: MapDef): MapDef {
  const cellsX = map.cellsX;
  const cellsZ = map.cellsZ;
  const blocked = createEmptyBlocked(cellsX, cellsZ);
  for (const rect of ALIEN_FANTASY_OBSTACLES) {
    fillRect(blocked, rect, true);
  }
  return { ...map, blockedCells: blocked };
}

export function alienFantasyProtectedCells(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const rect of ALIEN_FANTASY_LANDMARKS) {
    for (let dz = 0; dz < rect.h; dz += 1) {
      for (let dx = 0; dx < rect.w; dx += 1) {
        set.add(`${String(rect.cx + dx)},${String(rect.cz + dz)}`);
      }
    }
  }
  return set;
}

export function createEmptyBlocked(cellsX: number, cellsZ: number): boolean[][] {
  const rows: boolean[][] = [];
  for (let cz = 0; cz < cellsZ; cz += 1) {
    const row: boolean[] = [];
    for (let cx = 0; cx < cellsX; cx += 1) {
      row.push(false);
    }
    rows.push(row);
  }
  return rows;
}

function fillRect(grid: boolean[][], rect: ObstacleRect, value: boolean): void {
  for (let dz = 0; dz < rect.h; dz += 1) {
    for (let dx = 0; dx < rect.w; dx += 1) {
      const cz = rect.cz + dz;
      const cx = rect.cx + dx;
      const row = grid[cz];
      if (row && cx >= 0 && cx < row.length) {
        row[cx] = value;
      }
    }
  }
}

export function defaultLabMap(): MapDef {
  return {
    schemaVersion: 1,
    id: 'lab-grid',
    displayName: 'Lab Grid',
    cellsX: DEFAULT_MAP_CELLS,
    cellsZ: DEFAULT_MAP_CELLS,
    chunkSize: 16,
  };
}

/** Narrow passage center cell between obstacle wings. */
export const ALIEN_FANTASY_NARROW_PASSAGE = { cx: 56, cz: 45 };
/** Broad passage south of central obstacles. */
export const ALIEN_FANTASY_BROAD_PASSAGE = { cx: 105, cz: 66 };
