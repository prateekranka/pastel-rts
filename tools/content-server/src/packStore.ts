import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  bumpRevision,
  computeContentHash,
  createInitialRevision,
  upgradePackV1ToV2,
  validateBuildingArchetype,
  validatePackV2,
  validateScenarioDef,
  validateUnitArchetype,
  validateUnitManifest,
  type BuildingArchetype,
  type PackV2,
  type UnitArchetype,
  type UnitManifest,
} from '@pastel-rts/content-schema';

export type PackStoreOptions = {
  packDir: string;
};

export type HotReloadEvent =
  | { type: 'unit-published'; id: string; manifest: UnitManifest }
  | { type: 'unit-archetype-published'; id: string; archetype: UnitArchetype }
  | { type: 'unit-archetype-updated'; id: string; archetype: UnitArchetype }
  | { type: 'unit-archetype-enabled'; id: string; enabled: boolean }
  | { type: 'unit-archetype-deleted'; id: string }
  | { type: 'building-archetype-published'; id: string; archetype: BuildingArchetype }
  | { type: 'building-archetype-updated'; id: string; archetype: BuildingArchetype }
  | { type: 'building-archetype-enabled'; id: string; enabled: boolean }
  | { type: 'building-archetype-deleted'; id: string };

const DEFAULT_FACTIONS: PackV2['factions'] = [
  { id: 'sunweaver', displayName: 'Sunweaver' },
  { id: 'gravemark', displayName: 'Gravemark' },
  { id: 'neutral', displayName: 'Neutral' },
];

export class PackStore {
  readonly packDir: string;
  readonly unitsDir: string;
  readonly buildingsDir: string;
  readonly mapsDir: string;
  readonly scenariosDir: string;
  readonly v1IndexPath: string;
  readonly v2IndexPath: string;

  constructor(options: PackStoreOptions) {
    this.packDir = options.packDir;
    this.unitsDir = join(this.packDir, 'units');
    this.buildingsDir = join(this.packDir, 'buildings');
    this.mapsDir = join(this.packDir, 'maps');
    this.scenariosDir = join(this.packDir, 'scenarios');
    this.v1IndexPath = join(this.packDir, 'pack.json');
    this.v2IndexPath = join(this.packDir, 'pack-v2.json');
    mkdirSync(this.unitsDir, { recursive: true });
    mkdirSync(this.buildingsDir, { recursive: true });
  }

  readPackV1(): { schemaVersion: number; id: string; units: UnitManifest[] } {
    const units: UnitManifest[] = [];
    if (!existsSync(this.unitsDir)) {
      return { schemaVersion: 1, id: 'dev-pack', units };
    }
    for (const name of readdirSync(this.unitsDir)) {
      const file = join(this.unitsDir, name, 'manifest.json');
      if (!existsSync(file)) {
        continue;
      }
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (isV1Manifest(parsed)) {
        units.push(validateUnitManifest(parsed));
      }
    }
    return { schemaVersion: 1, id: 'dev-pack', units };
  }

  readPackV2(): PackV2 {
    if (existsSync(this.v2IndexPath)) {
      return validatePackV2(JSON.parse(readFileSync(this.v2IndexPath, 'utf8')));
    }
    const upgraded = upgradePackV1ToV2(this.readPackV1());
    const diskUnits = this.listUnitArchetypesFromDisk();
    const diskBuildings = this.listBuildingArchetypesFromDisk();
    if (diskUnits.length > 0 || diskBuildings.length > 0) {
      return this.buildPackV2Index(diskUnits, diskBuildings, upgraded.revision);
    }
    return upgraded;
  }

  writePackV1Index(): void {
    const index = this.readPackV1();
    atomicWriteJson(this.v1IndexPath, index);
  }

  writePackV2Index(units: UnitArchetype[], buildings: BuildingArchetype[]): PackV2 {
    const previous = existsSync(this.v2IndexPath)
      ? validatePackV2(JSON.parse(readFileSync(this.v2IndexPath, 'utf8')))
      : null;
    const revision = previous ? bumpRevision(previous.revision) : createInitialRevision();
    const pack = this.buildPackV2Index(units, buildings, revision);
    atomicWriteJson(this.v2IndexPath, pack);
    return pack;
  }

