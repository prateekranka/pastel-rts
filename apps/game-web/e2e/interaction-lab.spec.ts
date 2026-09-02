import { test, expect } from '@playwright/test';
import { seedFor } from '../src/qa/deterministicSeeds';

const LAB_URL = `/?mode=interaction-lab&seed=${String(seedFor('interactionLab'))}&renderer=webgl&dpr=1&zoom=70-percent`;

async function waitForLab(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('#game-canvas');
  await page.waitForFunction(() => {
    const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
    return Boolean(lab?.isReady() && lab.runtime.getEntityCount() > 8);
  }, { timeout: 20_000 });
}

test.describe('interaction lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('loads interaction-lab mode with army rail', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await waitForLab(page);
    await expect(page.locator('.pastel-match-hud')).toBeVisible();
    await expect(page.locator('.pastel-minimap')).toBeVisible();
    await expect(page.locator('.pastel-lab-tools')).toBeVisible();
  });

  test('select one unit, tap destination, selection remains', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await waitForLab(page);
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    if (!box) {
      return;
    }
    // Click near look-at (first scenario unit ~16,20), away from lab tools overlay.
    await page.mouse.click(box.x + box.width * 0.48, box.y + box.height * 0.52);
    await page.waitForTimeout(250);
    const selectedBefore = await page.evaluate(() => {
      const lab = window.__pastelApp?.getInteractionLab?.();
      return lab?.selection.getSelected().length ?? 0;
    });
    expect(selectedBefore).toBeGreaterThan(0);
    const before = await page.evaluate(() => {
      const lab = window.__pastelApp?.getInteractionLab?.();
      const selected = lab?.selection.getSelected()[0];
      const entity = lab?.getPickableEntities().find(
        (entry) => entry.id.index === selected?.index && entry.id.generation === selected?.generation,
      );
      return entity ? { x: entity.x, z: entity.z } : null;
    });
    await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const lab = window.__pastelApp?.getInteractionLab?.();
      const selected = lab?.selection.getSelected()[0];
      const entity = lab?.getPickableEntities().find(
        (entry) => entry.id.index === selected?.index && entry.id.generation === selected?.generation,
      );
      return {
        selected: lab?.selection.getSelected().length ?? 0,
        pos: entity ? { x: entity.x, z: entity.z } : null,
        moves: lab?.interaction.issuedCommands.filter((entry) => entry.kind === 'move').length ?? 0,
      };
    });
    expect(after.selected).toBeGreaterThan(0);
    expect(after.moves).toBeGreaterThan(0);
    if (before && after.pos) {
      expect(Math.hypot(after.pos.x - before.x, after.pos.z - before.z)).toBeGreaterThan(0.2);
    }
  });

  test('pan empty ground moves camera without move command', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await waitForLab(page);
    const before = await page.evaluate(() => {
      const app = window.__pastelApp;
      const lab = app?.getInteractionLab?.();
      return app
        ? {
            x: app.getCamera().lookAt.x,
            z: app.getCamera().lookAt.z,
            moves: lab?.interaction.issuedCommands.filter((entry) => entry.kind === 'move').length ?? 0,
          }
        : null;
    });
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    if (!box || !before) {
      return;
    }
    await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.62);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.78 - 160, box.y + box.height * 0.62 - 90);
    await page.mouse.up();
    const after = await page.evaluate(() => {
      const app = window.__pastelApp;
      const lab = app?.getInteractionLab?.();
      return app
        ? {
            x: app.getCamera().lookAt.x,
            z: app.getCamera().lookAt.z,
            moves: lab?.interaction.issuedCommands.filter((entry) => entry.kind === 'move').length ?? 0,
          }
        : null;
    });
    expect(after).not.toBeNull();
    if (!after) {
      return;
    }
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);
    expect(after.moves).toBe(before.moves);
  });

  test('group formation destinations are distinct', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await waitForLab(page);
    const distinct = await page.evaluate(async () => {
      const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
      if (!lab) {
        return false;
      }
      const friendlies = lab
        .getPickableEntities()
        .filter((entity) => entity.kind === 'unit' && entity.relationship === 'friendly')
        .slice(0, 6);
      lab.selection.selectMany(friendlies.map((entity) => entity.id));
      lab.debugOverlays.set('paths', true);
      const dest = { x: 40 * 1024, z: 28 * 1024 };
      lab.commandClient.issueMove({
        entityIds: friendlies.map((entity) => entity.id),
        destination: dest,
        issuedAtTick: lab.runtime.getLatestTick(),
        executeTick: lab.runtime.getLatestTick(),
        formation: { kind: 'line', spacingSubunits: 512 },
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const debug = lab.runtime.getNavDebug();
      const goals = new Set(
        (debug?.paths ?? []).map((path) => {
          const last = path.cells[path.cells.length - 1];
          return last ? `${String(last.cx)},${String(last.cz)}` : '';
        }),
      );
      return goals.size >= 2;
    });
    expect(distinct).toBe(true);
  });

  test('building placement replans moving units', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await waitForLab(page);
    const replanned = await page.evaluate(async () => {
      const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
      if (!lab) {
        return false;
      }
      const friendlies = lab
        .getPickableEntities()
        .filter((entity) => entity.kind === 'unit' && entity.relationship === 'friendly')
        .slice(0, 4);
      lab.selection.selectMany(friendlies.map((entity) => entity.id));
      lab.debugOverlays.set('paths', true);
      lab.commandClient.issueMove({
        entityIds: friendlies.map((entity) => entity.id),
        destination: { x: 70 * 1024, z: 45 * 1024 },
        issuedAtTick: lab.runtime.getLatestTick(),
        executeTick: lab.runtime.getLatestTick(),
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const beforePaths = lab.runtime.getNavDebug()?.paths ?? [];
      const before = JSON.stringify(beforePaths);
      const mid = beforePaths[0]?.cells[Math.floor((beforePaths[0]?.cells.length ?? 1) / 2)];
      const originCell = mid ?? { cx: 28, cz: 22 };
      lab.commandClient.issuePlaceBuilding({
        archetypeId: 'sunweaver-sanctum',
        originCell,
        issuedAtTick: lab.runtime.getLatestTick(),
        executeTick: lab.runtime.getLatestTick(),
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
      const after = JSON.stringify(lab.runtime.getNavDebug()?.paths ?? []);
      return before !== after && before.length > 2;
    });
    expect(replanned).toBe(true);
  });

  test('replay checksums match the recorded sequence', async ({ page }) => {
    await page.goto(LAB_URL, { waitUntil: 'networkidle' });
    await waitForLab(page);
    const matched = await page.evaluate(async () => {
      const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
      if (!lab) {
        return { ok: false, checksums: 0 };
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      const commands = lab.recorder.exportLog();
      const checksums = [...lab.runtime.getChecksums()];
      lab.replay.setRecorded(commands, checksums);
      return {
        ok: checksums.length > 0 && lab.replay.runReplay(lab.runtime.getLatestTick()),
        checksums: checksums.length,
      };
    });
    expect(matched.checksums).toBeGreaterThan(0);
    expect(matched.ok).toBe(true);
  });

  test('visual capture — army rail and lab framing', async ({ page }) => {
    await page.goto(`${LAB_URL}&touchDebug=0`, { waitUntil: 'networkidle' });
    await waitForLab(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#game-canvas')).toHaveScreenshot('interaction-lab-framing.png', {
      maxDiffPixelRatio: 0.02,
      timeout: 15_000,
      mask: [page.locator('.pastel-hud')],
    });
    await expect(page.locator('.pastel-match-hud')).toHaveScreenshot('interaction-lab-army-rail.png', {
      maxDiffPixelRatio: 0.02,
      timeout: 15_000,
    });
  });
});

declare global {
  interface Window {
    getInteractionLab?: () => LabHook | null;
    __pastelApp?: {
      getCamera: () => { lookAt: { x: number; z: number } };
      getInteractionLab?: () => LabHook | null;
    };
  }
}

type LabHook = {
  isReady: () => boolean;
  selection: {
    getSelected: () => Array<{ index: number; generation: number }>;
    selectMany: (ids: Array<{ index: number; generation: number }>) => void;
  };
  interaction: { issuedCommands: Array<{ kind: string }> };
  getPickableEntities: () => Array<{
    id: { index: number; generation: number };
    kind: string;
    relationship: string;
    x: number;
    z: number;
  }>;
  commandClient: {
    issueMove: (params: unknown) => void;
    issuePlaceBuilding: (params: unknown) => void;
  };
  runtime: {
    getLatestTick: () => number;
    getEntityCount: () => number;
    getChecksums: () => Array<{ tick: number; hash: number }>;
    getNavDebug: () => { paths: Array<{ cells: Array<{ cx: number; cz: number }> }> } | null;
  };
  recorder: { exportLog: () => unknown[] };
  replay: {
    setRecorded: (commands: unknown[], checksums: unknown[]) => void;
    runReplay: (ticks: number) => boolean;
  };
  debugOverlays: { set: (key: string, value: boolean) => void };
};
