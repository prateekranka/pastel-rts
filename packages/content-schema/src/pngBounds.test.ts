import { describe, expect, it } from 'vitest';
import { detectOpaqueBounds } from './pngBounds';

describe('opaque bounds', () => {
  it('detects non-transparent pixels', () => {
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    const set = (x: number, y: number, a: number) => {
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 3] = a;
    };
    set(1, 1, 255);
    set(2, 2, 255);
    expect(detectOpaqueBounds(width, height, data)).toEqual({
      minX: 1,
      minY: 1,
      maxX: 3,
      maxY: 3,
    });
  });
});
