import { test, expect, type Page } from '@playwright/test';
import { computeContentHash } from '@pastel-rts/content-schema';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { routeIsolatedContent } from './support/isolated-content';

const gamePort = Number(process.env['PLAYWRIGHT_GAME_PORT'] ?? 4173);
const labUrl = '/?mode=interaction-lab&seed=42&renderer=webgl&dpr=1&zoom=70-percent';
const gameOrigin = `http://127.0.0.1:${String(gamePort)}`;
const artifactDir = resolve(
  process.env['M11G_ARTIFACT_DIR'] ?? 'docs/roadmap/M1.1-G2-artifacts',
);

mkdirSync(artifactDir, { recursive: true });

async function preparePage(page: Page): Promise<void> {
  await routeIsolatedContent(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function waitForLab(page: Page): Promise<void> {
  await page.waitForSelector('#game-canvas');
  await page.waitForFunction(
    () => {
      const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
      return Boolean(lab?.isReady() && lab.runtime.getEntityCount() > 8);
    },
    undefined,
    { timeout: 20_000 },
  );
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`);
  });
  return errors;
}

async function exportBundle(page: Page, filename: string): Promise<Record<string, unknown>> {
  const bundlePath = join(artifactDir, filename);
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Export bug bundle' }).click();
  const download = await downloadPromise;
  await download.saveAs(bundlePath);
  const parsed: unknown = JSON.parse(readFileSync(bundlePath, 'utf8')) as unknown;
  expect(parsed).toBeTruthy();
  expect(typeof parsed).toBe('object');
  return parsed as Record<string, unknown>;
}

async function clientPointForFriendlyUnit(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const app = window.__pastelApp;
    const lab = window.getInteractionLab?.() ?? app?.getInteractionLab?.();
    const unit = lab
      ?.getPickableEntities()
      .find((entity) => entity.kind === 'unit' && entity.relationship === 'friendly');
    const camera = app?.getCamera().camera;
    const canvas = document.querySelector('#game-canvas');
    if (!unit || !camera || !(canvas instanceof HTMLCanvasElement)) {
      return null;
    }
    const Vector3 = camera.position.constructor as new (x: number, y: number, z: number) => {
      x: number;
      y: number;
      project: (cam: typeof camera) => void;
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

async function readSelectedEntity(page: Page): Promise<{ x: number; z: number } | null> {
  return page.evaluate(() => {
    const app = window.__pastelApp;
    const lab = window.getInteractionLab?.() ?? app?.getInteractionLab?.();
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

async function exercisePointerMove(page: Page): Promise<PointerMoveEvidence> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error('Interaction-lab canvas has no client bounds');
  }
  const unitPoint = await clientPointForFriendlyUnit(page);
  expect(unitPoint).not.toBeNull();
  if (!unitPoint) {
    throw new Error('Interaction-lab has no projected friendly unit');
  }

  await page.mouse.click(unitPoint.x, unitPoint.y);
  await page.waitForFunction(
    () => {
      const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
      return (lab?.selection.getSelected().length ?? 0) > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
  const before = await readSelectedEntity(page);
  expect(before).not.toBeNull();
  if (!before) {
    throw new Error('Friendly unit selection did not expose a live entity');
  }

  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
  await page.waitForFunction(
    () => {
      const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
      if (!lab) {
        return false;
      }
      const moveIds = lab.recorder
        .exportLog()
        .filter((command) => command.payload.kind === 'move')
        .map((command) => command.commandId);
      const acceptedMove = lab.recorder.exportResults().some(
        (result) => moveIds.includes(result.commandId) && result.status === 'accepted',
      );
      return lab.interaction.issuedCommands.some((entry) => entry.kind === 'move') && acceptedMove;
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    (start) => {
      const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
      const selected = lab?.selection.getSelected()[0];
      const current = selected
        ? lab?.getPickableEntities().find(
            (entry) => entry.id.index === selected.index && entry.id.generation === selected.generation,
          )
        : undefined;
      return current !== undefined && Math.hypot(current.x - start.x, current.z - start.z) > 0.2;
    },
    before,
    { timeout: 15_000 },
  );

  const evidence = await page.evaluate(() => {
    const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
    if (!lab) {
      throw new Error('Interaction-lab hook disappeared after pointer move');
    }
    const sentCommands = lab.recorder.exportLog();
    const commandIds = new Set(sentCommands.map((command) => command.commandId));
    const observedCommandResults = lab.recorder
      .exportResults()
      .filter((result) => commandIds.has(result.commandId));
    const saved = lab.scenario.exportSaveDocument();
    const commands = saved.commandLog;
    const commandResults = saved.commandResults;
    const checksums = saved.checksums;
    const moveCommands = commands.filter((command) => command.payload.kind === 'move');
    const acceptedMoveResults = commandResults.filter((result) =>
      moveCommands.some((command) => command.commandId === result.commandId) && result.status === 'accepted',
    );
    return {
      sentCommands,
      observedCommandResults,
      commands,
      commandResults,
      checksums,
      moveCommands,
      acceptedMoveResults,
      issuedCommands: [...lab.interaction.issuedCommands],
      lastGestureLabel: lab.interaction.lastGestureLabel,
    };
  });
  const after = await readSelectedEntity(page);
  expect(after).not.toBeNull();
  if (!after) {
    throw new Error('Moved friendly unit was not readable after accepted move');
  }

  return {
    ...evidence,
    before,
    after,
    movedDistance: Math.hypot(after.x - before.x, after.z - before.z),
  };
}

async function readActiveState(page: Page): Promise<ActiveState> {
  return page.evaluate(() => {
    const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
    const diagnostics = lab?.getDiagnostics();
    const expected = lab?.replay.getLastExpected() ?? [];
    return {
      revision: diagnostics?.content.revision ?? null,
      contentHash: diagnostics?.content.contentHash ?? null,
      scenarioId: diagnostics?.scenarioId ?? null,
      seed: diagnostics?.seed ?? null,
      commandCount: diagnostics?.commandCount ?? null,
      checksumCount: diagnostics?.checksumCount ?? null,
      expectedChecksums: expected,
    };
  });
}

test.describe('M1.1-G runtime bug bundle', () => {
  test('exports a real pointer move, imports in a fresh context, and matches the exact checksum sequence', async ({
    page,
    browser,
  }) => {
    const sourceErrors = collectBrowserErrors(page);
    await preparePage(page);
    await page.goto(labUrl, { waitUntil: 'networkidle' });
    await waitForLab(page);
    await page.waitForTimeout(800);

    const before = await readActiveState(page);
    const pointerMove = await exercisePointerMove(page);
    expect(pointerMove.lastGestureLabel).toBe('tap-move');
    expect(pointerMove.issuedCommands.filter((entry) => entry.kind === 'move').length).toBeGreaterThan(0);
    expect(pointerMove.moveCommands.length).toBeGreaterThan(0);
    const acceptedMove = pointerMove.acceptedMoveResults[0];
    const sentMove = pointerMove.sentCommands.find((command) => command.payload.kind === 'move');
    const canonicalMove = pointerMove.moveCommands[0];
    expect(acceptedMove).toBeDefined();
    expect(sentMove).toBeDefined();
    expect(canonicalMove).toBeDefined();
    if (!acceptedMove || !sentMove || !canonicalMove) {
      throw new Error('Pointer move evidence is incomplete');
    }
    expect(canonicalMove.commandId).toBe(sentMove.commandId);
    expect(canonicalMove.sequence).toBe(sentMove.sequence);
    expect(canonicalMove.payload).toEqual(sentMove.payload);
    expect(acceptedMove.acceptedAtTick).toBeDefined();
    expect(canonicalMove.executeTick).toBe(acceptedMove.acceptedAtTick);
    expect(canonicalMove.executeTick).toBeGreaterThanOrEqual(sentMove.executeTick);
    expect(pointerMove.movedDistance).toBeGreaterThan(0.2);
    expect(pointerMove.commands.length).toBeGreaterThan(0);
    expect(pointerMove.commands.map((command) => command.sequence)).toEqual(
      pointerMove.commands.map((_, index) => index),
    );
    expect(pointerMove.checksums.length).toBeGreaterThan(1);
    expect(new Set(pointerMove.checksums.map((checksum) => checksum.hash)).size).toBeGreaterThan(1);

    const bundle = await exportBundle(page, 'm11g2-exported-bundle.json');
    const bundleContent = bundle['content'] as Record<string, unknown>;
    const bundleIdentity = bundle['identity'] as Record<string, unknown>;
    const bundleReplay = bundle['replay'] as Record<string, unknown>;
    const bundleTickRange = bundleReplay['tickRange'] as Record<string, unknown>;
    const bundleEndTick = bundleTickRange['endTick'] as number;
    const bundleCommands = bundleReplay['commands'] as RecordedCommand[];
    const bundleResults = bundleReplay['commandResults'] as RecordedResult[];
    const bundleChecksums = bundleReplay['checksums'] as StateChecksum[];
    expect(bundle['kind']).toBe('qa-bug-bundle');
    expect(bundleContent['assetCoverage']).toBe('json-only');
    expect(bundleContent['assetHashes']).toEqual([]);
    expect(bundleIdentity['revision']).toBe(before.revision);
    expect(bundleCommands.length).toBeGreaterThan(0);
    expect(bundleCommands).toEqual(pointerMove.commands);
    expect(bundleResults).toEqual(pointerMove.commandResults);
    expect(bundleReplay['commandLogLength']).toBe(pointerMove.commands.length);
    expect(bundleChecksums.length).toBeGreaterThan(1);
    expect(new Set(bundleChecksums.map((checksum) => checksum.hash)).size).toBeGreaterThan(1);
    expect(bundleCommands.map((command) => command.sequence)).toEqual(
      bundleCommands.map((_, index) => index),
    );
    const acceptedBundleMove = bundleResults.find(
      (result) =>
        bundleCommands.some(
          (command) => command.commandId === result.commandId && command.payload.kind === 'move',
        ) && result.status === 'accepted',
    );
    expect(acceptedBundleMove).toBeDefined();
    expect(bundleReplay['checksums']).toEqual(
      bundleChecksums,
    );
    expect(bundleChecksums.length).toBeGreaterThanOrEqual(pointerMove.checksums.length);
    expect(bundleChecksums.slice(0, pointerMove.checksums.length)).toEqual(pointerMove.checksums);

    const freshContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
    });
    try {
      const freshPage = await freshContext.newPage();
      const freshErrors = collectBrowserErrors(freshPage);
      await preparePage(freshPage);
      await freshPage.goto(`${gameOrigin}${labUrl}`, { waitUntil: 'networkidle' });
      await waitForLab(freshPage);
      await freshPage.locator('input[data-role="bug-import-file"]').setInputFiles(
        join(artifactDir, 'm11g2-exported-bundle.json'),
      );
      await expect(freshPage.locator('[data-role="status"]')).toContainText(
        'Bug bundle reproduced:',
        { timeout: 20_000 },
      );

      const replayEvidence = await freshPage.evaluate((endTick) => {
        const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
        if (!lab) {
          return null;
        }
        const expected = lab.replay.getLastExpected();
        const inspectorMatched = lab.replay.runReplay(endTick);
        const actual = lab.replay.getLastActual();
        const exact = actual.length === expected.length && actual.every(
          (entry, index) => entry.tick === expected[index]?.tick && entry.hash === expected[index]?.hash,
        );
        return {
          expected,
          actual,
          totalTicks: endTick,
          inspectorMatched,
          exact,
          state: {
            revision: lab.getDiagnostics().content.revision,
            contentHash: lab.getDiagnostics().content.contentHash,
            scenarioId: lab.getDiagnostics().scenarioId,
            seed: lab.getDiagnostics().seed,
          },
        };
      }, bundleEndTick);
      expect(replayEvidence).not.toBeNull();
      if (!replayEvidence) {
        return;
      }
      expect(replayEvidence.inspectorMatched).toBe(true);
      expect(replayEvidence.exact).toBe(true);
      expect(replayEvidence.expected).toEqual(bundleChecksums);
      expect(replayEvidence.actual).toEqual(bundleChecksums);
      expect(replayEvidence.expected.length).toBe(bundleChecksums.length);
      expect(replayEvidence.state.revision).toBe(bundleIdentity['revision']);
      expect(replayEvidence.state.contentHash).toBe(bundleIdentity['contentHash']);
      expect(replayEvidence.state.scenarioId).toBe(bundleIdentity['scenarioId']);
      expect(replayEvidence.state.seed).toBe(bundleReplay['seed']);

      const screenshotPath = join(artifactDir, 'm11g2-fresh-page-reproduced.png');
      await freshPage.screenshot({ path: screenshotPath });
      const commandOutputPath = join(artifactDir, 'm11g2-export-import-evidence.json');
      writeFileSync(
        commandOutputPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            sourcePageState: before,
            userInteraction: pointerMove,
            exportedBundle: {
              path: join(artifactDir, 'm11g2-exported-bundle.json'),
              commandCount: bundleCommands.length,
              commandResults: bundleResults,
              checksums: bundleChecksums,
              tickRange: bundleTickRange,
            },
            freshPageReplay: replayEvidence,
            screenshotPath,
            sourceBrowserErrors: sourceErrors,
            freshBrowserErrors: freshErrors,
          },
          null,
          2,
        ),
        'utf8',
      );
      expect(sourceErrors).toEqual([]);
      expect(freshErrors).toEqual([]);
    } finally {
      await freshContext.close();
    }
  });

  test('rejects a historical revision bundle and keeps the active scene intact', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await preparePage(page);
    await page.goto(labUrl, { waitUntil: 'networkidle' });
    await waitForLab(page);
    await page.waitForTimeout(500);

    const before = await readActiveState(page);
    const bundle = await exportBundle(page, 'm11g2-bundle-before-tamper.json');
    const content = bundle['content'] as Record<string, unknown>;
    const pack = content['pack'] as Record<string, unknown>;
    const identity = bundle['identity'] as Record<string, unknown>;
    pack['revision'] = '999';
    pack['contentHash'] = computeContentHash(pack);
    identity['revision'] = '999';
    identity['packHash'] = pack['contentHash'];
    identity['contentHash'] = pack['contentHash'];
    const tamperedPath = join(artifactDir, 'm11g2-historical-revision-bundle.json');
    writeFileSync(tamperedPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

    await page.locator('input[data-role="bug-import-file"]').setInputFiles(tamperedPath);
    await expect(page.locator('[data-role="status"]')).toContainText(
      'Bug bundle rejected: Bug bundle revision 999 is not active',
      { timeout: 20_000 },
    );
    const after = await readActiveState(page);
    expect(after.revision).toBe(before.revision);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.scenarioId).toBe(before.scenarioId);
    expect(after.seed).toBe(before.seed);
    expect(after.commandCount).toBe(before.commandCount);
    expect(after.expectedChecksums).toEqual(before.expectedChecksums);

    const screenshotPath = join(artifactDir, 'm11g2-historical-revision-rejected.png');
    await page.screenshot({ path: screenshotPath });
    const commandOutputPath = join(artifactDir, 'm11g2-rejection-evidence.json');
    writeFileSync(
      commandOutputPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          tamperedBundlePath: tamperedPath,
          before,
          after,
          screenshotPath,
          browserErrors: errors,
        },
        null,
        2,
      ),
      'utf8',
    );
    expect(errors).toEqual([]);
  });
});

type ActiveState = {
  revision: string | null;
  contentHash: string | null;
  scenarioId: string | null;
  seed: number | null;
  commandCount: number | null;
  checksumCount: number | null;
  expectedChecksums: StateChecksum[];
};

type StateChecksum = { tick: number; hash: number };

type RecordedCommand = {
  protocolVersion: number;
  commandId: string;
  sequence: number;
  issuedAtTick: number;
  executeTick: number;
  playerId: string;
  kind: string;
  payload: { kind: string; [key: string]: unknown };
};

type RecordedResult = {
  type: 'commandResult';
  commandId: string;
  status: 'accepted' | 'rejected';
  acceptedAtTick?: number;
  reason?: string;
  spawnedId?: { index: number; generation: number };
};

type EntityHook = {
  id: { index: number; generation: number };
  kind: string;
  relationship: string;
  x: number;
  z: number;
};

type SavedReplay = {
  commandLog: RecordedCommand[];
  commandResults: RecordedResult[];
  checksums: StateChecksum[];
};

type PointerMoveEvidence = {
  sentCommands: RecordedCommand[];
  observedCommandResults: RecordedResult[];
  commands: RecordedCommand[];
  commandResults: RecordedResult[];
  checksums: StateChecksum[];
  moveCommands: RecordedCommand[];
  acceptedMoveResults: RecordedResult[];
  issuedCommands: Array<{ kind: string; entityCount: number }>;
  lastGestureLabel: string | null;
  before: { x: number; z: number };
  after: { x: number; z: number };
  movedDistance: number;
};

declare global {
  interface Window {
    getInteractionLab?: () => LabHook | null;
    __pastelApp?: AppHook;
  }
}

type LabHook = {
  isReady: () => boolean;
  runtime: { getEntityCount: () => number };
  getPickableEntities: () => EntityHook[];
  selection: { getSelected: () => Array<{ index: number; generation: number }> };
  interaction: {
    issuedCommands: Array<{ kind: string; entityCount: number }>;
    lastGestureLabel: string | null;
  };
  recorder: {
    exportLog: () => RecordedCommand[];
    exportResults: () => RecordedResult[];
    exportChecksums: () => StateChecksum[];
  };
  scenario: {
    getReplayToTick: () => number;
    exportSaveDocument: () => SavedReplay;
  };
  replay: {
    getLastExpected: () => StateChecksum[];
    getLastActual: () => StateChecksum[];
    runReplay: (totalTicks: number) => boolean;
  };
  getDiagnostics: () => {
    content: { revision: string; contentHash: string };
    scenarioId: string | null;
    seed: number;
    commandCount: number;
    checksumCount: number;
  };
};

type AppHook = {
  getInteractionLab?: () => LabHook | null;
  getCamera: () => {
    camera: {
      position: {
        constructor: new (
          x: number,
          y: number,
          z: number,
        ) => {
          x: number;
          y: number;
          project: (camera: unknown) => void;
        };
      };
    };
  };
};
