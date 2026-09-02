import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../config/constants';
import { interpolationAlpha } from './SimClient';

describe('snapshot interpolation', () => {
  it('starts at the previous snapshot when the current one just arrived', () => {
    expect(interpolationAlpha(1000, 1000, TICK_MS)).toBe(0);
  });

  it('reaches the current snapshot after one tick of render time', () => {
    expect(interpolationAlpha(1000 + TICK_MS, 1000, TICK_MS)).toBe(1);
  });

  it('is mid-blend halfway through the tick', () => {
    expect(interpolationAlpha(1000 + TICK_MS / 2, 1000, TICK_MS)).toBeCloseTo(0.5, 5);
  });
});
