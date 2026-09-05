import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import {
  bumpRevision,
  computeContentHash,
  computeSimulationRulesHash,
  computeVisualContentHash,
  createInitialRevision,
  isValidContentId,
  isValidRevision,
  upgradePackV1ToV2,
  validateBuildingArchetype,
  validateMapDef,
  validatePackV2,
  validatePublicationState,
  validateReferenceAttachmentMetadata,
  validateRevisionMetadata,
  validateScenarioDef,
  validateUnitArchetype,
  validateUnitManifest,
  type BuildingArchetype,
  type ImmutableAssetReference,
  type PackV1,
  type PackV2,
  type PublicationState,
  type ReferenceAttachmentMetadata,
  type RevisionMetadata,
  type UnitArchetype,
  type UnitManifest,
} from '@pastel-rts/content-schema';
import { decodePng } from './png';

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
  | { type: 'building-archetype-deleted'; id: string }
  | { type: 'publication-published'; revision: string; previousRevision: string; restartRequired: boolean }
  | { type: 'publication-reverted'; revision: string; sourceRevision: string; restartRequired: boolean };

export type PublicationStatus = {
  currentRevision: string;
  draftRevision: string;
  current: RevisionMetadata;
};

export type PublicationOperationResult = {
  metadata: RevisionMetadata;
  pack: PackV2;
  previousRevision: string;
  draftRevision: string;
};

export class RevisionConflictError extends Error {
  readonly status = 409;
  readonly code = 'revision-conflict';
  readonly expectedRevision: string;
  readonly current: RevisionMetadata;
  readonly scope: 'draft' | 'publication';
  readonly actualRevision: string;

  constructor(
    expectedRevision: string,
    current: RevisionMetadata,
    scope: 'draft' | 'publication',
    actualRevision: string,
  ) {
    super(
      `Stale ${scope} revision. Expected ${expectedRevision}, but the current ${scope} revision is ${actualRevision}. Refresh revision ${actualRevision} before retrying.`,
    );
    this.name = 'RevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.current = current;
    this.scope = scope;
    this.actualRevision = actualRevision;
  }
}

export class DependencyConflictError extends Error {
  readonly status = 409;
  readonly code = 'dependency-conflict';
  readonly dependencies: string[];

  constructor(kind: 'unit' | 'building', id: string, dependencies: string[]) {
    super(`${kind} ${id} is referenced by scenarios: ${dependencies.join(', ')}`);
    this.name = 'DependencyConflictError';
    this.dependencies = dependencies;
  }
}

export class ContentNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'not-found';

  constructor(message: string) {
    super(message);
    this.name = 'ContentNotFoundError';
  }
}

const DEFAULT_FACTIONS: PackV2['factions'] = [
  { id: 'sunweaver', displayName: 'Sunweaver' },
  { id: 'gravemark', displayName: 'Gravemark' },
  { id: 'neutral', displayName: 'Neutral' },
];

const PUBLICATION_DIR = '.content-publication';
const REVISION_DIR = 'revisions';

export class PackStore {
  readonly packDir: string;
  readonly unitsDir: string;
  readonly buildingsDir: string;
  readonly mapsDir: string;
  readonly scenariosDir: string;
  readonly v1IndexPath: string;
  readonly v2IndexPath: string;
  readonly publicationDir: string;
  readonly revisionsDir: string;
  readonly statePath: string;
  readonly draftPackPath: string;
  readonly referencesPath: string;
  readonly referencesDir: string;

  constructor(options: PackStoreOptions) {
    this.packDir = options.packDir;
    this.unitsDir = join(this.packDir, 'units');
    this.buildingsDir = join(this.packDir, 'buildings');
    this.mapsDir = join(this.packDir, 'maps');
    this.scenariosDir = join(this.packDir, 'scenarios');
    this.v1IndexPath = join(this.packDir, 'pack.json');
    this.v2IndexPath = join(this.packDir, 'pack.json');
    this.publicationDir = join(this.packDir, PUBLICATION_DIR);
    this.revisionsDir = join(this.publicationDir, REVISION_DIR);
    this.statePath = join(this.publicationDir, 'state.json');
    this.draftPackPath = join(this.publicationDir, 'draft-pack.json');
    this.referencesPath = join(this.publicationDir, 'references.json');
    this.referencesDir = join(this.publicationDir, 'references');
    mkdirSync(this.unitsDir, { recursive: true });
    mkdirSync(this.buildingsDir, { recursive: true });
    mkdirSync(this.mapsDir, { recursive: true });
    mkdirSync(this.scenariosDir, { recursive: true });
    mkdirSync(this.revisionsDir, { recursive: true });
    mkdirSync(this.referencesDir, { recursive: true });
    this.materializeCanonicalV2Pack();
    this.initializePublicationState();
  }

  readPackV1(): PackV1 {
    return this.readDraftPackV1();
  }

  readPublishedPackV1(): PackV1 {
    const metadata = this.getCurrentRevisionMetadata();
    if (metadata.legacyManifestPath !== undefined) {
      const path = this.resolveRevisionRelativePath(metadata.revision, metadata.legacyManifestPath);
      if (existsSync(path)) {
        return parsePackV1(readFileSync(path, 'utf8'));
      }
    }
    const pack = this.readPublishedPackV2();
    return {
      schemaVersion: 1,
      id: pack.id,
      units: pack.units.map((unit) => downgradeUnitToV1(unit)),
    };
  }

  /** The draft view is retained for existing Foundry editor callers. */
  readPackV2(): PackV2 {
    return this.readDraftPackV2();
  }

  /** Runtime consumers use this view, never the mutable draft directories. */
  readPublishedPackV2(): PackV2 {
    const metadata = this.getCurrentRevisionMetadata();
    return this.readRevisionPack(metadata);
  }

  getPublicationStatus(): PublicationStatus {
    const state = this.readPublicationState();
    return {
      currentRevision: state.currentRevision,
      draftRevision: state.draftRevision,
      current: this.getRevisionMetadata(state.currentRevision),
    };
  }

