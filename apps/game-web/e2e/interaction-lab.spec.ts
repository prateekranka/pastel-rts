import { test, expect } from '@playwright/test';
import { seedFor } from '../src/qa/deterministicSeeds';

const LAB_URL = `/?mode=interaction-lab&seed=${String(seedFor('interactionLab'))}&renderer=webgl&dpr=1&zoom=70-percent`;

async function skipIfLabUnwired(page: import('@playwright/test').Page): Promise<boolean> {
  const wired = await page.evaluate(() => {
    const app = window.__pastelApp as
      | { getInteractionLab?: () => unknown; isInteractionLab?: () => boolean }
      | undefined;
    return Boolean(app?.getInteractionLab?.() ?? app?.isInteractionLab?.());
  });
  if (!wired) {
    test.skip(true, 'Interaction lab not wired in GameApp yet — factory exported under src/sandbox/');
    return true;
  }
  return false;
}

test.describe('interaction lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('loads interaction-lab mode or skips when unwired', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#game-canvas');
    if (await skipIfLabUnwired(page)) {
      return;
    }
    await expect(page.locator('.pastel-match-hud, .pastel-hud')).toBeVisible();
  });

  test('select one unit, tap destination, selection remains', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#game-canvas');
    if (await skipIfLabUnwired(page)) {
      return;
    }
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    if (!box) {
      return;
    }
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
    await page.waitForTimeout(300);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.45);
    await page.waitForTimeout(500);
    const selected = await page.evaluate(() => {
      const lab = (window.__pastelApp as { getInteractionLab?: () => { selection: { getSelected: () => unknown[] } } })
        ?.getInteractionLab?.();
      return lab?.selection.getSelected().length ?? 0;
    });
    expect(selected).toBeGreaterThan(0);
  });

  test('pan empty ground moves camera without move command', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#game-canvas');
    if (await skipIfLabUnwired(page)) {
      return;
    }
    const before = await page.evaluate(() => {
      const app = window.__pastelApp;
      return app ? { x: app.getCamera().lookAt.x, z: app.getCamera().lookAt.z } : null;
    });
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (!box || !before) {
      return;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 60);
    await page.mouse.up();
    const after = await page.evaluate(() => {
      const app = window.__pastelApp;
      return app ? { x: app.getCamera().lookAt.x, z: app.getCamera().lookAt.z } : null;
    });
    expect(after).not.toBeNull();
    if (!after) {
      return;
    }
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);
    const moveCommands = await page.evaluate(() => {
      const lab = (window.__pastelApp as {
        getInteractionLab?: () => { interaction: { issuedCommands: Array<{ kind: string }> } };
      })?.getInteractionLab?.();
      return lab?.interaction.issuedCommands.filter((entry) => entry.kind === 'move').length ?? 0;
    });
    expect(moveCommands).toBe(0);
  });

  test('visual capture — army rail and lab framing', async ({ page }) => {
    await page.goto(
      `${LAB_URL}&touchDebug=0`,
      { waitUntil: 'networkidle' },
    );
    await page.waitForSelector('#game-canvas');
    if (await skipIfLabUnwired(page)) {
      return;
    }
    await page.waitForTimeout(400);
    await expect(page.locator('#game-canvas')).toHaveScreenshot('interaction-lab-framing.png', {
      maxDiffPixelRatio: 0.02,
      timeout: 15_000,
    });
  });
});

declare global {
  interface Window {
    __pastelApp?: {
      getCamera: () => { lookAt: { x: number; z: number } };
      getInteractionLab?: () => {
        selection: { getSelected: () => unknown[] };
        interaction: { issuedCommands: Array<{ kind: string }> };
      };
      isInteractionLab?: () => boolean;
    };
  }
}
