import type { AnimationDef } from './animation';
import { validateAnimationDef, countSpriteSheetFrames } from './animation';
import { computeContentHash, createInitialRevision as createInitialRevisionHelper, normalizeRevision } from './contentHash';
import type { PixelBounds, UnitAnchor, UnitManifest, UnitFaction } from './unitManifest';
import { UNIT_MANIFEST_SCHEMA_VERSION, validateUnitManifest } from './unitManifest';
import {
  isRecord,
  isValidContentId,
  requireContentId,
  requireFiniteNumber,
  requireNonNegativeInt,
  requireNonNegativeNumber,
  requirePositiveInt,
  requirePositiveNumber,
  requireSafeAssetPath,
  requireString,
} from './validation';

export const PACK_V2_SCHEMA_VERSION = 2;
export const UNIT_ARCHETYPE_SCHEMA_VERSION = 2;
export const BUILDING_ARCHETYPE_SCHEMA_VERSION = 2;

export const FACTION_IDS = ['sunweaver', 'gravemark', 'neutral'] as const;
export type FactionId = (typeof FACTION_IDS)[number];

export const PLAYABLE_FACTION_IDS = ['sunweaver', 'gravemark'] as const;
export type PlayableFactionId = (typeof PLAYABLE_FACTION_IDS)[number];

/** Default movement speed used when upgrading v1 units (subunits per tick). */
export const DEFAULT_V1_UPGRADE_SPEED_SUBUNITS_PER_TICK = 64;

export type FactionDef = {
  id: FactionId;
  displayName: string;
};

export type ShadowDef = {
  offsetX: number;
  offsetZ: number;
  scale: number;
  opacity: number;
};

export type Vec2 = {
  x: number;
  z: number;
};

export type RectFootprint = {
  kind: 'rect';
  cellsW: number;
  cellsH: number;
};

export type CellMaskFootprint = {
  kind: 'mask';
  cellsW: number;
  cellsH: number;
  mask: boolean[][];
};

export type Footprint = RectFootprint | CellMaskFootprint;

export type BuildableTerrainRules = {
  allowedTerrain?: string[];
  blockedTerrain?: string[];
};

export type UnitMovementDef = {
  speedSubunitsPerTick: number;
  accelerationRate: number;
  turnRateMilli: number;
  footprintCategory: string;
};

export type UnitArchetype = {
  schemaVersion: typeof UNIT_ARCHETYPE_SCHEMA_VERSION;
  id: string;
  displayName: string;
  enabled: boolean;
  factionId: FactionId;
  assetPath: string;
  sourceWidth: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
  margin: { x: number; y: number };
  spacing: { x: number; y: number };
  bounds: PixelBounds;
  anchor: UnitAnchor;
  worldHeight: number;
  shadow?: ShadowDef;
  selectionRadius: number;
  collisionRadius: number;
  animation: AnimationDef;
  movement: UnitMovementDef;
  tags?: string[];
};

export type BuildingArchetype = {
  schemaVersion: typeof BUILDING_ARCHETYPE_SCHEMA_VERSION;
  id: string;
  displayName: string;
  enabled: boolean;
  factionId: FactionId;
  assetPath: string;
  sourceWidth: number;
  sourceHeight: number;
  bounds: PixelBounds;
  anchor: UnitAnchor;
  worldHeight: number;
  footprint: Footprint;
  blockedCellMask?: boolean[][];
  buildableTerrain?: BuildableTerrainRules;
  selectionFootprint?: RectFootprint;
  entrancePoint?: Vec2;
  rallyPoint?: Vec2;
  animation?: AnimationDef;
  tags?: string[];
};

export type MapReference = {
  id: string;
  path: string;
};

export type ScenarioReference = {
  id: string;
  path: string;
  mapId?: string;
};

export type PackV2 = {
  schemaVersion: typeof PACK_V2_SCHEMA_VERSION;
  id: string;
  revision: string;
  factions: FactionDef[];
  units: UnitArchetype[];
  buildings: BuildingArchetype[];
  maps?: MapReference[];
  scenarios?: ScenarioReference[];
  contentHash: string;
};

export type PackV1 = {
  schemaVersion: typeof UNIT_MANIFEST_SCHEMA_VERSION;
  id: string;
  units: UnitManifest[];
};

export function isValidFactionId(value: string): value is FactionId {
  return (FACTION_IDS as readonly string[]).includes(value);
}

