import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { REQUIRED_PERFORMANCE_REPORT_KEYS } from '../src/diagnostics/report';

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
    await expect(page.locator('.pastel-hud')).toContainText(/1% low/i);
    await expect(page.locator('.pastel-hud')).toContainText(/p95/i);
    await expect(page.locator('.pastel-hud')).toContainText(/p99/i);
    await expect(page.locator('.pastel-hud')).toContainText(/draw calls/i);
    await expect(page.locator('.pastel-hud')).toContainText(/snapshot latency/i);
    await expect(page.locator('.pastel-hud')).toContainText(/viewport/i);
    await expect(page.locator('.pastel-hud')).toContainText(/DPR/i);
    await expect(page.locator('.pastel-hud')).toContainText(/chunks/i);
    await expect(page.locator('.pastel-hud')).toContainText(/renderer/i);

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

    const wheelPrevented = await canvas.evaluate((el) => {
      const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(wheelPrevented).toBe(true);

    await canvas.evaluate((el) => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(250);
    const afterZoom = await page.evaluate(() => window.__pastelApp?.getCamera().getVisibleCellsX() ?? 0);
    expect(afterZoom).toBeLessThan(before.zoom - 5);

    await page.getByRole('button', { name: 'Collapse' }).click();
    await expect(page.getByRole('button', { name: 'Expand' })).toBeVisible();
  });
});

test.describe('touch debug, WebGPU fallback, pause, soak', () => {
  test('optional touch-debug overlay is addressable', async ({ page }) => {
    await page.goto('/?benchmark=idle-base&seed=1&renderer=webgl&dpr=1&touchDebug=1', {
      waitUntil: 'networkidle',
    });
    await expect(page.locator('.pastel-touch-debug')).toBeVisible();
    await expect(page.locator('.pastel-touch-debug')).toContainText(/gesture:/);
  });

  test('WebGPU request falls back and still renders', async ({ page }) => {
    await page.goto('/?benchmark=idle-base&seed=1&renderer=webgpu&dpr=1', {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('#game-canvas');
    await expect(page.locator('.pastel-hud')).toContainText(/requested webgpu/i);
    const ready = await page.evaluate(() => Boolean(window.__pastelApp?.getRenderer()));
    expect(ready).toBe(true);
  });

  test('native pause/resume does not leap the simulation', async ({ page }) => {
    await page.goto('/?benchmark=idle-base&seed=1&renderer=webgl&dpr=1', {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => (window.__pastelApp?.getSim().getLatestTick() ?? 0) > 4);
    const before = await page.evaluate(() => window.__pastelApp?.getSim().getLatestTick() ?? 0);
    await page.evaluate(() => {
      window.__pastelNative?.postMessage({ type: 'pause' });
    });
    await expect.poll(async () => page.evaluate(() => window.__pastelApp?.isPaused() ?? false)).toBe(true);
    await page.waitForTimeout(600);
    const paused = await page.evaluate(() => window.__pastelApp?.getSim().getLatestTick() ?? 0);
    expect(paused - before).toBeLessThan(3);
    await page.evaluate(() => {
      window.__pastelNative?.postMessage({ type: 'resume' });
    });
    await expect.poll(async () => page.evaluate(() => window.__pastelApp?.isPaused() ?? true)).toBe(false);
    await page.waitForFunction((tick) => (window.__pastelApp?.getSim().getLatestTick() ?? 0) > tick, paused);
  });

  test('matching native developer config does not reload', async ({ page }) => {
    await page.goto('/?benchmark=idle-base&seed=1&renderer=webgl&dpr=1.5', {
      waitUntil: 'networkidle',
    });
    const before = page.url();
    await page.evaluate(() => {
      window.__pastelNative?.postMessage({
        type: 'setDeveloperConfiguration',
        payload: { renderer: 'webgl', haptics: true },
      });
    });
    await page.waitForTimeout(400);
    expect(page.url()).toBe(before);
  });

  test('short soak exports JSON with required fields and moves the camera', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download', { timeout: 25_000 });
    await page.goto('/?benchmark=20-minute-soak&soakMs=3000&seed=1&renderer=webgl&dpr=1', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#game-canvas');
    const startLook = await page.evaluate(() => {
      const look = window.__pastelApp?.getCamera().lookAt;
      return look ? { x: look.x, z: look.z } : null;
    });
    await page.waitForTimeout(1200);
    const moved = await page.evaluate((start) => {
      const look = window.__pastelApp?.getCamera().lookAt;
      if (!look || !start) {
        return 0;
      }
      return Math.hypot(look.x - start.x, look.z - start.z);
    }, startLook);
    expect(moved).toBeGreaterThan(1);

    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const report = JSON.parse(readFileSync(path ?? '', 'utf8')) as Record<string, unknown>;
    for (const key of REQUIRED_PERFORMANCE_REPORT_KEYS) {
      expect(report).toHaveProperty(key);
    }
    expect(report['physicalValidationStatus']).toBe('awaiting-physical-validation');
    expect(report['autoCameraMotion']).toBe(true);
    expect(report['benchmark']).toBe('20-minute-soak');
    expect(typeof report['userAgent']).toBe('string');
    expect(report['viewport']).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  });
});
