import { LONG_FRAME_MS } from '../config/constants';
import type { LongFrame } from './report';
import { average, fpsFromFrameTime, onePercentLowFps } from './stats';

const HUD_WINDOW = 5 * 60; // ~5s at 60fps

export class FrameTracker {
  private readonly frameTimes: number[] = [];
  private readonly hudWindow: number[] = [];
  private readonly simTimes: number[] = [];
  private readonly latencies: number[] = [];
  private readonly drawCalls: number[] = [];
  private readonly triangles: number[] = [];
  private readonly longFrames: LongFrame[] = [];
  private startedAt = 0;

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
  }

  durationMs(now = performance.now()): number {
    return now - this.startedAt;
  }

  hud() {
    const current = this.hudWindow[this.hudWindow.length - 1] ?? 0;
    return {
      currentFps: fpsFromFrameTime(current),
      rollingAvgFps: fpsFromFrameTime(average(this.hudWindow)),
      onePercentLowFps: onePercentLowFps(this.hudWindow),
      currentFrameTimeMs: current,
      avgFrameTimeMs: average(this.hudWindow),
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
}
