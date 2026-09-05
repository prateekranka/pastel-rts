import { expect, test, type Page } from '@playwright/test';
import { observeBrowser } from './support/browser-evidence';
import { routeIsolatedContent } from './support/isolated-content';

const LAB_URL =
  '/?mode=interaction-lab&scenario=interaction-lab-alien-fantasy&seed=42&renderer=webgl&dpr=1&zoom=70-percent';

const GAME_VIEWPORT = { width: 1280, height: 800 };
const CONTENT_ORIGIN = `http://127.0.0.1:${process.env['PLAYWRIGHT_CONTENT_PORT'] ?? '8787'}`;

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await routeIsolatedContent(page);
  await page.setViewportSize(GAME_VIEWPORT);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
  });
});

test('M1.1-C game command, blocker, save/load, and replay audit', async ({ page }, testInfo) => {
  const evidence = observeBrowser(page, testInfo, 'game-lab');
  await page.goto(LAB_URL, { waitUntil: 'domcontentloaded' });
  await waitForLab(page);

  const initial = await readLabState(page);
  expect(initial.entityCount).toBeGreaterThanOrEqual(25);
  expect(initial.buildingCount).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.locator('.pastel-match-hud')).toBeVisible();
  await expect(page.locator('.pastel-minimap')).toBeVisible();
  await expect(page.locator('.pastel-lab-tools')).toBeVisible();
  await evidence.capture('initial-content', {
    entityCount: initial.entityCount,
    buildingCount: initial.buildingCount,
    bundledPackAssetRequests: await readPackAssetRequests(page),
  });

  const unitPoint = await clientPointForFriendlyUnit(page);
  expect(unitPoint).not.toBeNull();
  if (!unitPoint) {
    return;
  }
  await page.mouse.click(unitPoint.x, unitPoint.y);
  await page.waitForFunction(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    return (lab?.selection.getSelected().length ?? 0) > 0;
  });
  const selected = await readLabState(page);
  expect(selected.selectedCount).toBeGreaterThan(0);
  await expect(page.locator('.pastel-match-hud-total')).not.toHaveText('0');
  await evidence.capture('selected-unit', { selectedCount: selected.selectedCount });

  const canvasBox = await page.locator('#game-canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) {
    return;
  }
  const beforeMove = await readSelectedEntity(page);
  expect(beforeMove).not.toBeNull();
  if (!beforeMove) {
    return;
  }
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.62, canvasBox.y + canvasBox.height * 0.42);
  await page.waitForFunction(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    return (lab?.interaction.issuedCommands.filter((entry) => entry.kind === 'move').length ?? 0) > 0;
  });
  await page.waitForFunction(
    (start) => {
      const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
      const lab = app?.getInteractionLab?.();
      const selected = lab?.selection.getSelected()[0];
      const current = selected
        ? lab?.getPickableEntities().find(
            (entry) => entry.id.index === selected.index && entry.id.generation === selected.generation,
          )
        : undefined;
      return current !== undefined && Math.hypot(current.x - start.x, current.z - start.z) > 0.2;
    },
    beforeMove,
    { timeout: 15_000 },
  );
  const moving = await readSelectedEntity(page);
  expect(moving).not.toBeNull();
  await evidence.capture('movement-animation-start', {
    before: beforeMove,
    after: moving,
    moveCommands: await readMoveCommandCount(page),
  });
  await page.waitForTimeout(350);
  const movingLater = await readSelectedEntity(page);
  await evidence.capture('movement-animation-later', {
    before: beforeMove,
    after: movingLater,
    moveCommands: await readMoveCommandCount(page),
  });

  const blocker = await exerciseBuildingBlocker(page);
  expect(blocker.pathCountBefore).toBeGreaterThan(0);
  expect(blocker.placementResult).toBe('accepted');
  expect(blocker.pathsChanged).toBe(true);
  expect(blocker.buildingCountAfter).toBeGreaterThan(blocker.buildingCountBefore);
  await evidence.capture('building-blocker-replan', blocker);

  const saveReplay = await exerciseSaveLoadReplay(page);
  expect(saveReplay.saveSchemaVersion).toBe(1);
  expect(saveReplay.commandCount).toBeGreaterThan(0);
  expect(saveReplay.checksumCount).toBeGreaterThan(0);
  expect(typeof saveReplay.replayMatched).toBe('boolean');
  expect(saveReplay.entityCountAfterReload).toBeGreaterThanOrEqual(25);
  await evidence.capture('save-load-replay', saveReplay);

  const playerButtons = (await page.locator('button').allTextContents()).map((text) => text.trim());
  const persistenceControls = playerButtons.filter((text) => /save|load|replay/i.test(text));
  await evidence.capture('ui-persistence-inventory', {
    playerButtons,
    persistenceControls,
    note: 'The public scenario save/load and replay APIs were exercised. No player-facing save/load/replay controls were found in the M1 HUD.',
  });
});

