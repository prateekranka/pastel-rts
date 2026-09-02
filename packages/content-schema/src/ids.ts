export type EntityIndex = number;
export type EntityGeneration = number;

export type EntityId = {
  index: EntityIndex;
  generation: EntityGeneration;
};

export function isNilEntity(id: EntityId): boolean {
  return id.generation === 0;
}

export function createEntityId(index: EntityIndex, generation: EntityGeneration): EntityId {
  return { index, generation };
}

export function entityIdsEqual(a: EntityId, b: EntityId): boolean {
  return a.index === b.index && a.generation === b.generation;
}

export function packEntityId(id: EntityId): bigint {
  return (BigInt(id.generation) << 32n) | BigInt(id.index >>> 0);
}

export function unpackEntityId(packed: bigint): EntityId {
  const index = Number(packed & 0xffffffffn);
  const generation = Number(packed >> 32n);
  return { index, generation };
}
