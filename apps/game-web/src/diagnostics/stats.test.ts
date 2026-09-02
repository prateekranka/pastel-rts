import { describe, expect, it } from 'vitest';
import { average, onePercentLowFps, percentile } from './stats';

describe('frame statistics', () => {
  it('computes percentile frame times on a known series', () => {
    const times = [10, 12, 11, 10, 40, 10, 11, 12, 10, 13];
    const sorted = [...times].sort((a, b) => a - b);
    expect(percentile(sorted, 0.5)).toBe(11);
    expect(percentile(sorted, 0.95)).toBeGreaterThanOrEqual(13);
    expect(percentile(sorted, 0.99)).toBeGreaterThanOrEqual(40 * 0.9);
    expect(average(times)).toBeCloseTo(13.9, 5);
  });

  it('computes 1% low FPS as the average of the slowest 1% of frames', () => {
    const times: number[] = [];
    for (let i = 0; i < 99; i += 1) {
      times.push(16.666);
    }
    times.push(100);
    expect(onePercentLowFps(times)).toBeCloseTo(10, 5);
  });
});
