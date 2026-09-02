import type { PixelBounds } from './unitManifest';

export function detectOpaqueBounds(
  width: number,
  height: number,
  rgba: ArrayLike<number>,
  alphaThreshold = 8,
): PixelBounds {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3] ?? 0;
      if (alpha > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + 1);
        maxY = Math.max(maxY, y + 1);
      }
    }
  }
  if (maxX <= minX || maxY <= minY) {
    return { minX: 0, minY: 0, maxX: width, maxY: height };
  }
  return { minX, minY, maxX, maxY };
}
