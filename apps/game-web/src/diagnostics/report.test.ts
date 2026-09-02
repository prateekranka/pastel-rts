import { describe, expect, it } from 'vitest';
import { FrameTracker } from './FrameTracker';
import { buildPerformanceReport, REQUIRED_PERFORMANCE_REPORT_KEYS } from './report';

describe('FrameTracker sample retention', () => {
  it('caps idle samples and retains full series during a soak', () => {
    const tracker = new FrameTracker();
    tracker.begin(0);
    for (let i = 0; i < 2000; i += 1) {
      tracker.sample({
        frameTimeMs: 16,
        simTimeMs: 2,
        snapshotLatencyMs: 1,
        drawCalls: 10,
        triangles: 100,
        nowMs: i * 16,
      });
    }
    expect(tracker.sampleCount()).toBeLessThanOrEqual(60 * 10);
    tracker.setRetainFullSamples(true);
    tracker.begin(0);
    for (let i = 0; i < 1200; i += 1) {
      tracker.sample({
        frameTimeMs: 16,
        simTimeMs: 2,
        snapshotLatencyMs: 1,
        drawCalls: 10,
        triangles: 100,
        nowMs: i * 16,
      });
    }
    expect(tracker.sampleCount()).toBe(1200);
    const hud = tracker.hud();
    expect(hud.p95FrameTimeMs).toBeGreaterThan(0);
    expect(hud.p99FrameTimeMs).toBeGreaterThan(0);
  });
});

describe('performance report schema', () => {
  it('includes every required soak JSON field', () => {
    const report = buildPerformanceReport({
      frameTimesMs: [16, 17, 16, 40],
      simTimesMs: [2, 3, 2],
      snapshotLatenciesMs: [1, 1, 2],
      drawCalls: [12, 14],
      triangles: [1000, 1100],
      longFrames: [{ atMs: 10, frameTimeMs: 40 }],
      pauseEvents: [{ atMs: 5, type: 'pause' }],
      durationMs: 2000,
      userAgent: 'test-agent',
      viewport: { width: 1280, height: 800 },
      drawingBuffer: { width: 1920, height: 1200 },
      devicePixelRatio: 2,
      pixelRatioCap: 1.5,
      effectivePixelRatio: 1.5,
      renderer: 'webgl',
      rendererBackend: 'webgl',
      rendererRequested: 'webgpu',
      rendererInitError: 'WebGPU is not available on this browser/device',
      entityCounts: {
        combat: 120,
        workers: 40,
        buildings: 30,
        props: 200,
        total: 390,
        visibleUnits: 190,
        visibleChunks: 12,
      },
      benchmark: '20-minute-soak',
      autoCameraMotion: true,
    });
    for (const key of REQUIRED_PERFORMANCE_REPORT_KEYS) {
      expect(report).toHaveProperty(key);
    }
    expect(report.physicalValidationStatus).toBe('awaiting-physical-validation');
    expect(report.autoCameraMotion).toBe(true);
    expect(report.rendererRequested).toBe('webgpu');
    expect(report.userAgent).toBe('test-agent');
  });
});
