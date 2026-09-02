import type { BufferGeometry } from 'three';
import type { PixelBounds } from '@pastel-rts/content-schema';

export type UvRect = { u: number; v: number; w: number; h: number };

/** Map opaque pixel bounds onto Three.js UV space (origin bottom-left). */
export function opaqueBoundsToUv(
  bounds: PixelBounds,
  sourceWidth: number,
  sourceHeight: number,
): UvRect {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  return {
    u: bounds.minX / width,
    v: 1 - bounds.maxY / height,
    w: Math.max(1, bounds.maxX - bounds.minX) / width,
    h: Math.max(1, bounds.maxY - bounds.minY) / height,
  };
}

export function applyUvRect(geometry: BufferGeometry, uv: UvRect): void {
  const uvAttr = geometry.getAttribute('uv');
  if (!uvAttr) {
    return;
  }
  for (let i = 0; i < uvAttr.count; i += 1) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    uvAttr.setXY(i, uv.u + u * uv.w, uv.v + v * uv.h);
  }
  uvAttr.needsUpdate = true;
}
