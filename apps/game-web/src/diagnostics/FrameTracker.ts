import { LONG_FRAME_MS } from '../config/constants';
import type { LongFrame } from './report';
import { average, fpsFromFrameTime, onePercentLowFps, percentile } from './stats';

const HUD_WINDOW = 5 * 60; // ~5s at 60fps
/** Cap incidental samples when a soak/report is not recording. */
const IDLE_SAMPLE_CAP = 60 * 10;

export class FrameTracker {
  private readonly frameTimes: number[] = [];
  private readonly hudWindow: number[] = [];
  private readonly simTimes: number[] = [];
  private readonly latencies: number[] = [];
  private readonly drawCalls: number[] = [];
  private readonly triangles: number[] = [];
  private readonly longFrames: LongFrame[] = [];
  private startedAt = 0;
  private retainFullSamples = false;

  begin(now = performance.now()): void {
    this.startedAt = now;
    this.frameTimes.length = 0;
    this.hudWindow.length = 0;
    this.simTimes.length = 0;
    this.latencies.length = 0;
    this.drawCalls.length = 0;
    this.triangles.length = 0;
    this.longFrames.length = 0;
  }

  setRetainFullSamples(enabled: boolean): void {
    this.retainFullSamples = enabled;
    if (!enabled) {
      this.trim(IDLE_SAMPLE_CAP);
    }
  }

  isRetainingFullSamples(): boolean {
    return this.retainFullSamples;
  }

  sample(input: {
    frameTimeMs: number;
    simTimeMs: number;
    snapshotLatencyMs: number;
    drawCalls: number;
    triangles: number;
    nowMs: number;
  }): void {
    this.frameTimes.push(input.frameTimeMs);
    this.hudWindow.push(input.frameTimeMs);
    if (this.hudWindow.length > HUD_WINDOW) {
      this.hudWindow.shift();
    }
    this.simTimes.push(input.simTimeMs);
    this.latencies.push(input.snapshotLatencyMs);
    this.drawCalls.push(input.drawCalls);
    this.triangles.push(input.triangles);
    if (input.frameTimeMs >= LONG_FRAME_MS) {
      this.longFrames.push({ atMs: input.nowMs - this.startedAt, frameTimeMs: input.frameTimeMs });
    }
    if (!this.retainFullSamples) {
      this.trim(IDLE_SAMPLE_CAP);
    }
  }

  durationMs(now = performance.now()): number {
    return now - this.startedAt;
  }

  sampleCount(): number {
    return this.frameTimes.length;
  }

  hud() {
    const current = this.hudWindow[this.hudWindow.length - 1] ?? 0;
    const sorted = [...this.hudWindow].sort((a, b) => a - b);
    return {
      currentFps: fpsFromFrameTime(current),
      rollingAvgFps: fpsFromFrameTime(average(this.hudWindow)),
      onePercentLowFps: onePercentLowFps(this.hudWindow),
      currentFrameTimeMs: current,
      avgFrameTimeMs: average(this.hudWindow),
      p95FrameTimeMs: percentile(sorted, 0.95),
      p99FrameTimeMs: percentile(sorted, 0.99),
    };
  }

  snapshot() {
    return {
      frameTimesMs: this.frameTimes,
      simTimesMs: this.simTimes,
      snapshotLatenciesMs: this.latencies,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      longFrames: this.longFrames,
      durationMs: this.durationMs(),
    };
  }

  private trim(max: number): void {
    trimFront(this.frameTimes, max);
    trimFront(this.simTimes, max);
    trimFront(this.latencies, max);
    trimFront(this.drawCalls, max);
    trimFront(this.triangles, max);
    if (this.longFrames.length > max) {
      this.longFrames.splice(0, this.longFrames.length - max);
    }
  }
}

function trimFront(values: number[], max: number): void {
  const extra = values.length - max;
  if (extra > 0) {
    values.splice(0, extra);
  }
}
