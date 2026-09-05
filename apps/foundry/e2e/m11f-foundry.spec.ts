import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { computeContentHash } from '@pastel-rts/content-schema';
import { routeIsolatedContent } from '../../game-web/e2e/support/isolated-content';

test.describe.configure({ mode: 'serial' });

const root = resolve(process.cwd());
const packDir = resolve(process.env['CONTENT_PACK_DIR'] ?? '/tmp/pastel-foundry-e2e');
const contentOrigin = `http://127.0.0.1:${process.env['CONTENT_PORT'] ?? '8787'}`;
const artifactDir = resolve(process.env['M11F_ARTIFACT_DIR'] ?? '/tmp/pastel-m11f-artifacts');
const unitAPath = join(root, 'content/dev-pack-v2/units/sunweaver-scout/sheet.png');
const unitBPath = join(root, 'content/dev-pack-v2/units/gravemark-stalker/sheet.png');
const referencePath = join(root, 'content/dev-pack-v2/buildings/gravemark-bastion/sprite.png');

// This suite deliberately uses the real content service. The caller must provide a fresh pack copy.
test('M1.1-F Foundry draft, publish, replacement, dependency, and reference workflow', async ({ page, request }) => {
  test.setTimeout(120_000);
  const unitA = readFileSync(unitAPath);
  const unitB = readFileSync(unitBPath);
  const referencePng = readFileSync(referencePath);
  expect(existsSync(join(packDir, 'pack.json'))).toBe(true);
  expect(unitA.equals(unitB)).toBe(false);
  mkdirSync(artifactDir, { recursive: true });

  await routeIsolatedContent(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/library', { waitUntil: 'domcontentloaded' });
  await waitForLibrary(page);
  await capture(page, 'foundry-library-1280x800');
  await assertControlBounds(page, ['#library-search', '#library-kind', '#new-unit', '#new-building', '#refresh']);

  await page.setViewportSize({ width: 1194, height: 834 });
  await waitForLibrary(page);
  await capture(page, 'foundry-library-1194x834');
  await assertControlBounds(page, ['#library-search', '#library-kind', '#new-unit', '#new-building', '#refresh']);
  await page.setViewportSize({ width: 1280, height: 800 });

  const initial = (await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body;
  const initialPack = (await apiJson<PackV2>(request, 'GET', revisionPackPath(initial.currentRevision))).body;
  const uiUnitId = `m11f-ui-unit-${String(Date.now())}`;
  const uiDuplicateId = `${uiUnitId}-copy`;

  await page.locator('#library-search').fill('sunweaver-scout');
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  await expect(page.locator('#library-body')).toContainText('sunweaver-scout');
  await page.locator('#library-search').fill('Sunweaver Scout');
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  await page.locator('#library-search').fill('');
  await page.locator('#library-kind').selectOption('building');
  const buildingRows = page.locator('#library-body tr');
  await expect.poll(() => buildingRows.count()).toBeGreaterThanOrEqual(3);
  const buildingKinds = await page.locator('#library-body tr td:first-child').allTextContents();
  expect(buildingKinds.length).toBeGreaterThanOrEqual(3);
  expect(buildingKinds.every((kind) => kind === 'building')).toBe(true);
  await page.locator('#library-kind').selectOption('all');
  await page.locator('#library-search').fill('');

  await page.locator('#library-search').fill('neutral-cyan-beacon');
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  await expect(page.locator('#library-body')).toContainText('No runtime content matches');
  await page.locator('#library-disabled').check();
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  await expect(page.locator('#library-body tr')).toHaveClass(/disabled-row/);
  await page.getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  await expect(page.locator('#library-body tr td:nth-child(5)')).toHaveText('yes');
  await page.locator('#library-disabled').uncheck();
  await page.locator('#library-search').fill('');

  await page.goto(`/#/unit/new?id=${encodeURIComponent(uiUnitId)}&scenario=lab-skirmish&seed=42`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('Unit Editor');
  await page.locator('#unit-file').setInputFiles(unitAPath);
  await expect(page.locator('#source-dimensions')).toHaveText('Source dimensions: 128×256 px');
  await page.locator('#unit-name').fill('M1.1-F UI unit');
  await page.locator('#unit-faction').selectOption('sunweaver');
  await page.locator('#sheet-layout').selectOption('grid');
  await page.locator('#frame-w').fill('32');
  await page.locator('#frame-h').fill('32');
  await page.locator('#grid-cols').fill('4');
  await page.locator('#grid-rows').fill('8');
  await page.locator('#directions').selectOption('1');
  await page.locator('#idle-fps').fill('9');
  await page.locator('#move-fps').fill('17');
  await page.locator('#idle-frames').fill('0, 1');
  await page.locator('#move-frames').fill('2, 3');
  await page.locator('#world-height').fill('2.3');
  await page.locator('#sel-radius').fill('0.7');
  await expect(page.locator('#unit-status')).toContainText('Manifest valid', { timeout: 10_000 });
  await expect(page.locator('#unit-manifest')).toContainText(uiUnitId);
  await capture(page, 'foundry-unit-before-save-1280x800');

  await page.locator('#workflow-save').click();
  await expect(page.locator('#unit-status')).toContainText(/Saved draft .* This is not live publish\./, { timeout: 15_000 });
  const savedDraftPublication = (await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body;
  expect(savedDraftPublication.currentRevision).toBe(initial.currentRevision);
  expect(savedDraftPublication.draftRevision).not.toBe(initial.draftRevision);
  const savedDraft = (await apiJson<PackV2>(request, 'GET', '/v2/draft/pack')).body;
  expect(savedDraft.units.find((entry) => entry.id === uiUnitId)).toMatchObject({
    id: uiUnitId,
    displayName: 'M1.1-F UI unit',
    worldHeight: 2.3,
  });
  expect(initialPack.units.some((entry) => entry.id === uiUnitId)).toBe(false);
  expect((await apiBinary(request, draftAssetPath(`units/${uiUnitId}/sheet.png`))).body.equals(unitA)).toBe(true);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitA)}.png`))).toEqual(unitA);
  await capture(page, 'foundry-unit-draft-saved-1280x800');

  await page.locator('#workflow-validate').click();
  await expect(page.locator('#workflow-status')).toContainText(/validated\. Published revision is unchanged\./, { timeout: 15_000 });
  expect((await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body.currentRevision).toBe(initial.currentRevision);
  await page.locator('#workflow-preview').click();
  await expect(page.locator('#workflow-status')).toHaveText('Preview uses the current local draft. It is not published.');
  await page.locator('#workflow-publish').click();
  await expect(page.locator('#workflow-status')).toContainText(/Published revision \S+\. Runtime acknowledgement is pending\./, { timeout: 15_000 });
  const firstPublish = (await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body;
  expect(firstPublish.currentRevision).not.toBe(initial.currentRevision);
  const firstPublishedPack = (await apiJson<PackV2>(request, 'GET', revisionPackPath(firstPublish.currentRevision))).body;
  expect(firstPublishedPack.units.find((entry) => entry.id === uiUnitId)).toMatchObject({ id: uiUnitId, worldHeight: 2.3 });
  expect(firstPublishedPack.contentHash).toBe(computeContentHash(firstPublishedPack));
  await assertPublishedAsset(request, firstPublish.currentRevision, `units/${uiUnitId}/sheet.png`, unitA, packDir);
  await capture(page, 'foundry-unit-published-1280x800');

  await page.goto(`/#/unit/${encodeURIComponent(uiUnitId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#unit-id')).toHaveValue(uiUnitId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#unit-name')).toHaveValue('M1.1-F UI unit');
  await expect(page.locator('#idle-fps')).toHaveValue('9');
  await expect(page.locator('#move-fps')).toHaveValue('17');
  await expect(page.locator('#world-height')).toHaveValue('2.3');
  await expect(page.locator('#source-dimensions')).toHaveText('Source dimensions: 128×256 px');

  await page.evaluate(() => {
    const originalOpen = window.open;
    window.open = (url?: string | URL) => {
      document.body.dataset['m11fSandboxUrl'] = String(url ?? '');
      return null;
    };
    window.setTimeout(() => {
      window.open = originalOpen;
    }, 1000);
  });
  await page.locator('#sandbox-unit').click();
  const openedSandboxUrl = await page.locator('body').getAttribute('data-m11f-sandbox-url');
  expect(openedSandboxUrl).toBeTruthy();
  const configuredGameOrigin = process.env['PLAYWRIGHT_GAME_WEB_ORIGIN'] ?? `http://127.0.0.1:${process.env['GAME_PORT'] ?? '5173'}`;
  expect(new URL(openedSandboxUrl as string).origin).toBe(configuredGameOrigin);
  expect(new URL(openedSandboxUrl as string).searchParams.get('spawnUnit')).toBe(uiUnitId);
  expect(new URL(openedSandboxUrl as string).searchParams.get('revision')).toBe(firstPublish.currentRevision);

  await page.locator('#unit-file').setInputFiles(unitBPath);
  await page.locator('#idle-fps').fill('13');
  await page.locator('#move-fps').fill('21');
  await page.locator('#world-height').fill('2.8');
  await expect(page.locator('#unit-status')).toContainText('Manifest valid', { timeout: 10_000 });
  await page.locator('#workflow-save').click();
  await expect(page.locator('#unit-status')).toContainText(/Saved draft .* This is not live publish\./, { timeout: 15_000 });
  const unpublishedReplacement = (await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body;
  expect(unpublishedReplacement.currentRevision).toBe(firstPublish.currentRevision);
  const replacementDraft = (await apiJson<PackV2>(request, 'GET', '/v2/draft/pack')).body;
  expect(replacementDraft.units.find((entry) => entry.id === uiUnitId)).toMatchObject({ id: uiUnitId, worldHeight: 2.8 });
  expect(asRecord(asRecord(replacementDraft.units.find((entry) => entry.id === uiUnitId)?.animation).clips).idle).toMatchObject({ fps: 13 });
  expect((await apiBinary(request, draftAssetPath(`units/${uiUnitId}/sheet.png`))).body.equals(unitB)).toBe(true);
  expect((await apiBinary(request, revisionAssetPath(firstPublish.currentRevision, `units/${uiUnitId}/sheet.png`))).body.equals(unitA)).toBe(true);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitA)}.png`))).toEqual(unitA);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitB)}.png`))).toEqual(unitB);
  await page.locator('#workflow-validate').click();
  await expect(page.locator('#workflow-status')).toContainText(/validated\. Published revision is unchanged\./, { timeout: 15_000 });
  await page.locator('#workflow-publish').click();
  await expect(page.locator('#workflow-status')).toContainText(/Published revision \S+\. Runtime acknowledgement is pending\./, { timeout: 15_000 });
  const replacementPublish = (await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body;
  expect(replacementPublish.currentRevision).not.toBe(firstPublish.currentRevision);
  await assertPublishedAsset(request, replacementPublish.currentRevision, `units/${uiUnitId}/sheet.png`, unitB, packDir);
  expect((await apiBinary(request, revisionAssetPath(firstPublish.currentRevision, `units/${uiUnitId}/sheet.png`))).body.equals(unitA)).toBe(true);

  const savedName = 'M1.1-F UI unit';
  await page.locator('#unit-name').fill('Local undo name');
  await expect(page.locator('#workflow-publish')).toBeDisabled();
  await page.locator('#unit-undo').click();
  await expect(page.locator('#unit-name')).toHaveValue(savedName);
  await expect(page.locator('#unit-status')).toContainText('Local edit restored');
  await page.locator('#unit-redo').click();
  await expect(page.locator('#unit-name')).toHaveValue('Local undo name');
  await expect(page.locator('#workflow-publish')).toBeDisabled();
  const dismissedNavigation: string[] = [];
  page.once('dialog', async (dialog) => {
    dismissedNavigation.push(dialog.message());
    await dialog.dismiss();
  });
  await page.locator('a[data-route="library"]').click();
  await expect(page).toHaveURL(/#\/unit\//);
  expect(dismissedNavigation[0]).toMatch(/unsaved|local/i);
  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await page.locator('a[data-route="library"]').click();
  await expect(page).toHaveURL(/#\/library$/);
  await waitForLibrary(page);

  await page.locator('#library-search').fill(uiUnitId);
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept(uiDuplicateId);
  });
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('#library-body tr')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('#library-body')).toContainText(uiDuplicateId);
  const duplicateDraft = (await apiJson<PackV2>(request, 'GET', '/v2/draft/pack')).body;
  expect(duplicateDraft.units.some((entry) => entry.id === uiDuplicateId)).toBe(true);
  expect((await apiJson<PackV2>(request, 'GET', revisionPackPath(replacementPublish.currentRevision))).body.units.some((entry) => entry.id === uiDuplicateId)).toBe(false);
  await waitForLibrary(page);

  await page.locator('#library-search').fill('sunweaver-scout');
  await expect(page.locator('#library-body tr')).toHaveCount(1);
  const removeDialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    removeDialogs.push(dialog.message());
    if (removeDialogs.length === 1) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => removeDialogs.length).toBe(2);
  await expect(page.locator('#library-body')).toContainText('sunweaver-scout');
  expect(removeDialogs[1]).toMatch(/Dependencies:.*lab-skirmish.*m11-fixture-gallery|Force removal/i);
  page.removeAllListeners('dialog');

  await page.locator('#library-search').fill('');
  await page.locator('#reference-file').setInputFiles(referencePath);
  const referenceId = `m11f-ui-reference-${String(Date.now())}`;
  const referencePromptValues = [referenceId, 'M1.1-F UI review reference'];
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    const value = referencePromptValues.shift();
    expect(value).toBeDefined();
    await dialog.accept(value);
  });
  await page.locator('#upload-reference').click();
  await expect(page.locator('#library-status')).toContainText('not runtime content', { timeout: 15_000 });
  await expect(page.locator('#reference-list')).toContainText('M1.1-F UI review reference');
  const references = (await apiJson<{ references: ReferenceAttachment[] }>(request, 'GET', '/v2/references')).body.references;
  const attached = references.find((reference) => reference.id === referenceId);
  expect(attached).toBeDefined();
  expect(attached?.sha256).toBe(sha256(referencePng));
  expect((await apiBinary(request, `/v2/references/${encodeURIComponent(referenceId)}/image`)).body.equals(referencePng)).toBe(true);
  const runtimeMetadata = (await apiJson<RevisionMetadata>(request, 'GET', `/v2/revisions/${encodeURIComponent(replacementPublish.currentRevision)}`)).body;
  expect(runtimeMetadata.assets.some((asset) => asset.assetPath.startsWith('references/'))).toBe(false);
  page.removeAllListeners('dialog');
  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Remove attachment' }).click();
  await expect(page.locator('#reference-list')).toContainText('No reference attachments.');
  expect((await apiBinary(request, `/v2/references/${encodeURIComponent(referenceId)}/image`)).status).toBe(404);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'references', referenceId, `${sha256(referencePng)}.png`))).toEqual(referencePng);

  await page.goto(`/#/unit/${encodeURIComponent(uiUnitId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#unit-id')).toHaveValue(uiUnitId);
  await expect(page.locator('#workflow-revision option')).not.toHaveCount(1, { timeout: 15_000 });
  await page.locator('#workflow-revision').selectOption(initial.currentRevision);
  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await page.locator('#workflow-revert').click();
  await expect(page.locator('#workflow-status')).toContainText(/Reverted content into new publication \S+\. Originals remain retained\./, { timeout: 15_000 });
  const reverted = (await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body;
  expect(reverted.currentRevision).not.toBe(replacementPublish.currentRevision);
  const revertedPack = (await apiJson<PackV2>(request, 'GET', revisionPackPath(reverted.currentRevision))).body;
  expect(revertedPack.contentHash).toBe(computeContentHash(revertedPack));
  expect(packContentWithoutRevision(revertedPack)).toEqual(packContentWithoutRevision(initialPack));
  expect(revertedPack.units.some((entry) => entry.id === uiUnitId)).toBe(false);
  expect(revertedPack.units.some((entry) => entry.id === uiDuplicateId)).toBe(false);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitA)}.png`))).toEqual(unitA);
  expect(readFileIfPresent(join(packDir, '.content-publication', 'originals', `${sha256(unitB)}.png`))).toEqual(unitB);
  await capture(page, 'foundry-reverted-1280x800');

  const cleanupPublication = (await apiJson<PublicationStatus>(request, 'GET', '/v2/publication')).body;
  const cleanupUnit = await apiJson<DraftMutationResponse>(request, 'DELETE', `/v2/units/${encodeURIComponent(uiUnitId)}`, {
    expectedDraftRevision: cleanupPublication.draftRevision,
  });
  expect(cleanupUnit.status).toBe(200);
  const cleanupDuplicate = await apiJson<DraftMutationResponse>(request, 'DELETE', `/v2/units/${encodeURIComponent(uiDuplicateId)}`, {
    expectedDraftRevision: cleanupUnit.body.publication.draftRevision,
  });
  expect(cleanupDuplicate.status).toBe(200);
});