  saveUnitV1(manifest: UnitManifest, pngBase64: string): UnitManifest {
    const dir = join(this.unitsDir, manifest.id);
    mkdirSync(dir, { recursive: true });
    const pngPath = join(dir, 'sprite.png');
    const assetPath = `units/${manifest.id}/sprite.png`;
    writePngAtomic(pngPath, pngBase64);
    const saved: UnitManifest = { ...manifest, assetPath };
    atomicWriteJson(join(dir, 'manifest.json'), saved);
    this.writePackV1Index();
    return saved;
  }

  createUnitArchetype(archetype: UnitArchetype, pngBase64?: string): UnitArchetype {
    const id = archetype.id;
    if (existsSync(join(this.unitsDir, id, 'manifest.json'))) {
      throw new Error(`Unit archetype already exists: ${id}`);
    }
    const dir = join(this.unitsDir, id);
    mkdirSync(dir, { recursive: true });
    const saved = this.persistUnitArchetype(dir, archetype, pngBase64);
    const pack = this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    if (!pack.units.some((entry) => entry.id === id)) {
      throw new Error('Pack index rebuild failed after unit create');
    }
    return saved;
  }

  updateUnitArchetype(id: string, archetype: UnitArchetype, pngBase64?: string): UnitArchetype {
    if (archetype.id !== id) {
      throw new Error('Unit id mismatch');
    }
    const dir = join(this.unitsDir, id);
    if (!existsSync(join(dir, 'manifest.json'))) {
      throw new Error(`Unit archetype not found: ${id}`);
    }
    const saved = this.persistUnitArchetype(dir, archetype, pngBase64);
    this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    return saved;
  }

  setUnitArchetypeEnabled(id: string, enabled: boolean): UnitArchetype {
    const current = this.getUnitArchetype(id);
    const updated: UnitArchetype = { ...current, enabled };
    atomicWriteJson(join(this.unitsDir, id, 'manifest.json'), updated);
    this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    return updated;
  }

