import { TICK_MS, type StateChecksum } from '@pastel-rts/simulation';
import type { CommandEnvelopeV1, CommandResult } from '@pastel-rts/content-schema';
import type { NavDebugSnapshot } from '@pastel-rts/navigation';
import { interpolationAlpha } from '../sim/SimClient';
import { INTERACTION_SNAPSHOT_STRIDE, interpolateSnapshotRows } from '../sandbox/snapshot';
import type { LabControlMessage, LabSnapshotSlot, LabWorkerOutbound } from '../sandbox/types';

export type MatchRuntimeOptions = {
  maxEntities?: number;
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
  private paused = false;
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
    this.post(init);
    this.post({ type: 'start' });
  }

  pause(): void {
    this.paused = true;
    this.post({ type: 'pause' });
  }

  resume(): void {
    this.paused = false;
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
    if (!this.worker) {
      return;
    }
    this.worker.postMessage({ type: 'terminate' } satisfies LabControlMessage);
    this.worker.terminate();
    this.worker = null;
    this.prev = null;
    this.curr = null;
    this.commandResults.length = 0;
    this.navDebug = null;
    this.checksums = [];
  }

  getSnapshotLatencyMs(): number {
    return this.lastLatencyMs;
  }

  getTickDurationMs(): number {
    return this.lastTickDurationMs;
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
      const receivedAtMs = performance.now();
      this.lastLatencyMs = receivedAtMs - message.producedAtMs;
      this.lastTickDurationMs = message.tickDurationMs;
      this.prev = this.curr;
      this.curr = {
        tick: message.tick,
        simTimeMs: message.simTimeMs,
        receivedAtMs,
        tickDurationMs: message.tickDurationMs,
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
