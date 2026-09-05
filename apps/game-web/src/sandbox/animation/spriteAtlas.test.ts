import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackV2, UnitArchetype } from '@pastel-rts/content-schema';
import { SpriteAtlasCache, spriteFrameUvRect } from './spriteAtlas';

class DeferredImage {
  static readonly pending: DeferredImage[] = [];

  readonly width = 32;
  readonly height = 32;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = '';

  set src(value: string) {
    this.source = value;
    DeferredImage.pending.push(this);
  }

  get src(): string {
    return this.source;
  }
}

const testUnit = {
  schemaVersion: 2,
  id: 'test-unit',
  displayName: 'Test Unit',
  enabled: true,
  factionId: 'sunweaver',
  assetPath: 'units/test-unit/sheet.png',
  sourceWidth: 32,
  sourceHeight: 32,
  frameWidth: 32,
  frameHeight: 32,
  margin: { x: 0, y: 0 },
  spacing: { x: 0, y: 0 },
  bounds: { minX: 0, minY: 0, maxX: 32, maxY: 32 },
  anchor: { x: 0.5, y: 1 },
  worldHeight: 1,
  selectionRadius: 1,
  collisionRadius: 1,
  animation: {},
  movement: {},
} as UnitArchetype;

function testPack(revision: string): PackV2 {
  return {
    schemaVersion: 2,
    id: 'test-pack',
    revision,
    factions: [],
    units: [testUnit],
    buildings: [],
    contentHash: `test-${revision}`,
  } as PackV2;
}

function installSpriteDomStubs(): void {
  vi.stubGlobal('Image', DeferredImage);
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 32,
      height: 32,
      getContext: () => ({
        fillStyle: '',
        fillRect: vi.fn(),
        strokeStyle: '',
        lineWidth: 1,
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
      }),
    }),
  });
}

function resolveNextImage(): void {
  const image = DeferredImage.pending.shift();
  if (!image) {
    throw new Error('Expected a deferred sprite image request');
  }
  image.onload?.();
}

afterEach(() => {
  DeferredImage.pending.length = 0;
  vi.unstubAllGlobals();
});

describe('spriteFrameUvRect', () => {
  it('offsets UV origin by margin and spacing', () => {
    const uv = spriteFrameUvRect({
      frameIndex: 1,
      cols: 2,
      frameWidth: 32,
      frameHeight: 32,
      texW: 80,
      texH: 40,
      marginX: 4,
      marginY: 2,
      spacingX: 8,
      spacingY: 4,
    });
    expect(uv.u).toBeCloseTo((4 + 32 + 8) / 80);
    expect(uv.v).toBeCloseTo(1 - (2 + 32) / 40);
    expect(uv.w).toBeCloseTo(32 / 80);
    expect(uv.h).toBeCloseTo(32 / 40);
  });
});

describe('SpriteAtlasCache resource handoff', () => {
  it('calls the consumer retirement hook before disposing the active texture', async () => {
    installSpriteDomStubs();
    const cache = new SpriteAtlasCache('./content/test-pack/');
    const initialLoad = cache.loadPack(testPack('1'));
    const placeholder = cache.getForArchetype(testUnit).texture;
    resolveNextImage();
    await initialLoad;

    const activeTexture = cache.getForArchetype(testUnit).texture;
    let activeTextureDisposed = false;
    let hookSawActiveTexture = false;
    activeTexture.addEventListener('dispose', () => {
      activeTextureDisposed = true;
    });

    const replacement = cache.replacePack(testPack('2'), './content/test-pack/', () => {
      hookSawActiveTexture = cache.getForArchetype(testUnit).texture === activeTexture && !activeTextureDisposed;
    });
    resolveNextImage();
    await replacement;

    expect(hookSawActiveTexture).toBe(true);
    expect(activeTextureDisposed).toBe(true);
    expect(cache.getForArchetype(testUnit).texture).not.toBe(activeTexture);
    expect(placeholder).not.toBe(cache.getForArchetype(testUnit).texture);
  });
});
