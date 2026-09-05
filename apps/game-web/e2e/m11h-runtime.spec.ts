import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { observeBrowser } from './support/browser-evidence';
import { routeIsolatedContent } from './support/isolated-content';

const GAME_URL =
  '/?mode=interaction-lab&scenario=interaction-lab-alien-fantasy&seed=42&renderer=webgl&dpr=1&zoom=70-percent';
const CONTENT_PORT = process.env['PLAYWRIGHT_CONTENT_PORT'] ?? '8787';
const CONTENT_ORIGIN = `http://127.0.0.1:${CONTENT_PORT}`;
const PACK_DIR = process.env['PLAYWRIGHT_CONTENT_PACK_DIR'] ?? process.env['CONTENT_PACK_DIR'] ?? '';
const GAME_VIEWPORT = { width: 1280, height: 800 };
const COMPACT_VIEWPORT = { width: 1194, height: 834 };
const RUNTIME_ID = 'game-web-interaction-lab';
const SCENARIO_ID = 'interaction-lab-alien-fantasy';
const SCOUT_ID = 'sunweaver-scout';

// The content service is shared by the serial lifecycle tests. The fixture is
// disposable, so every mutation is isolated from the checked-in dev pack.
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await routeIsolatedContent(page);
  await page.setViewportSize(GAME_VIEWPORT);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
  });
});

