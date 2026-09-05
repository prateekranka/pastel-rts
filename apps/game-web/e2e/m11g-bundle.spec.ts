import { test, expect, type Page } from '@playwright/test';
import { computeContentHash } from '@pastel-rts/content-schema';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { routeIsolatedContent } from './support/isolated-content';

const gamePort = Number(process.env['PLAYWRIGHT_GAME_PORT'] ?? 4173);
const labUrl = '/?mode=interaction-lab&seed=42&renderer=webgl&dpr=1&zoom=70-percent';
const gameOrigin = `http://127.0.0.1:${String(gamePort)}`;
const artifactDir = resolve(
  process.env['M11G_ARTIFACT_DIR'] ?? 'docs/roadmap/M1.1-G-artifacts',
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
  test('exports, imports in a fresh context, and matches the exact checksum sequence', async ({
    page,
    browser,
  }) => {
    const sourceErrors = collectBrowserErrors(page);
    await preparePage(page);
    await page.goto(labUrl, { waitUntil: 'networkidle' });
    await waitForLab(page);
    await page.waitForTimeout(800);

    const before = await readActiveState(page);
    const bundle = await exportBundle(page, 'm11g-exported-bundle.json');
    const bundleContent = bundle['content'] as Record<string, unknown>;
    const bundleIdentity = bundle['identity'] as Record<string, unknown>;
    const bundleReplay = bundle['replay'] as Record<string, unknown>;
    const bundleTickRange = bundleReplay['tickRange'] as Record<string, unknown>;
    const bundleEndTick = bundleTickRange['endTick'] as number;
    expect(bundle['kind']).toBe('qa-bug-bundle');
    expect(bundleContent['assetCoverage']).toBe('json-only');
    expect(bundleContent['assetHashes']).toEqual([]);
    expect(bundleIdentity['revision']).toBe(before.revision);
    expect(bundleReplay['commands']).toBeTruthy();
    expect(bundleReplay['checksums']).toBeTruthy();

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
        join(artifactDir, 'm11g-exported-bundle.json'),
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
      expect(replayEvidence.expected).toEqual(bundleReplay['checksums']);
      expect(replayEvidence.actual).toEqual(bundleReplay['checksums']);
      expect(replayEvidence.state.revision).toBe(bundleIdentity['revision']);
      expect(replayEvidence.state.contentHash).toBe(bundleIdentity['contentHash']);
      expect(replayEvidence.state.scenarioId).toBe(bundleIdentity['scenarioId']);
      expect(replayEvidence.state.seed).toBe(bundleReplay['seed']);

      const screenshotPath = join(artifactDir, 'm11g-fresh-page-reproduced.png');
      await freshPage.screenshot({ path: screenshotPath });
      const commandOutputPath = join(artifactDir, 'm11g-export-import-evidence.json');
      writeFileSync(
        commandOutputPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            sourcePageState: before,
            bundlePath: join(artifactDir, 'm11g-exported-bundle.json'),
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
    const bundle = await exportBundle(page, 'm11g-bundle-before-tamper.json');
    const content = bundle['content'] as Record<string, unknown>;
    const pack = content['pack'] as Record<string, unknown>;
    const identity = bundle['identity'] as Record<string, unknown>;
    pack['revision'] = '999';
    pack['contentHash'] = computeContentHash(pack);
    identity['revision'] = '999';
    identity['packHash'] = pack['contentHash'];
    identity['contentHash'] = pack['contentHash'];
    const tamperedPath = join(artifactDir, 'm11g-historical-revision-bundle.json');
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

    const screenshotPath = join(artifactDir, 'm11g-historical-revision-rejected.png');
    await page.screenshot({ path: screenshotPath });
    const commandOutputPath = join(artifactDir, 'm11g-rejection-evidence.json');
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
  expectedChecksums: Array<{ tick: number; hash: number }>;
};

declare global {
  interface Window {
    getInteractionLab?: () => LabHook | null;
    __pastelApp?: {
      getInteractionLab?: () => LabHook | null;
    };
  }
}

type LabHook = {
  isReady: () => boolean;
  runtime: { getEntityCount: () => number };
  scenario: {
    getReplayToTick: () => number;
  };
  replay: {
    getLastExpected: () => Array<{ tick: number; hash: number }>;
    getLastActual: () => Array<{ tick: number; hash: number }>;
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
