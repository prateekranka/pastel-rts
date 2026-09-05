import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { computeContentHash } from '@pastel-rts/content-schema';

test.describe.configure({ mode: 'serial' });

test('M1.1-F real API publication, integrity, and preservation acceptance', async ({ request }) => {
  test.setTimeout(120_000);

  const root = resolve(process.cwd());
  const packDir = resolve(process.env['CONTENT_PACK_DIR'] ?? '/tmp/pastel-foundry-e2e');
  const contentOrigin = `http://127.0.0.1:${process.env['CONTENT_PORT'] ?? '8787'}`;
  const unitA = readFileSync(join(root, 'content/dev-pack-v2/units/sunweaver-scout/sheet.png'));
  const unitB = readFileSync(join(root, 'content/dev-pack-v2/units/gravemark-stalker/sheet.png'));
  const buildingPng = readFileSync(join(root, 'content/dev-pack-v2/buildings/gravemark-bastion/sprite.png'));
  expect(existsSync(join(packDir, 'pack.json'))).toBe(true);
  expect(unitA.equals(unitB)).toBe(false);

  const initial = (await apiJson<PublicationStatus>(request, contentOrigin, 'GET', '/v2/publication')).body;
  const initialPack = (await apiJson<PackV2>(request, contentOrigin, 'GET', revisionPackPath(initial.currentRevision))).body;
  expect(initialPack.schemaVersion).toBe(2);
  expect(initialPack.revision).toBe(initial.currentRevision);
  expect(initialPack.contentHash).toBe(computePackHash(initialPack));
  expect(sha256(readFileSync(join(packDir, initial.current.manifestPath)))).toBe(initial.current.manifestHash);

  const unitId = `m11f-api-unit-${String(Date.now())}`;
  const buildingId = `m11f-api-building-${String(Date.now())}`;
  const brokenId = `m11f-api-broken-${String(Date.now())}`;
  const staleId = `m11f-api-stale-${String(Date.now())}`;
  const staleSecondId = `m11f-api-stale-second-${String(Date.now())}`;
  const unit = fixtureUnit(unitId, 'M1.1-F API Unit');
  const building = fixtureBuilding(buildingId, 'M1.1-F API Building');
  let draftRevision = initial.draftRevision;

  const createdUnit = await apiJson<DraftMutationResponse>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: unit,
    pngBase64: unitA.toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(createdUnit.status).toBe(200);
  expect(createdUnit.body.archetype?.id).toBe(unitId);
  expect(createdUnit.body.publication.currentRevision).toBe(initial.currentRevision);
  draftRevision = createdUnit.body.publication.draftRevision;

  const createdBuilding = await apiJson<DraftMutationResponse>(request, contentOrigin, 'POST', '/v2/buildings', {
    archetype: building,
    pngBase64: buildingPng.toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(createdBuilding.status).toBe(200);
  expect(createdBuilding.body.archetype?.id).toBe(buildingId);
  expect(createdBuilding.body.publication.currentRevision).toBe(initial.currentRevision);
  draftRevision = createdBuilding.body.publication.draftRevision;

  const draftBeforePublish = (await apiJson<PackV2>(request, contentOrigin, 'GET', '/v2/draft/pack')).body;
  expect(draftBeforePublish.units.some((entry) => entry.id === unitId)).toBe(true);
  expect(draftBeforePublish.buildings.some((entry) => entry.id === buildingId)).toBe(true);
  expect(draftBeforePublish.revision).toBe(draftRevision);
  const historicalBeforePublish = (await apiJson<PackV2>(request, contentOrigin, 'GET', revisionPackPath(initial.currentRevision))).body;
  expect(historicalBeforePublish.units.some((entry) => entry.id === unitId)).toBe(false);
  expect(historicalBeforePublish.buildings.some((entry) => entry.id === buildingId)).toBe(false);

  const draftUnitAsset = await apiBinary(request, contentOrigin, draftAssetPath(unit.assetPath));
  expect(draftUnitAsset.status).toBe(200);
  expect(draftUnitAsset.body.equals(unitA)).toBe(true);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitA)}.png`))).toEqual(unitA);

  const validation = await apiJson<{ ok: true; draftRevision: string }>(request, contentOrigin, 'POST', '/v2/validate', {
    expectedDraftRevision: draftRevision,
  });
  expect(validation.status).toBe(200);
  expect(validation.body).toEqual({ ok: true, draftRevision });
  const afterValidation = (await apiJson<PublicationStatus>(request, contentOrigin, 'GET', '/v2/publication')).body;
  expect(afterValidation.currentRevision).toBe(initial.currentRevision);

  const firstPublication = await apiJson<PublishResponse>(request, contentOrigin, 'POST', '/v2/publish', {
    expectedRevision: initial.currentRevision,
  });
  expect(firstPublication.status).toBe(200);
  const firstRevision = firstPublication.body.revision;
  expect(firstRevision).not.toBe(initial.currentRevision);
  expect(firstPublication.body.pack.units.some((entry) => entry.id === unitId)).toBe(true);
  expect(firstPublication.body.pack.buildings.some((entry) => entry.id === buildingId)).toBe(true);
  expect(firstPublication.body.pack.contentHash).toBe(computePackHash(firstPublication.body.pack));
  const firstUnitAsset = firstPublication.body.metadata.assets.find((asset) => asset.assetPath === unit.assetPath);
  expect(firstUnitAsset).toMatchObject({ sha256: sha256(unitA), byteLength: unitA.length, kind: 'runtime' });
  expect(sha256(readFileSync(join(packDir, firstPublication.body.metadata.manifestPath)))).toBe(firstPublication.body.metadata.manifestHash);
  expect((await apiBinary(request, contentOrigin, revisionAssetPath(firstRevision, unit.assetPath))).body.equals(unitA)).toBe(true);

  const staleExpected = draftRevision;
  const staleCreate = await apiJson<DraftMutationResponse>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: fixtureUnit(staleId, 'M1.1-F stale first'),
    pngBase64: unitA.toString('base64'),
    expectedDraftRevision: staleExpected,
  });
  expect(staleCreate.status).toBe(200);
  const afterStaleCreate = staleCreate.body.publication.draftRevision;
  const staleConflict = await apiJson<Record<string, unknown>>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: fixtureUnit(staleSecondId, 'M1.1-F stale second'),
    pngBase64: buildingPng.toString('base64'),
    expectedDraftRevision: staleExpected,
  });
  expect(staleConflict.status).toBe(409);
  expect(staleConflict.body).toMatchObject({ code: 'revision-conflict', scope: 'draft', currentRevision: afterStaleCreate });
  const removeStale = await apiJson<DraftMutationResponse>(request, contentOrigin, 'DELETE', `/v2/units/${encodeURIComponent(staleId)}`, {
    expectedDraftRevision: afterStaleCreate,
  });
  expect(removeStale.status).toBe(200);
  draftRevision = removeStale.body.publication.draftRevision;

  const corrupt = Buffer.from(unitA);
  corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 1;
  const corruptResult = await apiJson<Record<string, unknown>>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: fixtureUnit(`m11f-api-corrupt-${String(Date.now())}`, 'M1.1-F corrupt'),
    pngBase64: corrupt.toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(corruptResult.status).toBe(400);
  expect(String(corruptResult.body.error)).toMatch(/PNG|CRC|corrupt/i);

  const invalidResult = await apiJson<Record<string, unknown>>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: fixtureUnit(`m11f-api-invalid-${String(Date.now())}`, 'M1.1-F invalid'),
    pngBase64: Buffer.from('not a png').toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(invalidResult.status).toBe(400);
  expect(String(invalidResult.body.error)).toMatch(/PNG|invalid/i);

  const oversizedResult = await apiJson<Record<string, unknown>>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: fixtureUnit(`m11f-api-oversize-${String(Date.now())}`, 'M1.1-F oversize'),
    pngBase64: Buffer.alloc(8 * 1024 * 1024 + 1, 0xab).toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(oversizedResult.status).toBe(400);
  expect(String(oversizedResult.body.error)).toMatch(/exceeds.*limit/i);

  const missingFrame = fixtureUnit(`m11f-api-missing-frame-${String(Date.now())}`, 'M1.1-F missing frame');
  missingFrame.sourceWidth = 32;
  missingFrame.sourceHeight = 32;
  missingFrame.frameWidth = 32;
  missingFrame.frameHeight = 32;
  missingFrame.bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const animation = asRecord(missingFrame.animation);
  animation.directions = 1;
  const clips = asRecord(animation.clips);
  clips.idle = { frames: { kind: 'indexes', indexes: [1] }, fps: 8, looping: true };
  clips.move = { frames: { kind: 'indexes', indexes: [0] }, fps: 12, looping: true };
  const missingFrameResult = await apiJson<Record<string, unknown>>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: missingFrame,
    pngBase64: unitA.toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(missingFrameResult.status).toBe(400);
  expect(String(missingFrameResult.body.error)).toMatch(/missing frame/i);

  const dependencyResult = await apiJson<Record<string, unknown>>(request, contentOrigin, 'DELETE', '/v2/units/sunweaver-scout', {
    expectedDraftRevision: draftRevision,
  });
  expect(dependencyResult.status).toBe(409);
  expect(dependencyResult.body).toMatchObject({ code: 'dependency-conflict' });
  expect(dependencyResult.body.dependencies).toEqual(expect.arrayContaining(['lab-skirmish', 'm11-fixture-gallery']));

  const replacement = fixtureUnit(unitId, 'M1.1-F API Unit replacement');
  replacement.worldHeight = 2.8;
  const replacementAnimation = asRecord(replacement.animation);
  const replacementClips = asRecord(replacementAnimation.clips);
  asRecord(replacementClips.idle).fps = 13;
  asRecord(replacementClips.move).fps = 21;
  const replacementResult = await apiJson<DraftMutationResponse>(request, contentOrigin, 'PUT', `/v2/units/${encodeURIComponent(unitId)}`, {
    archetype: replacement,
    pngBase64: unitB.toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(replacementResult.status).toBe(200);
  expect(replacementResult.body.archetype?.id).toBe(unitId);
  expect(replacementResult.body.archetype?.worldHeight).toBe(2.8);
  expect(asRecord(asRecord(replacementResult.body.archetype?.animation).clips).idle).toMatchObject({ fps: 13 });
  draftRevision = replacementResult.body.publication.draftRevision;

  const replacementDraft = (await apiJson<PackV2>(request, contentOrigin, 'GET', '/v2/draft/pack')).body;
  const replacementDraftUnit = replacementDraft.units.find((entry) => entry.id === unitId);
  expect(replacementDraftUnit).toMatchObject({ id: unitId, displayName: 'M1.1-F API Unit replacement', worldHeight: 2.8 });
  expect(asRecord(asRecord(replacementDraftUnit?.animation).clips).move).toMatchObject({ fps: 21 });
  expect((await apiBinary(request, contentOrigin, draftAssetPath(unit.assetPath))).body.equals(unitB)).toBe(true);
  expect((await apiBinary(request, contentOrigin, revisionAssetPath(firstRevision, unit.assetPath))).body.equals(unitA)).toBe(true);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitA)}.png`))).toEqual(unitA);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitB)}.png`))).toEqual(unitB);

  const lastGoodStatus = (await apiJson<PublicationStatus>(request, contentOrigin, 'GET', '/v2/publication')).body;
  const lastGoodPack = (await apiJson<PackV2>(request, contentOrigin, 'GET', revisionPackPath(lastGoodStatus.currentRevision))).body;
  const lastGoodMetadata = (await apiJson<RevisionMetadata>(request, contentOrigin, 'GET', `/v2/revisions/${encodeURIComponent(lastGoodStatus.currentRevision)}`)).body;
  const revisionCountBeforeFailure = (await apiJson<RevisionsResponse>(request, contentOrigin, 'GET', '/v2/revisions')).body.revisions.length;

  const brokenResult = await apiJson<DraftMutationResponse>(request, contentOrigin, 'POST', '/v2/units', {
    archetype: fixtureUnit(brokenId, 'M1.1-F broken publication'),
    pngBase64: unitA.toString('base64'),
    expectedDraftRevision: draftRevision,
  });
  expect(brokenResult.status).toBe(200);
  draftRevision = brokenResult.body.publication.draftRevision;
  rmSync(join(packDir, 'units', brokenId, 'sheet.png'), { force: true });

  const invalidDraftValidation = await apiJson<Record<string, unknown>>(request, contentOrigin, 'POST', '/v2/validate', {
    expectedDraftRevision: draftRevision,
  });
  expect(invalidDraftValidation.status).toBe(500);
  expect(invalidDraftValidation.body).toMatchObject({ code: 'content-integrity' });
  const failedPublication = await apiJson<Record<string, unknown>>(request, contentOrigin, 'POST', '/v2/publish', {
    expectedRevision: lastGoodStatus.currentRevision,
  });
  expect(failedPublication.status).toBeGreaterThanOrEqual(400);
  expect(String(failedPublication.body.error)).toMatch(/missing|asset|runtime/i);

  const afterFailureStatus = (await apiJson<PublicationStatus>(request, contentOrigin, 'GET', '/v2/publication')).body;
  expect(afterFailureStatus.currentRevision).toBe(lastGoodStatus.currentRevision);
  const afterFailurePack = (await apiJson<PackV2>(request, contentOrigin, 'GET', revisionPackPath(lastGoodStatus.currentRevision))).body;
  expect(afterFailurePack).toEqual(lastGoodPack);
  expect((await apiJson<RevisionsResponse>(request, contentOrigin, 'GET', '/v2/revisions')).body.revisions).toHaveLength(revisionCountBeforeFailure);
  expect((await apiBinary(request, contentOrigin, revisionAssetPath(lastGoodStatus.currentRevision, unit.assetPath))).body.equals(unitA)).toBe(true);
  expect(sha256(readFileSync(join(packDir, lastGoodMetadata.manifestPath)))).toBe(lastGoodMetadata.manifestHash);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitA)}.png`))).toEqual(unitA);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitB)}.png`))).toEqual(unitB);

  const removeBroken = await apiJson<DraftMutationResponse>(request, contentOrigin, 'DELETE', `/v2/units/${encodeURIComponent(brokenId)}`, {
    expectedDraftRevision: draftRevision,
  });
  expect(removeBroken.status).toBe(200);
  draftRevision = removeBroken.body.publication.draftRevision;
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitA)}.png`))).toEqual(unitA);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitB)}.png`))).toEqual(unitB);

  const replacementValidation = await apiJson<{ ok: true; draftRevision: string }>(request, contentOrigin, 'POST', '/v2/validate', {
    expectedDraftRevision: draftRevision,
  });
  expect(replacementValidation.status).toBe(200);
  const secondPublication = await apiJson<PublishResponse>(request, contentOrigin, 'POST', '/v2/publish', {
    expectedRevision: firstRevision,
  });
  expect(secondPublication.status).toBe(200);
  const secondRevision = secondPublication.body.revision;
  expect(secondRevision).not.toBe(firstRevision);
  expect(secondPublication.body.pack.units.find((entry) => entry.id === unitId)).toMatchObject({ id: unitId, worldHeight: 2.8 });
  const secondUnitAsset = secondPublication.body.metadata.assets.find((asset) => asset.assetPath === unit.assetPath);
  expect(secondUnitAsset).toMatchObject({ sha256: sha256(unitB), byteLength: unitB.length, kind: 'runtime' });
  expect((await apiBinary(request, contentOrigin, revisionAssetPath(secondRevision, unit.assetPath))).body.equals(unitB)).toBe(true);
  expect((await apiBinary(request, contentOrigin, revisionAssetPath(firstRevision, unit.assetPath))).body.equals(unitA)).toBe(true);

  const referenceId = `m11f-reference-${String(Date.now())}`;
  const referenceResult = await apiJson<{ ok: true; reference: ReferenceAttachment }>(request, contentOrigin, 'POST', '/v2/references', {
    id: referenceId,
    displayName: 'M1.1-F review reference',
    pngBase64: buildingPng.toString('base64'),
  });
  expect(referenceResult.status).toBe(200);
  expect(referenceResult.body.reference.id).toBe(referenceId);
  expect(referenceResult.body.reference.assetPath).toMatch(new RegExp(`^references/${referenceId}/[a-f0-9]{64}\\.png$`));
  const referenceBytes = await apiBinary(request, contentOrigin, `/v2/references/${encodeURIComponent(referenceId)}/image`);
  expect(referenceBytes.status).toBe(200);
  expect(referenceBytes.body.equals(buildingPng)).toBe(true);
  const secondMetadata = (await apiJson<RevisionMetadata>(request, contentOrigin, 'GET', `/v2/revisions/${encodeURIComponent(secondRevision)}`)).body;
  expect(secondMetadata.assets.some((asset) => asset.assetPath.startsWith('references/'))).toBe(false);
  expect((await apiJson<PackV2>(request, contentOrigin, 'GET', revisionPackPath(secondRevision))).body).not.toHaveProperty('references');
  const referenceHash = referenceResult.body.reference.sha256;
  const removeReference = await apiJson<Record<string, unknown>>(request, contentOrigin, 'DELETE', `/v2/references/${encodeURIComponent(referenceId)}`);
  expect(removeReference.status).toBe(200);
  expect((await apiBinary(request, contentOrigin, `/v2/references/${encodeURIComponent(referenceId)}/image`)).status).toBe(404);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'references', referenceId, `${referenceHash}.png`))).toEqual(buildingPng);

  const unsafeHistorical = await apiJson<Record<string, unknown>>(request, contentOrigin, 'GET', `/v2/revisions/${encodeURIComponent(secondRevision)}/assets/%2e%2e/units/${encodeURIComponent(unitId)}/sheet.png`);
  expect(unsafeHistorical.status).toBe(400);
  expect(unsafeHistorical.body).toMatchObject({ error: expect.stringMatching(/invalid (path|id)/i) });
  const unsafeDraft = await apiJson<Record<string, unknown>>(request, contentOrigin, 'GET', '/v2/draft/assets/%252e%252e/units/sunweaver-scout/sheet.png');
  expect(unsafeDraft.status).toBe(400);
  expect(unsafeDraft.body).toMatchObject({ code: 'invalid-path' });
  const unknownHistorical = await apiJson<Record<string, unknown>>(request, contentOrigin, 'GET', revisionAssetPath(secondRevision, 'units/not-allowlisted/sheet.png'));
  expect(unknownHistorical.status).toBe(404);

  const revertResult = await apiJson<PublishResponse>(request, contentOrigin, 'POST', '/v2/revert', {
    targetRevision: initial.currentRevision,
    expectedCurrentRevision: secondRevision,
  });
  expect(revertResult.status).toBe(200);
  expect(revertResult.body.metadata.sourceRevision).toBe(initial.currentRevision);
  expect(revertResult.body.pack.contentHash).toBe(computePackHash(revertResult.body.pack));
  expect(packContentWithoutRevision(revertResult.body.pack)).toEqual(packContentWithoutRevision(initialPack));
  expect((await apiBinary(request, contentOrigin, revisionAssetPath(revertResult.body.revision, 'units/sunweaver-scout/sheet.png'))).body.equals(readFileSync(join(root, 'content/dev-pack-v2/units/sunweaver-scout/sheet.png')))).toBe(true);

  const cleanupBefore = (await apiJson<PublicationStatus>(request, contentOrigin, 'GET', '/v2/publication')).body;
  const cleanupUnit = await apiJson<DraftMutationResponse>(request, contentOrigin, 'DELETE', `/v2/units/${encodeURIComponent(unitId)}`, {
    expectedDraftRevision: cleanupBefore.draftRevision,
  });
  expect(cleanupUnit.status).toBe(200);
  const cleanupBuilding = await apiJson<DraftMutationResponse>(request, contentOrigin, 'DELETE', `/v2/buildings/${encodeURIComponent(buildingId)}`, {
    expectedDraftRevision: cleanupUnit.body.publication.draftRevision,
  });
  expect(cleanupBuilding.status).toBe(200);
});

type PackV2 = {
  schemaVersion: number;
  id: string;
  revision: string;
  contentHash: string;
  units: Array<Record<string, unknown> & { id: string; assetPath: string }>;
  buildings: Array<Record<string, unknown> & { id: string; assetPath: string }>;
};

type Asset = {
  kind: 'runtime' | 'data';
  assetPath: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
  width?: number;
  height?: number;
};

type RevisionMetadata = {
  revision: string;
  manifestPath: string;
  manifestHash: string;
  assets: Asset[];
  sourceRevision?: string;
  simulationRulesHash: string;
  visualContentHash: string;
};

type ReferenceAttachment = {
  id: string;
  displayName: string;
  assetPath: string;
  sha256: string;
  byteLength: number;
};

type PublicationStatus = {
  currentRevision: string;
  draftRevision: string;
  current: RevisionMetadata;
};

type RevisionsResponse = { revisions: RevisionMetadata[] };

type DraftMutationResponse = {
  ok: true;
  archetype?: Record<string, unknown> & { id: string };
  draft: PackV2;
  publication: PublicationStatus;
  warning?: string;
  deleted?: true;
};

type PublishResponse = {
  ok: true;
  revision: string;
  metadata: RevisionMetadata;
  pack: PackV2;
  publication: PublicationStatus;
};

async function apiJson<T>(
  request: APIRequestContext,
  origin: string,
  method: string,
  path: string,
  data?: unknown,
): Promise<{ status: number; body: T }> {
  const options: { method: string; data?: unknown; headers?: Record<string, string> } = { method };
  if (data !== undefined) {
    options.data = data;
    options.headers = { 'content-type': 'application/json' };
  }
  const response = await request.fetch(`${origin}${path}`, options);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  return { status: response.status(), body: body as T };
}

async function apiBinary(
  request: APIRequestContext,
  origin: string,
  path: string,
): Promise<{ status: number; body: Buffer }> {
  const response = await request.get(`${origin}${path}`);
  return { status: response.status(), body: await response.body() };
}

function fixtureUnit(id: string, displayName: string): Record<string, unknown> & { id: string; assetPath: string } {
  const value = JSON.parse(readFileSync(join(resolve(process.cwd()), 'content/dev-pack-v2/units/sunweaver-scout/manifest.json'), 'utf8')) as Record<string, unknown> & { id: string; assetPath: string };
  value.id = id;
  value.displayName = displayName;
  value.assetPath = `units/${id}/sheet.png`;
  const animation = asRecord(value.animation);
  const clips = asRecord(animation.clips);
  for (const clipName of ['idle', 'move']) {
    const clip = clips[clipName];
    if (clip && typeof clip === 'object' && !Array.isArray(clip)) {
      (clip as Record<string, unknown>).assetPath = value.assetPath;
    }
  }
  return value;
}

function fixtureBuilding(id: string, displayName: string): Record<string, unknown> & { id: string; assetPath: string } {
  const value = JSON.parse(readFileSync(join(resolve(process.cwd()), 'content/dev-pack-v2/buildings/gravemark-bastion/manifest.json'), 'utf8')) as Record<string, unknown> & { id: string; assetPath: string };
  value.id = id;
  value.displayName = displayName;
  value.assetPath = `buildings/${id}/sprite.png`;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object in acceptance fixture');
  }
  return value as Record<string, unknown>;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function computePackHash(pack: PackV2): string {
  return computeContentHash(pack);
}

function packContentWithoutRevision(pack: PackV2): Omit<PackV2, 'revision' | 'contentHash'> {
  const { revision: _revision, contentHash: _contentHash, ...content } = pack;
  return content;
}

function readFileIfPresent(path: string): Buffer {
  expect(existsSync(path)).toBe(true);
  return readFileSync(path);
}

function revisionPackPath(revision: string): string {
  return `/v2/revisions/${encodeURIComponent(revision)}/pack`;
}

function revisionAssetPath(revision: string, assetPath: string): string {
  return `/v2/revisions/${encodeURIComponent(revision)}/assets/${encodeAssetPath(assetPath)}`;
}

function draftAssetPath(assetPath: string): string {
  return `/v2/draft/assets/${encodeAssetPath(assetPath)}`;
}

function encodeAssetPath(assetPath: string): string {
  return assetPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}
