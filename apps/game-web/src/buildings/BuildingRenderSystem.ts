import {
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
} from 'three';
import type { BuildingArchetype, PackV2 } from '@pastel-rts/content-schema';
import { ISO_AZIMUTH } from '../config/constants';
import { opaqueBoundsToUv, applyUvRect } from '../content/spriteUv';
import { entityIdKey, parseSnapshotEntity } from '../sandbox/snapshot';

const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3(1, 1, 1);
const _axis = new Vector3(0, 1, 0);

type BuildingBatch = {
  mesh: InstancedMesh;
  capacity: number;
  visible: number;
};

export type BuildingArtState = 'loading' | 'ready' | 'missing';

export type BuildingArtStatus = {
  archetypeId: string;
  assetPath: string;
  state: BuildingArtState;
  error: string | null;
};

export type BuildingRenderSystemOptions = {
  scene: Scene;
  pack: PackV2;
  packBaseUrl?: string;
  capacityPerArchetype?: number;
};

/** Renders building footprints and authored sprites from worker snapshots. */
export class BuildingRenderSystem {
  private readonly scene: Scene;
  private pack: PackV2;
  private packBaseUrl: string;
  private readonly loader = new TextureLoader();
  private readonly batches = new Map<string, BuildingBatch>();
  private readonly archetypeByEntity = new Map<string, string>();
  private readonly materials = new Map<string, MeshLambertMaterial>();
  private readonly artStatus = new Map<string, BuildingArtStatus>();
  private capacityPerArchetype: number;
  private generation = 0;
  private disposed = false;

  constructor(options: BuildingRenderSystemOptions) {
    this.scene = options.scene;
    this.pack = options.pack;
    this.packBaseUrl = normalizeBaseUrl(options.packBaseUrl ?? './content/dev-pack-v2/');
    this.capacityPerArchetype = options.capacityPerArchetype ?? 32;
    this.buildBatches();
  }

  registerEntityArchetype(entityKey: string, archetypeId: string): void {
    if (!this.disposed) {
      this.archetypeByEntity.set(entityKey, archetypeId);
    }
  }

  unregisterEntity(entityKey: string): void {
    this.archetypeByEntity.delete(entityKey);
  }

  getPack(): PackV2 {
    return this.pack;
  }

  getArtDiagnostics(): BuildingArtStatus[] {
    return [...this.artStatus.values()].map((status) => ({ ...status }));
  }

  getResourceCounts(): { geometries: number; textures: number } {
    return { geometries: this.batches.size, textures: this.materials.size };
  }