  listRevisionMetadata(): RevisionMetadata[] {
    const revisions: RevisionMetadata[] = [];
    for (const name of readdirSync(this.revisionsDir)) {
      if (name.startsWith('.') || !isValidRevision(name)) {
        continue;
      }
      const metadataPath = join(this.revisionsDir, name, 'metadata.json');
      if (!existsSync(metadataPath)) {
        continue;
      }
      revisions.push(validateRevisionMetadata(JSON.parse(readFileSync(metadataPath, 'utf8'))));
    }
    return revisions.sort(compareRevisionMetadata);
  }

  getRevisionMetadata(revision: string): RevisionMetadata {
    assertSafeRevision(revision);
    const path = join(this.revisionsDir, revision, 'metadata.json');
    if (!existsSync(path)) {
      throw new ContentNotFoundError(`Revision not found: ${revision}`);
    }
    const metadata = validateRevisionMetadata(JSON.parse(readFileSync(path, 'utf8')));
    if (metadata.revision !== revision) {
      throw new Error(`Revision metadata mismatch for ${revision}`);
    }
    return metadata;
  }

  publish(expectedRevision: string): PublicationOperationResult {
    const current = this.getCurrentRevisionMetadata();
    this.assertCurrentRevision(expectedRevision, current, 'publication');
    const draft = validatePackV2(this.readDraftPackV2());
    const revision = this.nextPublicationRevision();
    const legacyPack = this.readDraftPackV1();
    const metadata = this.writeRevisionSnapshot(revision, draft, {
      allowMissingAssets: false,
      parentRevision: current.revision,
      legacyPack,
    });
    const publishedPack = this.readRevisionPack(metadata);
    const state = this.readPublicationState();
    atomicWriteJson(this.statePath, {
      schemaVersion: state.schemaVersion,
      currentRevision: metadata.revision,
      draftRevision: draft.revision,
    } satisfies PublicationState);
    return {
      metadata,
      pack: publishedPack,
      previousRevision: current.revision,
      draftRevision: draft.revision,
    };
  }

  revert(targetRevision: string, expectedCurrentRevision: string): PublicationOperationResult {
    const current = this.getCurrentRevisionMetadata();
    this.assertCurrentRevision(expectedCurrentRevision, current, 'publication');
    const target = this.getRevisionMetadata(targetRevision);
    const targetPack = this.readRevisionPack(target);
    const revision = this.nextPublicationRevision();
    const metadata = this.writeRevisionFromRetainedRevision(revision, target, targetPack, current.revision);
    const publishedPack = this.readRevisionPack(metadata);
    const state = this.readPublicationState();
    atomicWriteJson(this.statePath, {
      schemaVersion: state.schemaVersion,
      currentRevision: metadata.revision,
      draftRevision: state.draftRevision,
    } satisfies PublicationState);
    return {
      metadata,
      pack: publishedPack,
      previousRevision: current.revision,
      draftRevision: state.draftRevision,
    };
  }

  writePackV1Index(): void {
    if (this.readCanonicalV2Pack()) {
      return;
    }
    atomicWriteJson(this.v1IndexPath, this.readDraftPackV1());
  }

  writePackV2Index(units: UnitArchetype[], buildings: BuildingArchetype[]): PackV2 {
    const current = this.readDraftPackV2();
    const draft = this.buildPackV2Index(units, buildings, current.revision);
    return this.saveDraftPack(draft);
  }

  saveUnitV1(manifest: UnitManifest, pngBase64: string, expectedRevision?: string): UnitManifest {
    this.assertDraftRevision(expectedRevision);
    const validated = validateUnitManifest(manifest);
    const dir = join(this.unitsDir, validated.id);
    mkdirSync(dir, { recursive: true });
    const pngPath = join(dir, 'sprite.png');
    writePngAtomic(pngPath, pngBase64);
    const saved: UnitManifest = { ...validated, assetPath: `units/${validated.id}/sprite.png` };
    atomicWriteJson(join(dir, 'manifest.json'), saved);

    const upgraded = upgradePackV1ToV2({ schemaVersion: 1, id: 'dev-pack', units: [saved] });
    const draft = this.readDraftPackV2();
    const nextDraft: PackV2 = {
      ...draft,
      units: [...draft.units.filter((unit) => unit.id !== saved.id), ...upgraded.units].sort(compareById),
    };
    this.saveDraftPack(nextDraft);
    this.writePackV1Index();
    return saved;
  }

  createUnitArchetype(archetype: UnitArchetype, pngBase64?: string, expectedRevision?: string): UnitArchetype {
    this.assertDraftRevision(expectedRevision);
    const validated = validateUnitArchetype(archetype);
    const dir = join(this.unitsDir, validated.id);
    if (existsSync(join(dir, 'manifest.json'))) {
      throw new Error(`Unit archetype already exists: ${validated.id}`);
    }
    mkdirSync(dir, { recursive: true });
    const saved = this.persistUnitArchetype(dir, validated, pngBase64);
    const draft = this.readDraftPackV2();
    const nextDraft: PackV2 = {
      ...draft,
      units: [...draft.units.filter((unit) => unit.id !== saved.id), saved].sort(compareById),
    };
    this.saveDraftPack(nextDraft);
    return saved;
  }

  updateUnitArchetype(
    id: string,
    archetype: UnitArchetype,
    pngBase64?: string,
    expectedRevision?: string,
  ): UnitArchetype {
    this.assertDraftRevision(expectedRevision);
    if (archetype.id !== id) {
      throw new Error('Unit id mismatch');
    }
    const dir = join(this.unitsDir, id);
    if (!existsSync(join(dir, 'manifest.json'))) {
      throw new ContentNotFoundError(`Unit archetype not found: ${id}`);
    }
    const saved = this.persistUnitArchetype(dir, validateUnitArchetype(archetype), pngBase64);
    const draft = this.readDraftPackV2();
    this.saveDraftPack({
      ...draft,
      units: [...draft.units.filter((unit) => unit.id !== id), saved].sort(compareById),
    });
    return saved;
  }