export function requireFactionId(value: unknown, label: string): FactionId {
  if (typeof value !== 'string' || !isValidFactionId(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function validateUnitArchetype(value: unknown): UnitArchetype {
  if (!isRecord(value)) {
    throw new Error('Unit archetype must be an object');
  }
  if (value['schemaVersion'] !== UNIT_ARCHETYPE_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(value['schemaVersion'])}`);
  }
  const id = requireContentId(value['id'], 'unit id');
  const displayName = requireString(value['displayName'], 'displayName');
  if (typeof value['enabled'] !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }
  const factionId = requireFactionId(value['factionId'], 'factionId');
  const assetPath = resolveAssetPath(value);
  const sourceWidth = requirePositiveInt(value['sourceWidth'], 'sourceWidth');
  const sourceHeight = requirePositiveInt(value['sourceHeight'], 'sourceHeight');
  const frameWidth = requirePositiveInt(value['frameWidth'], 'frameWidth');
  const frameHeight = requirePositiveInt(value['frameHeight'], 'frameHeight');
  const margin = parseVec2(value['margin'], 'margin', 0);
  const spacing = parseVec2(value['spacing'], 'spacing', 0);
  const bounds = parseBounds(value['bounds'], sourceWidth, sourceHeight);
  const anchor = parseAnchor(value['anchor']);
  const worldHeight = requirePositiveNumber(value['worldHeight'], 'worldHeight');
  const selectionRadius = requirePositiveNumber(value['selectionRadius'], 'selectionRadius');
  const collisionRadius = requirePositiveNumber(value['collisionRadius'], 'collisionRadius');
  const totalFrames = countSpriteSheetFrames(
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
    margin.x,
    margin.y,
    spacing.x,
    spacing.y,
  );
  if (totalFrames <= 0) {
    throw new Error('Invalid sprite sheet layout');
  }
  const animation = validateAnimationDef(value['animation'], totalFrames, assetPath);
  const movement = parseUnitMovement(value['movement']);
  const archetype: UnitArchetype = {
    schemaVersion: UNIT_ARCHETYPE_SCHEMA_VERSION,
    id,
    displayName,
    enabled: value['enabled'],
    factionId,
    assetPath,
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
    margin,
    spacing,
    bounds,
    anchor,
    worldHeight,
    selectionRadius,
    collisionRadius,
    animation,
    movement,
  };
  const shadow = parseOptionalShadow(value['shadow']);
  if (shadow !== undefined) {
    archetype.shadow = shadow;
  }
  const tags = parseOptionalTags(value['tags']);
  if (tags !== undefined) {
    archetype.tags = tags;
  }
  return archetype;
}

export function validateBuildingArchetype(value: unknown): BuildingArchetype {
  if (!isRecord(value)) {
    throw new Error('Building archetype must be an object');
  }
  if (value['schemaVersion'] !== BUILDING_ARCHETYPE_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(value['schemaVersion'])}`);
  }
  const id = requireContentId(value['id'], 'building id');
  const displayName = requireString(value['displayName'], 'displayName');
  if (typeof value['enabled'] !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }
  const factionId = requireFactionId(value['factionId'], 'factionId');
  const assetPath = resolveAssetPath(value);
  const sourceWidth = requirePositiveInt(value['sourceWidth'], 'sourceWidth');
  const sourceHeight = requirePositiveInt(value['sourceHeight'], 'sourceHeight');
  const bounds = parseBounds(value['bounds'], sourceWidth, sourceHeight);
  const anchor = parseAnchor(value['anchor']);
  const worldHeight = requirePositiveNumber(value['worldHeight'], 'worldHeight');
  const footprint = parseFootprint(value['footprint']);
  const building: BuildingArchetype = {
    schemaVersion: BUILDING_ARCHETYPE_SCHEMA_VERSION,
    id,
    displayName,
    enabled: value['enabled'],
    factionId,
    assetPath,
    sourceWidth,
    sourceHeight,
    bounds,
    anchor,
    worldHeight,
    footprint,
  };
  const blockedCellMask = parseOptionalCellMask(value['blockedCellMask'], footprint);
  if (blockedCellMask !== undefined) {
    building.blockedCellMask = blockedCellMask;
  }
  const buildableTerrain = parseOptionalBuildableTerrain(value['buildableTerrain']);
  if (buildableTerrain !== undefined) {
    building.buildableTerrain = buildableTerrain;
  }
  const selectionFootprint = parseOptionalRectFootprint(value['selectionFootprint']);
  if (selectionFootprint !== undefined) {
    building.selectionFootprint = selectionFootprint;
  }
  const entrancePoint = parseOptionalVec2(value['entrancePoint'], 'entrancePoint');
  if (entrancePoint !== undefined) {
    building.entrancePoint = entrancePoint;
  }
  const rallyPoint = parseOptionalVec2(value['rallyPoint'], 'rallyPoint');
  if (rallyPoint !== undefined) {
    building.rallyPoint = rallyPoint;
  }
  const animationValue = value['animation'];
  if (animationValue !== undefined) {
    const frameWidth = requirePositiveInt(value['frameWidth'] ?? sourceWidth, 'frameWidth');
    const frameHeight = requirePositiveInt(value['frameHeight'] ?? sourceHeight, 'frameHeight');
    const margin = parseVec2(value['margin'], 'margin', 0);
    const spacing = parseVec2(value['spacing'], 'spacing', 0);
    const totalFrames = countSpriteSheetFrames(
      sourceWidth,
      sourceHeight,
      frameWidth,
      frameHeight,
      margin.x,
      margin.y,
      spacing.x,
      spacing.y,
    );
    building.animation = validateAnimationDef(animationValue, totalFrames, assetPath);
  }
  const tags = parseOptionalTags(value['tags']);
  if (tags !== undefined) {
    building.tags = tags;
  }
  return building;
}

export function validatePackV2(value: unknown): PackV2 {
  if (!isRecord(value)) {
    throw new Error('Pack must be an object');
  }
  if (value['schemaVersion'] !== PACK_V2_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(value['schemaVersion'])}`);
  }
  const id = requireContentId(value['id'], 'pack id');
  const revision = normalizeRevision(value['revision']);
  const factions = parseFactions(value['factions']);
  const unitsValue = value['units'];
  if (!Array.isArray(unitsValue)) {
    throw new Error('units must be an array');
  }
  const units = unitsValue.map((entry) => validateUnitArchetype(entry));
  const buildingsValue = value['buildings'];
  if (!Array.isArray(buildingsValue)) {
    throw new Error('buildings must be an array');
  }
  const buildings = buildingsValue.map((entry) => validateBuildingArchetype(entry));
  const packWithoutHash: Omit<PackV2, 'contentHash'> = {
    schemaVersion: PACK_V2_SCHEMA_VERSION,
    id,
    revision,
    factions,
    units,
    buildings,
  };
  const maps = parseOptionalMapReferences(value['maps']);
  if (maps !== undefined) {
    packWithoutHash.maps = maps;
  }
  const scenarios = parseOptionalScenarioReferences(value['scenarios']);
  if (scenarios !== undefined) {
    packWithoutHash.scenarios = scenarios;
  }
  const contentHash = computeContentHash(packWithoutHash);
  return { ...packWithoutHash, contentHash };
}

export function upgradePackV1ToV2(packV1: unknown): PackV2 {
  if (!isRecord(packV1)) {
    throw new Error('Pack must be an object');
  }
  if (packV1['schemaVersion'] !== UNIT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(packV1['schemaVersion'])}`);
  }
  const id = requireContentId(packV1['id'], 'pack id');
  const unitsValue = packV1['units'];
  if (!Array.isArray(unitsValue)) {
    throw new Error('units must be an array');
  }
  const manifests = unitsValue.map((entry) => validateUnitManifest(entry));
  const factions: FactionDef[] = [
    { id: 'sunweaver', displayName: 'Sunweaver' },
    { id: 'gravemark', displayName: 'Gravemark' },
    { id: 'neutral', displayName: 'Neutral' },
  ];
  const units = manifests.map((manifest) => upgradeUnitManifestToArchetype(manifest));
  const packWithoutHash: Omit<PackV2, 'contentHash'> = {
    schemaVersion: PACK_V2_SCHEMA_VERSION,
    id,
    revision: createInitialRevisionHelper(),
    factions,
    units,
    buildings: [],
  };
  return { ...packWithoutHash, contentHash: computeContentHash(packWithoutHash) };
}

