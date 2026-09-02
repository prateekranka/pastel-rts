import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  Texture,
  TextureLoader,
} from 'three';
import { ISO_AZIMUTH, MAP_WORLD_SIZE } from '../config/constants';
import { validateUnitManifest, type UnitManifest } from '@pastel-rts/content-schema';

const CONTENT_BASE = '/dev-content';

/**
 * Dev-only: listen for Foundry publishes and spawn textured proxies.
 * Loads PNG + manifest from the content server (files on disk), not Blob URLs.
 */
export class ContentHotReload {
  private source: EventSource | null = null;
  private readonly meshes: Mesh[] = [];
  private geometry: PlaneGeometry | null = null;
  private material: MeshBasicMaterial | null = null;
  private texture: Texture | null = null;
  private readonly loader = new TextureLoader();
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  start(): void {
    void this.refreshPack();
    try {
      this.source = new EventSource(`${CONTENT_BASE}/events`);
      this.source.onmessage = (event) => {
        try {
          const parsed: unknown = JSON.parse(event.data);
          if (!parsed || typeof parsed !== 'object' || !('manifest' in parsed)) {
            return;
          }
          const manifest = validateUnitManifest((parsed as { manifest: unknown }).manifest);
          void this.spawn(manifest);
        } catch (error) {
          console.warn('Hot-reload message ignored', error);
        }
      };
    } catch (error) {
      console.info('Content server not available', error);
    }
  }

  dispose(): void {
    this.source?.close();
    this.source = null;
    this.clearMeshes();
  }

  private async refreshPack(): Promise<void> {
    try {
      const response = await fetch(`${CONTENT_BASE}/pack`);
      if (!response.ok) {
        return;
      }
      const pack: unknown = await response.json();
      if (!pack || typeof pack !== 'object' || !('units' in pack) || !Array.isArray(pack.units)) {
        return;
      }
      const last = pack.units[pack.units.length - 1];
      if (last) {
        await this.spawn(validateUnitManifest(last));
      }
    } catch {
      // Content server is optional outside local foundry workflows.
    }
  }

  private async spawn(manifest: UnitManifest): Promise<void> {
    if (!manifest.enabled) {
      return;
    }
    this.clearMeshes();
    const url = `${CONTENT_BASE}/${manifest.assetPath}?t=${Date.now()}`;
    this.texture = await this.loader.loadAsync(url);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    const bw = Math.max(1, manifest.bounds.maxX - manifest.bounds.minX);
    const bh = Math.max(1, manifest.bounds.maxY - manifest.bounds.minY);
    const height = manifest.worldHeight;
    const width = height * (bw / bh);
    this.geometry = new PlaneGeometry(width, height);
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.08,
      side: DoubleSide,
      depthWrite: true,
    });
    for (let i = 0; i < 4; i += 1) {
      const mesh = new Mesh(this.geometry, this.material);
      mesh.rotation.y = ISO_AZIMUTH + Math.PI;
      const x = MAP_WORLD_SIZE * 0.55 + i * 2.2 + (0.5 - manifest.anchor.x) * width;
      mesh.position.set(x, height * (1 - manifest.anchor.y) + height / 2, MAP_WORLD_SIZE * 0.5);
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private clearMeshes(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
    }
    this.meshes.length = 0;
    this.geometry?.dispose();
    this.geometry = null;
    this.material?.dispose();
    this.material = null;
    this.texture?.dispose();
    this.texture = null;
  }
}
