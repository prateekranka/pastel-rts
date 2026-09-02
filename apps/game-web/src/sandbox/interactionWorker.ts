import type { CommandEnvelopeV1, CommandResult, MapDef, PackV2, ScenarioDef } from '@pastel-rts/content-schema';
import { NavigationService } from '@pastel-rts/navigation';
import { Simulation, TICK_MS, type CommandLogEntry } from '@pastel-rts/simulation';
import type { LabControlMessage, LabNavDebugMessage, LabSnapshotMessage, LabWorkerOutbound } from './types';

let simulation: Simulation | null = null;
let nav: NavigationService | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let navDebugEnabled = false;
let lastTickStartedAt = 0;
let lastCommandLogLength = 0;

function post(message: LabWorkerOutbound, transfer?: Transferable[]): void {
  if (transfer !== undefined && transfer.length > 0) {
    self.postMessage(message, transfer);
  } else {
    self.postMessage(message);
  }
}

function flushCommandResults(): void {
  if (!simulation) {
    return;
  }
  const log = simulation.getCommandLog();
  for (let index = lastCommandLogLength; index < log.length; index += 1) {
    const entry: CommandLogEntry = log[index]!;
    post(entry.result);
  }
  lastCommandLogLength = log.length;
}

function initLab(body: {
  seed: number;
  pack: PackV2;
  map?: MapDef;
  scenario?: ScenarioDef;
}): void {
  stopInterval();
  nav = new NavigationService();
  simulation = new Simulation({
    pack: body.pack,
    nav,
    seed: body.seed,
  });
  lastCommandLogLength = 0;
  if (body.map !== undefined) {
    nav.applyMapDef(body.map);
  }
  if (body.scenario !== undefined) {
    simulation.loadScenario(body.scenario);
  }
}

function emitSnapshot(): void {
  if (!simulation) {
    return;
  }
  const producedAtMs = performance.now();
  const tickDurationMs = lastTickStartedAt > 0 ? producedAtMs - lastTickStartedAt : 0;
  const snapshot = simulation.buildSnapshot();
  const message: LabSnapshotMessage = {
    type: 'snapshot',
    tick: snapshot.tick,
    simTimeMs: snapshot.simTimeMs,
    producedAtMs,
    tickDurationMs,
    entityCount: snapshot.entityCount,
    payload: snapshot.payload,
  };
  post(message, [snapshot.payload.buffer]);
}

function emitNavDebug(): void {
  if (!nav || !navDebugEnabled) {
    return;
  }
  const message: LabNavDebugMessage = {
    type: 'navDebug',
    snapshot: nav.debugSnapshot(),
  };
  post(message);
}

function tickOnce(): void {
  if (!simulation) {
    return;
  }
  lastTickStartedAt = performance.now();
  simulation.step();
  flushCommandResults();
  emitSnapshot();
  emitNavDebug();
}

function startInterval(): void {
  stopInterval();
  intervalId = setInterval(() => {
    tickOnce();
  }, TICK_MS);
}

function stopInterval(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

self.onmessage = (event: MessageEvent<LabControlMessage>): void => {
  const message = event.data;
  switch (message.type) {
    case 'initLab':
      initLab(message);
      break;
    case 'start':
      simulation?.resume();
      startInterval();
      tickOnce();
      break;
    case 'pause':
      simulation?.pause();
      stopInterval();
      break;
    case 'resume':
      simulation?.resume();
      startInterval();
      break;
    case 'stepOne':
      simulation?.pause();
      stopInterval();
      tickOnce();
      break;
    case 'terminate':
      stopInterval();
      simulation = null;
      nav = null;
      lastCommandLogLength = 0;
      break;
    case 'command':
      simulation?.enqueueCommand(message.envelope);
      break;
    case 'setNavDebug':
      navDebugEnabled = message.enabled;
      if (navDebugEnabled) {
        emitNavDebug();
      }
      break;
    default:
      break;
  }
};

export type { CommandResult, CommandEnvelopeV1 };
