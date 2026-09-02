import { LONG_FRAME_MS, PERFORMANCE_REPORT_SCHEMA_VERSION } from '../config/constants';
import type { RendererKind } from '../renderer/adapter';
import type { DprPreset } from '../config/constants';
import type { SimCounts } from '../sim/types';
import { average, fpsFromFrameTime, onePercentLowFps, percentile } from './stats';

export type PauseEvent = {
  atMs: number;
  type: 'pause' | 'resume' | 'background' | 'foreground';
};

export type LongFrame = {
  atMs: number;
  frameTimeMs: number;
};

export type PerformanceReport = {
  schemaVersion: number;
  commit: string;
  buildTime: string;
  timestamp: string;
  durationMs: number;
  userAgent: string;
  viewport: { width: number; height: number };
  drawingBuffer: { width: number; height: number };
  devicePixelRatio: number;
  pixelRatioCap: DprPreset | number;
  effectivePixelRatio: number;
  renderer: RendererKind;
  rendererBackend: string;
  rendererRequested: RendererKind;
  rendererInitError: string | null;
  quality: { renderScale: number; dprPreset: DprPreset | number };
  entityCounts: SimCounts & { total: number; visibleUnits: number; visibleChunks: number };
  avgFps: number;
  rollingAvgFps: number;
  onePercentLowFps: number;
  avgFrameTimeMs: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  avgSimTimeMs: number;
  maxSimTimeMs: number;
  avgSnapshotLatencyMs: number;
  drawCallRange: { min: number; max: number };
  triangleRange: { min: number; max: number };
  longFrames: LongFrame[];
  pauseEvents: PauseEvent[];
  benchmark: string;
  autoCameraMotion: boolean;
  physicalValidationStatus: 'awaiting-physical-validation';
};

export const REQUIRED_PERFORMANCE_REPORT_KEYS = [
  'schemaVersion',
  'commit',
  'buildTime',
  'timestamp',
  'durationMs',
  'userAgent',
  'viewport',
  'drawingBuffer',
  'devicePixelRatio',
  'pixelRatioCap',
  'effectivePixelRatio',
  'renderer',
  'rendererBackend',
  'rendererRequested',
  'rendererInitError',
  'quality',
  'entityCounts',
  'avgFps',
  'rollingAvgFps',
  'onePercentLowFps',
  'avgFrameTimeMs',
  'p95FrameTimeMs',
  'p99FrameTimeMs',
  'avgSimTimeMs',
  'maxSimTimeMs',
  'avgSnapshotLatencyMs',
  'drawCallRange',
  'triangleRange',
  'longFrames',
  'pauseEvents',
  'benchmark',
  'autoCameraMotion',
  'physicalValidationStatus',
] as const;

export type SampleInput = {
  frameTimesMs: number[];
  simTimesMs: number[];
  snapshotLatenciesMs: number[];
  drawCalls: number[];
  triangles: number[];
  longFrames: LongFrame[];
  pauseEvents: PauseEvent[];
  durationMs: number;
  userAgent: string;
  viewport: { width: number; height: number };
  drawingBuffer: { width: number; height: number };
  devicePixelRatio: number;
  pixelRatioCap: DprPreset | number;
  effectivePixelRatio: number;
  renderer: RendererKind;
  rendererBackend: string;
  rendererRequested: RendererKind;
  rendererInitError: string | null;
  entityCounts: PerformanceReport['entityCounts'];
  benchmark: string;
  autoCameraMotion: boolean;
};

export function buildPerformanceReport(input: SampleInput): PerformanceReport {
  const sorted = [...input.frameTimesMs].sort((a, b) => a - b);
  const avgFrame = average(input.frameTimesMs);
  return {
    schemaVersion: PERFORMANCE_REPORT_SCHEMA_VERSION,
    commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
    buildTime: typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : 'unknown',
    timestamp: new Date().toISOString(),
    durationMs: input.durationMs,
    userAgent: input.userAgent,
    viewport: input.viewport,
    drawingBuffer: input.drawingBuffer,
    devicePixelRatio: input.devicePixelRatio,
    pixelRatioCap: input.pixelRatioCap,
    effectivePixelRatio: input.effectivePixelRatio,
    renderer: input.renderer,
    rendererBackend: input.rendererBackend,
    rendererRequested: input.rendererRequested,
    rendererInitError: input.rendererInitError,
    quality: {
      renderScale: input.effectivePixelRatio,
      dprPreset: input.pixelRatioCap,
    },
    entityCounts: input.entityCounts,
    avgFps: fpsFromFrameTime(avgFrame),
    rollingAvgFps: fpsFromFrameTime(average(input.frameTimesMs.slice(-300))),
    onePercentLowFps: onePercentLowFps(input.frameTimesMs),
    avgFrameTimeMs: avgFrame,
    p95FrameTimeMs: percentile(sorted, 0.95),
    p99FrameTimeMs: percentile(sorted, 0.99),
    avgSimTimeMs: average(input.simTimesMs),
    maxSimTimeMs: input.simTimesMs.reduce((max, value) => Math.max(max, value), 0),
    avgSnapshotLatencyMs: average(input.snapshotLatenciesMs),
    drawCallRange: range(input.drawCalls),
    triangleRange: range(input.triangles),
    longFrames: input.longFrames.filter((frame) => frame.frameTimeMs >= LONG_FRAME_MS),
    pauseEvents: input.pauseEvents,
    benchmark: input.benchmark,
    autoCameraMotion: input.autoCameraMotion,
    physicalValidationStatus: 'awaiting-physical-validation',
  };
}

function range(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  let min = values[0] ?? 0;
  let max = min;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}
