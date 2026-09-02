import { SUBUNITS_PER_CELL } from '@pastel-rts/content-schema';
import type { EntityId, SubunitCoord } from '@pastel-rts/content-schema';

import type { NavigationGrid } from './grid';
import { navCellCenterSubunits, subunitToNavCell } from './pathfinder';
import {
  DEFAULT_FORMATION_SPACING_SUBUNITS,
  NEIGHBOR_DELTAS,
  compareEntityIds,
  type FormationKind,
  type FormationSlot,
  type NavCell,
} from './types';

export type FormationPlanInput = {
  entityIds: EntityId[];
  destination: SubunitCoord;
  kind: FormationKind;
  spacingSubunits?: number;
  /** Optional approach direction for line/box facing. Defaults to +Z. */
  facingMilli?: number;
};

export function planFormationSlots(
  grid: NavigationGrid,
  input: FormationPlanInput,
): FormationSlot[] {
  const spacing = input.spacingSubunits ?? DEFAULT_FORMATION_SPACING_SUBUNITS;
  const sortedIds = input.entityIds.slice().sort(compareEntityIds);
  const count = sortedIds.length;
  if (count === 0) {
    return [];
  }

  const destCell = subunitToNavCell(input.destination);
  const offsets = computeSlotOffsets(input.kind, count, spacing, input.facingMilli ?? 0);
  const usedCells = new Set<number>();
  const slots: FormationSlot[] = [];

  for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
    const entityId = sortedIds[slotIndex]!;
    const offset = offsets[slotIndex]!;
    const rawTarget: SubunitCoord = {
      x: input.destination.x + offset.dx,
      z: input.destination.z + offset.dz,
    };
    const projected = projectSlotToWalkable(grid, destCell, rawTarget, usedCells);
    usedCells.add(grid.toIndex(projected.cell.cx, projected.cell.cz));
    slots.push({
      entityId,
      slotIndex,
      target: projected.target,
    });
  }

  return slots;
}

type SlotOffset = { dx: number; dz: number };

function computeSlotOffsets(
  kind: FormationKind,
  count: number,
  spacing: number,
  facingMilli: number,
): SlotOffset[] {
  if (kind === 'none') {
    return computeLooseOffsets(count, spacing);
  }
  if (kind === 'line') {
    return computeLineOffsets(count, spacing, facingMilli);
  }
  return computeBoxOffsets(count, spacing);
}

/** Loose spread around the destination (schema `none`). */
function computeLooseOffsets(count: number, spacing: number): SlotOffset[] {
  if (count === 1) {
    return [{ dx: 0, dz: 0 }];
  }
  const offsets: SlotOffset[] = [{ dx: 0, dz: 0 }];
  let ring = 1;
  while (offsets.length < count) {
    for (let dx = -ring; dx <= ring && offsets.length < count; dx += 1) {
      for (let dz = -ring; dz <= ring && offsets.length < count; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) {
          continue;
        }
        offsets.push({ dx: dx * spacing, dz: dz * spacing });
      }
    }
    ring += 1;
  }
  return offsets;
}

function computeLineOffsets(count: number, spacing: number, facingMilli: number): SlotOffset[] {
  const angle = facingMilli / 1000;
  const perpX = Math.cos(angle + Math.PI / 2);
  const perpZ = Math.sin(angle + Math.PI / 2);
  const center = (count - 1) / 2;
  const offsets: SlotOffset[] = [];
  for (let i = 0; i < count; i += 1) {
    const along = i - center;
    offsets.push({
      dx: Math.round(perpX * spacing * along),
      dz: Math.round(perpZ * spacing * along),
    });
  }
  return offsets;
}

/** Compact box formation (schema `box`). */
function computeBoxOffsets(count: number, spacing: number): SlotOffset[] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const offsets: SlotOffset[] = [];
  const startX = -Math.floor((cols - 1) / 2) * spacing;
  const startZ = -Math.floor((rows - 1) / 2) * spacing;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (offsets.length >= count) {
        break;
      }
      offsets.push({
        dx: startX + col * spacing,
        dz: startZ + row * spacing,
      });
    }
  }
  return offsets;
}

function projectSlotToWalkable(
  grid: NavigationGrid,
  anchorCell: NavCell,
  rawTarget: SubunitCoord,
  reservedCells: Set<number>,
): { cell: NavCell; target: SubunitCoord } {
  const rawCell = subunitToNavCell(rawTarget);
  const candidate = findNearestLegalCell(grid, rawCell, anchorCell, reservedCells);
  return {
    cell: candidate,
    target: navCellCenterSubunits(candidate),
  };
}

function findNearestLegalCell(
  grid: NavigationGrid,
  preferred: NavCell,
  anchor: NavCell,
  reservedCells: Set<number>,
): NavCell {
  const maxRadius = grid.width + grid.height;
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    const candidates: NavCell[] = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) + Math.abs(dz) !== radius) {
          continue;
        }
        const cx = preferred.cx + dx;
        const cz = preferred.cz + dz;
        if (!grid.isWalkable(cx, cz)) {
          continue;
        }
        const index = grid.toIndex(cx, cz);
        if (reservedCells.has(index)) {
          continue;
        }
        candidates.push({ cx, cz });
      }
    }
    candidates.sort((a, b) => {
      const distA = Math.abs(a.cx - anchor.cx) + Math.abs(a.cz - anchor.cz);
      const distB = Math.abs(b.cx - anchor.cx) + Math.abs(b.cz - anchor.cz);
      if (distA !== distB) {
        return distA - distB;
      }
      if (a.cx !== b.cx) {
        return a.cx - b.cx;
      }
      return a.cz - b.cz;
    });
    if (candidates.length > 0) {
      return candidates[0]!;
    }
  }
  return preferred;
}

export function formationSlotCellsUnique(slots: FormationSlot[], grid: NavigationGrid): boolean {
  const seen = new Set<number>();
  for (const slot of slots) {
    const cell = subunitToNavCell(slot.target);
    const key = grid.toIndex(cell.cx, cell.cz);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

export function snapSubunitToCellCenter(coord: SubunitCoord): SubunitCoord {
  const cell = subunitToNavCell(coord);
  return navCellCenterSubunits(cell);
}

export function cellSpacingSubunits(): number {
  return SUBUNITS_PER_CELL;
}

/** Deterministic spiral search used by slot projection tests. */
export function walkableNeighbors(grid: NavigationGrid, cell: NavCell): NavCell[] {
  const result: NavCell[] = [];
  for (const [dx, dz] of NEIGHBOR_DELTAS) {
    const cx = cell.cx + dx;
    const cz = cell.cz + dz;
    if (grid.isWalkable(cx, cz)) {
      result.push({ cx, cz });
    }
  }
  return result;
}
