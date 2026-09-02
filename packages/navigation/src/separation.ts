import type { SubunitCoord } from '@pastel-rts/content-schema';

import type { NavigationGrid } from './grid';
import { subunitToNavCell } from './pathfinder';
import { compareEntityIds, type SeparationUnit } from './types';

const MIN_SEPARATION_SUBUNITS = 256;

export type SeparationResult = {
  entityId: SeparationUnit['entityId'];
  position: SubunitCoord;
  moved: boolean;
};

/**
 * Lightweight deterministic separation pass. Units are processed in entity-id
 * order; each displacement is clamped to remain in a walkable cell and cannot
 * cut diagonal corners through blocked orthogonals.
 */
export function applyLocalSeparation(
  grid: NavigationGrid,
  units: SeparationUnit[],
  iterations = 2,
): SeparationResult[] {
  const sorted = units.slice().sort((a, b) => compareEntityIds(a.entityId, b.entityId));
  const positions = sorted.map((unit) => ({ ...unit.position }));
  const radii = sorted.map((unit) => unit.radiusSubunits);

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < sorted.length; i += 1) {
      let pushX = 0;
      let pushZ = 0;
      for (let j = 0; j < sorted.length; j += 1) {
        if (i === j) {
          continue;
        }
        const dx = positions[i]!.x - positions[j]!.x;
        const dz = positions[i]!.z - positions[j]!.z;
        const minDist = radii[i]! + radii[j]!;
        const distSq = dx * dx + dz * dz;
        if (distSq === 0) {
          pushX += MIN_SEPARATION_SUBUNITS;
          continue;
        }
        if (distSq >= minDist * minDist) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        pushX += (dx / dist) * overlap;
        pushZ += (dz / dist) * overlap;
      }
      if (pushX === 0 && pushZ === 0) {
        continue;
      }
      const next = clampSeparationMove(grid, positions[i]!, pushX, pushZ);
      positions[i] = next;
    }
  }

  return sorted.map((unit, index) => ({
    entityId: unit.entityId,
    position: positions[index]!,
    moved: positions[index]!.x !== unit.position.x || positions[index]!.z !== unit.position.z,
  }));
}

function clampSeparationMove(
  grid: NavigationGrid,
  current: SubunitCoord,
  pushX: number,
  pushZ: number,
): SubunitCoord {
  const fromCell = subunitToNavCell(current);
  const candidates: SubunitCoord[] = [
    { x: current.x + Math.round(pushX), z: current.z + Math.round(pushZ) },
    { x: current.x + Math.round(pushX), z: current.z },
    { x: current.x, z: current.z + Math.round(pushZ) },
    current,
  ];

  for (const candidate of candidates) {
    const cell = subunitToNavCell(candidate);
    if (!grid.isWalkable(cell.cx, cell.cz)) {
      continue;
    }
    if (
      cell.cx !== fromCell.cx ||
      cell.cz !== fromCell.cz
    ) {
      if (!grid.allowsDiagonalCorner(fromCell.cx, fromCell.cz, cell.cx, cell.cz)) {
        continue;
      }
    }
    return candidate;
  }

  return current;
}

export function separationRespectsBlockers(
  grid: NavigationGrid,
  results: SeparationResult[],
): boolean {
  for (const result of results) {
    const cell = subunitToNavCell(result.position);
    if (!grid.isWalkable(cell.cx, cell.cz)) {
      return false;
    }
  }
  return true;
}
