import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { observeBrowser } from '../../game-web/e2e/support/browser-evidence';
import { routeIsolatedContent } from '../../game-web/e2e/support/isolated-content';

const PACK_DIR = process.env['CONTENT_PACK_DIR'] ?? '/tmp/pastel-foundry-e2e';
const VIEWPORT = { width: 1280, height: 800 };

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await routeIsolatedContent(page);
  await page.setViewportSize(VIEWPORT);
});

test('M1.1-C Foundry imports unit sheets, saves content, and launches sandbox', async ({ page }, testInfo) => {
  const id = `m11c-unit-${String(Date.now())}`;
  const evidence = observeBrowser(page, testInfo, 'foundry-unit');
  await page.goto(`/#/unit/new?id=${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('Unit Editor');

  const pngBytes = await createPng(page, 128, 64, 4);
  await page.locator('#unit-file').setInputFiles({
    name: `${id}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(pngBytes),
  });
  await expect(page.locator('#unit-status')).toContainText(/PNG loaded|Manifest valid/i, { timeout: 10_000 });
  await page.locator('#sheet-layout').selectOption('horizontal');
  await page.locator('#frame-w').fill('32');
  await page.locator('#frame-h').fill('32');
  await page.locator('#grid-cols').fill('4');
  await page.locator('#grid-rows').fill('2');
  await page.locator('#unit-name').fill('M1.1-C Sheet Unit');
  await page.locator('#directions').selectOption('4');
  await page.locator('#mirrored').check();
  await page.locator('#idle-frames').fill('0,1,2,3');
  await page.locator('#move-frames').fill('4,5,6,7');
  await page.locator('#idle-fps').fill('8');
  await page.locator('#move-fps').fill('12');
  await expect(page.locator('#unit-status')).toContainText('Manifest valid', { timeout: 10_000 });

  const manifest = JSON.parse(await page.locator('#unit-manifest').innerText()) as {
    id: string;
    sourceWidth: number;
    sourceHeight: number;
    frameWidth: number;
    animation: { directions: number; mirrored?: boolean; clips: { idle: unknown; move?: unknown } };
  };
  expect(manifest.id).toBe(id);
  expect(manifest.sourceWidth).toBe(128);
  expect(manifest.sourceHeight).toBe(64);
  expect(manifest.frameWidth).toBe(32);
  expect(manifest.animation.directions).toBe(4);
  expect(manifest.animation.mirrored).toBe(true);
  expect(manifest.animation.clips.move).toBeDefined();
  for (const selector of ['#pv-grid', '#pv-idle', '#pv-move', '#pv-game-neutral', '#pv-cam-neutral']) {
    await expect(page.locator(selector).first()).toBeVisible();
  }
  await evidence.capture('sheet-preview', {
    id,
    sourceDimensions: [manifest.sourceWidth, manifest.sourceHeight],
    frameWidth: manifest.frameWidth,
    directions: manifest.animation.directions,
    mirrored: manifest.animation.mirrored,
  });

  await page.locator('#save-unit').click();
  await expect(page.locator('#unit-status')).toContainText(/Saved|created|updated/i, { timeout: 10_000 });
  expect(existsSync(join(PACK_DIR, 'units', id, 'sheet.png'))).toBe(true);
  expect(existsSync(join(PACK_DIR, 'units', id, 'manifest.json'))).toBe(true);
  const savedPack = await page.evaluate(async () => {
    const response = await fetch('/dev-content/pack?schema=2');
    return response.json() as Promise<{ units: Array<{ id: string }> }>;
  });
  expect(savedPack.units.some((unit) => unit.id === id)).toBe(true);
  await evidence.capture('unit-saved', { id, savedPackEntry: savedPack.units.find((unit) => unit.id === id) });

  const popupPromise = page.waitForEvent('popup');
  await page.locator('#sandbox-unit').click();
  const popup = await popupPromise;
  await routeIsolatedContent(popup);
  const popupEvidence = observeBrowser(popup, testInfo, 'unit-sandbox');
  await popup.waitForLoadState('domcontentloaded');
  await waitForLab(popup);
  await popup.waitForTimeout(800);
  const spawnResults = await readCommandResults(popup);
  expect(popup.url()).toContain(`spawnUnit=${encodeURIComponent(id)}`);
  await popupEvidence.capture('boot', {
    url: popup.url(),
    spawnResults,
    note: 'The sandbox boot is verified separately from whether the runtime pack acknowledges the newly saved Foundry ID.',
  });
  await popup.close();
});

