import { describe, expect, it } from 'vitest';
import { opaqueBoundsToUv } from './spriteUv';

describe('opaque bounds UVs', () => {
  it('crops to the detected sprite rectangle, not the full padded PNG', () => {
    const uv = opaqueBoundsToUv({ minX: 16, minY: 8, maxX: 48, maxY: 56 }, 64, 64);
    expect(uv.u).toBeCloseTo(0.25, 6);
    expect(uv.w).toBeCloseTo(0.5, 6);
    expect(uv.h).toBeCloseTo(0.75, 6);
    expect(uv.v).toBeCloseTo(1 - 56 / 64, 6);
  });
});
