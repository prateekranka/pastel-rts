import type {
  BuildingArchetype,
  PackV2,
  UnitArchetype,
  UnitManifest,
} from '@pastel-rts/content-schema';

const BASE = '/dev-content';
const DEFAULT_SCENARIO = 'interaction-lab-alien-fantasy';

export type RevisionAsset = {
  kind: 'runtime' | 'data';
  assetPath: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
  width?: number;
  height?: number;
};

export type RevisionMetadata = {
  schemaVersion: 1;
  revision: string;
  packId: string;
  manifestPath: string;
  legacyManifestPath?: string;
  manifestHash: string;
  visualContentHash: string;
  simulationRulesHash: string;
  restartRequired: boolean;
  assets: RevisionAsset[];
  createdAt: string;
  parentRevision?: string;
  sourceRevision?: string;
};

export type PublicationStatus = {
  currentRevision: string;
  draftRevision: string;
  current: RevisionMetadata;
};

export type DraftListResponse<T> = {
  revision: string;
  draftRevision: string;
  publishedRevision: string;
  items: T[];
};

export type DraftMutationResponse<T> = {
  ok: true;
  archetype?: T;
  draft: PackV2;
  publication: PublicationStatus;
  warning?: string;
  deleted?: true;
};

export type ReferenceAttachment = {
  schemaVersion: 1;
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

export type Acknowledgement = {
  runtimeId: string;
  scenarioId: string;
  revision: string;
  simulationRulesHash: string;
  restartRequired: boolean;
  updatedAt: string;
};

export type AcknowledgementResponse = {
  acknowledgements: Acknowledgement[];
};

export class ContentApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: Record<string, unknown> | null;
  readonly dependencies: string[];
  readonly currentRevision: string | null;

  constructor(status: number, body: unknown) {
    const record = isRecord(body) ? body : null;
    const message = record && typeof record.error === 'string' ? record.error : `Content request failed (${String(status)})`;
    super(message);
    this.name = 'ContentApiError';
    this.status = status;
    this.code = record && typeof record.code === 'string' ? record.code : null;
    this.body = record;
    this.dependencies = record && Array.isArray(record.dependencies)
      ? record.dependencies.filter((value): value is string => typeof value === 'string')
      : [];
    this.currentRevision = record && typeof record.currentRevision === 'string' ? record.currentRevision : null;
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<{ ok: boolean; publication?: PublicationStatus }> {
  return requestJson<{ ok: boolean; publication?: PublicationStatus }>('/health', signal ? { signal } : {});
}

/** Legacy M0 path remains available from the V1 proxy editor. */
export async function publishUnitV1(manifest: UnitManifest, pngBase64: string): Promise<void> {
  await requestJson('/units', {
    method: 'POST',
    body: JSON.stringify({ manifest, pngBase64 }),
  });
}

export async function fetchPublicationStatus(signal?: AbortSignal): Promise<PublicationStatus> {
  return requestJson<PublicationStatus>('/v2/publication', signal ? { signal } : {});
}

export async function fetchRevisions(signal?: AbortSignal): Promise<{
  currentRevision: string;
  draftRevision: string;
  current: RevisionMetadata;
  revisions: RevisionMetadata[];
}> {
  return requestJson('/v2/revisions', signal ? { signal } : {});
}

export async function fetchDraftPackV2(signal?: AbortSignal): Promise<PackV2> {
  return requestJson<PackV2>('/v2/draft/pack', signal ? { signal } : {});
}

export async function fetchPublishedPackV2(revision: string, signal?: AbortSignal): Promise<PackV2> {
  return requestJson<PackV2>(`/v2/revisions/${encodeURIComponent(revision)}/pack`, signal ? { signal } : {});
}

export async function fetchUnitListV2(signal?: AbortSignal): Promise<DraftListResponse<UnitArchetype>> {
  const body = await requestJson<{
    units: UnitArchetype[];
    revision: string;
    draftRevision: string;
    publishedRevision: string;
  }>( '/v2/units', signal ? { signal } : {});
  return { items: body.units, revision: body.revision, draftRevision: body.draftRevision, publishedRevision: body.publishedRevision };
}

export async function fetchUnitsV2(signal?: AbortSignal): Promise<UnitArchetype[]> {
  return (await fetchUnitListV2(signal)).items;
}

export async function fetchBuildingListV2(signal?: AbortSignal): Promise<DraftListResponse<BuildingArchetype>> {
  const body = await requestJson<{
    buildings: BuildingArchetype[];
    revision: string;
    draftRevision: string;
    publishedRevision: string;
  }>( '/v2/buildings', signal ? { signal } : {});
  return {
    items: body.buildings,
    revision: body.revision,
    draftRevision: body.draftRevision,
    publishedRevision: body.publishedRevision,
  };
}

export async function fetchBuildingsV2(signal?: AbortSignal): Promise<BuildingArchetype[]> {
  return (await fetchBuildingListV2(signal)).items;
}

export async function fetchReferences(signal?: AbortSignal): Promise<ReferenceAttachment[]> {
  const body = await requestJson<{ references: ReferenceAttachment[] }>('/v2/references', signal ? { signal } : {});
  return body.references;
}

export async function createReference(
  id: string,
  displayName: string,
  pngBase64: string,
): Promise<ReferenceAttachment> {
  const body = await requestJson<{ ok: true; reference: ReferenceAttachment }>('/v2/references', {
    method: 'POST',
    body: JSON.stringify({ id, displayName, pngBase64 }),
  });
  return body.reference;
}

export async function deleteReference(id: string): Promise<void> {
  await requestJson(`/v2/references/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function createUnitV2(
  archetype: UnitArchetype,
  pngBase64: string | undefined,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<UnitArchetype>> {
  return draftMutation('/v2/units', 'POST', { archetype, pngBase64, expectedDraftRevision });
}

export async function updateUnitV2(
  id: string,
  archetype: UnitArchetype,
  pngBase64: string | undefined,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<UnitArchetype>> {
  return draftMutation(`/v2/units/${encodeURIComponent(id)}`, 'PUT', {
    archetype,
    pngBase64,
    expectedDraftRevision,
  });
}

export async function setUnitEnabledV2(
  id: string,
  enabled: boolean,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<UnitArchetype>> {
  return draftMutation(`/v2/units/${encodeURIComponent(id)}`, 'PATCH', { enabled, expectedDraftRevision });
}

export async function deleteUnitV2(
  id: string,
  expectedDraftRevision: string,
  force = false,
): Promise<DraftMutationResponse<never>> {
  return draftMutation(`/v2/units/${encodeURIComponent(id)}${force ? '?force=true' : ''}`, 'DELETE', {
    expectedDraftRevision,
  });
}

export async function duplicateUnitV2(
  sourceId: string,
  newId: string,
  displayName: string,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<UnitArchetype>> {
  return draftMutation(`/v2/units/${encodeURIComponent(sourceId)}/duplicate`, 'POST', {
    newId,
    displayName,
    expectedDraftRevision,
  });
}

export async function createBuildingV2(
  archetype: BuildingArchetype,
  pngBase64: string | undefined,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<BuildingArchetype>> {
  return draftMutation('/v2/buildings', 'POST', { archetype, pngBase64, expectedDraftRevision });
}

export async function updateBuildingV2(
  id: string,
  archetype: BuildingArchetype,
  pngBase64: string | undefined,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<BuildingArchetype>> {
  return draftMutation(`/v2/buildings/${encodeURIComponent(id)}`, 'PUT', {
    archetype,
    pngBase64,
    expectedDraftRevision,
  });
}

export async function setBuildingEnabledV2(
  id: string,
  enabled: boolean,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<BuildingArchetype>> {
  return draftMutation(`/v2/buildings/${encodeURIComponent(id)}`, 'PATCH', { enabled, expectedDraftRevision });
}

export async function deleteBuildingV2(
  id: string,
  expectedDraftRevision: string,
  force = false,
): Promise<DraftMutationResponse<never>> {
  return draftMutation(`/v2/buildings/${encodeURIComponent(id)}${force ? '?force=true' : ''}`, 'DELETE', {
    expectedDraftRevision,
  });
}

export async function duplicateBuildingV2(
  sourceId: string,
  newId: string,
  displayName: string,
  expectedDraftRevision: string,
): Promise<DraftMutationResponse<BuildingArchetype>> {
  return draftMutation(`/v2/buildings/${encodeURIComponent(sourceId)}/duplicate`, 'POST', {
    newId,
    displayName,
    expectedDraftRevision,
  });
}

export async function validateDraft(expectedDraftRevision: string): Promise<{ ok: true; draftRevision: string }> {
  return requestJson('/v2/validate', {
    method: 'POST',
    body: JSON.stringify({ expectedDraftRevision }),
  });
}

export async function publishDraft(expectedRevision: string): Promise<{
  ok: true;
  revision: string;
  metadata: RevisionMetadata;
  pack: PackV2;
  publication: PublicationStatus;
}> {
  return requestJson('/v2/publish', {
    method: 'POST',
    body: JSON.stringify({ expectedRevision }),
  });
}

export async function revertPublication(
  targetRevision: string,
  expectedCurrentRevision: string,
): Promise<{
  ok: true;
  revision: string;
  metadata: RevisionMetadata;
  pack: PackV2;
  publication: PublicationStatus;
}> {
  return requestJson('/v2/revert', {
    method: 'POST',
    body: JSON.stringify({ targetRevision, expectedCurrentRevision }),
  });
}

export async function fetchAcknowledgements(signal?: AbortSignal): Promise<Acknowledgement[]> {
  const body = await requestJson<AcknowledgementResponse>('/v2/acknowledgements', signal ? { signal } : {});
  return body.acknowledgements.slice(0, 32);
}

export function draftAssetUrl(assetPath: string): string {
  return `${BASE}/v2/draft/assets/${encodeAssetPath(assetPath)}`;
}

export function revisionAssetUrl(revision: string, assetPath: string): string {
  return `${BASE}/v2/revisions/${encodeURIComponent(revision)}/assets/${encodeAssetPath(assetPath)}`;
}

export function referenceImageUrl(id: string): string {
  return `${BASE}/v2/references/${encodeURIComponent(id)}/image`;
}

export function sandboxOrigin(): string {
  const configured = import.meta.env.VITE_GAME_WEB_ORIGIN ?? import.meta.env.VITE_GAME_URL;
  if (typeof configured === 'string' && configured.length > 0) {
    return configured.replace(/\/$/, '');
  }
  const port = import.meta.env.VITE_SANDBOX_PORT;
  if (typeof port === 'string' && port.length > 0) {
    return `http://127.0.0.1:${port}`;
  }
  return 'http://127.0.0.1:5173';
}

export function buildSandboxUrl(options: {
  archetypeId: string;
  kind: 'unit' | 'building';
  seed?: number;
  scenarioId?: string;
  publicationRevision?: string | undefined;
  debug?: boolean;
}): string {
  const params = new URLSearchParams({
    mode: 'interaction-lab',
    content: 'studio',
    seed: String(options.seed ?? 1),
    scenario: options.scenarioId ?? DEFAULT_SCENARIO,
  });
  if (options.publicationRevision) {
    params.set('revision', options.publicationRevision);
  }
  if (options.debug) {
    params.set('touchDebug', '1');
  }
  params.set(options.kind === 'unit' ? 'spawnUnit' : 'spawnBuilding', options.archetypeId);
  return `${sandboxOrigin()}/?${params.toString()}`;
}

async function draftMutation<T>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: Record<string, unknown>,
): Promise<DraftMutationResponse<T>> {
  return requestJson(path, { method, body: JSON.stringify(body) });
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await parseBody(response);
  if (!response.ok) {
    throw new ContentApiError(response.status, body);
  }
  return body as T;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function encodeAssetPath(assetPath: string): string {
  return assetPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type { BuildingArchetype, UnitArchetype, UnitManifest, PackV2 };