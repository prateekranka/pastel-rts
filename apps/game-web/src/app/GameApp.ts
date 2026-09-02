import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
  WebGLRenderer,
} from 'three';
import { DEFAULT_DPR_CAP, DEFAULT_SEED, MAP_WORLD_SIZE } from '../config/constants';
import { palette } from '../config/palette';
import { IsometricCamera } from '../camera/IsometricCamera';
import { LandmarkSystem } from '../world/LandmarkSystem';
import { TerrainSystem } from '../world/TerrainSystem';
import { assertChunkLayout } from '../world/chunks';

export class GameApp {
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly iso = new IsometricCamera();
  private terrain: TerrainSystem | null = null;
  private landmarks: LandmarkSystem | null = null;
  private animationFrame = 0;
  private disposed = false;
  private readonly lights: Array<AmbientLight | HemisphereLight | DirectionalLight> = [];
  private canvas: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  async start(canvas: HTMLCanvasElement): Promise<void> {
    assertChunkLayout();
    this.canvas = canvas;
    this.scene.background = new Color(palette.background);
    this.scene.fog = null;

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

    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.syncSize();

    const loop = (time: number) => {
      if (this.disposed) {
        return;
      }
      void time;
      this.terrain?.updateVisibility(this.iso);
      this.renderer?.render(this.scene, this.iso.camera);
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
