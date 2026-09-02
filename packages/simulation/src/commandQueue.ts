import type { CommandEnvelopeV1, CommandResult, Tick } from '@pastel-rts/content-schema';

export type CommandLogEntry = {
  envelope: CommandEnvelopeV1;
  result: CommandResult;
};

export type PendingCommand = {
  envelope: CommandEnvelopeV1;
};

/** Deterministic sort: lower executeTick first, then lower sequence. */
export function compareCommands(a: CommandEnvelopeV1, b: CommandEnvelopeV1): number {
  if (a.executeTick !== b.executeTick) {
    return a.executeTick - b.executeTick;
  }
  if (a.sequence !== b.sequence) {
    return a.sequence - b.sequence;
  }
  return a.commandId.localeCompare(b.commandId);
}

export class CommandQueue {
  private readonly pending: PendingCommand[] = [];

  enqueue(envelope: CommandEnvelopeV1): void {
    this.pending.push({ envelope });
  }

  /** Returns commands due at `tick`, sorted deterministically. Removes them from the queue. */
  drainForTick(tick: Tick): CommandEnvelopeV1[] {
    const due: CommandEnvelopeV1[] = [];
    const remaining: PendingCommand[] = [];
    for (const entry of this.pending) {
      if (entry.envelope.executeTick <= tick) {
        due.push(entry.envelope);
      } else {
        remaining.push(entry);
      }
    }
    due.sort(compareCommands);
    this.pending.length = 0;
    this.pending.push(...remaining);
    return due;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  /** Serializable snapshot of queued commands (for debugging). */
  snapshotPending(): CommandEnvelopeV1[] {
    return this.pending.map((entry) => entry.envelope).sort(compareCommands);
  }
}

export type CommandLog = CommandLogEntry[];

export function serializeCommandLog(log: CommandLog): CommandLogEntry[] {
  return JSON.parse(JSON.stringify(log)) as CommandLogEntry[];
}
