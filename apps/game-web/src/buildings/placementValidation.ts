import type { BuildingArchetype, CellCoord, Footprint, PackV2 } from '@pastel-rts/content-schema';
import { SUBUNITS_PER_CELL } from '@pastel-rts/content-schema';
import type { NavigationService } from '@pastel-rts/navigation';

export type PlacementValidationResult =
  | { valid: true }
  | { valid: false; reason: 'out-of-bounds' | 'overlap' | 'non-buildable' | 'protected' | 'unknown-archetype' | 'malformed' };

export function footprintDimensions(footprint: Footprint): { cellsW: number; cellsH: number } {
  return { cellsW: footprint.cellsW, cellsH: footprint.cellsH };
}

/** Client-side preview validation mirroring worker placeBuilding rules. */
export function validateBuildingPlacement(params: {
  pack: PackV2;
  nav: Pick<NavigationService, 'isWalkable'>;
  archetypeId: string;
  originCell: CellCoord;
  cellsX?: number;
  cellsZ?: number;
  protectedCells?: ReadonlySet<string>;
}): PlacementValidationResult {
  const cellsX = params.cellsX ?? 160;
  const cellsZ = params.cellsZ ?? 160;
  const archetype = params.pack.buildings.find((entry) => entry.id === params.archetypeId && entry.enabled);
  if (!archetype) {
    return { valid: false, reason: 'unknown-archetype' };
  }
  if (!archetype.footprint || archetype.footprint.cellsW < 1 || archetype.footprint.cellsH < 1) {
    return { valid: false, reason: 'malformed' };
  }
  const { cellsW, cellsH } = footprintDimensions(archetype.footprint);
  for (let dz = 0; dz < cellsH; dz += 1) {
    for (let dx = 0; dx < cellsW; dx += 1) {
      const cx = params.originCell.cx + dx;
      const cz = params.originCell.cz + dz;
      if (cx < 0 || cz < 0 || cx >= cellsX || cz >= cellsZ) {
        return { valid: false, reason: 'out-of-bounds' };
      }
      const key = cellKey(cx, cz);
      if (params.protectedCells?.has(key)) {
        return { valid: false, reason: 'protected' };
      }
      if (!params.nav.isWalkable(cx, cz)) {
        return { valid: false, reason: 'overlap' };
      }
    }
  }
  return { valid: true };
}

export function findBuildingArchetype(pack: PackV2, id: string): BuildingArchetype | undefined {
  return pack.buildings.find((building) => building.id === id && building.enabled);
}

export function originCellFromWorld(x: number, z: number): CellCoord {
  return {
    cx: Math.floor(x),
    cz: Math.floor(z),
  };
}

export function footprintWorldCenter(origin: CellCoord, cellsW: number, cellsH: number): { x: number; z: number } {
  return {
    x: origin.cx + cellsW / 2,
    z: origin.cz + cellsH / 2,
  };
}

export function cellKey(cx: number, cz: number): string {
  return `${String(cx)},${String(cz)}`;
}

export function subunitCellCenter(cx: number, cz: number): { x: number; z: number } {
  return {
    x: cx * SUBUNITS_PER_CELL + Math.floor(SUBUNITS_PER_CELL / 2),
    z: cz * SUBUNITS_PER_CELL + Math.floor(SUBUNITS_PER_CELL / 2),
  };
}
