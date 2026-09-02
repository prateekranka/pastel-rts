import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
} from 'three';
import type { BuildingArchetype, CellCoord, PackV2 } from '@pastel-rts/content-schema';
import { CELL_SIZE } from '../../config/constants';
import { footprintDimensions } from '../../buildings/placementValidation';
import type { PlacementValidationResult } from '../../buildings/placementValidation';

/** Semi-transparent building footprint preview for placement mode. */
export class PlacementGhost {
  private readonly scene: Scene;
  private readonly group = new Group();
  private readonly validMaterial = new MeshBasicMaterial({
    color: 0x44cc88,
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
    depthWrite: false,
  });
  private readonly invalidMaterial = new MeshBasicMaterial({
    color: 0xcc4444,
    transparent: true,
    opacity: 0.4,
    side: DoubleSide,
    depthWrite: false,
  });
  private visible = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.name = 'placement-ghost';
    this.scene.add(this.group);
  }

  hide(): void {
    this.visible = false;
    this.group.visible = false;
  }

  showAt(params: {
    archetype: BuildingArchetype;
    originCell: CellCoord;
    validation: PlacementValidationResult;
  }): void {
    this.clear();
    const { cellsW, cellsH } = footprintDimensions(params.archetype.footprint);
    const material = params.validation.valid ? this.validMaterial : this.invalidMaterial;
    const mesh = new Mesh(new BoxGeometry(cellsW * CELL_SIZE, 0.08, cellsH * CELL_SIZE), material);
    mesh.position.set(
      params.originCell.cx + cellsW / 2,
      0.04,
      params.originCell.cz + cellsH / 2,
    );
    this.group.add(mesh);
    this.visible = true;
    this.group.visible = true;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
    this.validMaterial.dispose();
    this.invalidMaterial.dispose();
  }

  isVisible(): boolean {
    return this.visible;
  }

  private clear(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0]!;
      this.group.remove(child);
      if (child instanceof Mesh) {
        child.geometry.dispose();
      }
    }
  }
}

export type BuildingPlacementMode = {
  active: boolean;
  archetypeId: string | null;
};

/** Tracks building placement mode and issues placeBuilding via callback. */
export class BuildingPlacementController {
  private mode: BuildingPlacementMode = { active: false, archetypeId: null };
  private readonly pack: PackV2;
  private readonly ghost: PlacementGhost;
  private readonly onPlace: (archetypeId: string, originCell: CellCoord) => void;
  private validate: (archetypeId: string, originCell: CellCoord) => PlacementValidationResult;

  constructor(options: {
    scene: Scene;
    pack: PackV2;
    onPlace: (archetypeId: string, originCell: CellCoord) => void;
    validate: (archetypeId: string, originCell: CellCoord) => PlacementValidationResult;
  }) {
    this.pack = options.pack;
    this.ghost = new PlacementGhost(options.scene);
    this.onPlace = options.onPlace;
    this.validate = options.validate;
  }

  setValidator(validate: (archetypeId: string, originCell: CellCoord) => PlacementValidationResult): void {
    this.validate = validate;
  }

  enterPlacement(archetypeId: string): void {
    this.mode = { active: true, archetypeId };
  }

  cancelPlacement(): void {
    this.mode = { active: false, archetypeId: null };
    this.ghost.hide();
  }

  isActive(): boolean {
    return this.mode.active;
  }

  getActiveArchetypeId(): string | null {
    return this.mode.archetypeId;
  }

  previewAt(originCell: CellCoord): PlacementValidationResult | null {
    if (!this.mode.active || !this.mode.archetypeId) {
      return null;
    }
    const archetype = this.pack.buildings.find((entry) => entry.id === this.mode.archetypeId);
    if (!archetype) {
      return { valid: false, reason: 'unknown-archetype' };
    }
    const validation = this.validate(this.mode.archetypeId, originCell);
    this.ghost.showAt({ archetype, originCell, validation });
    return validation;
  }

  tapPlace(originCell: CellCoord): PlacementValidationResult {
    if (!this.mode.active || !this.mode.archetypeId) {
      return { valid: false, reason: 'malformed' };
    }
    const validation = this.validate(this.mode.archetypeId, originCell);
    if (validation.valid) {
      this.onPlace(this.mode.archetypeId, originCell);
      this.cancelPlacement();
    } else {
      this.previewAt(originCell);
    }
    return validation;
  }

  dispose(): void {
    this.ghost.dispose();
  }
}
