import type {
  BuildingArchetype,
  PixelBounds,
  UnitAnchor,
  UnitArchetype,
} from '@pastel-rts/content-schema';
import { createRuntimePreviewProjection, type ScreenPoint } from '../previewProjection';
import {
  drawAnchorOverlay,
  frameRect,
  type AnchorOverlay,
  type SheetConfig,
} from './spriteSheet';

export type RuntimePreviewFlags = {
  showGroundGrid: boolean;
  showFootprints: boolean;
  showDirectionOverlay: boolean;
};

export type RuntimePreviewMode = 'gameplay' | 'seventy';

export function drawFramePreview(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  frameIndex: number,
  config: SheetConfig,
  sourceWidth: number,
  sourceHeight: number,
  background: 'checker' | 'neutral',
  overlay?: AnchorOverlay,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  canvas.className = background;
  const rect = frameRect(frameIndex, config, sourceWidth, sourceHeight);
  if (!rect) {
    return;
  }
  const pad = 8;
  canvas.width = rect.w + pad * 2;
  canvas.height = rect.h + pad * 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (background === 'neutral') {
    ctx.fillStyle = '#8aa3a8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, pad, pad, rect.w, rect.h);
  if (overlay) {
    drawAnchorOverlay(ctx, overlay, 1, pad, pad, rect.w, rect.h);
  }
}

export function drawSheetGridOverlay(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  config: SheetConfig,
  sourceWidth: number,
  sourceHeight: number,
  selectedFrame: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  canvas.className = 'checker';
  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.ceil(sourceWidth * scale));
  canvas.height = Math.max(1, Math.ceil(sourceHeight * scale));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  let index = 0;
  let y = config.marginY;
  while (y + config.frameHeight <= sourceHeight) {
    let x = config.marginX;
    while (x + config.frameWidth <= sourceWidth) {
      ctx.strokeStyle = index === selectedFrame ? '#e07a3d' : '#5ce1e688';
      ctx.lineWidth = index === selectedFrame ? 2 : 1;
      ctx.strokeRect(x * scale, y * scale, config.frameWidth * scale, config.frameHeight * scale);
      index += 1;
      x += config.frameWidth + config.spacingX;
    }
    y += config.frameHeight + config.spacingY;
  }
}

export function drawRuntimeGameplayPreview(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  archetype: UnitArchetype | BuildingArchetype,
  frame: { x: number; y: number; w: number; h: number },
  mode: RuntimePreviewMode,
  background: 'checker' | 'neutral',
  flags: RuntimePreviewFlags,
  directionLabel?: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const width = 320;
  const height = 220;
  canvas.width = width;
  canvas.height = height;
  canvas.className = background;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  if (background === 'neutral') {
    ctx.fillStyle = '#8aa3a8';
    ctx.fillRect(0, 0, width, height);
  }

  const projection = createRuntimePreviewProjection(width, height, mode === 'gameplay' ? undefined : '70-percent');
  const boundsW = Math.max(1, archetype.bounds.maxX - archetype.bounds.minX);
  const boundsH = Math.max(1, archetype.bounds.maxY - archetype.bounds.minY);
  const worldHeight = archetype.worldHeight;
  const worldWidth = worldHeight * (boundsW / boundsH);
  const groundX = projection.camera.lookAt.x;
  const groundZ = projection.camera.lookAt.z;
  const quad = projection.projectSpriteQuad({
    groundX,
    groundZ,
    worldWidth,
    worldHeight,
    anchorX: archetype.anchor.x,
    anchorY: archetype.anchor.y,
  });
  const sourceX = frame.x + archetype.bounds.minX;
  const sourceY = frame.y + archetype.bounds.minY;
  drawProjectedImage(ctx, image, sourceX, sourceY, boundsW, boundsH, quad);

  if (flags.showGroundGrid) {
    drawGroundGrid(ctx, projection, quad.ground, groundX, groundZ);
  }
  if (flags.showFootprints) {
    drawGroundAnchor(ctx, quad.ground, '#f4d35e');
    const selectionRadius = 'selectionRadius' in archetype ? archetype.selectionRadius : footprintRadius(archetype);
    const collisionRadius = 'collisionRadius' in archetype ? archetype.collisionRadius : selectionRadius;
    drawGroundRadius(ctx, projection.projectGroundRadius(groundX, groundZ, selectionRadius), '#8ee3b1', 'selection');
    drawGroundRadius(ctx, projection.projectGroundRadius(groundX, groundZ, collisionRadius), '#f4d35e', 'collision');
  }
  if (flags.showDirectionOverlay) {
    ctx.fillStyle = '#14363a';
    ctx.strokeStyle = '#f2e6d0';
    ctx.lineWidth = 1;
    ctx.fillRect(8, 8, 132, 24);
    ctx.strokeRect(8.5, 8.5, 131, 23);
    ctx.fillStyle = '#f2e6d0';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(directionLabel ?? 'Facing: authored', 16, 24);
  }
}

function drawProjectedImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  quad: { topLeft: ScreenPoint; topRight: ScreenPoint; bottomLeft: ScreenPoint },
): void {
  const a = (quad.topRight.x - quad.topLeft.x) / sourceWidth;
  const b = (quad.topRight.y - quad.topLeft.y) / sourceWidth;
  const c = (quad.bottomLeft.x - quad.topLeft.x) / sourceHeight;
  const d = (quad.bottomLeft.y - quad.topLeft.y) / sourceHeight;
  ctx.save();
  ctx.setTransform(a, b, c, d, quad.topLeft.x, quad.topLeft.y);
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  ctx.restore();
}

function drawGroundGrid(
  ctx: CanvasRenderingContext2D,
  projection: ReturnType<typeof createRuntimePreviewProjection>,
  center: ScreenPoint,
  groundX: number,
  groundZ: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#5ce1e655';
  ctx.lineWidth = 1;
  for (let offset = -4; offset <= 4; offset += 1) {
    const x0 = projection.projectWorldPoint(groundX + offset, 0, groundZ - 4);
    const x1 = projection.projectWorldPoint(groundX + offset, 0, groundZ + 4);
    const z0 = projection.projectWorldPoint(groundX - 4, 0, groundZ + offset);
    const z1 = projection.projectWorldPoint(groundX + 4, 0, groundZ + offset);
    ctx.beginPath();
    ctx.moveTo(x0.x, x0.y);
    ctx.lineTo(x1.x, x1.y);
    ctx.moveTo(z0.x, z0.y);
    ctx.lineTo(z1.x, z1.y);
    ctx.stroke();
  }
  ctx.fillStyle = '#f4d35e';
  ctx.fillRect(center.x - 2, center.y - 2, 4, 4);
  ctx.restore();
}

function drawGroundAnchor(ctx: CanvasRenderingContext2D, point: ScreenPoint, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(point.x - 8, point.y);
  ctx.lineTo(point.x + 8, point.y);
  ctx.moveTo(point.x, point.y - 8);
  ctx.lineTo(point.x, point.y + 8);
  ctx.stroke();
  ctx.restore();
}

function drawGroundRadius(
  ctx: CanvasRenderingContext2D,
  radius: { center: ScreenPoint; radiusX: number; radiusY: number },
  color: string,
  label: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(radius.center.x, radius.center.y, radius.radiusX, radius.radiusY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(label, radius.center.x + radius.radiusX + 4, radius.center.y);
  ctx.restore();
}

function footprintRadius(archetype: BuildingArchetype): number {
  return Math.max(archetype.footprint.cellsW, archetype.footprint.cellsH) * 0.5;
}

export { drawPreview } from '../preview';
export type { AnchorOverlay } from './spriteSheet';
