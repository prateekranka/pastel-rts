import { SUBUNITS_PER_CELL } from '@pastel-rts/content-schema';
import type { Tick } from '@pastel-rts/content-schema';
import type { EntityPool } from './entityPool.js';
import { forEachLiveEntity } from './entityPool.js';
import type { NavigationService } from './navigation.js';

export type StateChecksum = {
  tick: Tick;
  hash: number;
};

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixHash(hash: number, value: number): number {
  let next = hash;
  next ^= value & 0xff;
  next = Math.imul(next, FNV_PRIME);
  next ^= (value >>> 8) & 0xff;
  next = Math.imul(next, FNV_PRIME);
  next ^= (value >>> 16) & 0xff;
  next = Math.imul(next, FNV_PRIME);
  next ^= (value >>> 24) & 0xff;
  next = Math.imul(next, FNV_PRIME);
  return next >>> 0;
}

function mixString(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next = mixHash(next, value.charCodeAt(index));
  }
  return next;
}

export function computeStateChecksum(
  tick: Tick,
  pool: EntityPool,
  nav: NavigationService,
): StateChecksum {
  let hash = FNV_OFFSET;
  hash = mixHash(hash, tick);

  forEachLiveEntity(pool, (id, slot) => {
    hash = mixHash(hash, id.index);
    hash = mixHash(hash, id.generation);
    hash = mixHash(hash, slot.kind === 'unit' ? 1 : 2);
    hash = mixHash(hash, slot.x);
    hash = mixHash(hash, slot.z);
    hash = mixHash(hash, slot.headingMilli);
    hash = mixHash(hash, slot.movementState === 'move' ? 1 : 0);
    if (slot.destination !== null) {
      hash = mixHash(hash, slot.destination.x);
      hash = mixHash(hash, slot.destination.z);
    } else {
      hash = mixHash(hash, -1);
    }
    if (slot.kind === 'building' && slot.originCell !== null) {
      hash = mixHash(hash, slot.originCell.cx);
      hash = mixHash(hash, slot.originCell.cz);
      hash = mixHash(hash, slot.footprintCellsW);
      hash = mixHash(hash, slot.footprintCellsH);
    }
    hash = mixString(hash, slot.archetypeId);
  });

  const debug = nav.debugSnapshot();
  for (let index = 0; index < debug.blocked.length; index += 1) {
    const blocked = debug.blocked[index] ?? 0;
    hash = mixHash(hash, blocked);
  }

  return { tick, hash };
}

export function isSubunitInBounds(x: number, z: number, cellsX: number, cellsZ: number): boolean {
  const maxSubunit = cellsX * SUBUNITS_PER_CELL;
  const maxSubunitZ = cellsZ * SUBUNITS_PER_CELL;
  return x >= 0 && z >= 0 && x < maxSubunit && z < maxSubunitZ;
}

export function isCellInBounds(cx: number, cz: number, cellsX: number, cellsZ: number): boolean {
  return cx >= 0 && cz >= 0 && cx < cellsX && cz < cellsZ;
}
