import {
  CanvasTexture,
  NearestFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { PackV2, UnitArchetype } from '@pastel-rts/content-schema';

export type AtlasEntry = {
  texture: Texture;
  cols: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  placeholder: boolean;
};

export type AtlasArtState = 'loading' | 'ready' | 'missing';

export type AtlasArtStatus = {
  assetPath: string;
  state: AtlasArtState;
  error: string | null;
};

type AtlasKey = string;

export function spriteFrameUvRect(params: {
  frameIndex: number;
  cols: number;
  frameWidth: number;
  frameHeight: number;
  texW: number;
  texH: number;
  marginX: number;
  marginY: number;
  spacingX: number;
  spacingY: number;
}): { u: number; v: number; w: number; h: number } {
  const col = params.frameIndex % Math.max(1, params.cols);
  const row = Math.floor(params.frameIndex / Math.max(1, params.cols));
  const x = params.marginX + col * (params.frameWidth + params.spacingX);
  const y = params.marginY + row * (params.frameHeight + params.spacingY);
  return {
    u: x / params.texW,
    v: 1 - (y + params.frameHeight) / params.texH,
    w: params.frameWidth / params.texW,
    h: params.frameHeight / params.texH,
  };
}

/** Shared sprite atlas cache with generation-safe replacement and visible art failures. */
export class SpriteAtlasCache {
  private readonly entries = new Map<AtlasKey, AtlasEntry>();
  private readonly statuses = new Map<AtlasKey, AtlasArtStatus>();
  private packBaseUrl: string;
  private generation = 0;
  private disposed = false;

  constructor(packBaseUrl = './content/dev-pack-v2/') {
    this.packBaseUrl = normalizeBaseUrl(packBaseUrl);
  }

  async loadPack(pack: PackV2): Promise<void> {
    if (this.disposed) {
      return;
    }
    const generation = ++this.generation;
    this.clearEntries();
    this.statuses.clear();
    const paths = new Set<string>();
    for (const unit of pack.units) {
      if (unit.enabled) {
        paths.add(unit.assetPath);
      }
    }
    for (const path of paths) {
      this.statuses.set(path, { assetPath: path, state: 'loading', error: null });
    }
    await Promise.all([...paths].map((path) => this.ensureLoaded(path, pack.units, generation)));
  }

  async replacePack(pack: PackV2, packBaseUrl: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.packBaseUrl = normalizeBaseUrl(packBaseUrl);
    await this.loadPack(pack);
  }

  getForArchetype(archetype: UnitArchetype): AtlasEntry {
    const entry = this.entries.get(archetype.assetPath);
    if (entry) {
      return entry;
    }
    return this.createPlaceholder(archetype, this.generation);
  }

  getArtStatus(archetypeOrPath: UnitArchetype | string): AtlasArtStatus {
    const assetPath = typeof archetypeOrPath === 'string' ? archetypeOrPath : archetypeOrPath.assetPath;
    return {
      ...(this.statuses.get(assetPath) ?? {
        assetPath,
        state: 'missing' as const,
        error: 'Sprite asset was not requested',
      }),
    };
  }

  getDiagnostics(): { assets: AtlasArtStatus[]; loadedTextures: number } {
    return {
      assets: [...this.statuses.values()].map((status) => ({ ...status })),
      loadedTextures: [...this.entries.values()].filter((entry) => !entry.placeholder).length,
    };
  }

  frameUv(archetype: UnitArchetype, frameIndex: number): { u: number; v: number; w: number; h: number } {
    const atlas = this.getForArchetype(archetype);
    const tex = atlas.texture;
    const image = tex.image as { width?: number; height?: number } | undefined;
    const texW = image?.width ?? archetype.sourceWidth;
    const texH = image?.height ?? archetype.sourceHeight;
    return spriteFrameUvRect({
      frameIndex,
      cols: atlas.cols,
      frameWidth: atlas.frameWidth,
      frameHeight: atlas.frameHeight,
      texW,
      texH,
      marginX: archetype.margin.x,
      marginY: archetype.margin.y,
      spacingX: archetype.spacing.x,
      spacingY: archetype.spacing.y,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.clearEntries();
    this.statuses.clear();
  }

  private async ensureLoaded(
    assetPath: string,
    units: UnitArchetype[],
    generation: number,
  ): Promise<void> {
    const archetype = units.find((unit) => unit.assetPath === assetPath);
    if (!archetype) {
      return;
    }
    try {
      const image = await loadImage(`${this.packBaseUrl}${assetPath}`);
      const texture = new CanvasTexture(image);
      configureTexture(texture);
      if (this.disposed || generation !== this.generation) {
        texture.dispose();
        return;
      }
      const previous = this.entries.get(assetPath);
      if (previous) {
        previous.texture.dispose();
      }
      this.entries.set(assetPath, makeEntry(texture, archetype, false));
      this.statuses.set(assetPath, { assetPath, state: 'ready', error: null });
    } catch {
      if (this.disposed || generation !== this.generation) {
        return;
      }
      const entry = this.entries.get(assetPath) ?? this.createPlaceholder(archetype, generation);
      this.entries.set(assetPath, entry);
      this.statuses.set(assetPath, {
        assetPath,
        state: 'missing',
        error: 'Authored sprite asset failed to load',
      });
    }
  }

  private createPlaceholder(archetype: UnitArchetype, generation: number): AtlasEntry {
    const existing = this.entries.get(archetype.assetPath);
    if (existing) {
      return existing;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, archetype.sourceWidth);
    canvas.height = Math.max(1, archetype.sourceHeight);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const tile = Math.max(4, Math.floor(Math.min(archetype.frameWidth, archetype.frameHeight) / 4));
      ctx.fillStyle = '#210d2f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y += tile) {
        for (let x = 0; x < canvas.width; x += tile) {
          if ((x / tile + y / tile) % 2 === 0) {
            ctx.fillStyle = '#ff3b81';
            ctx.fillRect(x, y, tile, tile);
          }
        }
      }
      ctx.strokeStyle = '#ffe6f1';
      ctx.lineWidth = Math.max(2, tile / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(canvas.width, canvas.height);
      ctx.moveTo(canvas.width, 0);
      ctx.lineTo(0, canvas.height);
      ctx.stroke();
    }
    const texture = new CanvasTexture(canvas);
    configureTexture(texture);
    const entry = makeEntry(texture, archetype, true);
    if (!this.disposed && generation === this.generation) {
      this.entries.set(archetype.assetPath, entry);
      const current = this.statuses.get(archetype.assetPath);
      if (!current) {
        this.statuses.set(archetype.assetPath, {
          assetPath: archetype.assetPath,
          state: 'missing',
          error: 'Authored sprite asset is not loaded',
        });
      }
    }
    return entry;
  }

  private clearEntries(): void {
    for (const entry of this.entries.values()) {
      entry.texture.dispose();
    }
    this.entries.clear();
  }
}

function makeEntry(texture: Texture, archetype: UnitArchetype, placeholder: boolean): AtlasEntry {
  const cols = Math.max(
    1,
    Math.floor((archetype.sourceWidth - archetype.margin.x) / (archetype.frameWidth + archetype.spacing.x)),
  );
  const rows = Math.max(
    1,
    Math.floor((archetype.sourceHeight - archetype.margin.y) / (archetype.frameHeight + archetype.spacing.y)),
  );
  return {
    texture,
    cols,
    rows,
    frameWidth: archetype.frameWidth,
    frameHeight: archetype.frameHeight,
    placeholder,
  };
}

function configureTexture(texture: Texture): void {
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('\\') || trimmed.includes('..')) {
    return './content/dev-pack-v2/';
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function loadImage(url: string): Promise<HTMLImageElement | HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    try {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('sprite load failed'));
      image.src = url;
    } catch {
      reject(new Error('sprite image unavailable'));
    }
  });
}