test('M1.1-H initial published studio load, asset identity, drafts, failed publish, and cosmetic replacement', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    process.env['PLAYWRIGHT_SERVER_MODE'] !== 'dev' ||
      process.env['PLAYWRIGHT_SKIP_CONTENT_SERVER'] === '1' ||
      PACK_DIR.length === 0,
    'The publication lifecycle requires the isolated development content service.',
  );
  const evidence = observeBrowser(page, testInfo, 'published-lifecycle');
  const browserRequests: string[] = [];
  page.on('request', (requestEvent) => browserRequests.push(requestEvent.url()));

  const initialPublication = await readPublication(request);
  const initialPack = await readRevisionPack(request, initialPublication.currentRevision);
  const initialScout = findScout(initialPack);
  const originalPng = readFileSync(join(PACK_DIR, 'units', SCOUT_ID, 'sheet.png')).toString('base64');
  const alternatePng = readFileSync(join(PACK_DIR, 'units', 'gravemark-stalker', 'sheet.png')).toString('base64');

  await page.goto(`${GAME_URL}&content=studio`, { waitUntil: 'domcontentloaded' });
  await waitForLab(page);
  await assertDiagnosticsLayout(page, GAME_VIEWPORT);
  const initialRuntime = await readRuntimeSnapshot(page);
  expect(initialRuntime.content?.identity.revision).toBe(initialPublication.currentRevision);
  expect(initialRuntime.content?.identity.packId).toBe(initialPublication.current.packId);
  expect(initialRuntime.content?.identity.contentHash).toBe(initialPack.contentHash);
  expect(initialRuntime.content?.identity.manifestHash).toBe(initialPublication.current.manifestHash);
  expect(initialRuntime.content?.identity.visualContentHash).toBe(initialPublication.current.visualContentHash);
  expect(initialRuntime.content?.identity.simulationRulesHash).toBe(initialPublication.current.simulationRulesHash);
  expect(initialRuntime.status?.activeAssetBaseUrl).toBe(
    `/dev-content/v2/revisions/${initialPublication.currentRevision}/assets/`,
  );
  await verifyRevisionAssets(request, initialPublication.currentRevision, initialPublication.current.assets);
  expect(browserRequests.some((url) => url.includes(`/dev-content/v2/revisions/${initialPublication.currentRevision}/`))).toBeTruthy();

  await evidence.capture('studio-1280x800', {
    viewport: GAME_VIEWPORT,
    publication: initialPublication,
    runtime: initialRuntime,
    browserRequests,
    resourceEntries: await readResourceEntries(page),
    performance: await readPerformanceEntries(page),
    renderValidation: 'SwiftShader or configured browser renderer; physical-device validation is separate',
  });
  await page.setViewportSize(COMPACT_VIEWPORT);
  await page.waitForTimeout(250);
  await assertDiagnosticsLayout(page, COMPACT_VIEWPORT);
  await evidence.capture('studio-1194x834', {
    viewport: COMPACT_VIEWPORT,
    publication: initialPublication,
    runtime: await readRuntimeSnapshot(page),
    browserRequests,
    resourceEntries: await readResourceEntries(page),
    performance: await readPerformanceEntries(page),
    renderValidation: 'SwiftShader or configured browser renderer; physical-device validation is separate',
  });
  await page.setViewportSize(GAME_VIEWPORT);

  const draftBefore = await readDraftPack(request);
  const draftScoutBefore = findScout(draftBefore);
  expect(draftScoutBefore.id).toBe(initialScout.id);
  const cosmeticA = cloneJson(draftScoutBefore);
  cosmeticA.displayName = 'Sunweaver Scout H Cosmetic A';
  const mutationA = await updateScout(request, draftBefore.revision, cosmeticA, alternatePng);
  expect(mutationA.draft.revision).not.toBe(draftBefore.revision);
  const publishedAfterDraft = await readRevisionPack(request, initialPublication.currentRevision);
  expect(findScout(publishedAfterDraft)).toEqual(initialScout);

  const failedPublish = await request.post(`${CONTENT_ORIGIN}/v2/publish`, {
    data: { expectedRevision: 'stale-revision' },
  });
  expect(failedPublish.status()).toBe(409);
  const publicationAfterFailure = await readPublication(request);
  expect(publicationAfterFailure.currentRevision).toBe(initialPublication.currentRevision);
  expect(findScout(await readRevisionPack(request, publicationAfterFailure.currentRevision))).toEqual(initialScout);
  const draftAfterFailure = await readDraftPack(request);
  expect(findScout(draftAfterFailure).displayName).toBe(cosmeticA.displayName);

  const publishA = await publishDraft(request, publicationAfterFailure.currentRevision, draftAfterFailure.revision);
  const metadataA = publishA.metadata;
  expect(metadataA.revision).toBe(publishA.revision);
  expect(metadataA.restartRequired).toBeFalsy();
  expect(metadataA.simulationRulesHash).toBe(initialPublication.current.simulationRulesHash);
  expect(metadataA.visualContentHash).not.toBe(initialPublication.current.visualContentHash);
  await waitForRevision(page, publishA.revision);
  const runtimeA = await readRuntimeSnapshot(page);
  expect(runtimeA.status?.activeRevision).toBe(publishA.revision);
  expect(runtimeA.content?.identity.visualContentHash).toBe(metadataA.visualContentHash);
  await waitForAcknowledgement(request, SCENARIO_ID, publishA.revision, false);

  const draftForCosmeticB = await readDraftPack(request);
  const cosmeticB = cloneJson(findScout(draftForCosmeticB));
  cosmeticB.displayName = 'Sunweaver Scout H Cosmetic B';
  const mutationB = await updateScout(request, draftForCosmeticB.revision, cosmeticB, originalPng);
  const publishB = await publishDraft(request, publishA.revision, mutationB.draft.revision);
  expect(publishB.metadata.restartRequired).toBeFalsy();
  expect(publishB.metadata.simulationRulesHash).toBe(metadataA.simulationRulesHash);
  expect(publishB.metadata.visualContentHash).not.toBe(metadataA.visualContentHash);
  const scoutAssetA = findAsset(metadataA, `units/${SCOUT_ID}/sheet.png`);
  const scoutAssetB = findAsset(publishB.metadata, `units/${SCOUT_ID}/sheet.png`);
  expect(scoutAssetB.sha256).not.toBe(scoutAssetA.sha256);
  await waitForRevision(page, publishB.revision);
  const runtimeB = await readRuntimeSnapshot(page);
  expect(runtimeB.status?.activeRevision).toBe(publishB.revision);
  expect(runtimeB.status?.activeSimulationRulesHash).toBe(metadataA.simulationRulesHash);
  await waitForAcknowledgement(request, SCENARIO_ID, publishB.revision, false);
  await evidence.capture('studio-cosmetic-replacement-repeat', {
    firstReplacement: { revision: publishA.revision, metadata: metadataA },
    secondReplacement: { revision: publishB.revision, metadata: publishB.metadata },
    runtime: runtimeB,
    repeatedStableId: SCOUT_ID,
    assetSha256Changed: true,
    browserRequests,
    resourceEntries: await readResourceEntries(page),
    performance: await readPerformanceEntries(page),
  });
});