  setUnitArchetypeEnabled(id: string, enabled: boolean, expectedRevision?: string): UnitArchetype {
    this.assertDraftRevision(expectedRevision);
    const current = this.getUnitArchetype(id);
    const updated: UnitArchetype = { ...current, enabled };
    atomicWriteJson(join(this.unitsDir, id, 'manifest.json'), updated);
    const draft = this.readDraftPackV2();
    this.saveDraftPack({
      ...draft,
      units: [...draft.units.filter((unit) => unit.id !== id), updated].sort(compareById),
    });
    return updated;
  }

  deleteUnitArchetype(id: string, force = false, expectedRevision?: string): { deleted: true; warning?: string } {
    this.assertDraftRevision(expectedRevision);
    const refs = this.findUnitReferences(id);
    if (refs.length > 0 && !force) {
      throw new DependencyConflictError('unit', id, refs);
    }
    const warning = refs.length > 0 ? `Removed unit referenced by: ${refs.join(', ')}` : undefined;
    const dir = join(this.unitsDir, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    const draft = this.readDraftPackV2();
    this.saveDraftPack({ ...draft, units: draft.units.filter((unit) => unit.id !== id) });
    return warning !== undefined ? { deleted: true, warning } : { deleted: true };
  }

  duplicateUnitArchetype(
    sourceId: string,
    newId: string,
    displayName?: string,
    expectedRevision?: string,
  ): UnitArchetype {
    this.assertDraftRevision(expectedRevision);
    assertContentId(newId, 'new unit id');
    const source = this.getUnitArchetype(sourceId);
    const destinationDir = join(this.unitsDir, newId);
    if (existsSync(join(destinationDir, 'manifest.json'))) {
      throw new Error(`Unit archetype already exists: ${newId}`);
    }
    const sourcePath = this.resolveDraftArchetypeAssetPath('unit', source);
    const fileName = basenameFromAssetPath(source.assetPath);
    mkdirSync(destinationDir, { recursive: true });
    copyPngAtomic(sourcePath, join(destinationDir, fileName));
    const duplicate = validateUnitArchetype({
      ...source,
      id: newId,
      displayName: displayName ?? `${source.displayName} Copy`,
      assetPath: `units/${newId}/${fileName}`,
    });
    atomicWriteJson(join(destinationDir, 'manifest.json'), duplicate);
    const draft = this.readDraftPackV2();
    this.saveDraftPack({
      ...draft,
      units: [...draft.units.filter((unit) => unit.id !== newId), duplicate].sort(compareById),
    });
    return duplicate;
  }

  getUnitArchetype(id: string): UnitArchetype {
    const file = join(this.unitsDir, id, 'manifest.json');
    if (!existsSync(file)) {
      throw new ContentNotFoundError(`Unit archetype not found: ${id}`);
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
    return result.sort(compareById);
  }

  createBuildingArchetype(
    archetype: BuildingArchetype,
    pngBase64?: string,
    expectedRevision?: string,
  ): BuildingArchetype {
    this.assertDraftRevision(expectedRevision);
    const validated = validateBuildingArchetype(archetype);
    const dir = join(this.buildingsDir, validated.id);
    if (existsSync(join(dir, 'manifest.json'))) {
      throw new Error(`Building archetype already exists: ${validated.id}`);
    }
    mkdirSync(dir, { recursive: true });
    const saved = this.persistBuildingArchetype(dir, validated, pngBase64);
    const draft = this.readDraftPackV2();
    this.saveDraftPack({
      ...draft,
      buildings: [...draft.buildings.filter((building) => building.id !== saved.id), saved].sort(compareById),
    });
    return saved;
  }

  updateBuildingArchetype(
    id: string,
    archetype: BuildingArchetype,
    pngBase64?: string,
    expectedRevision?: string,
  ): BuildingArchetype {
    this.assertDraftRevision(expectedRevision);
    if (archetype.id !== id) {
      throw new Error('Building id mismatch');
    }
    const dir = join(this.buildingsDir, id);
    if (!existsSync(join(dir, 'manifest.json'))) {
      throw new ContentNotFoundError(`Building archetype not found: ${id}`);
    }
    const saved = this.persistBuildingArchetype(dir, validateBuildingArchetype(archetype), pngBase64);
    const draft = this.readDraftPackV2();
    this.saveDraftPack({
      ...draft,
      buildings: [...draft.buildings.filter((building) => building.id !== id), saved].sort(compareById),
    });
    return saved;
  }

  setBuildingArchetypeEnabled(id: string, enabled: boolean, expectedRevision?: string): BuildingArchetype {
    this.assertDraftRevision(expectedRevision);
    const current = this.getBuildingArchetype(id);
    const updated: BuildingArchetype = { ...current, enabled };
    atomicWriteJson(join(this.buildingsDir, id, 'manifest.json'), updated);
    const draft = this.readDraftPackV2();
    this.saveDraftPack({
      ...draft,
      buildings: [...draft.buildings.filter((building) => building.id !== id), updated].sort(compareById),
    });
    return updated;
  }

  deleteBuildingArchetype(
    id: string,
    force = false,
    expectedRevision?: string,
  ): { deleted: true; warning?: string } {
    this.assertDraftRevision(expectedRevision);
    const refs = this.findBuildingReferences(id);
    if (refs.length > 0 && !force) {
      throw new DependencyConflictError('building', id, refs);
    }
    const warning = refs.length > 0 ? `Removed building referenced by: ${refs.join(', ')}` : undefined;
    const dir = join(this.buildingsDir, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    const draft = this.readDraftPackV2();
    this.saveDraftPack({ ...draft, buildings: draft.buildings.filter((building) => building.id !== id) });
    return warning !== undefined ? { deleted: true, warning } : { deleted: true };
  }

  duplicateBuildingArchetype(
    sourceId: string,
    newId: string,
    displayName?: string,
    expectedRevision?: string,
  ): BuildingArchetype {
    this.assertDraftRevision(expectedRevision);
    assertContentId(newId, 'new building id');
    const source = this.getBuildingArchetype(sourceId);
    const destinationDir = join(this.buildingsDir, newId);
    if (existsSync(join(destinationDir, 'manifest.json'))) {
      throw new Error(`Building archetype already exists: ${newId}`);
    }
    const sourcePath = this.resolveDraftArchetypeAssetPath('building', source);
    const fileName = basenameFromAssetPath(source.assetPath);
    mkdirSync(destinationDir, { recursive: true });
    copyPngAtomic(sourcePath, join(destinationDir, fileName));
    const duplicate = validateBuildingArchetype({
      ...source,
      id: newId,
      displayName: displayName ?? `${source.displayName} Copy`,
      assetPath: `buildings/${newId}/${fileName}`,
    });
    atomicWriteJson(join(destinationDir, 'manifest.json'), duplicate);
    const draft = this.readDraftPackV2();
    this.saveDraftPack({
      ...draft,
      buildings: [...draft.buildings.filter((building) => building.id !== newId), duplicate].sort(compareById),
    });
    return duplicate;
  }

  getBuildingArchetype(id: string): BuildingArchetype {
    const file = join(this.buildingsDir, id, 'manifest.json');
    if (!existsSync(file)) {
      throw new ContentNotFoundError(`Building archetype not found: ${id}`);
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
    return result.sort(compareById);
  }

  createReferenceAttachment(
    input: { id: string; displayName: string },
    pngBase64: string,
  ): ReferenceAttachmentMetadata {
    assertContentId(input.id, 'reference id');
    const decoded = decodePng(decodePngBase64(pngBase64));
    const bytes = Buffer.from(decodePngBase64(pngBase64));
    const hash = sha256Buffer(bytes);
    const storageRelative = `${PUBLICATION_DIR}/references/${input.id}/${hash}.png`;
    const storagePath = join(this.packDir, storageRelative);
    if (!existsSync(storagePath)) {
      mkdirSync(dirname(storagePath), { recursive: true });
      writeFileSync(storagePath, bytes, { flag: 'wx' });
    }
    const metadata = validateReferenceAttachmentMetadata({
      schemaVersion: 1,
      id: input.id,
      displayName: input.displayName,
      assetPath: `references/${input.id}/${hash}.png`,
      storagePath: storageRelative,
      sha256: hash,
      byteLength: bytes.length,
      width: decoded.width,
      height: decoded.height,
      createdAt: new Date().toISOString(),
    });
    const references = this.readReferenceAttachments().filter((reference) => reference.id !== input.id);
    references.push(metadata);
    atomicWriteJson(this.referencesPath, references.sort(compareById));
    return metadata;
  }

  listReferenceAttachments(): ReferenceAttachmentMetadata[] {
    return this.readReferenceAttachments();
  }

  deleteReferenceAttachment(id: string): { deleted: true } {
    const references = this.readReferenceAttachments();
    if (!references.some((reference) => reference.id === id)) {
      throw new ContentNotFoundError(`Reference attachment not found: ${id}`);
    }
    atomicWriteJson(this.referencesPath, references.filter((reference) => reference.id !== id));
    return { deleted: true };
  }

  resolveAssetPath(relativePath: string): string {
    const safe = sanitizeRelativePath(relativePath);
    const metadata = this.getCurrentRevisionMetadata();
    const asset = metadata.assets.find((entry) => entry.assetPath === safe);
    if (!asset) {
      throw new ContentNotFoundError('Asset not found');
    }
    const absolute = this.resolveRevisionStoragePath(metadata.revision, asset.storagePath);
    if (!existsSync(absolute)) {
      throw new Error('Published asset is missing');
    }
    return absolute;
  }

  resolveUnitFilePath(relativePath: string): string {
    return this.resolveAssetPath(`units/${relativePath}`);
  }

  resolveDraftAssetPath(relativePath: string): string {
    const safe = sanitizeRelativePath(relativePath);
    const absolute = join(this.packDir, safe);
    assertWithinPack(this.packDir, absolute);
    if (!existsSync(absolute)) {
      throw new ContentNotFoundError('Draft asset not found');
    }
    return absolute;
  }

  /** Legacy v1 callers can keep their immediate save semantics during migration. */
  publishLegacyV1Compatibility(): PublicationOperationResult | null {
    if (!this.isV1PackJson()) {
      return null;
    }
    const current = this.getCurrentRevisionMetadata();
    const draft = validatePackV2(this.readDraftPackV2());
    const revision = this.nextPublicationRevision();
    const metadata = this.writeRevisionSnapshot(revision, draft, {
      allowMissingAssets: true,
      parentRevision: current.revision,
      legacyPack: this.readDraftPackV1(),
    });
    const publishedPack = this.readRevisionPack(metadata);
    const state = this.readPublicationState();
    atomicWriteJson(this.statePath, {
      schemaVersion: state.schemaVersion,
      currentRevision: metadata.revision,
      draftRevision: draft.revision,
    } satisfies PublicationState);
    return {
      metadata,
      pack: publishedPack,
      previousRevision: current.revision,
      draftRevision: draft.revision,
    };
  }

  private initializePublicationState(): void {
    if (existsSync(this.statePath)) {
      const state = this.readPublicationState();
      this.getRevisionMetadata(state.currentRevision);
      if (!existsSync(this.draftPackPath)) {
        const draft = validatePackV2({ ...this.buildDraftPackV2(), revision: state.draftRevision });
        atomicWriteJson(this.draftPackPath, draft);
      }
      return;
    }

    const legacyPack = this.readDraftPackV1();
    const sourceDraft = this.buildDraftPackV2();
    const initialRevisionCandidate = safeRevisionOrInitial(sourceDraft.revision);
    const initialRevision = this.revisionDirectoryExists(initialRevisionCandidate)
      ? this.nextAvailableRevision(initialRevisionCandidate)
      : initialRevisionCandidate;
    const initialPack = validatePackV2({ ...sourceDraft, revision: initialRevision });
    atomicWriteJson(this.draftPackPath, initialPack);
    const metadata = this.writeRevisionSnapshot(initialRevision, initialPack, {
      allowMissingAssets: true,
      legacyPack,
    });
    atomicWriteJson(this.statePath, {
      schemaVersion: 1,
      currentRevision: metadata.revision,
      draftRevision: initialPack.revision,
    } satisfies PublicationState);
  }

  private readPublicationState(): PublicationState {
    if (!existsSync(this.statePath)) {
      throw new Error('Publication state is missing');
    }
    return validatePublicationState(JSON.parse(readFileSync(this.statePath, 'utf8')));
  }

  private getCurrentRevisionMetadata(): RevisionMetadata {
    return this.getRevisionMetadata(this.readPublicationState().currentRevision);
  }

  private assertCurrentRevision(
    expectedRevision: string,
    current: RevisionMetadata,
    scope: 'draft' | 'publication',
  ): void {
    assertSafeRevision(expectedRevision);
    const actual = scope === 'draft' ? this.readPublicationState().draftRevision : current.revision;
    if (actual !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, current, scope, actual);
    }
  }

  private assertDraftRevision(expectedRevision: string | undefined): void {
    if (expectedRevision === undefined) {
      return;
    }
    const current = this.getCurrentRevisionMetadata();
    this.assertCurrentRevision(expectedRevision, current, 'draft');
  }

  private readDraftPackV1(): PackV1 {
    const units: UnitManifest[] = [];
    if (existsSync(this.unitsDir)) {
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
    }
    const index = this.peekPackJson();
    const id = index?.schemaVersion === 1 && typeof index.id === 'string' ? index.id : 'dev-pack';
    return { schemaVersion: 1, id, units: units.sort(compareById) };
  }

  private readDraftPackV2(): PackV2 {
    const canonical = this.readCanonicalV2Pack();
    if (canonical) {
      if (!existsSync(this.draftPackPath)) {
        return this.buildDraftPackV2();
      }
      const draft = validatePackV2(JSON.parse(readFileSync(this.draftPackPath, 'utf8')));
      if (draft.revision !== canonical.revision || draft.contentHash !== canonical.contentHash) {
        return this.buildDraftPackV2();
      }
      return draft;
    }
    if (existsSync(this.draftPackPath)) {
      return validatePackV2(JSON.parse(readFileSync(this.draftPackPath, 'utf8')));
    }
    return this.buildDraftPackV2();
  }

  private buildDraftPackV2(): PackV2 {
    const canonical = this.readCanonicalV2Pack();
    const diskUnits = this.listUnitArchetypesFromDisk();
    const diskBuildings = this.listBuildingArchetypesFromDisk();
    if (canonical) {
      return this.mergeCanonicalWithDisk(canonical, diskUnits, diskBuildings);
    }
    const upgraded = upgradePackV1ToV2(this.readDraftPackV1());
    const units = [...upgraded.units, ...diskUnits].sort(compareById);
    return this.buildPackV2Index(units, diskBuildings, safeRevisionOrInitial(upgraded.revision));
  }

  private saveDraftPack(pack: PackV2): PackV2 {
    const current = this.readDraftPackV2();
    const revision = this.nextDraftRevision(current.revision);
    const draft = validatePackV2({ ...pack, revision });
    atomicWriteJson(this.draftPackPath, draft);
    if (!this.isV1PackJson()) {
      atomicWriteJson(this.v2IndexPath, draft);
    }
    if (existsSync(this.statePath)) {
      const state = this.readPublicationState();
      atomicWriteJson(this.statePath, {
        ...state,
        draftRevision: draft.revision,
      } satisfies PublicationState);
    }
    return draft;
  }

  private nextDraftRevision(current: string): string {
    const candidate = safeRevisionOrInitial(bumpRevision(current));
    return candidate;
  }

  private readCanonicalV2Pack(): PackV2 | null {
    const index = this.peekPackJson();
    if (index?.schemaVersion !== 2) {
      return null;
    }
    return validatePackV2(JSON.parse(readFileSync(this.v2IndexPath, 'utf8')));
  }

  private mergeCanonicalWithDisk(
    canonical: PackV2,
    diskUnits: UnitArchetype[],
    diskBuildings: BuildingArchetype[],
  ): PackV2 {
    const units = mergeArchetypesById(canonical.units, diskUnits);
    const buildings = mergeArchetypesById(canonical.buildings, diskBuildings);
    const packWithoutHash: Omit<PackV2, 'contentHash'> = {
      schemaVersion: 2,
      id: canonical.id,
      revision: safeRevisionOrInitial(canonical.revision),
      factions: canonical.factions,
      units,
      buildings,
    };
    if (canonical.maps) {
      packWithoutHash.maps = canonical.maps;
    }
    if (canonical.scenarios) {
      packWithoutHash.scenarios = canonical.scenarios;
    }
    return { ...packWithoutHash, contentHash: computeContentHash(packWithoutHash) };
  }

  private materializeCanonicalV2Pack(): void {
    const pack = this.readCanonicalV2Pack();
    if (!pack) {
      return;
    }
    for (const unit of pack.units) {
      const dir = join(this.unitsDir, unit.id);
      mkdirSync(dir, { recursive: true });
      const manifest = join(dir, 'manifest.json');
      if (!existsSync(manifest)) {
        atomicWriteJson(manifest, unit);
      }
    }
    for (const building of pack.buildings) {
      const dir = join(this.buildingsDir, building.id);
      mkdirSync(dir, { recursive: true });
      const manifest = join(dir, 'manifest.json');
      if (!existsSync(manifest)) {
        atomicWriteJson(manifest, building);
      }
    }
  }

  private persistUnitArchetype(dir: string, archetype: UnitArchetype, pngBase64?: string): UnitArchetype {
    const validated = validateUnitArchetype(archetype);
    const assetFileName = basenameFromAssetPath(validated.assetPath);
    const pngPath = join(dir, assetFileName);
    if (pngBase64 !== undefined) {
      writePngAtomic(pngPath, pngBase64);
    } else if (existsSync(pngPath)) {
      decodePng(readFileSync(pngPath));
    } else {
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
    const pngPath = join(dir, assetFileName);
    if (pngBase64 !== undefined) {
      writePngAtomic(pngPath, pngBase64);
    } else if (existsSync(pngPath)) {
      decodePng(readFileSync(pngPath));
    } else {
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
      revision: safeRevisionOrInitial(revision),
      factions: DEFAULT_FACTIONS,
      units: [...units].sort(compareById),
      buildings: [...buildings].sort(compareById),
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
    for (const file of readdirSync(this.mapsDir).sort()) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const id = file.replace(/\.json$/, '');
      if (!isValidContentId(id)) {
        continue;
      }
      maps.push({ id, path: `maps/${file}` });
    }
    return maps.length > 0 ? maps : undefined;
  }

  private readScenarioReferences(): PackV2['scenarios'] {
    if (!existsSync(this.scenariosDir)) {
      return undefined;
    }
    const scenarios: NonNullable<PackV2['scenarios']> = [];
    for (const file of readdirSync(this.scenariosDir).sort()) {
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
    return refs.sort();
  }

  private writeRevisionSnapshot(
    revision: string,
    draft: PackV2,
    options: {
      allowMissingAssets: boolean;
      parentRevision?: string;
      sourceRevision?: string;
      legacyPack: PackV1;
    },
  ): RevisionMetadata {
    assertSafeRevision(revision);
    const finalDir = join(this.revisionsDir, revision);
    if (existsSync(finalDir)) {
      throw new Error(`Revision already exists: ${revision}`);
    }
    const tempDir = join(this.revisionsDir, `.${revision}.${randomBytes(8).toString('hex')}.tmp`);
    mkdirSync(join(tempDir, 'assets'), { recursive: true });
    try {
      const pack = validatePackV2({ ...draft, revision });
      const packText = jsonText(pack);
      const assetRefs = this.collectRevisionAssets(pack, tempDir, revision, options.allowMissingAssets);
      const metadata = this.buildRevisionMetadata(revision, pack, assetRefs, options);
      writeFileSync(join(tempDir, 'pack.json'), packText);
      writeFileSync(join(tempDir, 'pack-v1.json'), jsonText(options.legacyPack));
      atomicWriteJson(join(tempDir, 'metadata.json'), metadata);
      renameSync(tempDir, finalDir);
      return metadata;
    } catch (error) {
      rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  private writeRevisionFromRetainedRevision(
    revision: string,
    sourceMetadata: RevisionMetadata,
    sourcePack: PackV2,
    parentRevision: string,
  ): RevisionMetadata {
    assertSafeRevision(revision);
    const sourceDir = join(this.revisionsDir, sourceMetadata.revision);
    const finalDir = join(this.revisionsDir, revision);
    if (!existsSync(sourceDir)) {
      throw new ContentNotFoundError(`Retained revision source not found: ${sourceMetadata.revision}`);
    }
    const tempDir = join(this.revisionsDir, `.${revision}.${randomBytes(8).toString('hex')}.tmp`);
    try {
      cpSync(sourceDir, tempDir, { recursive: true, errorOnExist: true });
      const pack = validatePackV2({ ...sourcePack, revision });
      const packText = jsonText(pack);
      const assets: ImmutableAssetReference[] = sourceMetadata.assets.map((asset) => {
        const sourcePath = this.resolveRevisionStoragePath(sourceMetadata.revision, asset.storagePath);
        if (!existsSync(sourcePath)) {
          throw new Error(`Retained revision asset is missing: ${asset.assetPath}`);
        }
        return {
          ...asset,
          storagePath: `${PUBLICATION_DIR}/${REVISION_DIR}/${revision}/assets/${asset.assetPath}`,
        };
      });
      const metadata = validateRevisionMetadata({
        ...sourceMetadata,
        revision,
        manifestPath: `${PUBLICATION_DIR}/${REVISION_DIR}/${revision}/pack.json`,
        ...(sourceMetadata.legacyManifestPath
          ? { legacyManifestPath: `${PUBLICATION_DIR}/${REVISION_DIR}/${revision}/pack-v1.json` }
          : {}),
        manifestHash: sha256Text(packText),
        assets,
        restartRequired: sourceMetadata.simulationRulesHash !== this.getCurrentRevisionMetadata().simulationRulesHash,
        createdAt: new Date().toISOString(),
        parentRevision,
        sourceRevision: sourceMetadata.revision,
      });
      writeFileSync(join(tempDir, 'pack.json'), packText);
      atomicWriteJson(join(tempDir, 'metadata.json'), metadata);
      renameSync(tempDir, finalDir);
      return metadata;
    } catch (error) {
      rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  private buildRevisionMetadata(
    revision: string,
    pack: PackV2,
    assets: ImmutableAssetReference[],
    options: { parentRevision?: string; sourceRevision?: string },
  ): RevisionMetadata {
    const runtimeAssetHashes = assets.map((asset) => ({
      assetPath: asset.assetPath,
      sha256: asset.sha256,
      kind: asset.kind,
    }));
    const metadata = validateRevisionMetadata({
      schemaVersion: 1,
      revision,
      packId: pack.id,
      manifestPath: `${PUBLICATION_DIR}/${REVISION_DIR}/${revision}/pack.json`,
      legacyManifestPath: `${PUBLICATION_DIR}/${REVISION_DIR}/${revision}/pack-v1.json`,
      manifestHash: sha256Text(jsonText(pack)),
      visualContentHash: computeVisualContentHash(pack, runtimeAssetHashes),
      simulationRulesHash: computeSimulationRulesHash(pack, runtimeAssetHashes),
      restartRequired: options.parentRevision
        ? computeSimulationRulesHash(pack, runtimeAssetHashes) !== this.getRevisionMetadata(options.parentRevision).simulationRulesHash
        : false,
      assets,
      createdAt: new Date().toISOString(),
      ...(options.parentRevision ? { parentRevision: options.parentRevision } : {}),
      ...(options.sourceRevision ? { sourceRevision: options.sourceRevision } : {}),
    });
    return metadata;
  }

  private collectRevisionAssets(
    pack: PackV2,
    tempDir: string,
    revision: string,
    allowMissingAssets: boolean,
  ): ImmutableAssetReference[] {
    const assets: ImmutableAssetReference[] = [];
    const seen = new Set<string>();
    const runtimeEntries: Array<{ kind: 'runtime'; assetPath: string; sourcePath: string }> = [];
    for (const unit of pack.units) {
      runtimeEntries.push({
        kind: 'runtime',
        assetPath: unit.assetPath,
        sourcePath: this.resolveDraftArchetypeAssetPath('unit', unit),
      });
    }
    for (const building of pack.buildings) {
      runtimeEntries.push({
        kind: 'runtime',
        assetPath: building.assetPath,
        sourcePath: this.resolveDraftArchetypeAssetPath('building', building),
      });
    }
    for (const entry of runtimeEntries) {
      this.copyRevisionAsset(entry, tempDir, revision, allowMissingAssets, seen, assets);
    }

    const dataEntries: Array<{ kind: 'data'; assetPath: string; sourcePath: string; validate: (value: unknown) => unknown }> = [];
    for (const reference of pack.maps ?? []) {
      dataEntries.push({
        kind: 'data',
        assetPath: reference.path,
        sourcePath: this.resolveDraftReferencePath(reference.path),
        validate: validateMapDef,
      });
    }
    for (const reference of pack.scenarios ?? []) {
      dataEntries.push({
        kind: 'data',
        assetPath: reference.path,
        sourcePath: this.resolveDraftReferencePath(reference.path),
        validate: validateScenarioDef,
      });
    }
    for (const entry of dataEntries) {
      if (!existsSync(entry.sourcePath)) {
        if (allowMissingAssets) {
          continue;
        }
        throw new Error(`Referenced content is missing: ${entry.assetPath}`);
      }
      const parsed = JSON.parse(readFileSync(entry.sourcePath, 'utf8')) as unknown;
      entry.validate(parsed);
      this.copyRevisionAsset(entry, tempDir, revision, false, seen, assets);
    }
    this.validateDraftDependencies(pack);
    return assets.sort(compareAssetReferences);
  }

  private copyRevisionAsset(
    entry: { kind: 'runtime' | 'data'; assetPath: string; sourcePath: string },
    tempDir: string,
    revision: string,
    allowMissingAssets: boolean,
    seen: Set<string>,
    assets: ImmutableAssetReference[],
  ): void {
    if (!existsSync(entry.sourcePath)) {
      if (allowMissingAssets) {
        return;
      }
      throw new Error(`Runtime asset is missing: ${entry.assetPath}`);
    }
    const bytes = readFileSync(entry.sourcePath);
    let width: number | undefined;
    let height: number | undefined;
    if (entry.kind === 'runtime') {
      const decoded = decodePng(bytes);
      width = decoded.width;
      height = decoded.height;
    } else {
      if (!entry.assetPath.endsWith('.json')) {
        throw new Error(`Referenced data must be JSON: ${entry.assetPath}`);
      }
    }
    const hash = sha256Buffer(bytes);
    const destinationRelative = `${PUBLICATION_DIR}/${REVISION_DIR}/${revision}/assets/${entry.assetPath}`;
    const destination = join(tempDir, 'assets', entry.assetPath);
    assertWithinPack(this.packDir, join(this.packDir, entry.assetPath));
    if (!seen.has(`${entry.kind}:${entry.assetPath}`)) {
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(entry.sourcePath, destination);
      const asset: ImmutableAssetReference = {
        kind: entry.kind,
        assetPath: entry.assetPath,
        storagePath: destinationRelative,
        sha256: hash,
        byteLength: bytes.length,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      };
      assets.push(asset);
      seen.add(`${entry.kind}:${entry.assetPath}`);
    }
  }

  private validateDraftDependencies(pack: PackV2): void {
    const unitIds = new Set(pack.units.map((unit) => unit.id));
    const buildingIds = new Set(pack.buildings.map((building) => building.id));
    for (const reference of pack.scenarios ?? []) {
      const path = this.resolveDraftReferencePath(reference.path);
      if (!existsSync(path)) {
        throw new Error(`Scenario reference is missing: ${reference.path}`);
      }
      const scenario = validateScenarioDef(JSON.parse(readFileSync(path, 'utf8')));
      for (const unit of scenario.units) {
        if (!unitIds.has(unit.archetypeId)) {
          throw new Error(`Scenario ${scenario.id} references missing unit ${unit.archetypeId}`);
        }
      }
      for (const building of scenario.buildings) {
        if (!buildingIds.has(building.archetypeId)) {
          throw new Error(`Scenario ${scenario.id} references missing building ${building.archetypeId}`);
        }
      }
    }
  }

  private resolveDraftArchetypeAssetPath(kind: 'unit' | 'building', archetype: UnitArchetype | BuildingArchetype): string {
    const safe = sanitizeRelativePath(archetype.assetPath);
    const direct = join(this.packDir, safe);
    assertWithinPack(this.packDir, direct);
    if (existsSync(direct)) {
      return direct;
    }
    const fileName = basenameFromAssetPath(safe);
    const dir = kind === 'unit' ? this.unitsDir : this.buildingsDir;
    const fallback = join(dir, archetype.id, fileName);
    assertWithinPack(dir, fallback);
    return fallback;
  }

  private resolveDraftReferencePath(path: string): string {
    const safe = sanitizeRelativePath(path);
    const absolute = join(this.packDir, safe);
    assertWithinPack(this.packDir, absolute);
    return absolute;
  }

  private readRevisionPack(metadata: RevisionMetadata): PackV2 {
    const path = this.resolveRevisionRelativePath(metadata.revision, metadata.manifestPath);
    const pack = validatePackV2(JSON.parse(readFileSync(path, 'utf8')));
    if (pack.revision !== metadata.revision) {
      throw new Error(`Published pack revision mismatch: ${metadata.revision}`);
    }
    return pack;
  }

  private resolveRevisionRelativePath(revision: string, path: string): string {
    assertSafeRevision(revision);
    const safe = sanitizeRelativePath(path);
    const absolute = join(this.packDir, safe);
    assertWithinPack(this.packDir, absolute);
    const expectedRoot = join(this.revisionsDir, revision);
    assertWithinPack(expectedRoot, absolute);
    if (!existsSync(absolute)) {
      throw new ContentNotFoundError(`Published file not found: ${path}`);
    }
    return absolute;
  }

  private resolveRevisionStoragePath(revision: string, storagePath: string): string {
    const absolute = this.resolveRevisionRelativePath(revision, storagePath);
    const expectedPrefix = `${PUBLICATION_DIR}/${REVISION_DIR}/${revision}/assets/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      throw new Error('Revision asset points outside its immutable revision');
    }
    return absolute;
  }

  private nextPublicationRevision(): string {
    const revisions = this.listRevisionMetadata().map((metadata) => metadata.revision);
    const numeric = revisions
      .map((revision) => Number.parseInt(revision, 10))
      .filter((value) => Number.isSafeInteger(value) && value >= 0);
    const candidate = numeric.length > 0 ? String(Math.max(...numeric) + 1) : bumpRevision(this.getCurrentRevisionMetadata().revision);
    return this.nextAvailableRevision(safeRevisionOrInitial(candidate), revisions);
  }

  private nextAvailableRevision(candidate: string, existing = this.listRevisionMetadata().map((metadata) => metadata.revision)): string {
    let next = safeRevisionOrInitial(candidate);
    const used = new Set(existing);
    while (used.has(next)) {
      next = safeRevisionOrInitial(bumpRevision(next));
    }
    return next;
  }

  private revisionDirectoryExists(revision: string): boolean {
    return existsSync(join(this.revisionsDir, revision));
  }

  private readReferenceAttachments(): ReferenceAttachmentMetadata[] {
    if (!existsSync(this.referencesPath)) {
      return [];
    }
    const parsed: unknown = JSON.parse(readFileSync(this.referencesPath, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error('Reference metadata must be an array');
    }
    return parsed.map((entry) => validateReferenceAttachmentMetadata(entry)).sort(compareById);
  }

  private peekPackJson(): { schemaVersion?: unknown; id?: unknown } | null {
    if (!existsSync(this.v1IndexPath)) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.v1IndexPath, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as { schemaVersion?: unknown; id?: unknown };
      }
    } catch {
      return null;
    }
    return null;
  }

  private isV1PackJson(): boolean {
    return this.peekPackJson()?.schemaVersion === 1;
  }
}

export function sanitizeRelativePath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('invalid path');
  }
  let decoded = path;
  let stable = false;
  for (let pass = 0; pass < 8; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error('invalid path');
    }
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }
  if (
    !stable ||
    decoded.trim().length === 0 ||
    decoded !== decoded.trim() ||
    decoded.startsWith('/') ||
    decoded.includes('\\') ||
    decoded.includes('\u0000') ||
    decoded.includes(':')
  ) {
    throw new Error('invalid path');
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('invalid path');
  }
  return segments.join('/');
}

function assertWithinPack(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`${sep}..${sep}`)) {
    throw new Error('invalid path');
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tempPath, jsonText(value));
  renameSync(tempPath, path);
}

function writePngAtomic(path: string, pngBase64: string): void {
  const buffer = decodePngBase64(pngBase64);
  decodePng(buffer);
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tempPath, buffer);
  renameSync(tempPath, path);
}

function copyPngAtomic(sourcePath: string, destinationPath: string): void {
  const bytes = readFileSync(sourcePath);
  decodePng(bytes);
  mkdirSync(dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, destinationPath);
}

function decodePngBase64(pngBase64: string): Buffer {
  if (typeof pngBase64 !== 'string') {
    throw new Error('pngBase64 is required');
  }
  const value = pngBase64.replace(/^data:image\/png;base64,/i, '');
  if (value.length === 0 || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('pngBase64 is invalid');
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0) {
    throw new Error('pngBase64 is invalid');
  }
  return buffer;
}

function basenameFromAssetPath(assetPath: string): string {
  const parts = sanitizeRelativePath(assetPath).split('/');
  const base = parts[parts.length - 1];
  if (!base || base === '.' || base === '..') {
    throw new Error('Invalid assetPath');
  }
  return base;
}

function assertContentId(value: string, label: string): void {
  if (!isValidContentId(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertSafeRevision(value: string): void {
  if (!isValidRevision(value)) {
    throw new Error('revision must be a safe identifier');
  }
}

function safeRevisionOrInitial(value: string): string {
  return isValidRevision(value) ? value : createInitialRevision();
}

function isV1Manifest(value: unknown): value is UnitManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1
  );
}

function isV2UnitArchetype(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2
  );
}

function isV2BuildingArchetype(value: unknown): boolean {
  return isV2UnitArchetype(value);
}

function mergeArchetypesById<T extends { id: string }>(base: readonly T[], overlay: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const entry of base) {
    byId.set(entry.id, entry);
  }
  for (const entry of overlay) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort(compareById);
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

function compareRevisionMetadata(a: RevisionMetadata, b: RevisionMetadata): number {
  const aNumber = Number.parseInt(a.revision, 10);
  const bNumber = Number.parseInt(b.revision, 10);
  if (Number.isSafeInteger(aNumber) && Number.isSafeInteger(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return a.revision.localeCompare(b.revision);
}

function compareAssetReferences(a: ImmutableAssetReference, b: ImmutableAssetReference): number {
  return `${a.kind}:${a.assetPath}`.localeCompare(`${b.kind}:${b.assetPath}`);
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Buffer(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function parsePackV1(value: string): PackV1 {
  const parsed: unknown = JSON.parse(value);
  if (!isRecordLike(parsed)) {
    throw new Error('Published v1 pack is invalid');
  }
  const unitsValue = parsed['units'];
  if (!Array.isArray(unitsValue)) {
    throw new Error('Published v1 pack units are invalid');
  }
  const units = unitsValue.map((unit) => validateUnitManifest(unit));
  return {
    schemaVersion: 1,
    id: typeof parsed['id'] === 'string' ? parsed['id'] : 'dev-pack',
    units,
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function downgradeUnitToV1(unit: UnitArchetype): UnitManifest {
  const faction = unit.factionId === 'sunweaver' ? 'friendly' : unit.factionId === 'gravemark' ? 'opposing' : 'neutral';
  return {
    schemaVersion: 1,
    id: unit.id,
    displayName: unit.displayName,
    enabled: unit.enabled,
    faction,
    assetPath: unit.assetPath,
    sourceWidth: unit.sourceWidth,
    sourceHeight: unit.sourceHeight,
    bounds: unit.bounds,
    anchor: unit.anchor,
    worldHeight: unit.worldHeight,
    selectionRadius: unit.selectionRadius,
    ...(unit.tags !== undefined ? { tags: unit.tags } : {}),
  };
}
