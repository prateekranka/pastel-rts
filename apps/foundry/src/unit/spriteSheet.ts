import {
  countSpriteSheetFrames,
  type DirectionCount,
  type PixelBounds,
  type SpriteClip,
  type UnitAnimationDef,
} from '@pastel-rts/content-schema';

export type SheetLayout = 'single' | 'horizontal' | 'grid';

export type SheetConfig = {
  layout: SheetLayout;
  frameWidth: number;
  frameHeight: number;
  marginX: number;
  marginY: number;
  spacingX: number;
  spacingY: number;
  columns: number;
  rows: number;
};

export function defaultSheetConfig(width: number, height: number): SheetConfig {
  return {
    layout: 'single',
    frameWidth: width,
    frameHeight: height,
    marginX: 0,
    marginY: 0,
    spacingX: 0,
    spacingY: 0,
    columns: 1,
    rows: 1,
  };
}

export function inferSheetConfig(width: number, height: number): SheetConfig[] {
  const options: SheetConfig[] = [defaultSheetConfig(width, height)];
  if (width > height && width % height === 0) {
    const frames = width / height;
    options.push({
      layout: 'horizontal',
      frameWidth: height,
      frameHeight: height,
      marginX: 0,
      marginY: 0,
      spacingX: 0,
      spacingY: 0,
      columns: frames,
      rows: 1,
    });
  }
  for (const cols of [2, 4, 8, 16]) {
    for (const rows of [2, 4, 8, 16]) {
      if (width % cols === 0 && height % rows === 0) {
        options.push({
          layout: 'grid',
          frameWidth: width / cols,
          frameHeight: height / rows,
          marginX: 0,
          marginY: 0,
          spacingX: 0,
          spacingY: 0,
          columns: cols,
          rows,
        });
      }
    }
  }
  return options;
}

/**
 * Selects a conservative grid for a newly uploaded sheet. A non-square sheet
 * with an authored horizontal strip keeps that strip. Other sheets prefer a
 * square frame grid with enough cells for clips and directions, rather than
 * selecting the first large divisor of the source dimensions.
 */
export function chooseBestSheetConfig(width: number, height: number): SheetConfig {
  if (width === height) {
    return defaultSheetConfig(width, height);
  }
  const candidates = inferSheetConfig(width, height).filter((candidate) => candidate.layout !== 'single');
  if (candidates.length === 0) {
    return defaultSheetConfig(width, height);
  }
  const horizontal = candidates.find(
    (candidate) => candidate.layout === 'horizontal' && candidate.rows === 1 && candidate.columns <= 8 && width >= height * 4,
  );
  if (horizontal) {
    return horizontal;
  }
  return [...candidates].sort((left, right) => sheetConfigScore(left) - sheetConfigScore(right))[0] ?? defaultSheetConfig(width, height);
}

function sheetConfigScore(config: SheetConfig): number {
  const frameCount = config.columns * config.rows;
  const frameCountPenalty = frameCount < 16 ? (16 - frameCount) * 8 : frameCount > 64 ? (frameCount - 64) * 2 : 0;
  const squarePenalty = Math.abs(config.frameWidth - config.frameHeight) * 4;
  const clipDivisibilityPenalty = frameCount >= 16 && frameCount % 4 === 0 ? 0 : 8;
  return frameCountPenalty + squarePenalty + clipDivisibilityPenalty;
}

export function totalFrames(config: SheetConfig, sourceWidth: number, sourceHeight: number): number {
  return countSpriteSheetFrames(
    sourceWidth,
    sourceHeight,
    config.frameWidth,
    config.frameHeight,
    config.marginX,
    config.marginY,
    config.spacingX,
    config.spacingY,
  );
}

export function frameRect(
  index: number,
  config: SheetConfig,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; w: number; h: number } | null {
  const framesPerRow = Math.max(
    1,
    Math.floor((sourceWidth - config.marginX + config.spacingX) / (config.frameWidth + config.spacingX)),
  );
  const row = Math.floor(index / framesPerRow);
  const col = index % framesPerRow;
  const x = config.marginX + col * (config.frameWidth + config.spacingX);
  const y = config.marginY + row * (config.frameHeight + config.spacingY);
  if (x + config.frameWidth > sourceWidth || y + config.frameHeight > sourceHeight) {
    return null;
  }
  return { x, y, w: config.frameWidth, h: config.frameHeight };
}

export function defaultUnitAnimation(total: number, assetPath: string): UnitAnimationDef {
  const clip: SpriteClip = {
    frames: { kind: 'indexes', indexes: total > 0 ? [0] : [0] },
    fps: 8,
    looping: true,
    assetPath,
  };
  return {
    directions: 1,
    mirrored: false,
    clips: {
      idle: { ...clip, fps: 8 },
      move: { ...clip, fps: 12 },
    },
  };
}

export function directionLabels(count: DirectionCount): string[] {
  if (count === 1) {
    return ['billboard'];
  }
  if (count === 4) {
    return ['N', 'E', 'S', 'W'];
  }
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
}

export function facingFrameIndex(directionIndex: number, framesPerDirection: number, baseFrame = 0): number {
  return baseFrame + directionIndex * framesPerDirection;
}

export type AnchorOverlay = {
  anchorX: number;
  anchorY: number;
  selectionRadius: number;
  collisionRadius: number;
  worldHeight: number;
  bounds: PixelBounds;
};

export function drawAnchorOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: AnchorOverlay,
  scale: number,
  offsetX: number,
  offsetY: number,
  frameW: number,
  frameH: number,
): void {
  const ax = offsetX + frameW * overlay.anchorX * scale;
  const ay = offsetY + frameH * overlay.anchorY * scale;
  ctx.strokeStyle = '#e07a3d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax - 6, ay);
  ctx.lineTo(ax + 6, ay);
  ctx.moveTo(ax, ay - 6);
  ctx.lineTo(ax, ay + 6);
  ctx.stroke();
  ctx.strokeStyle = '#5ce1e6';
  ctx.beginPath();
  ctx.moveTo(offsetX, ay);
  ctx.lineTo(offsetX + frameW * scale, ay);
  ctx.stroke();
  ctx.strokeStyle = '#ffb4a2';
  ctx.strokeRect(
    offsetX + overlay.bounds.minX * scale,
    offsetY + overlay.bounds.minY * scale,
    (overlay.bounds.maxX - overlay.bounds.minX) * scale,
    (overlay.bounds.maxY - overlay.bounds.minY) * scale,
  );
  ctx.strokeStyle = '#8ee3b1';
  ctx.beginPath();
  ctx.arc(ax, ay, overlay.selectionRadius * 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#f4d35e';
  ctx.beginPath();
  ctx.arc(ax, ay, overlay.collisionRadius * 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#b7d0d3';
  ctx.fillRect(ax + 8, offsetY - 4, 4, overlay.worldHeight * 20);
}