type JsonRecord = Record<string, unknown>;
type PackEntry = JsonRecord & { id: string; assetPath: string };
type PackV2 = {
  schemaVersion: number;
  id: string;
  revision: string;
  contentHash: string;
  units: PackEntry[];
  buildings: PackEntry[];
};
type Asset = {
  kind: 'runtime' | 'data';
  assetPath: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
};
type RevisionMetadata = {
  revision: string;
  manifestPath: string;
  manifestHash: string;
  assets: Asset[];
  sourceRevision?: string;
};
type PublicationStatus = {
  currentRevision: string;
  draftRevision: string;
  current: RevisionMetadata;
};
type DraftMutationResponse = {
  ok: true;
  archetype?: JsonRecord & { id: string };
  draft: PackV2;
  publication: PublicationStatus;
};
type ReferenceAttachment = {
  id: string;
  displayName: string;
  assetPath: string;
  sha256: string;
  width: number;
  height: number;
};

async function waitForLibrary(page: Page): Promise<void> {
  await expect(page.locator('#library-status')).toContainText(/runtime entries loaded\./, { timeout: 15_000 });
  await expect(page.locator('#pack-meta')).toContainText(/Draft revision \S+ · Published revision \S+/);
}

async function assertControlBounds(page: Page, selectors: string[]): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const selector of selectors) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} must have a practical visible control box`).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThan(24);
    expect(box?.height ?? 0).toBeGreaterThan(20);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  }
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(artifactDir, `${name}.png`) });
}

async function apiJson<T>(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
): Promise<{ status: number; body: T }> {
  const options: { method: string; data?: unknown; headers?: Record<string, string> } = { method };
  if (data !== undefined) {
    options.data = data;
    options.headers = { 'content-type': 'application/json' };
  }
  const response = await request.fetch(`${contentOrigin}${path}`, options);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  return { status: response.status(), body: body as T };
}

async function apiBinary(request: APIRequestContext, path: string): Promise<{ status: number; body: Buffer }> {
  const response = await request.get(`${contentOrigin}${path}`);
  return { status: response.status(), body: await response.body() };
}

async function assertPublishedAsset(
  request: APIRequestContext,
  revision: string,
  assetPath: string,
  expectedBytes: Buffer,
  packDir: string,
): Promise<void> {
  const asset = (await apiJson<RevisionMetadata>(request, 'GET', `/v2/revisions/${encodeURIComponent(revision)}`)).body.assets.find((entry) => entry.assetPath === assetPath);
  expect(asset).toMatchObject({ sha256: sha256(expectedBytes), byteLength: expectedBytes.length, kind: 'runtime' });
  expect((await apiBinary(request, revisionAssetPath(revision, assetPath))).body.equals(expectedBytes)).toBe(true);
  expect(sha256(readFileIfPresent(join(packDir, asset?.storagePath ?? '')))).toBe(sha256(expectedBytes));
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object in acceptance response');
  }
  return value as JsonRecord;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
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