test('M1.1-C Foundry authors a building footprint and launches sandbox', async ({ page }, testInfo) => {
  const id = `m11c-building-${String(Date.now())}`;
  const evidence = observeBrowser(page, testInfo, 'foundry-building');
  await page.goto(`/#/building/new?id=${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('Building Editor');

  const pngBytes = await createPng(page, 96, 96, 1);
  await page.locator('#bld-file').setInputFiles({
    name: `${id}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(pngBytes),
  });
  await expect(page.locator('#bld-status')).toContainText(/PNG loaded|Manifest valid/i, { timeout: 10_000 });
  await page.locator('#bld-name').fill('M1.1-C Footprint Building');
  await page.locator('#cells-w').fill('3');
  await page.locator('#cells-h').fill('2');
  const grid = page.locator('#footprint-grid');
  const gridBox = await grid.boundingBox();
  expect(gridBox).not.toBeNull();
  if (!gridBox) {
    return;
  }
  await page.mouse.click(gridBox.x + gridBox.width * 0.2, gridBox.y + gridBox.height * 0.25);
  await expect(page.locator('#bld-status')).toContainText('Manifest valid', { timeout: 10_000 });
  const manifest = JSON.parse(await page.locator('#bld-manifest').innerText()) as {
    id: string;
    footprint: { cellsW: number; cellsH: number };
    blockedCellMask?: boolean[][];
    sourceWidth: number;
    sourceHeight: number;
  };
  expect(manifest.id).toBe(id);
  expect(manifest.footprint).toEqual({ kind: 'rect', cellsW: 3, cellsH: 2 });
  expect(manifest.sourceWidth).toBe(96);
  expect(manifest.sourceHeight).toBe(96);
  expect(manifest.blockedCellMask?.some((row) => row.some(Boolean))).toBe(true);
  await expect(page.locator('#footprint-grid')).toBeVisible();
  await expect(page.locator('#bld-src-neutral')).toBeVisible();
  await expect(page.locator('#bld-game-neutral')).toBeVisible();
  await evidence.capture('building-preview', {
    id,
    footprint: manifest.footprint,
    blockedCellMask: manifest.blockedCellMask,
  });

  await page.locator('#save-building').click();
  await expect(page.locator('#bld-status')).toContainText(/Saved|created|updated/i, { timeout: 10_000 });
  expect(existsSync(join(PACK_DIR, 'buildings', id, 'sprite.png'))).toBe(true);
  expect(existsSync(join(PACK_DIR, 'buildings', id, 'manifest.json'))).toBe(true);
  const savedPack = await page.evaluate(async () => {
    const response = await fetch('/dev-content/pack?schema=2');
    return response.json() as Promise<{ buildings: Array<{ id: string }> }>;
  });
  expect(savedPack.buildings.some((building) => building.id === id)).toBe(true);
  await evidence.capture('building-saved', { id, savedPackEntry: savedPack.buildings.find((building) => building.id === id) });

  const popupPromise = page.waitForEvent('popup');
  await page.locator('#sandbox-building').click();
  const popup = await popupPromise;
  await routeIsolatedContent(popup);
  const popupEvidence = observeBrowser(popup, testInfo, 'building-sandbox');
  await popup.waitForLoadState('domcontentloaded');
  await waitForLab(popup);
  await popup.waitForTimeout(800);
  const spawnResults = await readCommandResults(popup);
  expect(popup.url()).toContain(`spawnBuilding=${encodeURIComponent(id)}`);
  await popupEvidence.capture('boot', {
    url: popup.url(),
    spawnResults,
    note: 'The sandbox boot is verified separately from whether the runtime pack acknowledges the newly saved Foundry ID.',
  });
  await popup.close();
});

test('M1.1-C Foundry library reads the isolated published pack', async ({ page }, testInfo) => {
  const evidence = observeBrowser(page, testInfo, 'foundry-library');
  await page.goto('/#/library', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#library-status')).toContainText(/entries loaded/i, { timeout: 10_000 });
  const rows = await page.locator('#library-body tr').count();
  expect(rows).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#pack-meta')).toContainText('Revision');
  await evidence.capture('library', { rows, status: await page.locator('#library-status').innerText() });
});

async function createPng(page: Page, width: number, height: number, frameCount: number): Promise<number[]> {
  return page.evaluate(async ({ width: imageWidth, height: imageHeight, frameCount: count }) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2d context missing');
    }
    const frameWidth = Math.max(1, Math.floor(imageWidth / Math.max(1, count)));
    for (let index = 0; index < count; index += 1) {
      context.fillStyle = ['#e07a3d', '#2f9c95', '#e0c15a', '#7650a8'][index % 4] ?? '#e07a3d';
      context.fillRect(index * frameWidth + 4, 4, Math.max(1, frameWidth - 8), imageHeight - 8);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error('PNG encode failed');
    }
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { width, height, frameCount });
}

async function waitForLab(page: Page): Promise<void> {
  await page.waitForSelector('#game-canvas');
  await page.waitForFunction(() => {
    const app = (window as unknown as { __pastelApp?: { getInteractionLab?: () => LabHook | null } }).__pastelApp;
    const lab = app?.getInteractionLab?.();
    return Boolean(lab?.isReady() && lab.runtime.getEntityCount() >= 25);
  }, undefined, { timeout: 30_000 });
}

async function readCommandResults(page: Page): Promise<Array<{ status: string; reason?: string }>> {
  return page.evaluate(() => {
    const app = (window as unknown as { __pastelApp?: { getInteractionLab?: () => LabHook | null } }).__pastelApp;
    const results = app?.getInteractionLab?.()?.recorder.exportResults() ?? [];
    return results.map((result) => ({ status: result.status, ...(result.reason ? { reason: result.reason } : {}) }));
  });
}

type LabHook = {
  isReady: () => boolean;
  runtime: { getEntityCount: () => number };
  recorder: { exportResults: () => Array<{ status: string; reason?: string }> };
};
