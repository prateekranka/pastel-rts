import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
} from 'three';
import { MAP_WORLD_SIZE, SOAK_DURATION_MS, STRESS_COUNTS } from '../config/constants';
import { palette } from '../config/palette';
import { NativeBridge } from '../bridge/NativeBridge';
import { IsometricCamera } from '../camera/IsometricCamera';
import { FrameTracker } from '../diagnostics/FrameTracker';
import { DiagnosticsHud } from '../diagnostics/Hud';
import { SoakController, downloadReport } from '../diagnostics/SoakController';
import { EntityRenderer } from '../entities/EntityRenderer';
import { ContentHotReload } from '../content/ContentHotReload';
import { PointerCameraControls } from '../input/PointerCameraControls';
import { TouchDebugOverlay } from '../input/TouchDebugOverlay';
import { createRendererAdapter, type RendererAdapter } from '../renderer/adapter';
import { CameraDirector } from '../runtime/CameraDirector';
import {
  BENCHMARKS,
  parseRuntimeConfig,
  pixelRatioForPreset,
  reloadWithQuery,
  type RuntimeConfig,
} from '../runtime/config';
import { SimClient } from '../sim/SimClient';
import { SNAPSHOT_STRIDE, totalEntities, type SimCounts } from '../sim/types';
import { LandmarkSystem } from '../world/LandmarkSystem';
import { TerrainSystem } from '../world/TerrainSystem';
import { assertChunkLayout } from '../world/chunks';

export class GameApp {
  private adapter: RendererAdapter | null = null;
  private readonly scene = new Scene();
  private readonly iso = new IsometricCamera();
  private terrain: TerrainSystem | null = null;
  private landmarks: LandmarkSystem | null = null;
  private entities: EntityRenderer | null = null;
  private hotReload: ContentHotReload | null = null;
  private readonly sim = new SimClient();
  private interpolated = new Float32Array(totalEntities(STRESS_COUNTS) * SNAPSHOT_STRIDE);
  private animationFrame = 0;
  private disposed = false;
  private paused = false;
  private pauseStartedAt = 0;
  private pausedDuration = 0;
  private lastFrameAt = 0;
  private readonly lights: Array<AmbientLight | HemisphereLight | DirectionalLight> = [];
  private canvas: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private visibilityHandler: (() => void) | null = null;
  private controls: PointerCameraControls | null = null;
  private touchDebug: TouchDebugOverlay | null = null;
  private readonly director = new CameraDirector();
  private config: RuntimeConfig = parseRuntimeConfig('');
  private readonly tracker = new FrameTracker();
  private readonly bridge = new NativeBridge();
  private hud: DiagnosticsHud | null = null;
  private soak: SoakController | null = null;
  private unbindNative: (() => void) | null = null;

