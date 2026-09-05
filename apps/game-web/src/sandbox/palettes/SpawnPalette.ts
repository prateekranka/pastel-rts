import type { BuildingArchetype, PackV2, UnitArchetype } from '@pastel-rts/content-schema';
import { MIN_TOUCH_TARGET_CSS } from '../../input/gestureConstants';

export type PaletteEntry = {
  archetypeId: string;
  displayName: string;
};

export class SpawnPalette {
  private pack: PackV2;
  private readonly factionId: string;

  constructor(pack: PackV2, factionId: string) {
    this.pack = pack;
    this.factionId = factionId;
  }

  setPack(pack: PackV2): void {
    this.pack = pack;
  }

  list(): PaletteEntry[] {
    return this.pack.units
      .filter((unit) => unit.enabled && unit.factionId === this.factionId)
      .map((unit) => ({ archetypeId: unit.id, displayName: unit.displayName }));
  }

  get(archetypeId: string): UnitArchetype | undefined {
    return this.pack.units.find((unit) => unit.id === archetypeId && unit.enabled);
  }
}

export class BuildPalette {
  private pack: PackV2;
  private readonly factionId: string;

  constructor(pack: PackV2, factionId: string) {
    this.pack = pack;
    this.factionId = factionId;
  }

  setPack(pack: PackV2): void {
    this.pack = pack;
  }

  list(): PaletteEntry[] {
    return this.pack.buildings
      .filter((building) => building.enabled && building.factionId === this.factionId)
      .map((building) => ({ archetypeId: building.id, displayName: building.displayName }));
  }

  get(archetypeId: string): BuildingArchetype | undefined {
    return this.pack.buildings.find((building) => building.id === archetypeId && building.enabled);
  }
}

export function refreshPaletteOptions(select: HTMLSelectElement, entries: readonly PaletteEntry[]): void {
  const selected = select.value;
  select.replaceChildren();
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.archetypeId;
    option.textContent = entry.displayName;
    select.append(option);
  }
  if (entries.some((entry) => entry.archetypeId === selected)) {
    select.value = selected;
  }
  select.style.minHeight = `${MIN_TOUCH_TARGET_CSS}px`;
}
