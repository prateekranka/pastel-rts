import {
  isRecord,
  requireContentId,
  requireNonNegativeInt,
  requirePositiveInt,
  requireSafeAssetPath,
  requireString,
} from './validation';

export const PUBLICATION_SCHEMA_VERSION = 1 as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type RevisionAssetKind = 'runtime' | 'data';

/** A logical pack path and the immutable copy used by one publication. */
export type ImmutableAssetReference = {
  kind: RevisionAssetKind;
  assetPath: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
  width?: number;
  height?: number;
};

/** Immutable metadata for one published pack revision. */
export type RevisionMetadata = {
  schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
  revision: string;
  packId: string;
  manifestPath: string;
  legacyManifestPath?: string;
  manifestHash: string;
  visualContentHash: string;
  simulationRulesHash: string;
  restartRequired: boolean;
  assets: ImmutableAssetReference[];
  createdAt: string;
  parentRevision?: string;
  sourceRevision?: string;
};

/** Reference art is deliberately not a runtime asset or a pack entry. */
export type ReferenceAttachmentMetadata = {
  schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
  id: string;
  displayName: string;
  assetPath: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  createdAt: string;
};

export type PublicationState = {
  schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
  currentRevision: string;
  draftRevision: string;
};

export function isValidRevision(value: string): boolean {
  return REVISION_PATTERN.test(value);
}

export function validateRevisionMetadata(value: unknown): RevisionMetadata {
  if (!isRecord(value)) {
    throw new Error('Revision metadata must be an object');
  }
  if (value['schemaVersion'] !== PUBLICATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported publication schemaVersion: ${String(value['schemaVersion'])}`);
  }
  const revision = requireRevision(value['revision']);
  const metadata: RevisionMetadata = {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    revision,
    packId: requireContentId(value['packId'], 'packId'),
    manifestPath: requireSafeAssetPath(value['manifestPath'], 'manifestPath'),
    manifestHash: requireHash(value['manifestHash'], 'manifestHash'),
    visualContentHash: requireHash(value['visualContentHash'], 'visualContentHash'),
    simulationRulesHash: requireHash(value['simulationRulesHash'], 'simulationRulesHash'),
    restartRequired: requireBoolean(value['restartRequired'], 'restartRequired'),
    assets: parseAssetReferences(value['assets']),
    createdAt: requireString(value['createdAt'], 'createdAt'),
  };
  const legacyManifestPath = value['legacyManifestPath'];
  if (legacyManifestPath !== undefined) {
    metadata.legacyManifestPath = requireSafeAssetPath(legacyManifestPath, 'legacyManifestPath');
  }
  const parentRevision = value['parentRevision'];
  if (parentRevision !== undefined) {
    metadata.parentRevision = requireRevision(parentRevision);
  }
  const sourceRevision = value['sourceRevision'];
  if (sourceRevision !== undefined) {
    metadata.sourceRevision = requireRevision(sourceRevision);
  }
  if (metadata.parentRevision === metadata.revision || metadata.sourceRevision === metadata.revision) {
    throw new Error('Revision metadata cannot point to itself');
  }
  return metadata;
}

export function validateReferenceAttachmentMetadata(value: unknown): ReferenceAttachmentMetadata {
  if (!isRecord(value)) {
    throw new Error('Reference attachment metadata must be an object');
  }
  if (value['schemaVersion'] !== PUBLICATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported publication schemaVersion: ${String(value['schemaVersion'])}`);
  }
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    id: requireContentId(value['id'], 'reference id'),
    displayName: requireString(value['displayName'], 'reference displayName'),
    assetPath: requireSafeAssetPath(value['assetPath'], 'reference assetPath'),
    storagePath: requireSafeAssetPath(value['storagePath'], 'reference storagePath'),
    sha256: requireHash(value['sha256'], 'reference sha256'),
    byteLength: requirePositiveInt(value['byteLength'], 'reference byteLength'),
    width: requirePositiveInt(value['width'], 'reference width'),
    height: requirePositiveInt(value['height'], 'reference height'),
    createdAt: requireString(value['createdAt'], 'reference createdAt'),
  };
}

export function validatePublicationState(value: unknown): PublicationState {
  if (!isRecord(value)) {
    throw new Error('Publication state must be an object');
  }
  if (value['schemaVersion'] !== PUBLICATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported publication schemaVersion: ${String(value['schemaVersion'])}`);
  }
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    currentRevision: requireRevision(value['currentRevision']),
    draftRevision: requireRevision(value['draftRevision']),
  };
}

function parseAssetReferences(value: unknown): ImmutableAssetReference[] {
  if (!Array.isArray(value)) {
    throw new Error('Revision assets must be an array');
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Revision asset ${String(index)} must be an object`);
    }
    const kind = entry['kind'];
    if (kind !== 'runtime' && kind !== 'data') {
      throw new Error(`Invalid revision asset kind at index ${String(index)}`);
    }
    const asset: ImmutableAssetReference = {
      kind,
      assetPath: requireSafeAssetPath(entry['assetPath'], `revision asset ${String(index)} assetPath`),
      storagePath: requireSafeAssetPath(entry['storagePath'], `revision asset ${String(index)} storagePath`),
      sha256: requireHash(entry['sha256'], `revision asset ${String(index)} sha256`),
      byteLength: requirePositiveInt(entry['byteLength'], `revision asset ${String(index)} byteLength`),
    };
    const width = entry['width'];
    if (width !== undefined) {
      asset.width = requirePositiveInt(width, `revision asset ${String(index)} width`);
    }
    const height = entry['height'];
    if (height !== undefined) {
      asset.height = requirePositiveInt(height, `revision asset ${String(index)} height`);
    }
    return asset;
  });
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
  }
  return value;
}

function requireRevision(value: unknown): string {
  if (typeof value !== 'string' || !isValidRevision(value)) {
    throw new Error('revision must be a safe identifier');
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}