  deleteUnitArchetype(id: string, force = false): { deleted: true; warning?: string } {
    const refs = this.findUnitReferences(id);
    if (refs.length > 0 && !force) {
      throw new Error(`Unit is referenced by scenarios: ${refs.join(', ')}`);
    }
    const warning = refs.length > 0 ? `Removed unit referenced by: ${refs.join(', ')}` : undefined;
    const dir = join(this.unitsDir, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    return warning !== undefined ? { deleted: true, warning } : { deleted: true };
  }

  getUnitArchetype(id: string): UnitArchetype {
    const file = join(this.unitsDir, id, 'manifest.json');
    if (!existsSync(file)) {
      throw new Error(`Unit archetype not found: ${id}`);
    }
    return validateUnitArchetype(JSON.parse(readFileSync(file, 'utf8')));
  }

  listUnitArchetypesFromDisk(): UnitArchetype[] {
    if (!existsSync(this.unitsDir)) {
      return [];
    }
    const result: UnitArchetype[] = [];
    for (const name of readdirSync(this.unitsDir)) {
      const file = join(this.unitsDir, name, 'manifest.json');
      if (!existsSync(file)) {
        continue;
      }
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (isV2UnitArchetype(parsed)) {
        result.push(validateUnitArchetype(parsed));
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  createBuildingArchetype(archetype: BuildingArchetype, pngBase64?: string): BuildingArchetype {
    const id = archetype.id;
    if (existsSync(join(this.buildingsDir, id, 'manifest.json'))) {
      throw new Error(`Building archetype already exists: ${id}`);
    }
    const dir = join(this.buildingsDir, id);
    mkdirSync(dir, { recursive: true });
    const saved = this.persistBuildingArchetype(dir, archetype, pngBase64);
    this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    return saved;
  }

  updateBuildingArchetype(id: string, archetype: BuildingArchetype, pngBase64?: string): BuildingArchetype {
    if (archetype.id !== id) {
      throw new Error('Building id mismatch');
    }
    const dir = join(this.buildingsDir, id);
    if (!existsSync(join(dir, 'manifest.json'))) {
      throw new Error(`Building archetype not found: ${id}`);
    }
    const saved = this.persistBuildingArchetype(dir, archetype, pngBase64);
    this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    return saved;
  }

  setBuildingArchetypeEnabled(id: string, enabled: boolean): BuildingArchetype {
    const current = this.getBuildingArchetype(id);
    const updated: BuildingArchetype = { ...current, enabled };
    atomicWriteJson(join(this.buildingsDir, id, 'manifest.json'), updated);
    this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    return updated;
  }

  deleteBuildingArchetype(id: string, force = false): { deleted: true; warning?: string } {
    const refs = this.findBuildingReferences(id);
    if (refs.length > 0 && !force) {
      throw new Error(`Building is referenced by scenarios: ${refs.join(', ')}`);
    }
    const warning = refs.length > 0 ? `Removed building referenced by: ${refs.join(', ')}` : undefined;
    const dir = join(this.buildingsDir, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    this.writePackV2Index(this.listUnitArchetypesFromDisk(), this.listBuildingArchetypesFromDisk());
    return warning !== undefined ? { deleted: true, warning } : { deleted: true };
  }

  getBuildingArchetype(id: string): BuildingArchetype {
    const file = join(this.buildingsDir, id, 'manifest.json');
    if (!existsSync(file)) {
      throw new Error(`Building archetype not found: ${id}`);
    }
    return validateBuildingArchetype(JSON.parse(readFileSync(file, 'utf8')));
  }

  listBuildingArchetypesFromDisk(): BuildingArchetype[] {
    if (!existsSync(this.buildingsDir)) {
      return [];
    }
    const result: BuildingArchetype[] = [];
    for (const name of readdirSync(this.buildingsDir)) {
      const file = join(this.buildingsDir, name, 'manifest.json');
      if (!existsSync(file)) {
        continue;
      }
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (isV2BuildingArchetype(parsed)) {
        result.push(validateBuildingArchetype(parsed));
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  resolveAssetPath(relativePath: string): string {
    const safe = sanitizeRelativePath(relativePath);
    const absolute = join(this.packDir, safe);
    assertWithinPack(this.packDir, absolute);
    if (!existsSync(absolute)) {
      throw new Error('Asset not found');
    }
    return absolute;
  }

  resolveUnitFilePath(relativePath: string): string {
    const safe = sanitizeRelativePath(relativePath);
    if (safe.includes('..')) {
      throw new Error('invalid path');
    }
    const absolute = join(this.unitsDir, safe);
    assertWithinPack(this.unitsDir, absolute);
    return absolute;
  }

  private persistUnitArchetype(dir: string, archetype: UnitArchetype, pngBase64?: string): UnitArchetype {
    const validated = validateUnitArchetype(archetype);
    const assetFileName = basenameFromAssetPath(validated.assetPath);
    if (pngBase64 !== undefined) {
      writePngAtomic(join(dir, assetFileName), pngBase64);
    } else if (!existsSync(join(dir, assetFileName))) {
      throw new Error('pngBase64 is required for new unit assets');
    }
    const saved: UnitArchetype = {
      ...validated,
      assetPath: `units/${validated.id}/${assetFileName}`,
    };
    atomicWriteJson(join(dir, 'manifest.json'), saved);
    return saved;
  }

  private persistBuildingArchetype(
    dir: string,
    archetype: BuildingArchetype,
    pngBase64?: string,
  ): BuildingArchetype {
    const validated = validateBuildingArchetype(archetype);
    const assetFileName = basenameFromAssetPath(validated.assetPath);
    if (pngBase64 !== undefined) {
      writePngAtomic(join(dir, assetFileName), pngBase64);
    } else if (!existsSync(join(dir, assetFileName))) {
      throw new Error('pngBase64 is required for new building assets');
    }
    const saved: BuildingArchetype = {
      ...validated,
      assetPath: `buildings/${validated.id}/${assetFileName}`,
    };
    atomicWriteJson(join(dir, 'manifest.json'), saved);
    return saved;
  }

  private buildPackV2Index(units: UnitArchetype[], buildings: BuildingArchetype[], revision: string): PackV2 {
    const maps = this.readMapReferences();
    const scenarios = this.readScenarioReferences();
    const packWithoutHash: Omit<PackV2, 'contentHash'> = {
      schemaVersion: 2,
      id: 'dev-pack-v2',
      revision,
      factions: DEFAULT_FACTIONS,
      units,
      buildings,
      ...(maps ? { maps } : {}),
      ...(scenarios ? { scenarios } : {}),
    };
    return { ...packWithoutHash, contentHash: computeContentHash(packWithoutHash) };
  }

  private readMapReferences(): PackV2['maps'] {
    if (!existsSync(this.mapsDir)) {
      return undefined;
    }
    const maps: NonNullable<PackV2['maps']> = [];
    for (const file of readdirSync(this.mapsDir)) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const id = file.replace(/\.json$/, '');
      maps.push({ id, path: `maps/${file}` });
    }
    return maps.length > 0 ? maps : undefined;
  }

  private readScenarioReferences(): PackV2['scenarios'] {
    if (!existsSync(this.scenariosDir)) {
      return undefined;
    }
    const scenarios: NonNullable<PackV2['scenarios']> = [];
    for (const file of readdirSync(this.scenariosDir)) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const parsed: unknown = JSON.parse(readFileSync(join(this.scenariosDir, file), 'utf8'));
      const scenario = validateScenarioDef(parsed);
      scenarios.push({ id: scenario.id, path: `scenarios/${file}`, mapId: scenario.mapId });
    }
    return scenarios.length > 0 ? scenarios : undefined;
  }

  private findUnitReferences(id: string): string[] {
    return this.findArchetypeReferences('unit', id);
  }

  private findBuildingReferences(id: string): string[] {
    return this.findArchetypeReferences('building', id);
  }

  private findArchetypeReferences(kind: 'unit' | 'building', id: string): string[] {
    if (!existsSync(this.scenariosDir)) {
      return [];
    }
    const refs: string[] = [];
    for (const file of readdirSync(this.scenariosDir)) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const scenario = validateScenarioDef(JSON.parse(readFileSync(join(this.scenariosDir, file), 'utf8')));
      const list = kind === 'unit' ? scenario.units : scenario.buildings;
      if (list.some((spawn) => spawn.archetypeId === id)) {
        refs.push(scenario.id);
      }
    }
    return refs;
  }
}

export function sanitizeRelativePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed.startsWith('/') || trimmed.includes('\\')) {
    throw new Error('invalid path');
  }
  const normalized = normalize(trimmed);
  if (normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`) || normalized.includes(`${sep}..`)) {
    throw new Error('invalid path');
  }
  return normalized.split(sep).join('/');
}

function assertWithinPack(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel.includes(`${sep}..`)) {
    throw new Error('invalid path');
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tempPath, path);
}

function writePngAtomic(path: string, pngBase64: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const buffer = decodePng(pngBase64);
  const tempPath = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tempPath, buffer);
  renameSync(tempPath, path);
}

function decodePng(pngBase64: string): Buffer {
  const buffer = Buffer.from(pngBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
  if (buffer.length < 32 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Uploaded file is not a PNG');
  }
  return buffer;
}

function basenameFromAssetPath(assetPath: string): string {
  const parts = sanitizeRelativePath(assetPath).split('/');
  const base = parts[parts.length - 1];
  if (!base) {
    throw new Error('Invalid assetPath');
  }
  return base;
}

function isV1Manifest(value: unknown): value is UnitManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    (value as { schemaVersion: unknown }).schemaVersion === 1
  );
}

function isV2UnitArchetype(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    (value as { schemaVersion: unknown }).schemaVersion === 2
  );
}

function isV2BuildingArchetype(value: unknown): boolean {
  return isV2UnitArchetype(value);
}