function upgradeUnitManifestToArchetype(manifest: UnitManifest): UnitArchetype {
  const factionId = mapLegacyFactionToFactionId(manifest.faction);
  const tags = manifest.tags ? [...manifest.tags] : undefined;
  return {
    schemaVersion: UNIT_ARCHETYPE_SCHEMA_VERSION,
    id: manifest.id,
    displayName: manifest.displayName,
    enabled: manifest.enabled,
    factionId,
    assetPath: manifest.assetPath,
    sourceWidth: manifest.sourceWidth,
    sourceHeight: manifest.sourceHeight,
    frameWidth: manifest.sourceWidth,
    frameHeight: manifest.sourceHeight,
    margin: { x: 0, y: 0 },
    spacing: { x: 0, y: 0 },
    bounds: manifest.bounds,
    anchor: manifest.anchor,
    worldHeight: manifest.worldHeight,
    selectionRadius: manifest.selectionRadius,
    collisionRadius: manifest.selectionRadius,
    animation: {
      directions: 1,
      mirrored: false,
      clips: {
        idle: {
          frames: { kind: 'indexes', indexes: [0] },
          fps: 8,
          looping: true,
          assetPath: manifest.assetPath,
        },
        move: {
          frames: { kind: 'indexes', indexes: [0] },
          fps: 12,
          looping: true,
          assetPath: manifest.assetPath,
        },
      },
    },
    movement: {
      speedSubunitsPerTick: DEFAULT_V1_UPGRADE_SPEED_SUBUNITS_PER_TICK,
      accelerationRate: 1,
      turnRateMilli: 3141,
      footprintCategory: 'unit-1x1',
    },
    ...(tags !== undefined ? { tags } : {}),
  };
}

