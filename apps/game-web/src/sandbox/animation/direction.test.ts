import { describe, expect, it } from 'vitest';
import { createTestPackV2 } from '@pastel-rts/simulation';
import { resolveDirection, sampleClipFrame } from './direction';
import { resolveUnitSpriteFrame, shouldUseMoveClip } from './animationResolver';

describe('animation direction resolution', () => {
  it('uses single direction for 1-dir sprites', () => {
    const result = resolveDirection(1.2, 1, false);
    expect(result).toEqual({ directionIndex: 0, mirrorX: false });
  });

  it('maps heading to quadrants for 4-dir', () => {
    expect(resolveDirection(0, 4, false).directionIndex).toBe(0);
    expect(resolveDirection(Math.PI / 2, 4, false).directionIndex).toBe(1);
    expect(resolveDirection(Math.PI, 4, false).directionIndex).toBe(2);
  });

  it('mirrors west facings when mirrored flag is set', () => {
    const west = resolveDirection(-Math.PI / 2, 4, true);
    expect(west.mirrorX).toBe(true);
  });

  it('samples clip frames from phase', () => {
    expect(sampleClipFrame([0, 1, 2, 3], 0, true)).toBe(0);
    expect(sampleClipFrame([0, 1, 2, 3], 0.75, true)).toBe(3);
  });
});

describe('unit sprite frame resolution', () => {
  const pack = createTestPackV2();
  const archetype = pack.units[0]!;

  it('uses idle clip when stationary', () => {
    expect(shouldUseMoveClip('idle')).toBe(false);
    const frame = resolveUnitSpriteFrame(archetype, 'idle', 0, 0.25);
    expect(frame.clipId).toBe('idle');
  });

  it('uses move clip when moving', () => {
    expect(shouldUseMoveClip('move')).toBe(true);
    const frame = resolveUnitSpriteFrame(archetype, 'move', Math.PI / 4, 0.5);
    expect(frame.clipId).toBe('move');
    expect(frame.sheetFrameIndex).toBeGreaterThanOrEqual(0);
  });
});
