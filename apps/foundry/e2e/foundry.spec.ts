import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACK_DIR = process.env['CONTENT_PACK_DIR'] ?? '/tmp/pastel-foundry-e2e';

/** Minimal 32×32 PNG as base64 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('Content Foundry PNG click-path', () => {
  test('upload PNG, preview bounds, save to disk pack', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('Content Foundry');

    const pngBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('2d context missing');
      }
      ctx.clearRect(0, 0, 32, 32);
      ctx.fillStyle = '#e07a3d';
      ctx.fillRect(8, 6, 16, 20);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        throw new Error('PNG encode failed');
      }
      const buffer = await blob.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    });

    await page.locator('#file').setInputFiles({
      name: 'foundry-proxy.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBytes),
    });

    await expect(page.locator('#status')).toContainText(/PNG loaded|Manifest valid/i, { timeout: 10_000 });
    const manifestText = await page.locator('#manifest').innerText();
    const manifest = JSON.parse(manifestText) as {
      schemaVersion: number;
      id: string;
      bounds: { minX: number; minY: number; maxX: number; maxY: number };
      anchor: { x: number; y: number };
      worldHeight: number;
      selectionRadius: number;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.id).toBe('foundry-proxy');
    expect(manifest.bounds.maxX - manifest.bounds.minX).toBeGreaterThan(8);
    expect(manifest.worldHeight).toBeGreaterThan(0);
    expect(manifest.selectionRadius).toBeGreaterThan(0);
    expect(manifest.anchor.x).toBeCloseTo(0.5);

    await expect(page.locator('#srcChecker')).toBeVisible();
    await expect(page.locator('#gameChecker')).toBeVisible();
    await expect(page.locator('#camChecker')).toBeVisible();

    await page.locator('#publish').click();
    await expect(page.locator('#status')).toContainText(/Saved .* content\/dev-pack|Saved foundry-proxy/i, {
      timeout: 10_000,
    });

    const pack = await page.evaluate(async () => {
      const response = await fetch('/dev-content/pack');
      return response.json();
    });
    expect(pack).toMatchObject({ id: 'dev-pack', schemaVersion: 1 });
    expect(Array.isArray(pack.units)).toBe(true);
    expect(pack.units.some((unit: { id: string }) => unit.id === 'foundry-proxy')).toBe(true);

    const spriteUrl = await page.evaluate(async () => {
      const response = await fetch('/dev-content/units/foundry-proxy/sprite.png');
      return { ok: response.ok, type: response.headers.get('content-type'), length: (await response.arrayBuffer()).byteLength };
    });
    expect(spriteUrl.ok).toBe(true);
    expect(spriteUrl.length).toBeGreaterThan(32);

    const spritePath = join(PACK_DIR, 'units/foundry-proxy/sprite.png');
    const manifestPath = join(PACK_DIR, 'units/foundry-proxy/manifest.json');
    expect(existsSync(spritePath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    const diskManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assetPath: string };
    expect(diskManifest.assetPath).toContain('sprite.png');
  });
});

test.describe('Content server v2 routes', () => {
  test('creates and validates v2 unit and building via API', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const suffix = Date.now();

    const unitResult = await page.evaluate(async ({ pngBase64, suffix: s }) => {
      const id = `e2e-scout-${String(s)}`;
      const archetype = {
        schemaVersion: 2,
        id,
        displayName: 'E2E Scout',
        enabled: true,
        factionId: 'sunweaver',
        assetPath: `units/${id}/sheet.png`,
        sourceWidth: 32,
        sourceHeight: 32,
        frameWidth: 32,
        frameHeight: 32,
        margin: { x: 0, y: 0 },
        spacing: { x: 0, y: 0 },
        bounds: { minX: 4, minY: 4, maxX: 28, maxY: 28 },
        anchor: { x: 0.5, y: 1 },
        worldHeight: 1.5,
        selectionRadius: 0.6,
        collisionRadius: 0.45,
        animation: {
          directions: 1,
          mirrored: false,
          clips: {
            idle: { frames: { kind: 'indexes', indexes: [0] }, fps: 8, looping: true },
            move: { frames: { kind: 'indexes', indexes: [0] }, fps: 12, looping: true },
          },
        },
        movement: {
          speedSubunitsPerTick: 64,
          accelerationRate: 1,
          turnRateMilli: 3000,
          footprintCategory: 'unit-1x1',
        },
      };
      const response = await fetch('/dev-content/v2/units', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetype, pngBase64 }),
      });
      return { ok: response.ok, body: await response.json(), id };
    }, { pngBase64: TINY_PNG_BASE64, suffix });

    expect(unitResult.ok).toBe(true);
    expect(unitResult.body.archetype.id).toBe(unitResult.id);

    const buildingResult = await page.evaluate(async ({ pngBase64, suffix: s }) => {
      const id = `e2e-bastion-${String(s)}`;
      const archetype = {
        schemaVersion: 2,
        id,
        displayName: 'E2E Bastion',
        enabled: true,
        factionId: 'gravemark',
        assetPath: `buildings/${id}/sprite.png`,
        sourceWidth: 32,
        sourceHeight: 32,
        bounds: { minX: 4, minY: 4, maxX: 28, maxY: 28 },
        anchor: { x: 0.5, y: 1 },
        worldHeight: 2.4,
        footprint: { kind: 'rect', cellsW: 2, cellsH: 2 },
      };
      const response = await fetch('/dev-content/v2/buildings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetype, pngBase64 }),
      });
      return { ok: response.ok, body: await response.json(), id };
    }, { pngBase64: TINY_PNG_BASE64, suffix });

    expect(buildingResult.ok).toBe(true);
    expect(buildingResult.body.archetype.id).toBe(buildingResult.id);

    const pack = await page.evaluate(async () => {
      const response = await fetch('/dev-content/pack?schema=2');
      return response.json();
    });
    expect(pack.schemaVersion).toBe(2);
    expect(pack.units.some((u: { id: string }) => u.id === unitResult.id)).toBe(true);
    expect(pack.buildings.some((b: { id: string }) => b.id === buildingResult.id)).toBe(true);
    expect(typeof pack.contentHash).toBe('string');
    expect(pack.contentHash.length).toBe(64);

    const v1Pack = await page.evaluate(async () => {
      const response = await fetch('/dev-content/pack');
      return response.json();
    });
    expect(v1Pack.schemaVersion).toBe(1);
    expect(Array.isArray(v1Pack.units)).toBe(true);
  });

  test('rejects unsafe asset paths', async ({ request }) => {
    const response = await request.post('http://127.0.0.1:8787/v2/units', {
      data: {
        archetype: {
          schemaVersion: 2,
          id: 'unsafe-path-test',
          displayName: 'Unsafe',
          enabled: true,
          factionId: 'neutral',
          assetPath: '../escape/sheet.png',
          sourceWidth: 32,
          sourceHeight: 32,
          frameWidth: 32,
          frameHeight: 32,
          margin: { x: 0, y: 0 },
          spacing: { x: 0, y: 0 },
          bounds: { minX: 4, minY: 4, maxX: 28, maxY: 28 },
          anchor: { x: 0.5, y: 1 },
          worldHeight: 1.5,
          selectionRadius: 0.6,
          collisionRadius: 0.45,
          animation: {
            directions: 1,
            mirrored: false,
            clips: {
              idle: { frames: { kind: 'indexes', indexes: [0] }, fps: 8, looping: true },
              move: { frames: { kind: 'indexes', indexes: [0] }, fps: 12, looping: true },
            },
          },
          movement: {
            speedSubunitsPerTick: 64,
            accelerationRate: 1,
            turnRateMilli: 3000,
            footprintCategory: 'unit-1x1',
          },
        },
        pngBase64: TINY_PNG_BASE64,
      },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/asset path|invalid path/i);
  });
});

test.describe('Test in sandbox', () => {
  test('unit editor sandbox launcher targets interaction-lab', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, '__openedSandbox', { writable: true, value: '' });
      window.open = (url?: string | URL) => {
        (window as unknown as { __openedSandbox: string }).__openedSandbox = String(url ?? '');
        return null;
      };
    });
    await page.goto('/#/unit/new', { waitUntil: 'networkidle' });
    await page.locator('#sandbox-unit').click();
    const opened = await page.evaluate(() => (window as unknown as { __openedSandbox: string }).__openedSandbox);
    expect(opened).toContain('mode=interaction-lab');
    expect(opened).toContain('spawnUnit=');
  });
});
