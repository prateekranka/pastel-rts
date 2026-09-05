import type { EntityId } from '@pastel-rts/content-schema';
import type { EntityArchetypeRecord } from './types';
import { entityIdKey } from './snapshot';

/**
 * Main-thread identity registry. Entity ids include the worker generation, so a
 * recycled slot can never inherit an old archetype or pick target.
 */
export class EntityRegistry {
  private readonly byId = new Map<string, EntityArchetypeRecord>();

  set(id: EntityId, record: EntityArchetypeRecord): void {
    this.byId.set(entityIdKey(id), { ...record });
  }

  get(id: EntityId): EntityArchetypeRecord | undefined {
    return this.byId.get(entityIdKey(id));
  }

  delete(id: EntityId): void {
    this.byId.delete(entityIdKey(id));
  }

  /** Remove ids that are no longer present in the latest worker snapshot. */
  reconcile(liveIds: readonly EntityId[]): string[] {
    const live = new Set(liveIds.map((id) => entityIdKey(id)));
    const removed: string[] = [];
    for (const key of this.byId.keys()) {
      if (!live.has(key)) {
        this.byId.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }

  entries(): Array<{ id: string; record: EntityArchetypeRecord }> {
    return [...this.byId.entries()].map(([id, record]) => ({ id, record: { ...record } }));
  }

  clear(): void {
    this.byId.clear();
  }

  size(): number {
    return this.byId.size;
  }
}
