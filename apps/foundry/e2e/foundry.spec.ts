import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACK_DIR = process.env['CONTENT_PACK_DIR'] ?? '/tmp/pastel-foundry-e2e';

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