  async start(canvas: HTMLCanvasElement, config = parseRuntimeConfig()): Promise<void> {
    assertChunkLayout();
    this.canvas = canvas;
    this.config = config;
    this.scene.background = new Color(palette.background);

    this.adapter = await createRendererAdapter(canvas, config.renderer);
    this.addLights();
    this.iso.applyNamedPreset(config.zoomStop);
    this.iso.setLookAt(MAP_WORLD_SIZE * 0.52, MAP_WORLD_SIZE * 0.48);
    this.terrain = new TerrainSystem(this.scene, config.seed);
    this.landmarks = new LandmarkSystem(this.scene, config.seed);
    this.entities = new EntityRenderer(this.scene);
    this.hotReload = new ContentHotReload(this.scene);
    this.hotReload.start();

    this.applyBenchmark(config);

    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.syncSize();

    this.controls = new PointerCameraControls(canvas, this.iso);
    const hudRoot = document.querySelector('#hud-root');
    if (hudRoot instanceof HTMLElement) {
      this.touchDebug = new TouchDebugOverlay(hudRoot);
      this.touchDebug.setVisible(config.touchDebug);
      if (config.benchmark !== 'visual-capture') {
        this.hud = new DiagnosticsHud(hudRoot);
        this.hud.syncConfig(config);
        this.bindHud();
      }
    }

    this.soak = new SoakController(this, this.tracker, this.bridge);
    this.tracker.begin();
    this.bindNative();
    this.bridge.send({
      type: 'gameReady',
      payload: {
        renderer: this.adapter.kind,
        viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
      },
    });

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.pause('background');
      } else {
        this.resume('background');
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    if (config.benchmark === '20-minute-soak' || config.soakMs) {
      this.soak.start(config.soakMs && config.soakMs > 0 ? config.soakMs : SOAK_DURATION_MS);
    }

    const loop = (time: number) => {
      if (this.disposed) {
        return;
      }
      const dt = this.lastFrameAt === 0 ? 16.6 : Math.max(0.01, time - this.lastFrameAt);
      this.lastFrameAt = time;
      const renderTime = time - this.pausedDuration;
      if (!this.paused) {
        this.director.update(dt, this.iso);
        const count = this.sim.interpolate(this.interpolated, renderTime);
        this.entities?.applySnapshot(this.interpolated, count);
      }
      this.terrain?.updateVisibility(this.iso);
      if (this.controls && this.touchDebug) {
        this.touchDebug.update(this.controls.getDebugSnapshot());
      }
      this.adapter?.render(this.scene, this.iso.camera);
      this.sample(dt, time);
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  applyBenchmark(config: RuntimeConfig): void {
    this.config = config;
    const def = BENCHMARKS[config.benchmark];
    this.entities?.setFrozenAnimation(def.freezeAnimation);
    this.director.setEnabled(def.autoPan);
    this.director.reset();
    this.ensureBuffer(def.counts);
    this.sim.setPopulation(config.seed, def.counts, def.concentrate, def.freezeAnimation);
    this.controls?.setEnabled(!def.autoPan && !def.freezeAnimation);
  }

  pause(reason: 'background' | 'native' = 'native'): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.pauseStartedAt = performance.now();
    this.sim.pause();
    this.soak?.recordPause(reason === 'background' ? 'background' : 'pause');
  }

  resume(reason: 'background' | 'native' = 'native'): void {
    if (!this.paused) {
      return;
    }
    this.pausedDuration += performance.now() - this.pauseStartedAt;
    this.paused = false;
    this.sim.resume();
    this.soak?.recordPause(reason === 'background' ? 'foreground' : 'resume');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.unbindNative?.();
    this.soak?.dispose();
    this.hud?.dispose();
    this.bridge.dispose();
    this.sim.stop();
    this.controls?.dispose();
    this.touchDebug?.dispose();
    this.entities?.dispose();
    this.hotReload?.dispose();
    this.terrain?.dispose();
    this.landmarks?.dispose();
    for (const light of this.lights) {
      this.scene.remove(light);
    }
    this.lights.length = 0;
    this.adapter?.dispose();
    this.adapter = null;
    this.canvas = null;
  }

  getCamera(): IsometricCamera {
    return this.iso;
  }

  getRenderer(): RendererAdapter | null {
    return this.adapter;
  }

  getConfig(): RuntimeConfig {
    return this.config;
  }

  getSim(): SimClient {
    return this.sim;
  }

  getEntities(): EntityRenderer | null {
    return this.entities;
  }

  getTerrain(): TerrainSystem | null {
    return this.terrain;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setTouchDebugVisible(visible: boolean): void {
    this.config = { ...this.config, touchDebug: visible };
    this.touchDebug?.setVisible(visible);
  }

  isTouchDebugVisible(): boolean {
    return this.touchDebug?.isVisible() ?? false;
  }

  private bindHud(): void {
    this.hud?.setHandlers({
      onToggle: () => undefined,
      onRenderer: (kind) => reloadWithQuery({ renderer: kind }),
      onBenchmark: (name) => reloadWithQuery({ benchmark: name }),
      onDpr: (preset) => reloadWithQuery({ dpr: String(preset) }),
      onTouchDebug: (enabled) => this.setTouchDebugVisible(enabled),
      onHaptic: () => this.bridge.send({ type: 'requestHaptic', payload: { style: 'medium' } }),
      onDownloadReport: () => {
        const report = this.soak?.captureReport();
        if (report) {
          downloadReport(report);
          this.bridge.send({ type: 'performanceReport', payload: report });
        }
      },
      onToggleSoak: () => {
        if (!this.soak) {
          return;
        }
        if (this.soak.isRunning()) {
          const report = this.soak.cancelOrFinish();
          downloadReport(report);
          this.bridge.send({ type: 'performanceReport', payload: report });
        } else {
          this.soak.start(this.config.soakMs && this.config.soakMs > 0 ? this.config.soakMs : SOAK_DURATION_MS);
        }
      },
    });
  }

  private bindNative(): void {
    this.unbindNative = this.bridge.onNativeMessage((message) => {
      if (message.type === 'pause') {
        this.pause('native');
      } else if (message.type === 'resume') {
        this.resume('native');
      } else {
        const payload = message.payload;
        if (payload.renderer || payload.benchmark || payload.dprPreset) {
          const patch: Record<string, string> = {};
          if (payload.renderer) {
            patch['renderer'] = payload.renderer;
          }
          if (payload.benchmark) {
            patch['benchmark'] = payload.benchmark;
          }
          if (payload.dprPreset) {
            patch['dpr'] = String(payload.dprPreset);
          }
          reloadWithQuery(patch);
          return;
        }
        if (typeof payload.touchDebug === 'boolean') {
          this.setTouchDebugVisible(payload.touchDebug);
        }
        if (typeof payload.haptics === 'boolean') {
          this.config = { ...this.config, haptics: payload.haptics };
        }
      }
    });
  }

  private sample(frameTimeMs: number, nowMs: number): void {
    try {
      const stats = this.adapter?.getStats() ?? { drawCalls: 0, triangles: 0 };
      this.tracker.sample({
        frameTimeMs,
        simTimeMs: this.sim.getTickDurationMs(),
        snapshotLatencyMs: this.sim.getSnapshotLatencyMs(),
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        nowMs,
      });
      const hud = this.tracker.hud();
      const viewport = this.iso.getViewport();
      this.hud?.update({
        ...hud,
        simTickMs: this.sim.getTickDurationMs(),
        snapshotLatencyMs: this.sim.getSnapshotLatencyMs(),
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        visibleChunks: this.terrain?.getVisibleChunkCount() ?? 0,
        visibleUnits: this.entities?.getVisibleUnitCount() ?? 0,
        totalEntities: this.entities?.getVisibleEntityCount() ?? 0,
        renderer: this.adapter?.kind ?? 'webgl',
        rendererBackend: this.adapter?.backend ?? 'webgl',
        rendererRequested: this.adapter?.requested ?? this.config.renderer,
        rendererInitError: this.adapter?.initError ?? null,
        dprPreset: this.config.dprPreset,
        effectiveDpr: this.adapter?.getPixelRatio() ?? 1,
        viewport,
        drawingBuffer: this.adapter?.getDrawingBufferSize() ?? { width: 0, height: 0 },
        elapsedMs: this.tracker.durationMs(nowMs),
        soakActive: this.soak?.isRunning() ?? false,
        counts: this.sim.getCounts(),
      });
    } catch (error) {
      console.warn('Diagnostics sample failed', error);
    }
  }

  private ensureBuffer(counts: SimCounts): void {
    const needed = totalEntities(counts) * SNAPSHOT_STRIDE;
    if (this.interpolated.length < needed) {
      this.interpolated = new Float32Array(needed);
    }
  }

  private addLights(): void {
    const hemi = new HemisphereLight(0xd8f0f2, palette.terrainDark, 0.9);
    const sun = new DirectionalLight(0xfff1d6, 0.85);
    sun.position.set(40, 80, 18);
    const ambient = new AmbientLight(0xffffff, 0.18);
    this.scene.add(hemi, sun, ambient);
    this.lights.push(hemi, sun, ambient);
  }

  private syncSize(): void {
    if (!this.canvas || !this.adapter) {
      return;
    }
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const dpr = pixelRatioForPreset(this.config.dprPreset, window.devicePixelRatio || 1);
    this.adapter.setPixelRatio(dpr);
    this.adapter.setSize(width, height);
    this.iso.setViewport(width, height);
  }
}

export { parseRuntimeConfig };
