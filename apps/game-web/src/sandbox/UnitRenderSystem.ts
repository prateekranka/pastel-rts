import {
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { PackV2, UnitArchetype } from '@pastel-rts/content-schema';
import { ISO_AZIMUTH } from '../config/constants';
import { resolveUnitSpriteFrame, shouldUseMoveClip } from './animation/animationResolver';
import { SpriteAtlasCache } from './animation/spriteAtlas';
import { entityIdKey, parseSnapshotEntity } from './snapshot';

const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3(1, 1, 1);
const _axis = new Vector3(0, 1, 0);

type FrameBatch = {
  mesh: InstancedMesh;
  capacity: number;
  visible: number;
};

export type UnitRenderSystemOptions = {
  scene: Scene;
  pack: PackV2;
  packBaseUrl?: string;
  capacityPerBatch?: number;
};

/** Renders interaction-lab units with idle/move directional sprites. */
export class UnitRenderSystem {
  private readonly scene: Scene;
  private readonly pack: PackV2;
  private readonly atlas: SpriteAtlasCache;
  private readonly batches = new Map<string, FrameBatch>();
  private readonly archetypeByEntity = new Map<string, string>();
  private readonly capacityPerBatch: number;
  private frozenAnimation = false;

  constructor(options: UnitRenderSystemOptions) {
    this.scene = options.scene;
    this.pack = options.pack;
    this.capacityPerBatch = options.capacityPerBatch ?? 64;
    this.atlas = new SpriteAtlasCache(options.packBaseUrl);
    void this.atlas.loadPack(options.pack);
  }

  registerEntityArchetype(entityKey: string, archetypeId: string): void {
    this.archetypeByEntity.set(entityKey, archetypeId);
  }

  unregisterEntity(entityKey: string): void {
    this.archetypeByEntity.delete(entityKey);
  }

  setFrozenAnimation(frozen: boolean): void {
    this.frozenAnimation = frozen;
  }

  applySnapshot(payload: Float32Array, entityCount: number): void {
    for (const batch of this.batches.values()) {
      batch.visible = 0;
    }

    for (let index = 0; index < entityCount; index += 1) {
      const entity = parseSnapshotEntity(payload, index);
      if (entity.kind !== 'unit') {
        continue;
      }
      const key = entityIdKey(entity.id);
      const archetypeId = this.archetypeByEntity.get(key);
      if (!archetypeId) {
        continue;
      }
      const archetype = this.findArchetype(archetypeId);
      if (!archetype) {
        continue;
      }
      const animState = shouldUseMoveClip(entity.animState) ? 'move' : 'idle';
      const phase = this.frozenAnimation ? 0 : entity.animPhase;
      const resolved = resolveUnitSpriteFrame(archetype, animState, entity.headingRadians, phase);
      const batchKey = `${archetypeId}:${String(resolved.sheetFrameIndex)}:${resolved.mirrorX ? '1' : '0'}`;
      const batch = this.ensureBatch(batchKey, archetype, resolved.sheetFrameIndex, resolved.mirrorX);
      const slot = batch.visible;
      batch.visible += 1;
      if (slot >= batch.capacity) {
        continue;
      }

      const height = archetype.worldHeight;
      _position.set(entity.x, height / 2, entity.z);
      _quaternion.setFromAxisAngle(_axis, ISO_AZIMUTH);
      const mirror = resolved.mirrorX ? -1 : 1;
      _scale.set(mirror * height * 0.5, height, height * 0.5);
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
    this.batches.clear();
    this.atlas.dispose();
  }

  hotReload(pack: PackV2): void {
    this.dispose();
    this.atlas.dispose();
    void this.atlas.loadPack(pack);
  }

  private findArchetype(id: string): UnitArchetype | undefined {
    return this.pack.units.find((unit) => unit.id === id);
  }

  private ensureBatch(
    batchKey: string,
    archetype: UnitArchetype,
    frameIndex: number,
    mirrorX: boolean,
  ): FrameBatch {
    const existing = this.batches.get(batchKey);
    if (existing) {
      return existing;
    }
    const atlasEntry = this.atlas.getForArchetype(archetype);
    const geometry = new PlaneGeometry(1, 1);
    const uv = this.atlas.frameUv(archetype, frameIndex);
    applyUvRect(geometry, uv, mirrorX);
    const material = new MeshLambertMaterial({
      map: atlasEntry.texture,
      transparent: true,
      alphaTest: 0.08,
      side: DoubleSide,
      depthWrite: true,
    });
    const mesh = new InstancedMesh(geometry, material, this.capacityPerBatch);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const batch: FrameBatch = { mesh, capacity: this.capacityPerBatch, visible: 0 };
    this.batches.set(batchKey, batch);
    return batch;
  }
}

function applyUvRect(
  geometry: PlaneGeometry,
  uv: { u: number; v: number; w: number; h: number },
  mirrorX: boolean,
): void {
  const uvAttr = geometry.getAttribute('uv');
  for (let i = 0; i < uvAttr.count; i += 1) {
    let u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    if (mirrorX) {
      u = 1 - u;
    }
    uvAttr.setXY(i, uv.u + u * uv.w, uv.v + v * uv.h);
  }
  uvAttr.needsUpdate = true;
}
