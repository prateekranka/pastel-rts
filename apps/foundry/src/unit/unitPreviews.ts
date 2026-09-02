import type { PixelBounds, UnitAnchor } from '@pastel-rts/content-schema';
import { drawAnchorOverlay, frameRect, type AnchorOverlay, type SheetConfig } from './spriteSheet';

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
  const maxDim = 256;
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.ceil(sourceWidth * scale);
  canvas.height = Math.ceil(sourceHeight * scale);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const total = Math.max(1, Math.ceil((sourceWidth - config.marginX) / (config.frameWidth + config.spacingX)));
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
  void total;
}

export function drawScaledGameplayPreview(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  bounds: PixelBounds,
  anchor: UnitAnchor,
  mode: 'gameplay' | 'seventy',
  background: 'checker' | 'neutral',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  canvas.className = background;
  const width = mode === 'gameplay' ? 96 : 64;
  canvas.width = width;
  canvas.height = width;
  ctx.clearRect(0, 0, width, width);
  if (background === 'neutral') {
    ctx.fillStyle = '#8aa3a8';
    ctx.fillRect(0, 0, width, width);
  }
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = (width * 0.78) / Math.max(bw, bh);
  const dw = bw * scale;
  const dh = bh * scale;
  const dx = (width - dw) * anchor.x;
  const dy = width - dh - (1 - anchor.y) * (width - dh) * 0.15;
  ctx.drawImage(image, bounds.minX, bounds.minY, bw, bh, dx, dy, dw, dh);
}

export { drawPreview } from '../preview';
