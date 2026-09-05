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
import { SpriteAtlasCache, type AtlasArtStatus } from './animation/spriteAtlas';
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

/** Renders interaction-lab units with immutable-pack generation replacement. */
export class UnitRenderSystem {
  private readonly scene: Scene;
  private pack: PackV2;
  private packBaseUrl: string;
  private readonly atlas: SpriteAtlasCache;
  private readonly batches = new Map<string, FrameBatch>();
  private readonly archetypeByEntity = new Map<string, string>();
  private readonly capacityPerBatch: number;
  private frozenAnimation = false;
  private disposed = false;

  constructor(options: UnitRenderSystemOptions) {
    this.scene = options.scene;
    this.pack = options.pack;
    this.packBaseUrl = normalizeBaseUrl(options.packBaseUrl ?? './content/dev-pack-v2/');
    this.capacityPerBatch = options.capacityPerBatch ?? 64;
    this.atlas = new SpriteAtlasCache(this.packBaseUrl);
    void this.atlas.loadPack(options.pack).then(() => {
      if (!this.disposed) {
        this.clearBatches();
      }
    });
  }

  registerEntityArchetype(entityKey: string, archetypeId: string): void {
    if (!this.disposed) {
      this.archetypeByEntity.set(entityKey, archetypeId);
    }
  }

  unregisterEntity(entityKey: string): void {
    this.archetypeByEntity.delete(entityKey);
  }

  setFrozenAnimation(frozen: boolean): void {
    this.frozenAnimation = frozen;
  }

  getPack(): PackV2 {
    return this.pack;
  }

  getArtDiagnostics(): { assets: AtlasArtStatus[]; loadedTextures: number } {
    return this.atlas.getDiagnostics();
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
      const { batch, slot } = this.takeBatchSlot(
        batchKey,
        archetype,
        resolved.sheetFrameIndex,
        resolved.mirrorX,
      );

      const height = archetype.worldHeight;
      const boundsW = Math.max(1, archetype.bounds.maxX - archetype.bounds.minX);
      const boundsH = Math.max(1, archetype.bounds.maxY - archetype.bounds.minY);
      const width = height * (boundsW / boundsH);
      _position.set(
        entity.x + (0.5 - archetype.anchor.x) * width,
        height * (1 - archetype.anchor.y) + height / 2,
        entity.z,
      );
      _quaternion.setFromAxisAngle(_axis, ISO_AZIMUTH);
      const mirror = resolved.mirrorX ? -1 : 1;
      _scale.set(mirror * width, height, width);
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
    this.clearBatches();
    this.atlas.dispose();
    this.archetypeByEntity.clear();
  }

  /** Replace only after the caller has decided that the revision is safe. */
  hotReload(pack: PackV2, packBaseUrl = this.packBaseUrl): void {
    if (this.disposed) {
      return;
    }
    this.clearBatches();
    this.pack = pack;
    this.packBaseUrl = normalizeBaseUrl(packBaseUrl);
    void this.atlas.replacePack(pack, this.packBaseUrl).then(() => {
      if (!this.disposed) {
        this.clearBatches();
      }
    });
  }

  private findArchetype(id: string): UnitArchetype | undefined {
    return this.pack.units.find((unit) => unit.id === id);
  }

  private takeBatchSlot(
    batchKey: string,
    archetype: UnitArchetype,
    frameIndex: number,
    mirrorX: boolean,
  ): { batch: FrameBatch; slot: number } {
    let ordinal = 0;
    while (true) {
      const batch = this.ensureBatch(`${batchKey}#${ordinal}`, archetype, frameIndex, mirrorX);
      if (batch.visible < batch.capacity) {
        const slot = batch.visible;
        batch.visible += 1;
        return { batch, slot };
      }
      ordinal += 1;
    }
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

  private clearBatches(): void {
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.mesh);
      batch.mesh.geometry.dispose();
      (batch.mesh.material as MeshLambertMaterial).dispose();
      batch.mesh.dispose();
    }
    this.batches.clear();
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

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
