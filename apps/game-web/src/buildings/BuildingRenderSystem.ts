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
  Vector3,
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

export type BuildingRenderSystemOptions = {
  scene: Scene;
  pack: PackV2;
  capacityPerArchetype?: number;
};

/** Renders building footprints and sprites from interaction snapshots. */
export class BuildingRenderSystem {
  private readonly scene: Scene;
  private readonly pack: PackV2;
  private readonly batches = new Map<string, BuildingBatch>();
  private readonly archetypeByEntity = new Map<string, string>();
  private readonly textures = new Map<string, MeshLambertMaterial>();

  constructor(options: BuildingRenderSystemOptions) {
    this.scene = options.scene;
    this.pack = options.pack;
    for (const building of options.pack.buildings) {
      if (building.enabled) {
        this.ensureBatch(building, options.capacityPerArchetype ?? 32);
      }
    }
  }

  registerEntityArchetype(entityKey: string, archetypeId: string): void {
    this.archetypeByEntity.set(entityKey, archetypeId);
  }

  unregisterEntity(entityKey: string): void {
    this.archetypeByEntity.delete(entityKey);
  }

  applySnapshot(payload: Float32Array, entityCount: number): void {
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
      batch.mesh.count = batch.visible;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.mesh);
      batch.mesh.geometry.dispose();
      (batch.mesh.material as MeshLambertMaterial).dispose();
      batch.mesh.dispose();
    }
    for (const material of this.textures.values()) {
      material.dispose();
    }
    this.batches.clear();
    this.textures.clear();
  }

  private findArchetype(id: string): BuildingArchetype | undefined {
    return this.pack.buildings.find((building) => building.id === id);
  }

  private ensureBatch(archetype: BuildingArchetype, capacity: number): void {
    if (this.batches.has(archetype.id)) {
      return;
    }
    const geometry = new PlaneGeometry(1, 1);
    const material = this.createMaterial(archetype);
    const uv = opaqueBoundsToUv(archetype.bounds, archetype.sourceWidth, archetype.sourceHeight);
    applyUvRect(geometry, uv);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.batches.set(archetype.id, { mesh, capacity, visible: 0 });
  }

  private createMaterial(archetype: BuildingArchetype): MeshLambertMaterial {
    const existing = this.textures.get(archetype.id);
    if (existing) {
      return existing;
    }
    const canvas = document.createElement('canvas');
    canvas.width = archetype.sourceWidth;
    canvas.height = archetype.sourceHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = archetype.factionId === 'sunweaver' ? '#efe0c4' : archetype.factionId === 'gravemark' ? '#d4c2f0' : '#5ce1e6';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#333';
      ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    const material = new MeshLambertMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      side: DoubleSide,
      depthWrite: true,
    });
    this.textures.set(archetype.id, material);
    return material;
  }
}