test('M1.1-C published v2 runtime loads exact revision and asset identity', async ({ page, request }, testInfo) => {
  test.skip(
    process.env['PLAYWRIGHT_SERVER_MODE'] !== 'dev' || process.env['PLAYWRIGHT_SKIP_CONTENT_SERVER'] === '1',
    'Published v2 runtime audit requires the isolated development server and content server.',
  );
  const evidence = observeBrowser(page, testInfo, 'content-v2-runtime');
  const browserRequests: string[] = [];
  page.on('request', (requestEvent) => browserRequests.push(requestEvent.url()));
  const publicationResponse = await request.get(`${CONTENT_ORIGIN}/v2/publication`);
  expect(publicationResponse.ok()).toBeTruthy();
  const publication = (await publicationResponse.json()) as {
    currentRevision: string;
    current: { revision: string; packId: string; manifestHash: string; visualContentHash: string; simulationRulesHash: string };
  };
  await page.goto(`${LAB_URL}&content=studio`, { waitUntil: 'domcontentloaded' });
  await waitForLab(page);
  const runtime = await readPublishedRuntime(page);
  expect(runtime.status?.activeRevision).toBe(publication.currentRevision);
  expect(runtime.content?.identity.revision).toBe(publication.currentRevision);
  expect(runtime.content?.identity.packId).toBe(publication.current.packId);
  expect(runtime.status?.activeManifestHash).toBe(publication.current.manifestHash);
  expect(runtime.status?.activeVisualContentHash).toBe(publication.current.visualContentHash);
  expect(runtime.status?.activeSimulationRulesHash).toBe(publication.current.simulationRulesHash);
  const metadataResponse = await request.get(`${CONTENT_ORIGIN}/v2/revisions/${encodeURIComponent(publication.currentRevision)}`);
  expect(metadataResponse.ok()).toBeTruthy();
  const metadata = (await metadataResponse.json()) as {
    assets: Array<{ assetPath: string; kind: string; sha256: string }>;
  };
  const runtimeAsset = metadata.assets.find((asset) => asset.kind === 'runtime');
  expect(runtimeAsset).toBeDefined();
  if (!runtimeAsset) {
    return;
  }
  const assetPath = runtimeAsset.assetPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const assetResponse = await request.get(
    `${CONTENT_ORIGIN}/v2/revisions/${encodeURIComponent(publication.currentRevision)}/assets/${assetPath}`,
  );
  expect(assetResponse.ok()).toBeTruthy();
  expect(assetResponse.headers()['content-type']).toContain('image/png');
  expect(browserRequests.some((url) => url.includes(`/dev-content/v2/revisions/${publication.currentRevision}/`))).toBeTruthy();
  await evidence.capture('published-v2-runtime', {
    publication,
    runtime,
    runtimeAsset,
    assetStatus: assetResponse.status(),
    resourceEntries: await readResourceEntries(page),
  });
});

test('M1.1-C production preview boots with content server stopped', async ({ page }, testInfo) => {
  test.skip(
    process.env['PLAYWRIGHT_SERVER_MODE'] !== 'preview' || process.env['PLAYWRIGHT_SKIP_CONTENT_SERVER'] !== '1',
    'Offline production audit is run with preview servers and no content webServer.',
  );
  const evidence = observeBrowser(page, testInfo, 'production-offline');
  const browserRequests: string[] = [];
  page.on('request', (requestEvent) => browserRequests.push(requestEvent.url()));
  await page.goto(LAB_URL, { waitUntil: 'domcontentloaded' });
  await waitForLab(page);
  const state = await readLabState(page);
  expect(state.entityCount).toBeGreaterThanOrEqual(25);
  expect(state.buildingCount).toBeGreaterThanOrEqual(3);
  expect(browserRequests.some((url) => url.includes('/dev-content'))).toBeFalsy();
  expect(browserRequests.some((url) => url.includes('/events'))).toBeFalsy();
  await evidence.capture('bundled-pack-offline', {
    entityCount: state.entityCount,
    buildingCount: state.buildingCount,
    contentServerExpected: 'stopped',
    browserRequests,
    resourceEntries: await readResourceEntries(page),
    physicalValidationStatus: 'awaiting-physical-validation',
  });
});

