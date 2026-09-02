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
  type CanvasTexture,
} from 'three';
import { ISO_AZIMUTH } from '../config/constants';
import { ENTITY_KIND, FACTION, SNAPSHOT_STRIDE } from '../sim/types';
import { ATLAS_SLOT, atlasUv, createPlaceholderAtlas } from './atlas';

const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _axis = new Vector3(0, 1, 0);

const SLOT_CAPACITY: Record<number, number> = {
  [ATLAS_SLOT.friendlyCombat]: 160,
  [ATLAS_SLOT.opposingCombat]: 160,
  [ATLAS_SLOT.friendlyWorker]: 80,
  [ATLAS_SLOT.opposingWorker]: 80,
  [ATLAS_SLOT.friendlyBuilding]: 64,
  [ATLAS_SLOT.opposingBuilding]: 64,
  [ATLAS_SLOT.mushroom]: 180,
  [ATLAS_SLOT.crystal]: 180,
  [ATLAS_SLOT.rock]: 180,
};

const SLOT_HEIGHT: Record<number, number> = {
  [ATLAS_SLOT.friendlyCombat]: 1.65,
  [ATLAS_SLOT.opposingCombat]: 1.65,
  [ATLAS_SLOT.friendlyWorker]: 1.15,
  [ATLAS_SLOT.opposingWorker]: 1.15,
  [ATLAS_SLOT.friendlyBuilding]: 2.5,
  [ATLAS_SLOT.opposingBuilding]: 2.5,
  [ATLAS_SLOT.mushroom]: 1.2,
  [ATLAS_SLOT.crystal]: 1.35,
  [ATLAS_SLOT.rock]: 0.85,
};

type SlotMesh = {
  mesh: InstancedMesh;
  geometry: PlaneGeometry;
  capacity: number;
  visible: number;
};

/**
 * Sprite-like instanced quads. One mesh per atlas slot (bounded, not per entity).
 * Planes face the fixed isometric azimuth and rest on a shared ground anchor.
 */
export class EntityRenderer {
  private readonly texture: CanvasTexture;
  private readonly material: MeshLambertMaterial;
  private readonly slots = new Map<number, SlotMesh>();
  private frozenAnimation = false;
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    this.texture = createPlaceholderAtlas();
    this.material = new MeshLambertMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.12,
      side: DoubleSide,
      depthWrite: true,
    });
    for (const slot of Object.values(ATLAS_SLOT)) {
      this.slots.set(slot, this.makeSlot(slot));
    }
  }

  setFrozenAnimation(frozen: boolean): void {
    this.frozenAnimation = frozen;
  }

  applySnapshot(payload: Float32Array, count: number): void {
    const used = new Map<number, number>();
    for (const slot of this.slots.keys()) {
      used.set(slot, 0);
    }
    for (let i = 0; i < count; i += 1) {
      const o = i * SNAPSHOT_STRIDE;
      const x = payload[o] ?? 0;
      const z = payload[o + 1] ?? 0;
      const anim = payload[o + 3] ?? 0;
      const kind = payload[o + 4] ?? 0;
      const faction = payload[o + 5] ?? 0;
      const slot = slotFor(kind, faction, i);
      const batch = this.slots.get(slot);
      if (!batch) {
        continue;
      }
      const index = used.get(slot) ?? 0;
      if (index >= batch.capacity) {
        continue;
      }
      used.set(slot, index + 1);
      const height = SLOT_HEIGHT[slot] ?? 1.2;
      const bob =
        this.frozenAnimation || kind === ENTITY_KIND.building || kind === ENTITY_KIND.prop
          ? 0
          : Math.sin(anim * Math.PI * 2) * 0.08;
      _quaternion.setFromAxisAngle(_axis, ISO_AZIMUTH + Math.PI);
      _position.set(x, height / 2 + bob, z);
      const width = kind === ENTITY_KIND.building ? height * 1.15 : height;
      _scale.set(width, height, 1);
      _matrix.compose(_position, _quaternion, _scale);
      batch.mesh.setMatrixAt(index, _matrix);
    }
    for (const [slot, batch] of this.slots) {
      const visible = used.get(slot) ?? 0;
      batch.visible = visible;
      batch.mesh.count = visible;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  getVisibleUnitCount(): number {
    let total = 0;
    for (const [slot, batch] of this.slots) {
      if (
        slot === ATLAS_SLOT.mushroom ||
        slot === ATLAS_SLOT.crystal ||
        slot === ATLAS_SLOT.rock
      ) {
        continue;
      }
      total += batch.visible;
    }
    return total;
  }

  getVisibleEntityCount(): number {
    let total = 0;
    for (const batch of this.slots.values()) {
      total += batch.visible;
    }
    return total;
  }

  dispose(): void {
    for (const batch of this.slots.values()) {
      this.scene.remove(batch.mesh);
      batch.geometry.dispose();
    }
    this.material.dispose();
    this.texture.dispose();
    this.slots.clear();
  }

  private makeSlot(slot: number): SlotMesh {
    const capacity = SLOT_CAPACITY[slot] ?? 64;
    const geometry = new PlaneGeometry(1, 1);
    const uv = atlasUv(slot);
    const uvAttr = geometry.getAttribute('uv');
    if (uvAttr) {
      for (let i = 0; i < uvAttr.count; i += 1) {
        const u = uvAttr.getX(i);
        const v = uvAttr.getY(i);
        uvAttr.setXY(i, uv.u + u * uv.w, uv.v + v * uv.h);
      }
    }
    const mesh = new InstancedMesh(geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.add(mesh);
    return { mesh, geometry, capacity, visible: 0 };
  }
}

function slotFor(kind: number, faction: number, index: number): number {
  if (kind === ENTITY_KIND.combat) {
    return faction === FACTION.opposing ? ATLAS_SLOT.opposingCombat : ATLAS_SLOT.friendlyCombat;
  }
  if (kind === ENTITY_KIND.worker) {
    return faction === FACTION.opposing ? ATLAS_SLOT.opposingWorker : ATLAS_SLOT.friendlyWorker;
  }
  if (kind === ENTITY_KIND.building) {
    return faction === FACTION.opposing ? ATLAS_SLOT.opposingBuilding : ATLAS_SLOT.friendlyBuilding;
  }
  const pick = index % 3;
  if (pick === 0) {
    return ATLAS_SLOT.mushroom;
  }
  if (pick === 1) {
    return ATLAS_SLOT.crystal;
  }
  return ATLAS_SLOT.rock;
}