export function mapLegacyFactionToFactionId(faction: UnitFaction): FactionId {
  switch (faction) {
    case 'friendly':
      return 'sunweaver';
    case 'opposing':
      return 'gravemark';
    case 'neutral':
      return 'neutral';
  }
}

function resolveAssetPath(value: Record<string, unknown>): string {
  const spriteSheetPath = value['spriteSheetPath'];
  const assetPath = value['assetPath'];
  if (typeof spriteSheetPath === 'string' && spriteSheetPath.length > 0) {
    return requireSafeAssetPath(spriteSheetPath, 'spriteSheetPath');
  }
  if (typeof assetPath === 'string' && assetPath.length > 0) {
    return requireSafeAssetPath(assetPath, 'assetPath');
  }
  throw new Error('assetPath or spriteSheetPath is required');
}

function parseAnchor(value: unknown): UnitAnchor {
  if (!isRecord(value)) {
    throw new Error('anchor is required');
  }
  const anchor = {
    x: requireFiniteNumber(value['x'], 'anchor.x'),
    y: requireFiniteNumber(value['y'], 'anchor.y'),
  };
  if (anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) {
    throw new Error('Invalid anchor');
  }
  return anchor;
}

function parseBounds(value: unknown, width: number, height: number): PixelBounds {
  if (!isRecord(value)) {
    throw new Error('bounds are required');
  }
  const bounds: PixelBounds = {
    minX: requireNonNegativeInt(value['minX'], 'bounds.minX'),
    minY: requireNonNegativeInt(value['minY'], 'bounds.minY'),
    maxX: requireNonNegativeInt(value['maxX'], 'bounds.maxX'),
    maxY: requireNonNegativeInt(value['maxY'], 'bounds.maxY'),
  };
  if (bounds.minX >= width || bounds.minY >= height || bounds.maxX > width || bounds.maxY > height) {
    throw new Error('bounds exceed source dimensions');
  }
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    throw new Error('bounds must be non-empty');
  }
  return bounds;
}

function parseVec2(value: unknown, label: string, defaultValue: number): { x: number; y: number } {
  if (value === undefined) {
    return { x: defaultValue, y: defaultValue };
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    x: requireNonNegativeInt(value['x'], `${label}.x`),
    y: requireNonNegativeInt(value['y'], `${label}.y`),
  };
}

function parseOptionalShadow(value: unknown): ShadowDef | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('shadow must be an object');
  }
  return {
    offsetX: requireFiniteNumber(value['offsetX'] ?? 0, 'shadow.offsetX'),
    offsetZ: requireFiniteNumber(value['offsetZ'] ?? 0, 'shadow.offsetZ'),
    scale: requirePositiveNumber(value['scale'] ?? 1, 'shadow.scale'),
    opacity: requireNonNegativeNumber(value['opacity'] ?? 0.35, 'shadow.opacity'),
  };
}

