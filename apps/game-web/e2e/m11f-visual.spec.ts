import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { seedFor } from '../src/qa/deterministicSeeds';
import { routeIsolatedContent } from './support/isolated-content';
import { observeBrowser } from './support/browser-evidence';

const labUrl = `/?mode=interaction-lab&seed=${String(seedFor('interactionLab'))}&renderer=webgl&dpr=1&zoom=70-percent`;
const artifactDir = process.env['M11F_ARTIFACT_DIR'] ?? '/tmp/pastel-m11f-artifacts';
process.env['M11C_ARTIFACT_DIR'] = artifactDir;

test('M1.1-F captures original-art interaction lab at both acceptance viewports', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const evidence = observeBrowser(page, testInfo, 'm11f-original-art');
  await routeIsolatedContent(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1194, height: 834 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(labUrl, { waitUntil: 'networkidle' });
    await waitForLab(page);
    await expect(page.locator('.pastel-match-hud')).toBeVisible();
    await expect(page.locator('.pastel-minimap')).toBeVisible();
    await expect(page.locator('.pastel-lab-tools')).toBeVisible();
    await assertVisibleInViewport(page, '.pastel-match-hud', viewport);
    await assertVisibleInViewport(page, '.pastel-minimap', viewport);
    await assertVisibleInViewport(page, '.pastel-lab-tools', viewport);
    await evidence.capture(`original-art-${String(viewport.width)}x${String(viewport.height)}`, {
      fixture: 'content/dev-pack-v2 original PNGs',
      viewport,
      review: 'Engineering visual-regression capture only. No snapshot rebaseline is performed by this test.',
    });
    const hudBox = await page.locator('.pastel-match-hud').boundingBox();
    expect(hudBox).not.toBeNull();
    if (hudBox) {
      await page.screenshot({
        path: join(artifactDir, `m11f-army-rail-${String(viewport.width)}x${String(viewport.height)}.png`),
        clip: hudBox,
      });
    }
  }
});

type InteractionLabHandle = {
  isReady: () => boolean;
  runtime: { getEntityCount: () => number };
};

type LabWindow = Window & {
  getInteractionLab?: () => InteractionLabHandle | undefined;
  __pastelApp?: { getInteractionLab?: () => InteractionLabHandle | undefined };
};

async function waitForLab(page: Page): Promise<void> {
  await page.waitForSelector('#game-canvas');
  await page.waitForFunction(
    () => {
      const labWindow = window as LabWindow;
      const lab = labWindow.getInteractionLab?.() ?? labWindow.__pastelApp?.getInteractionLab?.();
      return Boolean(lab?.isReady() && lab.runtime.getEntityCount() > 8);
    },
    undefined,
    { timeout: 20_000 },
  );
}

async function assertVisibleInViewport(
  page: Page,
  selector: string,
  viewport: { width: number; height: number },
): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} must be visible at ${String(viewport.width)}×${String(viewport.height)}`).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
}
