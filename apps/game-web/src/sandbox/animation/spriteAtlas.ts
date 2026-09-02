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

/** Shared sprite atlas cache — one texture per archetype asset path. */
export class SpriteAtlasCache {
  private readonly entries = new Map<AtlasKey, AtlasEntry>();
  private readonly packBaseUrl: string;

  constructor(packBaseUrl = './content/dev-pack-v2/') {
    this.packBaseUrl = packBaseUrl.endsWith('/') ? packBaseUrl : `${packBaseUrl}/`;
  }

  async loadPack(pack: PackV2): Promise<void> {
    const paths = new Set<string>();
    for (const unit of pack.units) {
      if (unit.enabled) {
        paths.add(unit.assetPath);
      }
    }
    await Promise.all([...paths].map((path) => this.ensureLoaded(path, pack.units)));
  }

  getForArchetype(archetype: UnitArchetype): AtlasEntry {
    const entry = this.entries.get(archetype.assetPath);
    if (!entry) {
      return this.createPlaceholder(archetype);
    }
    return entry;
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
    for (const entry of this.entries.values()) {
      entry.texture.dispose();
    }
    this.entries.clear();
  }

  private async ensureLoaded(assetPath: string, units: UnitArchetype[]): Promise<void> {
    if (this.entries.has(assetPath)) {
      return;
    }
    const archetype = units.find((unit) => unit.assetPath === assetPath);
    if (!archetype) {
      return;
    }
    try {
      const url = `${this.packBaseUrl}${assetPath}`;
      const image = await loadImage(url);
      const texture = new CanvasTexture(image);
      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      const cols = Math.max(1, Math.floor((archetype.sourceWidth - archetype.margin.x) / (archetype.frameWidth + archetype.spacing.x)));
      const rows = Math.max(1, Math.floor((archetype.sourceHeight - archetype.margin.y) / (archetype.frameHeight + archetype.spacing.y)));
      this.entries.set(assetPath, {
        texture,
        cols,
        rows,
        frameWidth: archetype.frameWidth,
        frameHeight: archetype.frameHeight,
      });
    } catch {
      this.entries.set(assetPath, this.createPlaceholder(archetype));
    }
  }

  private createPlaceholder(archetype: UnitArchetype): AtlasEntry {
    const canvas = document.createElement('canvas');
    canvas.width = archetype.sourceWidth;
    canvas.height = archetype.sourceHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = archetype.factionId === 'sunweaver' ? '#f2e6d0' : '#b9a0e0';
      const cols = Math.max(1, Math.floor(archetype.sourceWidth / archetype.frameWidth));
      const rows = Math.max(1, Math.floor(archetype.sourceHeight / archetype.frameHeight));
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = col * archetype.frameWidth;
          const y = row * archetype.frameHeight;
          ctx.fillRect(x + 2, y + 2, archetype.frameWidth - 4, archetype.frameHeight - 4);
          ctx.strokeStyle = '#333';
          ctx.strokeRect(x + 2, y + 2, archetype.frameWidth - 4, archetype.frameHeight - 4);
        }
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const cols = Math.max(1, Math.floor(archetype.sourceWidth / archetype.frameWidth));
    const rows = Math.max(1, Math.floor(archetype.sourceHeight / archetype.frameHeight));
    const entry: AtlasEntry = {
      texture,
      cols,
      rows,
      frameWidth: archetype.frameWidth,
      frameHeight: archetype.frameHeight,
    };
    this.entries.set(archetype.assetPath, entry);
    return entry;
  }
}

function loadImage(url: string): Promise<HTMLImageElement | HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}
