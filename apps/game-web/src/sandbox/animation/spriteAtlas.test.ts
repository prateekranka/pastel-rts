import { describe, expect, it } from 'vitest';
import { spriteFrameUvRect } from './spriteAtlas';

describe('spriteFrameUvRect', () => {
  it('offsets UV origin by margin and spacing', () => {
    const uv = spriteFrameUvRect({
      frameIndex: 1,
      cols: 2,
      frameWidth: 32,
      frameHeight: 32,
      texW: 80,
      texH: 40,
      marginX: 4,
      marginY: 2,
      spacingX: 8,
      spacingY: 4,
    });
    expect(uv.u).toBeCloseTo((4 + 32 + 8) / 80);
    expect(uv.v).toBeCloseTo(1 - (2 + 32) / 40);
    expect(uv.w).toBeCloseTo(32 / 80);
    expect(uv.h).toBeCloseTo(32 / 40);
  });
});
