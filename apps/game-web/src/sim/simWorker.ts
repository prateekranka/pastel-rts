/// <reference lib="webworker" />

import { TICK_MS } from '../config/constants';
import { Simulation } from './Simulation';
import {
  totalEntities,
  type SimControlMessage,
  type SimCounts,
  type SimSnapshotMessage,
} from './types';

const simulation = new Simulation();
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let counts: SimCounts = { combat: 0, workers: 0, buildings: 0, props: 0 };
/** Next snapshot buffer. The previous buffer is transferred to the main thread. */
let nextPayload: Float32Array | null = null;

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer(): void {
  stopTimer();
  timer = setInterval(tick, TICK_MS);
}

function tick(): void {
  if (!running) {
    return;
  }
  const { tickDurationMs } = simulation.step(TICK_MS);
  const needed = simulation.requiredPayloadLength(counts);
  const payload =
    nextPayload && nextPayload.length === needed && nextPayload.buffer.byteLength === needed * 4
      ? nextPayload
      : new Float32Array(needed);
  nextPayload = new Float32Array(needed);
  simulation.writeSnapshot(payload);
  const message: SimSnapshotMessage = {
    type: 'snapshot',
    tick: simulation.getTick(),
    simTimeMs: simulation.getSimTimeMs(),
    producedAtMs: performance.now(),
    tickDurationMs,
    counts,
    payload,
  };
  postMessage(message, { transfer: [payload.buffer] });
}

self.onmessage = (event: MessageEvent<SimControlMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
    case 'setCounts': {
      counts = message.counts;
      simulation.init(message.seed, message.counts, message.concentrate, message.freezeMotion);
      running = false;
      stopTimer();
      break;
    }
    case 'start':
      running = true;
      startTimer();
      tick();
      break;
    case 'pause':
      running = false;
      stopTimer();
      break;
    case 'resume':
      running = true;
      startTimer();
      break;
    case 'terminate':
      running = false;
      stopTimer();
      close();
      break;
    default: {
      const _never: never = message;
      void _never;
    }
  }
};

export function snapshotFloatCount(next: SimCounts): number {
  return totalEntities(next);
}