  applySnapshot(payload: Float32Array, entityCount: number): void {
    if (this.disposed) {
      return;
    }
    for (const batch of this.batches.values()) {
      batch.visible = 0;
    }
    for (let index = 0; index < entityCount; index += 1) {
      const entity = parseSnapshotEntity(payload, index);
      if (entity.kind !== 'building') {
        continue;
      }
      const key = entityIdKey(entity.id);
      const archetypeId = this.archetypeByEntity.get(key);
      if (!archetypeId) {
        continue;
      }
      const batch = this.batches.get(archetypeId);
      const archetype = this.findArchetype(archetypeId);
      if (!batch || !archetype) {
        continue;
      }
      const slot = batch.visible;
      batch.visible += 1;
      if (slot >= batch.capacity) {
        continue;
      }
      const height = archetype.worldHeight;
      _position.set(entity.x, height / 2, entity.z);
      _quaternion.setFromAxisAngle(_axis, ISO_AZIMUTH);
      const footprintW = archetype.footprint.cellsW;
      const footprintH = archetype.footprint.cellsH;
      _scale.set(footprintW * 0.9, height, footprintH * 0.9);
      _matrix.compose(_position, _quaternion, _scale);
      batch.mesh.setMatrixAt(slot, _matrix);
    }
    for (const batch of this.batches.values()) {
      batch.mesh.count = Math.min(batch.visible, batch.capacity);
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.clearRenderResources();
    this.archetypeByEntity.clear();
    this.artStatus.clear();
  }

  /** Replace the visual pack. The worker remains authoritative until its caller restarts it. */
  hotReload(pack: PackV2, packBaseUrl = this.packBaseUrl): void {
    if (this.disposed) {
      return;
    }
    this.generation += 1;
    this.clearRenderResources();
    this.pack = pack;
    this.packBaseUrl = normalizeBaseUrl(packBaseUrl);
    this.buildBatches();
  }

  private findArchetype(id: string): BuildingArchetype | undefined {
    return this.pack.buildings.find((building) => building.id === id);
  }

  private buildBatches(): void {
    this.artStatus.clear();
    for (const building of this.pack.buildings) {
      if (building.enabled) {
        this.ensureBatch(building);
      }
    }
  }

  private ensureBatch(archetype: BuildingArchetype): void {
    if (this.batches.has(archetype.id)) {
      return;
    }
    const geometry = new PlaneGeometry(1, 1);
    const material = this.createMaterial(archetype, this.generation);
    const uv = opaqueBoundsToUv(archetype.bounds, archetype.sourceWidth, archetype.sourceHeight);
    applyUvRect(geometry, uv);
    const mesh = new InstancedMesh(geometry, material, this.capacityPerArchetype);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.batches.set(archetype.id, { mesh, capacity: this.capacityPerArchetype, visible: 0 });
  }

  private createMaterial(archetype: BuildingArchetype, generation: number): MeshLambertMaterial {
    const existing = this.materials.get(archetype.id);
    if (existing) {
      return existing;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, archetype.sourceWidth);
    canvas.height = Math.max(1, archetype.sourceHeight);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#210d2f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ff3b81';
      ctx.fillRect(0, 0, canvas.width, Math.max(4, Math.floor(canvas.height / 5)));
      ctx.fillStyle = '#ffe6f1';
      ctx.font = `${Math.max(8, Math.floor(canvas.height / 6))}px sans-serif`;
      ctx.fillText('MISSING ART', 4, Math.max(12, Math.floor(canvas.height / 2)));
      ctx.strokeStyle = '#ffe6f1';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    }
    const placeholder = new CanvasTexture(canvas);
    configureTexture(placeholder);
    const material = new MeshLambertMaterial({
      map: placeholder,
      transparent: true,
      alphaTest: 0.08,
      side: DoubleSide,
      depthWrite: true,
    });
    this.materials.set(archetype.id, material);
    this.artStatus.set(archetype.id, {
      archetypeId: archetype.id,
      assetPath: archetype.assetPath,
      state: 'loading',
      error: null,
    });
    void this.loadAuthoredTexture(archetype, material, generation);
    return material;
  }

  private async loadAuthoredTexture(
    archetype: BuildingArchetype,
    material: MeshLambertMaterial,
    generation: number,
  ): Promise<void> {
    try {
      const texture = await this.loader.loadAsync(`${this.packBaseUrl}${archetype.assetPath}`);
      configureTexture(texture);
      if (this.disposed || generation !== this.generation || this.materials.get(archetype.id) !== material) {
        texture.dispose();
        return;
      }
      const previous = material.map;
      material.map = texture;
      material.needsUpdate = true;
      if (previous && previous !== texture) {
        previous.dispose();
      }
      this.artStatus.set(archetype.id, {
        archetypeId: archetype.id,
        assetPath: archetype.assetPath,
        state: 'ready',
        error: null,
      });
    } catch {
      if (!this.disposed && generation === this.generation && this.materials.get(archetype.id) === material) {
        this.artStatus.set(archetype.id, {
          archetypeId: archetype.id,
          assetPath: archetype.assetPath,
          state: 'missing',
          error: 'Authored building asset failed to load',
        });
      }
    }
  }

  private clearRenderResources(): void {
    const textures = new Set<Texture>();
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.mesh);
      batch.mesh.geometry.dispose();
      batch.mesh.dispose();
    }
    for (const material of this.materials.values()) {
      if (material.map) {
        textures.add(material.map);
      }
      material.dispose();
    }
    for (const texture of textures) {
      texture.dispose();
    }
    this.batches.clear();
    this.materials.clear();
  }
}

function configureTexture(texture: Texture): void {
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
