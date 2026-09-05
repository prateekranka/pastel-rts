import type { PackV2 } from './pack';
import { sha256Hex } from './sha256';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type ContentAssetHash = {
  assetPath: string;
  sha256: string;
  kind?: 'runtime' | 'data';
};

export function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined && key !== 'contentHash')
      .sort();
    const result: { [key: string]: JsonValue } = {};
    for (const key of keys) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }
  throw new Error('Unsupported value in canonical content');
}

export function computeContentHash(content: unknown): string {
  const canonical = canonicalize(content);
  const json = JSON.stringify(canonical);
  return sha256Hex(json);
}

/** Hash fields which change the authored presentation, including runtime PNG bytes. */
export function computeVisualContentHash(
  pack: Pick<PackV2, 'units' | 'buildings'>,
  assetHashes: readonly ContentAssetHash[] = [],
): string {
  const content = {
    units: pack.units
      .map((unit) => ({
        id: unit.id,
        displayName: unit.displayName,
        enabled: unit.enabled,
        factionId: unit.factionId,
        assetPath: unit.assetPath,
        sourceWidth: unit.sourceWidth,
        sourceHeight: unit.sourceHeight,
        frameWidth: unit.frameWidth,
        frameHeight: unit.frameHeight,
        margin: unit.margin,
        spacing: unit.spacing,
        bounds: unit.bounds,
        anchor: unit.anchor,
        worldHeight: unit.worldHeight,
        shadow: unit.shadow,
        animation: unit.animation,
        tags: unit.tags,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    buildings: pack.buildings
      .map((building) => ({
        id: building.id,
        displayName: building.displayName,
        enabled: building.enabled,
        factionId: building.factionId,
        assetPath: building.assetPath,
        sourceWidth: building.sourceWidth,
        sourceHeight: building.sourceHeight,
        bounds: building.bounds,
        anchor: building.anchor,
        worldHeight: building.worldHeight,
        animation: building.animation,
        shadow: building.shadow,
        tags: building.tags,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    assets: assetHashes
      .filter((asset) => asset.kind !== 'data')
      .map((asset) => ({ assetPath: asset.assetPath, sha256: asset.sha256 }))
      .sort((a, b) => a.assetPath.localeCompare(b.assetPath)),
  };
  return computeContentHash(content);
}

/** Hash fields that can affect an authoritative scenario or simulation restart. */
export function computeSimulationRulesHash(
  pack: Pick<PackV2, 'units' | 'buildings' | 'maps' | 'scenarios'>,
  dataAssetHashes: readonly ContentAssetHash[] = [],
): string {
  const content = {
    units: pack.units
      .map((unit) => ({
        id: unit.id,
        enabled: unit.enabled,
        factionId: unit.factionId,
        selectionRadius: unit.selectionRadius,
        collisionRadius: unit.collisionRadius,
        movement: unit.movement,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    buildings: pack.buildings
      .map((building) => ({
        id: building.id,
        enabled: building.enabled,
        factionId: building.factionId,
        footprint: building.footprint,
        blockedCellMask: building.blockedCellMask,
        buildableTerrain: building.buildableTerrain,
        selectionFootprint: building.selectionFootprint,
        entrancePoint: building.entrancePoint,
        rallyPoint: building.rallyPoint,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    maps: pack.maps
      ?.map((map) => ({ ...map }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    scenarios: pack.scenarios
      ?.map((scenario) => ({ ...scenario }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    assets: dataAssetHashes
      .filter((asset) => asset.kind === 'data')
      .map((asset) => ({ assetPath: asset.assetPath, sha256: asset.sha256 }))
      .sort((a, b) => a.assetPath.localeCompare(b.assetPath)),
  };
  return computeContentHash(content);
}

export function createInitialRevision(): string {
  return '1';
}

export function bumpRevision(current: string): string {
  const parsed = Number.parseInt(current, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return String(parsed + 1);
  }
  return `${current}-next`;
}

export function normalizeRevision(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return createInitialRevision();
}
