import type { PixelBounds, UnitAnchor } from '@pastel-rts/content-schema';

export function drawPreview(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  bounds: PixelBounds,
  anchor: UnitAnchor,
  mode: 'source' | 'gameplay' | 'seventy',
  background: 'checker' | 'neutral',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  canvas.className = background;
  const width = mode === 'source' ? 192 : mode === 'gameplay' ? 96 : 64;
  canvas.width = width;
  canvas.height = width;
  ctx.clearRect(0, 0, width, width);
  ctx.fillStyle = background === 'neutral' ? '#8aa3a8' : 'transparent';
  if (background === 'neutral') {
    ctx.fillRect(0, 0, width, width);
  }
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = (width * 0.78) / Math.max(bw, bh);
  const dw = bw * scale;
  const dh = bh * scale;
  const dx = (width - dw) * anchor.x;
  const dy = width - dh - (1 - anchor.y) * (width - dh) * 0.15;
  ctx.drawImage(
    image,
    bounds.minX,
    bounds.minY,
    bw,
    bh,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.strokeStyle = '#e07a3d';
  ctx.beginPath();
  ctx.moveTo(dx + dw * anchor.x - 4, dy + dh * anchor.y);
  ctx.lineTo(dx + dw * anchor.x + 4, dy + dh * anchor.y);
  ctx.moveTo(dx + dw * anchor.x, dy + dh * anchor.y - 4);
  ctx.lineTo(dx + dw * anchor.x, dy + dh * anchor.y + 4);
  ctx.stroke();
}