function parseUnitMovement(value: unknown): UnitMovementDef {
  if (!isRecord(value)) {
    throw new Error('movement is required');
  }
  const footprintCategory = value['footprintCategory'];
  if (typeof footprintCategory !== 'string' || footprintCategory.trim().length === 0) {
    throw new Error('movement.footprintCategory is required');
  }
  return {
    speedSubunitsPerTick: requirePositiveInt(value['speedSubunitsPerTick'], 'movement.speedSubunitsPerTick'),
    accelerationRate: requirePositiveNumber(value['accelerationRate'], 'movement.accelerationRate'),
    turnRateMilli: requirePositiveInt(value['turnRateMilli'], 'movement.turnRateMilli'),
    footprintCategory: footprintCategory.trim(),
  };
}

function parseFootprint(value: unknown): Footprint {
  if (!isRecord(value)) {
    throw new Error('Invalid footprint');
  }
  const kind = value['kind'];
  const cellsW = requirePositiveInt(value['cellsW'], 'footprint.cellsW');
  const cellsH = requirePositiveInt(value['cellsH'], 'footprint.cellsH');
  if (kind === 'rect' || kind === undefined) {
    return { kind: 'rect', cellsW, cellsH };
  }
  if (kind === 'mask') {
    const mask = parseCellMask(value['mask'], cellsW, cellsH);
    return { kind: 'mask', cellsW, cellsH, mask };
  }
  throw new Error('Invalid footprint');
}

function parseOptionalRectFootprint(value: unknown): RectFootprint | undefined {
  if (value === undefined) {
    return undefined;
  }
  const footprint = parseFootprint(value);
  if (footprint.kind !== 'rect') {
    throw new Error('selectionFootprint must be rectangular');
  }
  return footprint;
}

function parseCellMask(value: unknown, cellsW: number, cellsH: number): boolean[][] {
  if (!Array.isArray(value) || value.length !== cellsH) {
    throw new Error('Invalid footprint');
  }
  return value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== cellsW) {
      throw new Error(`Invalid footprint mask row ${String(rowIndex)}`);
    }
    return row.map((cell) => {
      if (typeof cell !== 'boolean') {
        throw new Error('footprint mask cells must be booleans');
      }
      return cell;
    });
  });
}

function parseOptionalCellMask(value: unknown, footprint: Footprint): boolean[][] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseCellMask(value, footprint.cellsW, footprint.cellsH);
}

function parseOptionalBuildableTerrain(value: unknown): BuildableTerrainRules | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('buildableTerrain must be an object');
  }
  const rules: BuildableTerrainRules = {};
  const allowedTerrain = value['allowedTerrain'];
  if (allowedTerrain !== undefined) {
    rules.allowedTerrain = parseStringArray(allowedTerrain, 'buildableTerrain.allowedTerrain');
  }
  const blockedTerrain = value['blockedTerrain'];
  if (blockedTerrain !== undefined) {
    rules.blockedTerrain = parseStringArray(blockedTerrain, 'buildableTerrain.blockedTerrain');
  }
  return rules;
}

function parseOptionalVec2(value: unknown, label: string): Vec2 | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    x: requireFiniteNumber(value['x'], `${label}.x`),
    z: requireFiniteNumber(value['z'], `${label}.z`),
  };
}

function parseOptionalTags(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseStringArray(value, 'tags');
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
}

function parseFactions(value: unknown): FactionDef[] {
  if (!Array.isArray(value)) {
    throw new Error('factions must be an array');
  }
  const seen = new Set<string>();
  const factions: FactionDef[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      throw new Error('Invalid faction definition');
    }
    const id = requireFactionId(entry['id'], 'faction id');
    if (seen.has(id)) {
      throw new Error(`Duplicate faction id: ${id}`);
    }
    seen.add(id);
    factions.push({
      id,
      displayName: requireString(entry['displayName'], 'displayName'),
    });
  }
  return factions;
}

function parseOptionalMapReferences(value: unknown): MapReference[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error('maps must be an array');
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Invalid map reference');
    }
    return {
      id: requireContentId(entry['id'], 'map id'),
      path: requireSafeAssetPath(entry['path'], 'map path'),
    };
  });
}

function parseOptionalScenarioReferences(value: unknown): ScenarioReference[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error('scenarios must be an array');
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Invalid scenario reference');
    }
    const scenario: ScenarioReference = {
      id: requireContentId(entry['id'], 'scenario id'),
      path: requireSafeAssetPath(entry['path'], 'scenario path'),
    };
    const mapId = entry['mapId'];
    if (mapId !== undefined) {
      scenario.mapId = requireContentId(mapId, 'scenario mapId');
    }
    return scenario;
  });
}

export { computeContentHash, bumpRevision, createInitialRevision, normalizeRevision } from './contentHash';
