export function average(values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

export function percentile(sortedAscending: ReadonlyArray<number>, p: number): number {
  if (sortedAscending.length === 0) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, p));
  const index = (sortedAscending.length - 1) * clamped;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const a = sortedAscending[lo] ?? 0;
  const b = sortedAscending[hi] ?? a;
  const t = index - lo;
  return a + (b - a) * t;
}

/** Average FPS of the slowest 1% of frames. */
export function onePercentLowFps(frameTimesMs: ReadonlyArray<number>): number {
  if (frameTimesMs.length === 0) {
    return 0;
  }
  const fps = frameTimesMs
    .map((ms) => (ms <= 0 ? 0 : 1000 / ms))
    .sort((a, b) => a - b);
  const count = Math.max(1, Math.floor(fps.length * 0.01));
  return average(fps.slice(0, count));
}

export function fpsFromFrameTime(ms: number): number {
  if (ms <= 0) {
    return 0;
  }
  return 1000 / ms;
}
