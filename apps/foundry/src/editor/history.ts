export type PendingImageState = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
};

export type EditorHistorySnapshot = {
  fields: Record<string, string | boolean>;
  pendingImage: PendingImageState | null;
  selectedFrame: number;
};

export class BoundedHistory<T> {
  private readonly limit: number;
  private readonly clone: (value: T) => T;
  private past: T[] = [];
  private future: T[] = [];
  private currentValue: T | null = null;

  constructor(limit = 40, clone: (value: T) => T = identity) {
    this.limit = Math.max(2, limit);
    this.clone = clone;
  }

  seed(value: T): void {
    this.currentValue = this.clone(value);
    this.past = [];
    this.future = [];
  }

  push(value: T): void {
    if (this.currentValue !== null) {
      this.past.push(this.clone(this.currentValue));
      if (this.past.length > this.limit) {
        this.past.shift();
      }
    }
    this.currentValue = this.clone(value);
    this.future = [];
  }

  undo(): T | null {
    if (this.currentValue === null || this.past.length === 0) {
      return null;
    }
    this.future.push(this.clone(this.currentValue));
    this.currentValue = this.past.pop() ?? null;
    return this.currentValue === null ? null : this.clone(this.currentValue);
  }

  redo(): T | null {
    if (this.currentValue === null || this.future.length === 0) {
      return null;
    }
    this.past.push(this.clone(this.currentValue));
    this.currentValue = this.future.pop() ?? null;
    return this.currentValue === null ? null : this.clone(this.currentValue);
  }

  current(): T | null {
    return this.currentValue === null ? null : this.clone(this.currentValue);
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }
}

export function cloneEditorSnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
  return {
    fields: { ...snapshot.fields },
    pendingImage: snapshot.pendingImage ? { ...snapshot.pendingImage } : null,
    selectedFrame: snapshot.selectedFrame,
  };
}

function identity<T>(value: T): T {
  return value;
}