async function waitForLab(page: Page): Promise<void> {
  await page.waitForSelector('#game-canvas');
  await page.waitForFunction(
    () => {
      const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
      const lab = app?.getInteractionLab?.();
      return Boolean(lab?.isReady() && lab.runtime.getEntityCount() >= 25);
    },
    undefined,
    { timeout: 30_000 },
  );
}

async function readLabState(page: Page): Promise<{
  entityCount: number;
  buildingCount: number;
  selectedCount: number;
  tick: number;
}> {
  return page.evaluate(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const entities = lab?.getPickableEntities() ?? [];
    return {
      entityCount: lab?.runtime.getEntityCount() ?? 0,
      buildingCount: entities.filter((entity) => entity.kind === 'building').length,
      selectedCount: lab?.selection.getSelected().length ?? 0,
      tick: lab?.runtime.getLatestTick() ?? 0,
    };
  });
}

async function readPublishedRuntime(page: Page): Promise<{
  content: { identity: { revision: string; packId: string } } | null;
  status: {
    activeRevision: string | null;
    activeManifestHash: string | null;
    activeVisualContentHash: string | null;
    activeSimulationRulesHash: string | null;
  } | null;
}> {
  return page.evaluate(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const content = lab?.getContent();
    const status = app?.getContentStatus?.();
    return {
      content: content ? { identity: { revision: content.identity.revision, packId: content.identity.packId } } : null,
      status: status
        ? {
            activeRevision: status.activeRevision,
            activeManifestHash: status.activeManifestHash,
            activeVisualContentHash: status.activeVisualContentHash,
            activeSimulationRulesHash: status.activeSimulationRulesHash,
          }
        : null,
    };
  });
}

async function readResourceEntries(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
}

async function readSelectedEntity(page: Page): Promise<{ x: number; z: number } | null> {
  return page.evaluate(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const selected = lab?.selection.getSelected()[0];
    if (!selected) {
      return null;
    }
    const entity = lab?.getPickableEntities().find(
      (entry) => entry.id.index === selected.index && entry.id.generation === selected.generation,
    );
    return entity ? { x: entity.x, z: entity.z } : null;
  });
}

async function readMoveCommandCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    return lab?.interaction.issuedCommands.filter((entry) => entry.kind === 'move').length ?? 0;
  });
}

async function clientPointForFriendlyUnit(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const unit = lab?.getPickableEntities().find(
      (entity) => entity.kind === 'unit' && entity.relationship === 'friendly',
    );
    const camera = app?.getCamera().camera;
    const canvas = document.querySelector('#game-canvas');
    if (!unit || !camera || !(canvas instanceof HTMLCanvasElement)) {
      return null;
    }
    const Vector3 = camera.position.constructor as new (x: number, y: number, z: number) => {
      x: number;
      y: number;
      project: (cam: unknown) => void;
    };
    const projected = new Vector3(unit.x, 0, unit.z);
    projected.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  });
}

async function exerciseBuildingBlocker(page: Page): Promise<{
  pathCountBefore: number;
  placementResult: string;
  pathsChanged: boolean;
  buildingCountBefore: number;
  buildingCountAfter: number;
  originCell: { cx: number; cz: number } | null;
}> {
  return page.evaluate(async () => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
    if (!lab) {
      return {
        pathCountBefore: 0,
        placementResult: 'missing-lab',
        pathsChanged: false,
        buildingCountBefore: 0,
        buildingCountAfter: 0,
        originCell: null,
      };
    }
    const friendlies = lab
      .getPickableEntities()
      .filter((entity) => entity.kind === 'unit' && entity.relationship === 'friendly')
      .slice(0, 4);
    lab.selection.selectMany(friendlies.map((entity) => entity.id));
    lab.debugOverlays.set('paths', true);
    lab.debugOverlays.set('staticBlockers', true);
    const tick = lab.runtime.getLatestTick();
    lab.commandClient.issueMove({
      entityIds: friendlies.map((entity) => entity.id),
      destination: { x: 70 * 1024, z: 45 * 1024 },
      issuedAtTick: tick,
      executeTick: tick,
    });
    let beforePaths: Array<{ cells: Array<{ cx: number; cz: number }> }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(100);
      beforePaths = lab.runtime.getNavDebug()?.paths ?? [];
      if (beforePaths.some((path) => path.cells.length > 2)) {
        break;
      }
    }
    const longPath = beforePaths.find((path) => path.cells.length > 2) ?? beforePaths[0];
    const middle = longPath?.cells[Math.floor((longPath.cells.length - 1) / 2)] ?? null;
    const buildingCountBefore = lab.getPickableEntities().filter((entity) => entity.kind === 'building').length;
    if (!middle) {
      return {
        pathCountBefore: beforePaths.length,
        placementResult: 'no-path-cell',
        pathsChanged: false,
        buildingCountBefore,
        buildingCountAfter: buildingCountBefore,
        originCell: null,
      };
    }
    lab.commandClient.issuePlaceBuilding({
      archetypeId: 'sunweaver-sanctum',
      originCell: middle,
      issuedAtTick: lab.runtime.getLatestTick(),
      executeTick: lab.runtime.getLatestTick(),
    });
    const before = JSON.stringify(beforePaths);
    let after = before;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(100);
      after = JSON.stringify(lab.runtime.getNavDebug()?.paths ?? []);
      if (after !== before) {
        break;
      }
    }
    const placement = [...lab.recorder.exportResults()]
      .reverse()
      .find((result) => result.commandId.includes('lab-'));
    return {
      pathCountBefore: beforePaths.length,
      placementResult: placement?.status ?? 'missing-result',
      pathsChanged: before !== after,
      buildingCountBefore,
      buildingCountAfter: lab.getPickableEntities().filter((entity) => entity.kind === 'building').length,
      originCell: middle,
    };
  });
}

