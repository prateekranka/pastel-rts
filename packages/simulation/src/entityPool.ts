import type { CellCoord, EntityId, MoveFormation, SubunitCoord } from '@pastel-rts/content-schema';
import { createEntityId, entityIdsEqual, isNilEntity } from '@pastel-rts/content-schema';
import type { FactionId } from '@pastel-rts/content-schema';

export type EntityKind = 'unit' | 'building';

export type MovementState = 'idle' | 'move';

export type EntitySlot = {
  generation: number;
  alive: boolean;
  kind: EntityKind;
  archetypeId: string;
  factionId: FactionId;
  x: number;
  z: number;
  headingMilli: number;
  movementState: MovementState;
  destination: SubunitCoord | null;
  formation: MoveFormation | null;
  originCell: CellCoord | null;
  footprintCellsW: number;
  footprintCellsH: number;
  animPhase: number;
};

export type EntityPool = {
  capacity: number;
  slots: EntitySlot[];
  liveCount: number;
};

function createEmptySlot(): EntitySlot {
  return {
    generation: 0,
    alive: false,
    kind: 'unit',
    archetypeId: '',
    factionId: 'neutral',
    x: 0,
    z: 0,
    headingMilli: 0,
    movementState: 'idle',
    destination: null,
    formation: null,
    originCell: null,
    footprintCellsW: 0,
    footprintCellsH: 0,
    animPhase: 0,
  };
}

export function createEntityPool(capacity: number): EntityPool {
  const slots: EntitySlot[] = [];
  for (let index = 0; index < capacity; index += 1) {
    slots.push(createEmptySlot());
  }
  return { capacity, slots, liveCount: 0 };
}

export function resolveEntity(pool: EntityPool, id: EntityId): EntitySlot | 'stale' | 'invalid' {
  if (isNilEntity(id)) {
    return 'invalid';
  }
  if (id.index < 0 || id.index >= pool.capacity) {
    return 'invalid';
  }
  const slot = pool.slots[id.index];
  if (slot === undefined) {
    return 'invalid';
  }
  if (!slot.alive || slot.generation !== id.generation) {
    return 'stale';
  }
  return slot;
}

export function allocateEntity(pool: EntityPool): EntityId | null {
  for (let index = 0; index < pool.capacity; index += 1) {
    const slot = pool.slots[index];
    if (slot === undefined) {
      continue;
    }
    if (!slot.alive) {
      if (slot.generation === 0) {
        slot.generation = 1;
      }
      slot.alive = true;
      slot.movementState = 'idle';
      slot.destination = null;
      slot.formation = null;
      slot.animPhase = 0;
      pool.liveCount += 1;
      return createEntityId(index, slot.generation);
    }
  }
  return null;
}

export function releaseEntity(pool: EntityPool, id: EntityId): boolean {
  const slot = resolveEntity(pool, id);
  if (slot === 'stale' || slot === 'invalid') {
    return false;
  }
  slot.alive = false;
  slot.movementState = 'idle';
  slot.destination = null;
  slot.formation = null;
  slot.originCell = null;
  slot.footprintCellsW = 0;
  slot.footprintCellsH = 0;
  slot.generation += 1;
  pool.liveCount -= 1;
  return true;
}

/** Iterate live entities in ascending index order (deterministic). */
export function forEachLiveEntity(
  pool: EntityPool,
  callback: (id: EntityId, slot: EntitySlot) => void,
): void {
  for (let index = 0; index < pool.capacity; index += 1) {
    const slot = pool.slots[index];
    if (slot === undefined || !slot.alive) {
      continue;
    }
    callback(createEntityId(index, slot.generation), slot);
  }
}

export function entityIdFromSlot(index: number, slot: EntitySlot): EntityId {
  return createEntityId(index, slot.generation);
}

export function isSameEntity(a: EntityId, b: EntityId): boolean {
  return entityIdsEqual(a, b);
}
