import { SOAK_DURATION_MS } from '../config/constants';
import type { NativeBridge } from '../bridge/NativeBridge';
import { buildPerformanceReport, type PauseEvent, type PerformanceReport } from './report';
import type { FrameTracker } from './FrameTracker';
import type { RendererAdapter } from '../renderer/adapter';
import type { RuntimeConfig } from '../runtime/config';
import type { SimClient } from '../sim/SimClient';
import type { EntityRenderer } from '../entities/EntityRenderer';
import type { TerrainSystem } from '../world/TerrainSystem';

export type SoakHost = {
  getRenderer: () => RendererAdapter | null;
  getConfig: () => RuntimeConfig;
  getSim: () => SimClient;
  getEntities: () => EntityRenderer | null;
  getTerrain: () => TerrainSystem | null;
  isAutoCameraEnabled: () => boolean;
};

export class SoakController {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private durationMs = SOAK_DURATION_MS;
  private readonly pauseEvents: PauseEvent[] = [];

  constructor(
    private readonly host: SoakHost,
    private readonly tracker: FrameTracker,
    private readonly bridge: NativeBridge,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  recordPause(type: PauseEvent['type']): void {
    this.pauseEvents.push({ atMs: this.tracker.durationMs(), type });
  }

  start(durationMs = SOAK_DURATION_MS): void {
    this.stopTimer();
    this.running = true;
    this.startedAt = performance.now();
    this.durationMs = durationMs;
    this.pauseEvents.length = 0;
    this.tracker.setRetainFullSamples(true);
    this.tracker.begin();
    this.timer = setTimeout(() => {
      const report = this.finish();
      downloadReport(report);
      this.bridge.send({ type: 'performanceReport', payload: report });
    }, durationMs);
  }

  cancelOrFinish(): PerformanceReport {
    return this.finish();
  }

  captureReport(): PerformanceReport {
    const adapter = this.host.getRenderer();
    const config = this.host.getConfig();
    const sample = this.tracker.snapshot();
    const canvas = document.querySelector('#game-canvas');
    const viewport = {
      width: canvas instanceof HTMLCanvasElement ? canvas.clientWidth : window.innerWidth,
      height: canvas instanceof HTMLCanvasElement ? canvas.clientHeight : window.innerHeight,
    };
    const drawingBuffer = adapter?.getDrawingBufferSize() ?? { width: 0, height: 0 };
    const counts = this.host.getSim().getCounts();
    return buildPerformanceReport({
      ...sample,
      pauseEvents: this.pauseEvents,
      userAgent: navigator.userAgent,
      viewport,
      drawingBuffer,
      devicePixelRatio: window.devicePixelRatio || 1,
      pixelRatioCap: config.dprPreset,
      effectivePixelRatio: adapter?.getPixelRatio() ?? 1,
      renderer: adapter?.kind ?? 'webgl',
      rendererBackend: adapter?.backend ?? 'webgl',
      rendererRequested: adapter?.requested ?? config.renderer,
      rendererInitError: adapter?.initError ?? null,
      entityCounts: {
        combat: counts?.combat ?? 0,
        workers: counts?.workers ?? 0,
        buildings: counts?.buildings ?? 0,
        props: counts?.props ?? 0,
        total:
          (counts?.combat ?? 0) +
          (counts?.workers ?? 0) +
          (counts?.buildings ?? 0) +
          (counts?.props ?? 0),
        visibleUnits: this.host.getEntities()?.getVisibleUnitCount() ?? 0,
        visibleChunks: this.host.getTerrain()?.getVisibleChunkCount() ?? 0,
      },
      benchmark: config.benchmark,
      autoCameraMotion: this.host.isAutoCameraEnabled(),
    });
  }

  private finish(): PerformanceReport {
    this.running = false;
    this.stopTimer();
    const report = this.captureReport();
    this.tracker.setRetainFullSamples(false);
    return report;
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stopTimer();
    this.running = false;
  }

  getStartedAt(): number {
    return this.startedAt;
  }

  getDurationMs(): number {
    return this.durationMs;
  }
}

export function downloadReport(report: PerformanceReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = report.timestamp.replace(/[:.]/g, '-');
  anchor.href = url;
  anchor.download = `pastel-rts-perf-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
