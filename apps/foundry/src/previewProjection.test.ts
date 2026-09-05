import { describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../../game-web/src/config/constants';
import { createRuntimePreviewProjection } from './previewProjection';

const footprintCases = [
  { name: 'gameplay/default at a 320x220 viewport', width: 320, height: 220, zoom: undefined },
  { name: '70-percent at a 640x360 viewport', width: 640, height: 360, zoom: '70-percent' as const },
] as const;

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

  it.each(footprintCases)('$name matches sampled ground-circle extrema', ({ width, height, zoom }) => {
    const projection = createRuntimePreviewProjection(width, height, zoom);
    const groundX = 80;
    const groundZ = 80;
    const radius = 0.6;
    const footprint = projection.projectGroundRadius(groundX, groundZ, radius);
    const sampled = sampleGroundCircleExtrema(projection, groundX, groundZ, radius);

    expect(footprint.center).toEqual(projection.projectWorldPoint(groundX, 0, groundZ));
    expect(footprint.radiusX).toBeCloseTo(sampled.radiusX, 5);
    expect(footprint.radiusY).toBeCloseTo(sampled.radiusY, 5);
  });
});

function sampleGroundCircleExtrema(
  projection: ReturnType<typeof createRuntimePreviewProjection>,
  centerX: number,
  centerZ: number,
  radius: number,
): { radiusX: number; radiusY: number } {
  const center = projection.projectWorldPoint(centerX, 0, centerZ);
  const worldRadius = radius * CELL_SIZE;
  const sampleCount = 8192;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2;
    const point = projection.projectWorldPoint(
      centerX + Math.cos(angle) * worldRadius,
      0,
      centerZ + Math.sin(angle) * worldRadius,
    );
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    radiusX: Math.max(center.x - minX, maxX - center.x),
    radiusY: Math.max(center.y - minY, maxY - center.y),
  };
}