test('M1.1-H rules revision requires explicit restart and exact acknowledgement', async ({ page, request }, testInfo) => {
  test.skip(
    process.env['PLAYWRIGHT_SERVER_MODE'] !== 'dev' ||
      process.env['PLAYWRIGHT_SKIP_CONTENT_SERVER'] === '1' ||
      PACK_DIR.length === 0,
    'The publication lifecycle requires the isolated development content service.',
  );
  const evidence = observeBrowser(page, testInfo, 'rules-restart');
  const browserRequests: string[] = [];
  page.on('request', (requestEvent) => browserRequests.push(requestEvent.url()));
  const publicationBefore = await readPublication(request);
  await page.goto(`${GAME_URL}&content=studio`, { waitUntil: 'domcontentloaded' });
  await waitForLab(page);
  const before = await readRuntimeSnapshot(page);
  expect(before.content?.identity.revision).toBe(publicationBefore.currentRevision);
  const draft = await readDraftPack(request);
  const rulesScout = cloneJson(findScout(draft));
  rulesScout.movement = {
    ...rulesScout.movement,
    speedSubunitsPerTick: rulesScout.movement.speedSubunitsPerTick + 1,
  };
  const mutation = await updateScout(request, draft.revision, rulesScout);
  const published = await publishDraft(request, publicationBefore.currentRevision, mutation.draft.revision);
  expect(published.metadata.restartRequired).toBeTruthy();
  expect(published.metadata.simulationRulesHash).not.toBe(publicationBefore.current.simulationRulesHash);

  await waitForContentPhase(page, 'restart-required');
  const pending = await readRuntimeSnapshot(page);
  expect(pending.status?.activeRevision).toBe(publicationBefore.currentRevision);
  expect(pending.status?.pendingRevision).toBe(published.revision);
  expect(pending.content?.identity.revision).toBe(publicationBefore.currentRevision);
  const tickBeforeRestart = pending.diagnostics?.tick ?? 0;
  await page.waitForTimeout(250);
  const tickWhilePending = (await readRuntimeSnapshot(page)).diagnostics?.tick ?? 0;
  expect(tickWhilePending).toBeGreaterThan(tickBeforeRestart);
  const restartButton = page.locator('.pastel-lab-tools [data-action="restart-revision"]');
  await expect(restartButton).toBeEnabled();
  await restartButton.click();
  await waitForRevision(page, published.revision);
  await page.waitForFunction(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    return app?.getContentStatus?.()?.phase === 'ready';
  });
  const after = await readRuntimeSnapshot(page);
  expect(after.status?.activeRevision).toBe(published.revision);
  expect(after.status?.pendingRevision).toBeNull();
  expect(after.content?.identity.simulationRulesHash).toBe(published.metadata.simulationRulesHash);
  await waitForAcknowledgement(request, SCENARIO_ID, published.revision, true);
  await evidence.capture('rules-restart-acknowledged', {
    before,
    pending,
    after,
    publication: published,
    acknowledgement: await readAcknowledgement(request, SCENARIO_ID),
    browserRequests,
    resourceEntries: await readResourceEntries(page),
    performance: await readPerformanceEntries(page),
  });
});

