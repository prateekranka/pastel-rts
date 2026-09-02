import type { FactionId, PackV2, PlayableFactionId } from '@pastel-rts/content-schema';
import { worldFloatToSubunit } from '@pastel-rts/content-schema';

export type SpawnPaletteEntry = {
  archetypeId: string;
  displayName: string;
  factionId: FactionId;
  tags: string[];
};

export type BuildPaletteEntry = {
  archetypeId: string;
  displayName: string;
  factionId: FactionId;
  footprintCells: { w: number; h: number };
};

/** Sandbox spawn palette derived from Pack v2. */
export class SpawnPalette {
  private readonly entries: SpawnPaletteEntry[];

  constructor(pack: PackV2, filterFaction?: PlayableFactionId) {
    this.entries = pack.units
      .filter((unit) => unit.enabled && (filterFaction === undefined || unit.factionId === filterFaction))
      .map((unit) => ({
        archetypeId: unit.id,
        displayName: unit.displayName,
        factionId: unit.factionId,
        tags: unit.tags ?? [],
      }));
  }

  list(): readonly SpawnPaletteEntry[] {
    return this.entries;
  }

  findByTag(tag: string): SpawnPaletteEntry | undefined {
    return this.entries.find((entry) => entry.tags.includes(tag));
  }

  defaultInfantry(factionId: PlayableFactionId): SpawnPaletteEntry | undefined {
    return (
      this.entries.find((entry) => entry.factionId === factionId && entry.tags.includes('infantry')) ??
      this.entries.find((entry) => entry.factionId === factionId)
    );
  }

  defaultWalker(factionId: PlayableFactionId): SpawnPaletteEntry | undefined {
    return this.entries.find((entry) => entry.factionId === factionId && entry.tags.includes('walker'));
  }

  spawnPosition(worldX: number, worldZ: number): { x: number; z: number } {
    return {
      x: worldFloatToSubunit(worldX),
      z: worldFloatToSubunit(worldZ),
    };
  }
}

/** Building placement palette derived from Pack v2. */
export class BuildPalette {
  private readonly entries: BuildPaletteEntry[];

  constructor(pack: PackV2, filterFaction?: PlayableFactionId) {
    this.entries = pack.buildings
      .filter(
        (building) =>
          building.enabled && (filterFaction === undefined || building.factionId === filterFaction),
      )
      .map((building) => ({
        archetypeId: building.id,
        displayName: building.displayName,
        factionId: building.factionId,
        footprintCells: {
          w: building.footprint.cellsW,
          h: building.footprint.cellsH,
        },
      }));
  }

  list(): readonly BuildPaletteEntry[] {
    return this.entries;
  }

  find(id: string): BuildPaletteEntry | undefined {
    return this.entries.find((entry) => entry.archetypeId === id);
  }
}
