import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  DEFAULT_DPR_CAP,
  DEFAULT_SEED,
  MAP_WORLD_SIZE,
  STRESS_COUNTS,
} from '../config/constants';
import { palette } from '../config/palette';
import { IsometricCamera } from '../camera/IsometricCamera';
import { EntityRenderer } from '../entities/EntityRenderer';
import { PointerCameraControls } from '../input/PointerCameraControls';
import { TouchDebugOverlay } from '../input/TouchDebugOverlay';
import { SimClient } from '../sim/SimClient';
import { SNAPSHOT_STRIDE, totalEntities, type SimCounts } from '../sim/types';
import { LandmarkSystem } from '../world/LandmarkSystem';
import { TerrainSystem } from '../world/TerrainSystem';
import { assertChunkLayout } from '../world/chunks';

export class GameApp {
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly iso = new IsometricCamera();
  private terrain: TerrainSystem | null = null;
  private landmarks: LandmarkSystem | null = null;
  private entities: EntityRenderer | null = null;
  private readonly sim = new SimClient();
  private interpolated = new Float32Array(totalEntities(STRESS_COUNTS) * SNAPSHOT_STRIDE);
  private animationFrame = 0;
  private disposed = false;
  private paused = false;
  private pauseStartedAt = 0;
  private pausedDuration = 0;
  private readonly lights: Array<AmbientLight | HemisphereLight | DirectionalLight> = [];
  private canvas: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private visibilityHandler: (() => void) | null = null;
  private controls: PointerCameraControls | null = null;
  private touchDebug: TouchDebugOverlay | null = null;

  async start(canvas: HTMLCanvasElement): Promise<void> {
    assertChunkLayout();
    this.canvas = canvas;
    this.scene.background = new Color(palette.background);

    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setClearColor(palette.background, 1);
    renderer.autoClear = true;
    this.renderer = renderer;

    this.addLights();
    this.iso.applyNamedPreset('70-percent');
    this.iso.setLookAt(MAP_WORLD_SIZE * 0.52, MAP_WORLD_SIZE * 0.48);
    this.terrain = new TerrainSystem(this.scene, DEFAULT_SEED);
    this.landmarks = new LandmarkSystem(this.scene, DEFAULT_SEED);
    this.entities = new EntityRenderer(this.scene);

    const counts: SimCounts = { ...STRESS_COUNTS };
    this.sim.start(DEFAULT_SEED, counts, true);

    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.syncSize();

    this.controls = new PointerCameraControls(canvas, this.iso);
    const hudRoot = document.querySelector('#hud-root');
    if (hudRoot instanceof HTMLElement) {
      this.touchDebug = new TouchDebugOverlay(hudRoot);
      const params = new URLSearchParams(window.location.search);
      this.touchDebug.setVisible(params.get('touchDebug') === '1');
    }

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.pause('background');
      } else {
        this.resume('background');
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    const loop = (time: number) => {
      if (this.disposed) {
        return;
      }
      const renderTime = time - this.pausedDuration;
      if (!this.paused) {
        const count = this.sim.interpolate(this.interpolated, renderTime);
        this.entities?.applySnapshot(this.interpolated, count);
      }
      this.terrain?.updateVisibility(this.iso);
      if (this.controls && this.touchDebug) {
        this.touchDebug.update(this.controls.getDebugSnapshot());
      }
      this.renderer?.render(this.scene, this.iso.camera);
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  pause(_reason: 'background' | 'native' = 'native'): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.pauseStartedAt = performance.now();
    this.sim.pause();
  }

  resume(_reason: 'background' | 'native' = 'native'): void {
    if (!this.paused) {
      return;
    }
    this.pausedDuration += performance.now() - this.pauseStartedAt;
    this.paused = false;
    this.sim.resume();
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
    this.sim.stop();
    this.controls?.dispose();
    this.touchDebug?.dispose();
    this.entities?.dispose();
    this.terrain?.dispose();
    this.landmarks?.dispose();
    for (const light of this.lights) {
      this.scene.remove(light);
    }
    this.lights.length = 0;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
  }

  getCamera(): IsometricCamera {
    return this.iso;
  }

  setTouchDebugVisible(visible: boolean): void {
    this.touchDebug?.setVisible(visible);
  }

  isTouchDebugVisible(): boolean {
    return this.touchDebug?.isVisible() ?? false;
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
    if (!this.canvas || !this.renderer) {
      return;
    }
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const cap = DEFAULT_DPR_CAP;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.iso.setViewport(width, height);
  }
}
