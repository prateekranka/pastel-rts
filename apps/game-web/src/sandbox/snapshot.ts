import {
  INTERACTION_SNAPSHOT_STRIDE,
  SNAPSHOT_ANIM_IDLE,
  SNAPSHOT_ANIM_MOVE,
  SNAPSHOT_KIND_BUILDING,
  SNAPSHOT_KIND_UNIT,
} from '@pastel-rts/simulation';
import type { EntityId } from '@pastel-rts/content-schema';
import type { EntityRelationship, PickableEntity } from '../selection/types';

export {
  INTERACTION_SNAPSHOT_STRIDE,
  SNAPSHOT_ANIM_IDLE,
  SNAPSHOT_ANIM_MOVE,
  SNAPSHOT_KIND_BUILDING,
  SNAPSHOT_KIND_UNIT,
};

export type ParsedSnapshotEntity = {
  id: EntityId;
  x: number;
  z: number;
  headingRadians: number;
  animPhase: number;
  kind: 'unit' | 'building';
  relationship: EntityRelationship;
  animState: 'idle' | 'move';
  facingIndex: number;
};

const RELATIONSHIP_MAP: Record<number, EntityRelationship> = {
  0: 'friendly',
  1: 'opposing',
  2: 'neutral',
};

export function parseSnapshotEntity(payload: Float32Array, index: number): ParsedSnapshotEntity {
  const offset = index * INTERACTION_SNAPSHOT_STRIDE;
  const kindCode = payload[offset + 4] ?? 0;
  const relationshipCode = payload[offset + 5] ?? 0;
  const animCode = payload[offset + 8] ?? SNAPSHOT_ANIM_IDLE;
  return {
    x: payload[offset] ?? 0,
    z: payload[offset + 1] ?? 0,
    headingRadians: payload[offset + 2] ?? 0,
    animPhase: payload[offset + 3] ?? 0,
    kind: kindCode === SNAPSHOT_KIND_BUILDING ? 'building' : 'unit',
    relationship: RELATIONSHIP_MAP[relationshipCode] ?? 'neutral',
    animState: animCode === SNAPSHOT_ANIM_MOVE ? 'move' : 'idle',
    facingIndex: Math.round(payload[offset + 9] ?? 0) % 8,
    id: {
      index: Math.round(payload[offset + 6] ?? 0),
      generation: Math.round(payload[offset + 7] ?? 0),
    },
  };
}

export function snapshotToPickable(
  entity: ParsedSnapshotEntity,
  archetypeId: string,
  selectionRadius: number,
  worldHeight?: number,
): PickableEntity {
  const pickable: PickableEntity = {
    id: entity.id,
    archetypeId,
    kind: entity.kind,
    relationship: entity.relationship,
    x: entity.x,
    z: entity.z,
    selectionRadius,
  };
  if (worldHeight !== undefined) {
    pickable.worldHeight = worldHeight;
  }
  return pickable;
}

export function entityIdKey(id: EntityId): string {
  return `${String(id.index)}:${String(id.generation)}`;
}
