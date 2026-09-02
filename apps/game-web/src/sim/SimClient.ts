import { TICK_MS } from '../config/constants';
import {
  SNAPSHOT_STRIDE,
  totalEntities,
  type SimControlMessage,
  type SimCounts,
  type SimSnapshotMessage,
} from './types';

export type SnapshotSlot = {
  tick: number;
  simTimeMs: number;
  receivedAtMs: number;
  tickDurationMs: number;
  producedAtMs: number;
  counts: SimCounts;
  payload: Float32Array;
};

export class SimClient {
  private worker: Worker | null = null;
  private prev: SnapshotSlot | null = null;
  private curr: SnapshotSlot | null = null;
  private lastLatencyMs = 0;
  private lastTickDurationMs = 0;
  private paused = false;

  start(seed: number, counts: SimCounts, concentrate: boolean, freezeMotion = false): void {
    this.stop();
    this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SimSnapshotMessage>) => {
      if (event.data.type !== 'snapshot') {
        return;
      }
      const receivedAtMs = performance.now();
      this.lastLatencyMs = receivedAtMs - event.data.producedAtMs;
      this.lastTickDurationMs = event.data.tickDurationMs;
      this.prev = this.curr;
      this.curr = {
        tick: event.data.tick,
        simTimeMs: event.data.simTimeMs,
        receivedAtMs,
        tickDurationMs: event.data.tickDurationMs,
        producedAtMs: event.data.producedAtMs,
        counts: event.data.counts,
        payload: event.data.payload,
      };
    };
    this.post({ type: 'init', seed, counts, concentrate, freezeMotion });
    this.post({ type: 'start' });
  }

  setPopulation(seed: number, counts: SimCounts, concentrate: boolean, freezeMotion = false): void {
    if (!this.worker) {
      this.start(seed, counts, concentrate, freezeMotion);
      return;
    }
    this.prev = null;
    this.curr = null;
    this.post({ type: 'setCounts', seed, counts, concentrate, freezeMotion });
    if (!this.paused) {
      this.post({ type: 'start' });
    }
  }

  pause(): void {
    this.paused = true;
    this.post({ type: 'pause' });
  }

  resume(): void {
    this.paused = false;
    this.post({ type: 'resume' });
  }

  stop(): void {
    if (!this.worker) {
      return;
    }
    this.worker.postMessage({ type: 'terminate' } satisfies SimControlMessage);
    this.worker.terminate();
    this.worker = null;
    this.prev = null;
    this.curr = null;
  }

  getSnapshotLatencyMs(): number {
    return this.lastLatencyMs;
  }

  getTickDurationMs(): number {
    return this.lastTickDurationMs;
  }

  getCounts(): SimCounts | null {
    return this.curr?.counts ?? null;
  }

  getLatestTick(): number {
    return this.curr?.tick ?? 0;
  }

  interpolate(out: Float32Array, renderTimeMs: number): number {
    const curr = this.curr;
    if (!curr) {
      return 0;
    }
    const prev = this.prev;
    const count = totalEntities(curr.counts);
    const needed = count * SNAPSHOT_STRIDE;
    if (out.length < needed) {
      return 0;
    }
    if (!prev || this.paused) {
      out.set(curr.payload.subarray(0, needed));
      return count;
    }
    const span = Math.max(TICK_MS, curr.simTimeMs - prev.simTimeMs);
    const alpha = interpolationAlpha(renderTimeMs, curr.receivedAtMs, span);
    const a = prev.payload;
    const b = curr.payload;
    for (let i = 0; i < count; i += 1) {
      const o = i * SNAPSHOT_STRIDE;
      out[o] = lerp(a[o] ?? 0, b[o] ?? 0, alpha);
      out[o + 1] = lerp(a[o + 1] ?? 0, b[o + 1] ?? 0, alpha);
      out[o + 2] = lerpAngle(a[o + 2] ?? 0, b[o + 2] ?? 0, alpha);
      out[o + 3] = lerp(a[o + 3] ?? 0, b[o + 3] ?? 0, alpha);
      out[o + 4] = b[o + 4] ?? 0;
      out[o + 5] = b[o + 5] ?? 0;
      out[o + 6] = b[o + 6] ?? 0;
      out[o + 7] = b[o + 7] ?? 0;
    }
    return count;
  }

  private post(message: SimControlMessage): void {
    this.worker?.postMessage(message);
  }
}

/** Alpha 0 = previous snapshot, 1 = current. Clocked from when `curr` arrived. */
export function interpolationAlpha(
  renderTimeMs: number,
  currentReceivedAtMs: number,
  spanMs: number,
): number {
  return clamp((renderTimeMs - currentReceivedAtMs) / Math.max(1, spanMs), 0, 1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) {
    diff -= Math.PI * 2;
  }
  while (diff < -Math.PI) {
    diff += Math.PI * 2;
  }
  return a + diff * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