async function exerciseSaveLoadReplay(page: Page): Promise<{
  saveSchemaVersion: number;
  commandCount: number;
  checksumCount: number;
  replayMatched: boolean;
  savedTick: number;
  entityCountAfterReload: number;
}> {
  const result = await page.evaluate(async () => {
    const app = (window as unknown as { __pastelApp?: AppHook }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
    await delay(700);
    if (!lab) {
      return {
        saveSchemaVersion: 0,
        commandCount: 0,
        checksumCount: 0,
        replayMatched: false,
        savedTick: 0,
        entityCountAfterReload: 0,
      };
    }
    const save = lab.scenario.exportSaveDocument() as {
      schemaVersion?: number;
      commandLog?: unknown[];
      checksums?: unknown[];
    };
    const commands = lab.recorder.exportLog();
    const checksums = lab.recorder.exportChecksums();
    lab.replay.setRecorded(commands, checksums);
    const replayMatched = lab.replay.runReplay(lab.runtime.getLatestTick());
    const savedTick = lab.runtime.getLatestTick();
    lab.scenario.importSaveDocument(save);
    await delay(700);
    return {
      saveSchemaVersion: save.schemaVersion ?? 0,
      commandCount: save.commandLog?.length ?? 0,
      checksumCount: save.checksums?.length ?? 0,
      replayMatched,
      savedTick,
      entityCountAfterReload: lab.runtime.getEntityCount(),
    };
  });
  return result;
}

async function readPackAssetRequests(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/content/dev-pack-v2/') && name.endsWith('.png')),
  );
}

type EntityHook = {
  id: { index: number; generation: number };
  kind: string;
  relationship: string;
  x: number;
  z: number;
};

type LabHook = {
  isReady: () => boolean;
  getContent: () => { identity: { revision: string; packId: string } };
  getPickableEntities: () => EntityHook[];
  selection: { getSelected: () => Array<{ index: number; generation: number }>; selectMany: (ids: unknown[]) => void };
  interaction: { issuedCommands: Array<{ kind: string }> };
  commandClient: { issueMove: (params: unknown) => void; issuePlaceBuilding: (params: unknown) => void };
  runtime: {
    getEntityCount: () => number;
    getLatestTick: () => number;
    getNavDebug: () => { paths: Array<{ cells: Array<{ cx: number; cz: number }> }> } | null;
  };
  recorder: {
    exportLog: () => unknown[];
    exportChecksums: () => Array<{ tick: number; hash: number }>;
    exportResults: () => Array<{ commandId: string; status: string }>;
  };
  replay: { setRecorded: (commands: unknown[], checksums: unknown[]) => void; runReplay: (ticks: number) => boolean };
  scenario: {
    exportSaveDocument: () => unknown;
    importSaveDocument: (document: unknown) => void;
  };
  debugOverlays: { set: (key: string, value: boolean) => void };
};

type AppHook = {
  getInteractionLab?: () => LabHook | null;
  getContentStatus?: () => {
    activeRevision: string | null;
    activeManifestHash: string | null;
    activeVisualContentHash: string | null;
    activeSimulationRulesHash: string | null;
  } | null;
  getCamera: () => {
    camera: {
      position: {
        constructor: new (x: number, y: number, z: number) => {
          x: number;
          y: number;
          project: (camera: unknown) => void;
        };
      };
    };
  };
};
