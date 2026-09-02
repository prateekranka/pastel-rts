import { expect, test } from '@playwright/test';

const VISUAL_URL =
  '/?benchmark=visual-capture&seed=1&renderer=webgl&dpr=1&zoom=70-percent';

test.describe('battlefield visual regression', () => {
  test('captures a deterministic 70-percent WebGL view', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(VISUAL_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#game-canvas');
    await page.waitForFunction(() => (window.__pastelApp?.getEntities()?.getVisibleEntityCount() ?? 0) > 200);
    await page.waitForTimeout(200);
    await expect(page.locator('#game-canvas')).toHaveScreenshot('battlefield-70-percent.png', {
      timeout: 15_000,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('camera interaction', () => {
  test('mouse pan, wheel zoom, and diagnostics overlay', async ({ page }) => {
    await page.goto('/?benchmark=dense-battle&seed=1&renderer=webgl&dpr=1', {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('#game-canvas');
    await page.waitForSelector('.pastel-hud');
    await expect(page.locator('.pastel-hud')).toBeVisible();
    await expect(page.locator('.pastel-hud')).toContainText('Diagnostics');
    await expect(page.locator('.pastel-hud')).toContainText(/FPS/i);

    const before = await page.evaluate(() => {
      const app = window.__pastelApp;
      return app
        ? { x: app.getCamera().lookAt.x, z: app.getCamera().lookAt.z, zoom: app.getCamera().getVisibleCellsX() }
        : null;
    });
    expect(before).not.toBeNull();

    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    if (!box) {
      return;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 80);
    await page.mouse.up();

    const afterPan = await page.evaluate(() => {
      const app = window.__pastelApp;
      return app
        ? { x: app.getCamera().lookAt.x, z: app.getCamera().lookAt.z, zoom: app.getCamera().getVisibleCellsX() }
        : null;
    });
    expect(afterPan).not.toBeNull();
    if (!before || !afterPan) {
      return;
    }
    expect(Math.hypot(afterPan.x - before.x, afterPan.z - before.z)).toBeGreaterThan(2);

    await canvas.evaluate((el) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(250);
    const afterZoom = await page.evaluate(() => window.__pastelApp?.getCamera().getVisibleCellsX() ?? 0);
    expect(afterZoom).toBeLessThan(before.zoom - 5);
  });
});
