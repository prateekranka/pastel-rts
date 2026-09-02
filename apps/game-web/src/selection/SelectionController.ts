import { entityIdsEqual, type EntityId } from '@pastel-rts/content-schema';
import { DOUBLE_TAP_SELECT_CAP } from '../input/gestureConstants';
import type { PickableEntity } from './types';

export type SelectionChangeListener = (selected: readonly EntityId[]) => void;

/**
 * Tracks selected entity ids. Supports additive desktop selection and
 * double-tap same-archetype grouping.
 */
export class SelectionController {
  private readonly selected = new Map<string, EntityId>();
  private readonly listeners = new Set<SelectionChangeListener>();

  getSelected(): EntityId[] {
    return [...this.selected.values()];
  }

  isSelected(id: EntityId): boolean {
    return this.selected.has(keyFor(id));
  }

  select(id: EntityId, additive = false): void {
    if (!additive) {
      this.selected.clear();
    }
    this.selected.set(keyFor(id), id);
    this.notify();
  }

  selectMany(ids: readonly EntityId[], additive = false): void {
    if (!additive) {
      this.selected.clear();
    }
    for (const id of ids) {
      this.selected.set(keyFor(id), id);
    }
    this.notify();
  }

  toggle(id: EntityId): void {
    const key = keyFor(id);
    if (this.selected.has(key)) {
      this.selected.delete(key);
    } else {
      this.selected.set(key, id);
    }
    this.notify();
  }

  clear(): void {
    if (this.selected.size === 0) {
      return;
    }
    this.selected.clear();
    this.notify();
  }

  selectSameArchetype(
    tapped: PickableEntity,
    visible: readonly PickableEntity[],
    maxCap = DOUBLE_TAP_SELECT_CAP,
  ): void {
    const relationship = tapped.relationship;
    const matches = visible.filter(
      (entity) =>
        entity.archetypeId === tapped.archetypeId &&
        entity.relationship === relationship &&
        entity.kind === 'unit',
    );
    const capped = matches.slice(0, maxCap).map((entity) => entity.id);
    this.selectMany(capped, false);
  }

  onChange(listener: SelectionChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
    this.selected.clear();
  }

  private notify(): void {
    const snapshot = this.getSelected();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function keyFor(id: EntityId): string {
  return `${id.index}:${id.generation}`;
}

export function idsEqual(a: EntityId, b: EntityId): boolean {
  return entityIdsEqual(a, b);
}
