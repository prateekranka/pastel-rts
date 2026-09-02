import type { DebugOverlayFlags } from '../sandbox/types';

export class DebugOverlayState {
  private flags: DebugOverlayFlags;
  private readonly listeners = new Set<(flags: DebugOverlayFlags) => void>();

  constructor(initial: DebugOverlayFlags) {
    this.flags = { ...initial };
  }

  getFlags(): DebugOverlayFlags {
    return { ...this.flags };
  }

  toggle(key: keyof DebugOverlayFlags): void {
    this.flags = { ...this.flags, [key]: !this.flags[key] };
    this.notify();
  }

  set(key: keyof DebugOverlayFlags, value: boolean): void {
    this.flags = { ...this.flags, [key]: value };
    this.notify();
  }

  subscribe(listener: (flags: DebugOverlayFlags) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getFlags();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
