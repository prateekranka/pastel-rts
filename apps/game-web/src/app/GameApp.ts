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
import {
  PublishedContentClient,
  runtimeContentFromBundle,
  type ContentClientStatus,
  type LoadedRuntimeContent,
} from '../content/PublishedContentClient';
import { PointerCameraControls } from '../input/PointerCameraControls';
import { TouchDebugOverlay } from '../input/TouchDebugOverlay';
import { createRendererAdapter, type RendererAdapter } from '../renderer/adapter';
import { CameraDirector } from '../runtime/CameraDirector';
import {
  BENCHMARKS,
  developerConfigQueryPatch,
  packV2PublicBaseUrl,
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
import { validatePackV2, type PackV2 } from '@pastel-rts/content-schema';
import {
  createInteractionLab,
  type InteractionLab,
  type InteractionLabHapticReason,
} from '../sandbox/createInteractionLab';
import type { HapticReason } from '../bridge/messages';

export class GameApp {
  private adapter: RendererAdapter | null = null;
  private readonly scene = new Scene();
  private readonly iso = new IsometricCamera();
  private terrain: TerrainSystem | null = null;
  private landmarks: LandmarkSystem | null = null;
  private entities: EntityRenderer | null = null;
  private contentClient: PublishedContentClient | null = null;
  private contentAckError: string | null = null;
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
  private lab: InteractionLab | null = null;

  async start(canvas: HTMLCanvasElement, config = parseRuntimeConfig()): Promise<void> {
    assertChunkLayout();
    this.canvas = canvas;
    this.config = config;
    this.scene.background = new Color(palette.background);

    this.adapter = await createRendererAdapter(canvas, config.renderer);
    this.canvas = this.adapter.canvas;
    this.addLights();
    this.iso.applyNamedPreset(config.zoomStop);
    this.iso.setLookAt(MAP_WORLD_SIZE * 0.52, MAP_WORLD_SIZE * 0.48);
    this.terrain = new TerrainSystem(this.scene, config.seed);
    this.landmarks = new LandmarkSystem(this.scene, config.seed);
    const labMode = config.mode === 'interaction-lab';
    if (!labMode) {
      this.entities = new EntityRenderer(this.scene);
    }

    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    this.syncSize();

    this.controls = new PointerCameraControls(this.canvas, this.iso);
    if (labMode) {
      await this.startInteractionLab(config);
    } else {
      this.applyBenchmark(config);
    }
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
    const liveCanvas = this.canvas;
    this.bridge.send({
      type: 'gameReady',
      payload: {
        renderer: this.adapter.kind,
        viewport: {
          width: liveCanvas?.clientWidth ?? 0,
          height: liveCanvas?.clientHeight ?? 0,
        },
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

    if (!labMode && (config.benchmark === '20-minute-soak' || config.soakMs)) {
      this.beginUnattendedSoak(config.soakMs && config.soakMs > 0 ? config.soakMs : SOAK_DURATION_MS);
    }

    const loop = (time: number) => {
      if (this.disposed) {
        return;
      }
      const isResumeFrame = this.lastFrameAt === 0;
      const dt = isResumeFrame ? 16.6 : Math.max(0.01, time - this.lastFrameAt);
      this.lastFrameAt = time;
      const renderTime = time - this.pausedDuration;
      if (!this.paused) {
        this.director.update(dt, this.iso);
        if (this.lab) {
          this.lab.tick();
        } else {
          const count = this.sim.interpolate(this.interpolated, renderTime);
          this.entities?.applySnapshot(this.interpolated, count);
        }
      }
      this.terrain?.updateVisibility(this.iso);
      if (this.controls && this.touchDebug) {
        this.touchDebug.update(this.controls.getDebugSnapshot());
      }
      this.adapter?.render(this.scene, this.iso.camera);
      if (!isResumeFrame) {
        this.sample(dt, time);
      }
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
    this.lab?.runtime.pause();
    this.soak?.recordPause(reason === 'background' ? 'background' : 'pause');
  }

  resume(reason: 'background' | 'native' = 'native'): void {
    if (!this.paused) {
      return;
    }
    this.pausedDuration += performance.now() - this.pauseStartedAt;
    this.paused = false;
    this.lastFrameAt = 0;
    this.sim.resume();
    this.lab?.runtime.resume();
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
    this.lab?.dispose();
    this.lab = null;
    this.controls?.dispose();
    this.touchDebug?.dispose();
    this.entities?.dispose();
    this.contentClient?.dispose();
    this.contentClient = null;
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

  getInteractionLab(): InteractionLab | null {
    return this.lab;
  }

  getContentStatus(): ContentClientStatus | null {
    return this.contentClient?.getStatus() ?? null;
  }

  isInteractionLab(): boolean {
    return this.lab !== null;
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

  isAutoCameraEnabled(): boolean {
    return this.director.isEnabled();
  }

  setTouchDebugVisible(visible: boolean): void {
    this.config = { ...this.config, touchDebug: visible };
    this.touchDebug?.setVisible(visible);
  }

  isTouchDebugVisible(): boolean {
    return this.touchDebug?.isVisible() ?? false;
  }

  private beginUnattendedSoak(durationMs: number): void {
    this.director.setEnabled(true);
    this.director.reset();
    this.controls?.setEnabled(false);
    this.soak?.start(durationMs);
  }

  private bindHud(): void {
    this.hud?.setHandlers({
      onToggle: () => undefined,
      onRenderer: (kind) => reloadWithQuery({ renderer: kind }),
      onBenchmark: (name) => reloadWithQuery({ benchmark: name }),
      onDpr: (preset) => reloadWithQuery({ dpr: String(preset) }),
      onTouchDebug: (enabled) => this.setTouchDebugVisible(enabled),
      onHaptic: () => this.sendHaptic('medium', 'selection'),
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
          this.applyBenchmark(this.config);
        } else {
          this.beginUnattendedSoak(
            this.config.soakMs && this.config.soakMs > 0 ? this.config.soakMs : SOAK_DURATION_MS,
          );
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
        const patch = developerConfigQueryPatch(this.config, payload);
        if (patch) {
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
      const resources = this.adapter?.getResourceCounts() ?? { textures: 0, geometries: 0 };
      const labDiagnostics = this.lab?.getDiagnostics();
      const contentStatus = this.contentClient?.getStatus();
      const activeContent = this.lab?.getContent();
      const simTickMs = this.lab?.runtime.getTickDurationMs() ?? this.sim.getTickDurationMs();
      const navTickMs = this.lab?.runtime.getNavigationTimeMs() ?? 0;
      const snapshotLatencyMs = this.lab?.runtime.getSnapshotLatencyMs() ?? this.sim.getSnapshotLatencyMs();
      this.tracker.sample({
        frameTimeMs,
        simTimeMs: simTickMs,
        snapshotLatencyMs,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        nowMs,
      });
      const hud = this.tracker.hud();
      const viewport = this.iso.getViewport();
      this.hud?.update({
        ...hud,
        simTickMs,
        navTickMs,
        snapshotLatencyMs,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        textures: resources.textures,
        geometries: resources.geometries,
        visibleChunks: this.terrain?.getVisibleChunkCount() ?? 0,
        visibleUnits: this.lab?.runtime.getEntityCount() ?? this.entities?.getVisibleUnitCount() ?? 0,
        totalEntities: this.lab?.runtime.getEntityCount() ?? this.entities?.getVisibleEntityCount() ?? 0,
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
        activeRevision: contentStatus?.activeRevision ?? labDiagnostics?.content.revision ?? null,
        contentPhase: contentStatus?.phase ?? (this.lab ? 'ready' : 'not-applicable'),
        contentError: contentStatus?.error ?? labDiagnostics?.error ?? null,
        activeManifestHash: contentStatus?.activeManifestHash ?? labDiagnostics?.content.manifestHash ?? null,
        activeVisualContentHash: contentStatus?.activeVisualContentHash ?? labDiagnostics?.content.visualContentHash ?? null,
        activeSimulationRulesHash: contentStatus?.activeSimulationRulesHash ?? labDiagnostics?.content.simulationRulesHash ?? null,
        activeAssetBaseUrl: contentStatus?.activeAssetBaseUrl ?? activeContent?.assetBaseUrl ?? null,
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

  private sendHaptic(style: 'light' | 'medium' | 'heavy', reason: HapticReason): void {
    if (!this.config.haptics) {
      return;
    }
    this.bridge.send({ type: 'requestHaptic', payload: { style, reason } });
  }

  private labHaptic(reason: InteractionLabHapticReason): void {
    const style = reason === 'selection' ? 'light' : reason === 'invalid' ? 'heavy' : 'medium';
    this.sendHaptic(style, reason);
  }

  private async startInteractionLab(config: RuntimeConfig): Promise<void> {
    let content: LoadedRuntimeContent;
    if (config.content === 'studio') {
      const client = new PublishedContentClient({
        onInstall: async (candidate, reason) => {
          if (this.lab) {
            await this.lab.applyContent(candidate, reason);
          }
        },
        onInstalled: async (_candidate, reason) => {
          // Initial content is installed before the lab exists. Rules changes
          // are acknowledged by the explicit restart action below.
          if (!this.lab || reason === 'initial' || reason === 'restart') {
            return;
          }
          try {
            await this.acknowledgeActiveScenario(false);
          } catch {
            // acknowledgeActiveScenario stores the exact failure for the lab
            // status line. The content install itself remains observable.
          }
        },
      });
      this.contentClient = client;
      try {
        content = await client.start(config.contentRevision);
      } catch (error) {
        client.dispose();
        this.contentClient = null;
        throw error;
      }
    } else {
      const pack = await loadPackV2();
      content = runtimeContentFromBundle(pack, packV2PublicBaseUrl());
    }

    const hudRoot = document.querySelector('#hud-root');
    const canvas = this.canvas;
    const controls = this.controls;
    if (!canvas || !controls) {
      throw new Error('Interaction lab requires a canvas and camera controls');
    }
    const labOptions: Parameters<typeof createInteractionLab>[0] = {
      canvas,
      scene: this.scene,
      camera: this.iso,
      cameraControls: controls,
      pack: content.pack,
      packBaseUrl: content.assetBaseUrl,
      content,
      seed: config.seed,
      requestHaptic: (reason) => this.labHaptic(reason),
    };
    if (this.contentClient) {
      labOptions.contentStatus = () => {
        const status = this.contentClient?.getStatus() as ContentClientStatus;
        if (this.contentAckError) {
          return {
            ...status,
            error: status.error ?? `acknowledgement error: ${this.contentAckError}`,
          };
        }
        return status;
      };
      labOptions.onSelectRevision = async (revision) => {
        const selected = await this.contentClient!.selectRevision(revision);
        if (!selected) {
          throw new Error('Revision selection was superseded or disposed');
        }
        this.contentAckError = null;
      };
      labOptions.onRestartRevision = async () => {
        const restarted = await this.contentClient!.restartToPending();
        if (!restarted) {
          throw new Error('No pending revision was restarted');
        }
        this.contentAckError = null;
        await this.acknowledgeActiveScenario(true);
      };
      labOptions.onAcknowledge = async () => {
        await this.acknowledgeActiveScenario();
      };
    }
    if (hudRoot instanceof HTMLElement) {
      labOptions.hudRoot = hudRoot;
    }
    if (config.scenarioId) {
      labOptions.scenarioId = config.scenarioId;
    }
    if (config.spawnUnitId) {
      labOptions.spawnUnitId = config.spawnUnitId;
    }
    if (config.spawnBuildingId) {
      labOptions.spawnBuildingId = config.spawnBuildingId;
    }
    this.lab = createInteractionLab(labOptions);
    this.controls?.setEnabled(true);
    await this.lab.ready;
    if (this.contentClient) {
      try {
        await this.acknowledgeActiveScenario();
      } catch (error) {
        this.contentAckError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  private async acknowledgeActiveScenario(restartRequired = false): Promise<void> {
    const scenarioId = this.lab?.scenario.getCurrentScenario()?.id;
    if (!scenarioId || !this.contentClient) {
      throw new Error('No active scenario to acknowledge');
    }
    try {
      await this.contentClient.acknowledge(scenarioId, restartRequired);
      this.contentAckError = null;
    } catch (error) {
      this.contentAckError = error instanceof Error ? error.message : String(error);
      throw error;
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

async function loadPackV2(): Promise<PackV2> {
  const response = await fetch(`${packV2PublicBaseUrl()}pack.json`);
  if (!response.ok) {
    throw new Error(`Failed to load bundled Pack v2 (${String(response.status)})`);
  }
  const raw: unknown = await response.json();
  const pack = validatePackV2(raw);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw) ||
    !('contentHash' in raw) ||
    raw.contentHash !== pack.contentHash
  ) {
    throw new Error('Bundled Pack v2 content hash mismatch');
  }
  return pack;
}
