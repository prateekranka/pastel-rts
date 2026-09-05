import { describe, expect, it } from 'vitest';
import { createRuntimePreviewProjection } from './previewProjection';

describe('runtime preview projection', () => {
  it('uses the named runtime camera framing for ground and sprite projection', () => {
    const projection = createRuntimePreviewProjection(320, 220, '70-percent');
    const ground = projection.projectWorldPoint(80, 0, 80);
    const quad = projection.projectSpriteQuad({
      groundX: 80,
      groundZ: 80,
      worldWidth: 1.5,
      worldHeight: 1.5,
      anchorX: 0.5,
      anchorY: 1,
    });

    expect(projection.camera.getVisibleCellsX()).toBe(44);
    expect(ground.x).toBeGreaterThan(0);
    expect(ground.x).toBeLessThan(320);
    expect(ground.y).toBeGreaterThan(0);
    expect(ground.y).toBeLessThan(220);
    expect(quad.ground).toEqual(ground);
    expect(quad.topLeft.x).not.toBe(quad.topRight.x);
    expect(quad.bottomLeft.y).not.toBe(quad.topLeft.y);
  });

  it('projects selection radii as screen-space ellipses instead of square thumbnail sizes', () => {
    const projection = createRuntimePreviewProjection(320, 220, '70-percent');
    const footprint = projection.projectGroundRadius(80, 80, 0.6);

    expect(footprint.radiusX).toBeGreaterThan(0);
    expect(footprint.radiusY).toBeGreaterThan(0);
    expect(Number.isFinite(footprint.radiusX)).toBe(true);
    expect(Number.isFinite(footprint.radiusY)).toBe(true);
  });
});
