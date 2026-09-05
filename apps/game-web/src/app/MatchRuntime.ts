import { TICK_MS, type StateChecksum } from '@pastel-rts/simulation';
import type { CommandEnvelopeV1, CommandResult } from '@pastel-rts/content-schema';
import type { NavDebugSnapshot } from '@pastel-rts/navigation';
import { interpolationAlpha } from '../sim/SimClient';
import { INTERACTION_SNAPSHOT_STRIDE, interpolateSnapshotRows } from '../sandbox/snapshot';
import type { LabControlMessage, LabSnapshotSlot, LabWorkerOutbound } from '../sandbox/types';

export type MatchRuntimeOptions = {
  maxEntities?: number;
};

export type MatchRuntimeDiagnostics = {
  tick: number;
  entityCount: number;
  snapshotLatencyMs: number;
  tickDurationMs: number;
  navDurationMs: number;
  checksumCount: number;
  paused: boolean;
};

/**
 * Interaction-lab worker client. Authoritative sim+nav stay in the worker;
 * the main thread only interpolates transferred snapshots.
 */
export class MatchRuntime {
  private worker: Worker | null = null;
  private prev: LabSnapshotSlot | null = null;
  private curr: LabSnapshotSlot | null = null;
  private lastLatencyMs = 0;
  private lastTickDurationMs = 0;
  private lastNavDurationMs = 0;
  private paused = false;
  private pausedAtTick: number | null = null;
  private readonly maxEntities: number;
  private readonly commandResults: CommandResult[] = [];
  private navDebug: NavDebugSnapshot | null = null;
  private checksums: StateChecksum[] = [];
  private readonly onCommandResult: ((result: CommandResult) => void) | null;
  private readonly onChecksums: ((checksums: readonly StateChecksum[]) => void) | null;

  constructor(
    options: MatchRuntimeOptions = {},
    onCommandResult?: (result: CommandResult) => void,
    onChecksums?: (checksums: readonly StateChecksum[]) => void,
  ) {
    this.maxEntities = options.maxEntities ?? 512;
    this.onCommandResult = onCommandResult ?? null;
    this.onChecksums = onChecksums ?? null;
  }

  start(init: Extract<LabControlMessage, { type: 'initLab' }>): void {
    this.stop();
    this.paused = false;
    this.pausedAtTick = null;
    this.worker = new Worker(new URL('./matchWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<LabWorkerOutbound>) => {
      this.handleMessage(event.data);
    };
    this.post(init);
    this.post({ type: 'start' });
  }

  reinit(init: Extract<LabControlMessage, { type: 'initLab' }>): void {
    if (!this.worker) {
      this.start(init);
      return;
    }
    this.prev = null;
    this.curr = null;
    this.commandResults.length = 0;
    this.navDebug = null;
    this.checksums = [];
    this.pausedAtTick = this.paused ? 0 : null;
    this.post(init);
    this.post({ type: 'start' });
    if (this.paused) {
      this.post({ type: 'pause' });
    }
  }

  pause(): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.pausedAtTick = this.curr?.tick ?? 0;
    this.post({ type: 'pause' });
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.pausedAtTick = null;
    this.post({ type: 'resume' });
  }

  stepOne(): void {
    this.post({ type: 'stepOne' });
  }

  postCommand(envelope: CommandEnvelopeV1): void {
    this.post({ type: 'command', envelope });
  }

  setNavDebug(enabled: boolean): void {
    this.post({ type: 'setNavDebug', enabled });
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'terminate' } satisfies LabControlMessage);
      this.worker.terminate();
      this.worker = null;
    }
    this.prev = null;
    this.curr = null;
    this.commandResults.length = 0;
    this.navDebug = null;
    this.checksums = [];
    this.paused = false;
    this.pausedAtTick = null;
    this.lastNavDurationMs = 0;
  }

  getSnapshotLatencyMs(): number {
    return this.lastLatencyMs;
  }

  getTickDurationMs(): number {
    return this.lastTickDurationMs;
  }

  getNavigationTimeMs(): number {
    return this.lastNavDurationMs;
  }

  getLatestTick(): number {
    return this.curr?.tick ?? 0;
  }

  getEntityCount(): number {
    return this.curr?.entityCount ?? 0;
  }

  getNavDebug(): NavDebugSnapshot | null {
    return this.navDebug;
  }

  getChecksums(): readonly StateChecksum[] {
    return this.checksums;
  }

  getDiagnostics(): MatchRuntimeDiagnostics {
    return {
      tick: this.getLatestTick(),
      entityCount: this.getEntityCount(),
      snapshotLatencyMs: this.lastLatencyMs,
      tickDurationMs: this.lastTickDurationMs,
      navDurationMs: this.lastNavDurationMs,
      checksumCount: this.checksums.length,
      paused: this.paused,
    };
  }

  drainCommandResults(): CommandResult[] {
    const drained = [...this.commandResults];
    this.commandResults.length = 0;
    return drained;
  }

  interpolate(out: Float32Array, renderTimeMs: number): number {
    const curr = this.curr;
    if (!curr) {
      return 0;
    }
    const prev = this.prev;
    const count = curr.entityCount;
    const needed = count * INTERACTION_SNAPSHOT_STRIDE;
    if (out.length < needed) {
      return 0;
    }
    if (!prev || this.paused) {
      out.set(curr.payload.subarray(0, needed));
      return count;
    }
    const span = Math.max(TICK_MS, curr.simTimeMs - prev.simTimeMs);
    const alpha = interpolationAlpha(renderTimeMs, curr.receivedAtMs, span);
    interpolateSnapshotRows(out, prev.payload, curr.payload, prev.entityCount, count, alpha);
    return count;
  }

  createInterpolationBuffer(): Float32Array {
    return new Float32Array(this.maxEntities * INTERACTION_SNAPSHOT_STRIDE);
  }

  private handleMessage(message: LabWorkerOutbound): void {
    if (message.type === 'snapshot') {
      // A pause message is asynchronous. Ignore snapshots already queued in the
      // worker transport so native/background pause cannot expose a pause delta.
      if (this.paused && this.pausedAtTick !== null && message.tick > this.pausedAtTick) {
        return;
      }
      const receivedAtMs = performance.now();
      this.lastLatencyMs = receivedAtMs - message.producedAtMs;
      this.lastTickDurationMs = message.tickDurationMs;
      this.lastNavDurationMs = message.navDurationMs ?? 0;
      this.prev = this.curr;
      this.curr = {
        tick: message.tick,
        simTimeMs: message.simTimeMs,
        receivedAtMs,
        tickDurationMs: message.tickDurationMs,
        navDurationMs: message.navDurationMs ?? 0,
        producedAtMs: message.producedAtMs,
        entityCount: message.entityCount,
        payload: message.payload,
      };
      return;
    }
    if (message.type === 'commandResult') {
      this.commandResults.push(message);
      this.onCommandResult?.(message);
      return;
    }
    if (message.type === 'navDebug') {
      this.navDebug = message.snapshot;
      return;
    }
    if (message.type === 'checksums') {
      this.checksums = message.checksums;
      this.onChecksums?.(message.checksums);
    }
  }

  private post(message: LabControlMessage): void {
    this.worker?.postMessage(message);
  }
}