test('M1.1-H reconnect resyncs the exact newest revision and historical pin stays fixed', async ({ page, request }, testInfo) => {
  test.skip(
    process.env['PLAYWRIGHT_SERVER_MODE'] !== 'dev' ||
      process.env['PLAYWRIGHT_SKIP_CONTENT_SERVER'] === '1' ||
      PACK_DIR.length === 0,
    'The publication lifecycle requires the isolated development content service.',
  );
  const evidence = observeBrowser(page, testInfo, 'reconnect-and-pin');
  const browserRequests: string[] = [];
  page.on('request', (requestEvent) => browserRequests.push(requestEvent.url()));
  const beforePublication = await readPublication(request);
  const beforePack = await readRevisionPack(request, beforePublication.currentRevision);
  await page.goto(`${GAME_URL}&content=studio`, { waitUntil: 'domcontentloaded' });
  await waitForLab(page);
  const sourceRevision = beforePublication.currentRevision;

  const draft = await readDraftPack(request);
  const reconnectScout = cloneJson(findScout(draft));
  reconnectScout.displayName = `Sunweaver Scout H Reconnect ${String(Date.now())}`;
  const mutation = await updateScout(request, draft.revision, reconnectScout);
  const published = await publishDraft(request, beforePublication.currentRevision, mutation.draft.revision);
  expect(published.metadata.restartRequired).toBeFalsy();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('m11h-test-sse-disconnect'));
  });
  await waitForRevision(page, published.revision);
  const reconnected = await readRuntimeSnapshot(page);
  expect(reconnected.status?.activeRevision).toBe(published.revision);
  expect(reconnected.content?.identity.revision).toBe(published.revision);
  expect(reconnected.status?.activeVisualContentHash).toBe(published.metadata.visualContentHash);
  expect(reconnected.status?.activeRevision).not.toBe(sourceRevision);
  await waitForAcknowledgement(request, SCENARIO_ID, published.revision, false);

  const revisions = await readRevisions(request);
  const historical = oldestRevision(revisions);
  expect(historical.revision).not.toBe(published.revision);
  await page.goto(`${GAME_URL}&content=studio&revision=${encodeURIComponent(historical.revision)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForLab(page);
  const pinnedBefore = await readRuntimeSnapshot(page);
  expect(pinnedBefore.content?.identity.revision).toBe(historical.revision);
  expect(pinnedBefore.status?.selectedRevision).toBe(historical.revision);

  const pinnedDraft = await readDraftPack(request);
  const pinnedPublishScout = cloneJson(findScout(pinnedDraft));
  pinnedPublishScout.displayName = `Sunweaver Scout H Pinned Event ${String(Date.now())}`;
  const pinnedMutation = await updateScout(request, pinnedDraft.revision, pinnedPublishScout);
  const pinnedPublication = await readPublication(request);
  const pinnedPublish = await publishDraft(request, pinnedPublication.currentRevision, pinnedMutation.draft.revision);
  await waitForAvailableRevision(page, pinnedPublish.revision);
  const pinnedAfter = await readRuntimeSnapshot(page);
  expect(pinnedAfter.status?.selectedRevision).toBe(historical.revision);
  expect(pinnedAfter.status?.activeRevision).toBe(historical.revision);
  expect(pinnedAfter.content?.identity.revision).toBe(historical.revision);
  expect(pinnedAfter.status?.availableRevision).toBe(pinnedPublish.revision);
  expect(browserRequests.some((url) => url.includes(`/dev-content/v2/revisions/${pinnedPublish.revision}/`))).toBeFalsy();
  await evidence.capture('reconnect-newest-and-historical-pin', {
    beforePublication,
    beforePack: { revision: beforePack.revision, contentHash: beforePack.contentHash },
    reconnected,
    historical: historical.revision,
    pinnedBefore,
    pinnedAfter,
    newestRevision: pinnedPublish.revision,
    browserRequests,
    resourceEntries: await readResourceEntries(page),
    performance: await readPerformanceEntries(page),
  });
});

test('M1.1-H Foundry launcher values select the requested scenario and spawn ID', async ({ page }, testInfo) => {
  test.skip(
    process.env['PLAYWRIGHT_SERVER_MODE'] !== 'dev' ||
      process.env['PLAYWRIGHT_SKIP_CONTENT_SERVER'] === '1' ||
      PACK_DIR.length === 0,
    'The Foundry launcher audit requires the isolated development content service.',
  );
  const evidence = observeBrowser(page, testInfo, 'foundry-launcher-values');
  const requestedSeed = 4242;
  await page.goto(
    `/?mode=interaction-lab&content=studio&scenario=lab-skirmish&spawnUnit=${SCOUT_ID}&seed=${String(requestedSeed)}&renderer=webgl&dpr=1&zoom=70-percent`,
    { waitUntil: 'domcontentloaded' },
  );
  await waitForLab(page, 1);
  await page.waitForFunction(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const log = lab?.recorder.exportLog() ?? [];
    const results = lab?.recorder.exportResults() ?? [];
    const spawnIds = new Set(
      log
        .filter((entry) => entry.payload.kind === 'spawnUnit')
        .map((entry) => entry.commandId),
    );
    return results.some((result) => spawnIds.has(result.commandId) && result.status === 'accepted');
  });
  const launcher = await readRuntimeSnapshot(page);
  const spawnCommands = launcher.commands.filter((entry) => entry.payload.kind === 'spawnUnit');
  expect(launcher.diagnostics?.scenarioId).toBe('lab-skirmish');
  expect(launcher.diagnostics?.seed).toBe(requestedSeed);
  expect(spawnCommands.some((entry) => entry.payload.archetypeId === SCOUT_ID)).toBeTruthy();
  expect(
    launcher.results.some(
      (result) => spawnCommands.some((entry) => entry.commandId === result.commandId) && result.status === 'accepted',
    ),
  ).toBeTruthy();
  await evidence.capture('foundry-launcher-scenario-and-spawn', {
    diagnostics: launcher.diagnostics,
    spawnCommands,
    commandResults: launcher.results,
    requestedScenario: 'lab-skirmish',
    requestedSpawnUnit: SCOUT_ID,
    requestedSeed,
    resourceEntries: await readResourceEntries(page),
    performance: await readPerformanceEntries(page),
  });
});

async function readPublication(request: APIRequestContext): Promise<Publication> {
  const response = await request.get(`${CONTENT_ORIGIN}/v2/publication`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Publication;
}

async function readRevisions(request: APIRequestContext): Promise<RevisionMetadata[]> {
  const response = await request.get(`${CONTENT_ORIGIN}/v2/revisions`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { revisions: RevisionMetadata[] };
  return body.revisions;
}

async function readRevisionPack(request: APIRequestContext, revision: string): Promise<PackV2> {
  const response = await request.get(`${CONTENT_ORIGIN}/v2/revisions/${encodeURIComponent(revision)}/pack`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as PackV2;
}

async function readDraftPack(request: APIRequestContext): Promise<PackV2> {
  const response = await request.get(`${CONTENT_ORIGIN}/v2/draft/pack`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as PackV2;
}

async function updateScout(
  request: APIRequestContext,
  expectedDraftRevision: string,
  archetype: UnitArchetype,
  pngBase64?: string,
): Promise<DraftMutation> {
  const response = await request.put(`${CONTENT_ORIGIN}/v2/units/${encodeURIComponent(SCOUT_ID)}`, {
    data: {
      archetype,
      expectedDraftRevision,
      ...(pngBase64 === undefined ? {} : { pngBase64 }),
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as DraftMutation;
}

async function publishDraft(
  request: APIRequestContext,
  expectedRevision: string,
  expectedDraftRevision: string,
): Promise<PublishResult> {
  const validation = await request.post(`${CONTENT_ORIGIN}/v2/validate`, {
    data: { expectedDraftRevision },
  });
  expect(validation.ok()).toBeTruthy();
  const validationBody = (await validation.json()) as { ok: boolean; draftRevision: string };
  expect(validationBody.ok).toBeTruthy();
  expect(validationBody.draftRevision).toBe(expectedDraftRevision);
  const response = await request.post(`${CONTENT_ORIGIN}/v2/publish`, {
    data: { expectedRevision },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as PublishResult;
}

async function verifyRevisionAssets(
  request: APIRequestContext,
  revision: string,
  assets: ImmutableAssetReference[],
): Promise<void> {
  for (const asset of assets) {
    const path = asset.assetPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const response = await request.get(`${CONTENT_ORIGIN}/v2/revisions/${encodeURIComponent(revision)}/assets/${path}`);
    expect(response.ok()).toBeTruthy();
    const digest = createHash('sha256').update(await response.body()).digest('hex');
    expect(digest).toBe(asset.sha256);
  }
}

async function readAcknowledgement(request: APIRequestContext, scenarioId: string): Promise<Acknowledgement | null> {
  const response = await request.get(`${CONTENT_ORIGIN}/v2/acknowledgements`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { acknowledgements: Acknowledgement[] };
  return body.acknowledgements.find((entry) => entry.runtimeId === RUNTIME_ID && entry.scenarioId === scenarioId) ?? null;
}

async function waitForAcknowledgement(
  request: APIRequestContext,
  scenarioId: string,
  revision: string,
  restartRequired: boolean,
): Promise<void> {
  await poll(async () => {
    const acknowledgement = await readAcknowledgement(request, scenarioId);
    return (
      acknowledgement !== null &&
      acknowledgement.revision === revision &&
      acknowledgement.simulationRulesHash.length === 64 &&
      acknowledgement.restartRequired === restartRequired
    );
  });
}

async function waitForLab(page: Page, minimumEntities = 25): Promise<void> {
  await page.waitForSelector('#game-canvas');
  await page.waitForFunction(
    (minimum) => {
      const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
      const lab = app?.getInteractionLab?.();
      return Boolean(lab?.isReady() && lab.runtime.getEntityCount() >= minimum);
    },
    minimumEntities,
    { timeout: 30_000 },
  );
}

async function assertDiagnosticsLayout(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  const minimap = page.locator('.pastel-minimap');
  const hud = page.locator('.pastel-hud');
  const body = page.locator('.pastel-hud-body');
  const collapse = page.locator('.pastel-hud [data-action="toggle"]');
  const armyRail = page.locator('.pastel-match-hud');
  await expect(minimap).toBeVisible();
  await expect(hud).toBeVisible();
  await expect(collapse).toBeVisible();
  await expect(armyRail).toBeVisible();

  const rectangles = await page.evaluate(() => {
    const read = (selector: string): { x: number; y: number; width: number; height: number } | null => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      minimap: read('.pastel-minimap'),
      hud: read('.pastel-hud'),
      armyRail: read('.pastel-match-hud'),
    };
  });
  expect(rectangles.minimap).not.toBeNull();
  expect(rectangles.hud).not.toBeNull();
  expect(rectangles.armyRail).not.toBeNull();
  if (!rectangles.minimap || !rectangles.hud || !rectangles.armyRail) {
    return;
  }
  expect(rectangles.hud.y).toBeGreaterThanOrEqual(rectangles.minimap.y + rectangles.minimap.height + 8);
  expect(rectangles.hud.y + rectangles.hud.height).toBeLessThanOrEqual(rectangles.armyRail.y - 8);
  expect(rectangles.hud.x + rectangles.hud.width).toBeLessThanOrEqual(viewport.width);

  const bodyMetrics = await body.evaluate((element) => {
    const metricsElement = element.querySelector('[data-role="metrics"]');
    const metricsStyle = metricsElement ? getComputedStyle(metricsElement) : null;
    const bodyStyle = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      bodyOverflowY: bodyStyle.overflowY,
      bodyTouchAction: bodyStyle.touchAction,
      metricsClientWidth: metricsElement?.clientWidth ?? 0,
      metricsScrollWidth: metricsElement?.scrollWidth ?? 0,
      metricsOverflowWrap: metricsStyle?.overflowWrap ?? '',
      metricsText: metricsElement?.textContent ?? '',
    };
  });
  expect(bodyMetrics.scrollHeight).toBeGreaterThan(bodyMetrics.clientHeight);
  expect(bodyMetrics.bodyOverflowY).toBe('auto');
  expect(bodyMetrics.bodyTouchAction).toContain('pan-y');
  expect(bodyMetrics.metricsScrollWidth).toBeLessThanOrEqual(bodyMetrics.metricsClientWidth);
  expect(bodyMetrics.metricsOverflowWrap).toBe('anywhere');
  expect(bodyMetrics.metricsText).toContain('content error:');

  expect(await collapse.getAttribute('aria-controls')).toBe('pastel-hud-body');
  expect(await collapse.getAttribute('aria-expanded')).toBe('true');
  await collapse.click();
  await expect(body).toBeHidden();
  expect(await collapse.getAttribute('aria-expanded')).toBe('false');
  await collapse.click();
  await expect(body).toBeVisible();
  expect(await collapse.getAttribute('aria-expanded')).toBe('true');

  await page.evaluate(() => {
    const canvas = document.querySelector('#game-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Missing game canvas for HUD propagation check');
    }
    let count = 0;
    canvas.addEventListener('pointerdown', () => count++, { once: true });
    (window as unknown as { __m11hHudCanvasPointerDowns?: () => number }).__m11hHudCanvasPointerDowns = () => count;
  });
  const hudBox = await hud.boundingBox();
  expect(hudBox).not.toBeNull();
  if (hudBox) {
    await page.mouse.click(hudBox.x + 12, hudBox.y + Math.min(hudBox.height - 12, 100));
  }
  const canvasPointerDowns = await page.evaluate(
    () => (window as unknown as { __m11hHudCanvasPointerDowns?: () => number }).__m11hHudCanvasPointerDowns?.() ?? -1,
  );
  expect(canvasPointerDowns).toBe(0);
}

async function waitForRevision(page: Page, revision: string): Promise<void> {
  await page.waitForFunction(
    (expectedRevision) => {
      const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
      return app?.getInteractionLab?.()?.getContent().identity.revision === expectedRevision;
    },
    revision,
    { timeout: 30_000 },
  );
}

async function waitForContentPhase(page: Page, phase: string): Promise<void> {
  await page.waitForFunction(
    (expectedPhase) => {
      const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
      return app?.getContentStatus?.()?.phase === expectedPhase;
    },
    phase,
    { timeout: 30_000 },
  );
}

async function waitForAvailableRevision(page: Page, revision: string): Promise<void> {
  await page.waitForFunction(
    (expectedRevision) => {
      const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
      return app?.getContentStatus?.()?.availableRevision === expectedRevision;
    },
    revision,
    { timeout: 30_000 },
  );
}

async function poll(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out while waiting for the content-service acknowledgement');
}

async function readRuntimeSnapshot(page: Page): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const content = lab?.getContent();
    return {
      content: content
        ? {
            identity: content.identity,
            assetBaseUrl: content.assetBaseUrl,
          }
        : null,
      status: app?.getContentStatus?.() ?? null,
      diagnostics: lab?.getDiagnostics() ?? null,
      commands: lab?.recorder.exportLog() ?? [],
      results: lab?.recorder.exportResults() ?? [],
    };
  });
}

async function readResourceEntries(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
}

async function readPerformanceEntries(page: Page): Promise<PerformanceEntrySnapshot[]> {
  return page.evaluate(() =>
    performance.getEntriesByType('navigation').map((entry) => ({
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
    })),
  );
}

function findScout(pack: PackV2): UnitArchetype {
  const scout = pack.units.find((unit) => unit.id === SCOUT_ID);
  if (!scout) {
    throw new Error(`Fixture is missing ${SCOUT_ID}`);
  }
  return scout;
}

function findAsset(metadata: RevisionMetadata, assetPath: string): ImmutableAssetReference {
  const asset = metadata.assets.find((entry) => entry.assetPath === assetPath);
  if (!asset) {
    throw new Error(`Revision ${metadata.revision} is missing ${assetPath}`);
  }
  return asset;
}

function oldestRevision(revisions: RevisionMetadata[]): RevisionMetadata {
  const sorted = [...revisions].sort((left, right) => compareRevisions(left.revision, right.revision));
  const oldest = sorted[0];
  if (!oldest) {
    throw new Error('Content service returned no published revisions');
  }
  return oldest;
}

function compareRevisions(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : Number.NaN;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : Number.NaN;
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type PackV2 = {
  revision: string;
  contentHash: string;
  units: UnitArchetype[];
};

type UnitArchetype = {
  id: string;
  displayName: string;
  movement: {
    speedSubunitsPerTick: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ImmutableAssetReference = {
  kind: 'runtime' | 'data';
  assetPath: string;
  storagePath: string;
  sha256: string;
  byteLength: number;
};

type RevisionMetadata = {
  revision: string;
  packId: string;
  manifestHash: string;
  visualContentHash: string;
  simulationRulesHash: string;
  restartRequired: boolean;
  assets: ImmutableAssetReference[];
};

type Publication = {
  currentRevision: string;
  draftRevision: string;
  current: RevisionMetadata;
};

type DraftMutation = {
  ok: boolean;
  draft: PackV2;
  publication: Publication;
};

type PublishResult = {
  ok: boolean;
  revision: string;
  metadata: RevisionMetadata;
  pack: PackV2;
  publication: Publication;
};

type Acknowledgement = {
  runtimeId: string;
  scenarioId: string;
  revision: string;
  simulationRulesHash: string;
  restartRequired: boolean;
  updatedAt: string;
};

type RuntimeSnapshot = {
  content: {
    identity: {
      revision: string;
      packId: string;
      contentHash: string;
      manifestHash: string | null;
      visualContentHash: string;
      simulationRulesHash: string;
      source: string;
    };
    assetBaseUrl: string;
  } | null;
  status: {
    phase: string;
    activeRevision: string | null;
    pendingRevision: string | null;
    availableRevision: string | null;
    activeManifestHash: string | null;
    activeVisualContentHash: string | null;
    activeSimulationRulesHash: string | null;
    activeAssetBaseUrl: string | null;
    selectedRevision: string | null;
  } | null;
  diagnostics: {
    content: { revision: string; visualContentHash: string; simulationRulesHash: string };
    scenarioId: string | null;
    seed: number;
    tick: number;
    entityCount: number;
  } | null;
  commands: Array<{ commandId: string; payload: { kind: string; archetypeId?: string } }>;
  results: Array<{ commandId: string; status: string }>;
};

type PerformanceEntrySnapshot = {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
};

type EntityHook = {
  id: { index: number; generation: number };
  kind: string;
  relationship: string;
  x: number;
  z: number;
};

type LabHook = {
  isReady: () => boolean;
  getContent: () => NonNullable<RuntimeSnapshot['content']>;
  getDiagnostics: () => RuntimeSnapshot['diagnostics'];
  getPickableEntities: () => EntityHook[];
  runtime: { getEntityCount: () => number };
  recorder: {
    exportLog: () => RuntimeSnapshot['commands'];
    exportResults: () => RuntimeSnapshot['results'];
  };
};

type AppHook = {
  getInteractionLab?: () => LabHook | null;
  getContentStatus?: () => RuntimeSnapshot['status'] | null;
};
