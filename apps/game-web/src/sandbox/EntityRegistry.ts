import type { EntityId } from '@pastel-rts/content-schema';
import { entityIdKey } from './snapshot';
import type { EntityArchetypeRecord } from './types';

/** Tracks entity id → archetype mapping from spawn/place command results. */
export class EntityRegistry {
  private readonly records = new Map<string, EntityArchetypeRecord>();

  set(id: EntityId, record: EntityArchetypeRecord): void {
    this.records.set(entityIdKey(id), record);
  }

  get(id: EntityId): EntityArchetypeRecord | undefined {
    return this.records.get(entityIdKey(id));
  }

  delete(id: EntityId): void {
    this.records.delete(entityIdKey(id));
  }

  clear(): void {
    this.records.clear();
  }

  entries(): IterableIterator<[string, EntityArchetypeRecord]> {
    return this.records.entries();
  }
}
