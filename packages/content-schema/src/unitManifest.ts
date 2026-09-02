import {
  isRecord,
  isValidContentId,
  requireInt,
  requirePositiveInt,
  requirePositiveNumber,
} from './validation';

export const UNIT_MANIFEST_SCHEMA_VERSION = 1;

export const UNIT_FACTIONS = ['friendly', 'opposing', 'neutral'] as const;
export type UnitFaction = (typeof UNIT_FACTIONS)[number];

export type PixelBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type UnitAnchor = {
  x: number;
  y: number;
};

export type UnitManifest = {
  schemaVersion: number;
  id: string;
  displayName: string;
  enabled: boolean;
  faction: UnitFaction;
  assetPath: string;
  sourceWidth: number;
  sourceHeight: number;
  bounds: PixelBounds;
  anchor: UnitAnchor;
  worldHeight: number;
  selectionRadius: number;
  tags?: string[];
};

export function isValidUnitId(id: string): boolean {
  return isValidContentId(id);
}

export function isValidAnchor(anchor: UnitAnchor): boolean {
  return (
    Number.isFinite(anchor.x) &&
    Number.isFinite(anchor.y) &&
    anchor.x >= 0 &&
    anchor.x <= 1 &&
    anchor.y >= 0 &&
    anchor.y <= 1
  );
}

export function validateUnitManifest(value: unknown): UnitManifest {
  if (!isRecord(value)) {
    throw new Error('Manifest must be an object');
  }
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== UNIT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(schemaVersion)}`);
  }
  const id = value['id'];
  if (typeof id !== 'string' || !isValidUnitId(id)) {
    throw new Error('Invalid unit id');
  }
  const displayName = value['displayName'];
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new Error('displayName is required');
  }
  if (typeof value['enabled'] !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }
  const faction = value['faction'];
  if (!UNIT_FACTIONS.includes(faction as UnitFaction)) {
    throw new Error('Invalid faction');
  }
  const assetPath = value['assetPath'];
  if (typeof assetPath !== 'string' || assetPath.trim().length === 0) {
    throw new Error('assetPath is required');
  }
  if (assetPath.includes('..') || assetPath.startsWith('/') || !assetPath.endsWith('.png')) {
    throw new Error('assetPath must be a relative PNG path');
  }
  const sourceWidth = requirePositiveInt(value['sourceWidth'], 'sourceWidth');
  const sourceHeight = requirePositiveInt(value['sourceHeight'], 'sourceHeight');
  const bounds = parseBounds(value['bounds'], sourceWidth, sourceHeight);
  const anchor = parseAnchor(value['anchor']);
  const worldHeight = requirePositiveNumber(value['worldHeight'], 'worldHeight');
  const selectionRadius = requirePositiveNumber(value['selectionRadius'], 'selectionRadius');
  const tagsValue = value['tags'];
  const manifest: UnitManifest = {
    schemaVersion: UNIT_MANIFEST_SCHEMA_VERSION,
    id,
    displayName: displayName.trim(),
    enabled: value['enabled'],
    faction: faction as UnitFaction,
    assetPath,
    sourceWidth,
    sourceHeight,
    bounds,
    anchor,
    worldHeight,
    selectionRadius,
  };
  if (tagsValue !== undefined) {
    if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== 'string')) {
      throw new Error('tags must be an array of strings');
    }
    manifest.tags = tagsValue;
  }
  return manifest;
}

export function createUnitManifest(input: Omit<UnitManifest, 'schemaVersion'> & { schemaVersion?: number }): UnitManifest {
  return validateUnitManifest({
    ...input,
    schemaVersion: input.schemaVersion ?? UNIT_MANIFEST_SCHEMA_VERSION,
  });
}

function parseAnchor(value: unknown): UnitAnchor {
  if (!isRecord(value)) {
    throw new Error('anchor is required');
  }
  const anchor = { x: Number(value['x']), y: Number(value['y']) };
  if (!isValidAnchor(anchor)) {
    throw new Error('Invalid anchor');
  }
  return anchor;
}

function parseBounds(value: unknown, width: number, height: number): PixelBounds {
  if (!isRecord(value)) {
    throw new Error('bounds are required');
  }
  const bounds: PixelBounds = {
    minX: requireInt(value['minX'], 'bounds.minX'),
    minY: requireInt(value['minY'], 'bounds.minY'),
    maxX: requireInt(value['maxX'], 'bounds.maxX'),
    maxY: requireInt(value['maxY'], 'bounds.maxY'),
  };
  if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > width || bounds.maxY > height) {
    throw new Error('bounds exceed source dimensions');
  }
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    throw new Error('bounds must be non-empty');
  }
  return bounds;
}
