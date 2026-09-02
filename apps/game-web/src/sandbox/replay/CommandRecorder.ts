import type { CommandEnvelopeV1, CommandResult } from '@pastel-rts/content-schema';
import type { StateChecksum } from '@pastel-rts/simulation';

/** Records issued commands and checksum history for replay/export. */
export class CommandRecorder {
  private recording = false;
  private readonly commands: CommandEnvelopeV1[] = [];
  private readonly results: CommandResult[] = [];
  private checksums: StateChecksum[] = [];

  start(): void {
    this.recording = true;
    this.commands.length = 0;
    this.results.length = 0;
    this.checksums = [];
  }

  stop(): void {
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  onCommand(envelope: CommandEnvelopeV1): void {
    if (!this.recording) {
      return;
    }
    this.commands.push(envelope);
  }

  onResult(result: CommandResult): void {
    if (!this.recording) {
      return;
    }
    this.results.push(result);
  }

  onChecksums(checksums: readonly StateChecksum[]): void {
    if (!this.recording) {
      return;
    }
    this.checksums = [...checksums];
  }

  exportLog(): CommandEnvelopeV1[] {
    return [...this.commands];
  }

  exportResults(): CommandResult[] {
    return [...this.results];
  }

  exportChecksums(): StateChecksum[] {
    return [...this.checksums];
  }
}

export type ReplayInspectorOptions = {
  replay: (commands: CommandEnvelopeV1[], totalTicks: number) => StateChecksum[];
};

/** Compares recorded command streams against deterministic replay. */
export class ReplayInspector {
  private readonly replay: ReplayInspectorOptions['replay'];
  private lastRecorded: CommandEnvelopeV1[] = [];
  private lastExpected: StateChecksum[] = [];
  private lastActual: StateChecksum[] = [];

  constructor(options: ReplayInspectorOptions) {
    this.replay = options.replay;
  }

  setRecorded(commands: CommandEnvelopeV1[], expectedChecksums: StateChecksum[]): void {
    this.lastRecorded = [...commands];
    this.lastExpected = [...expectedChecksums];
  }

  runReplay(totalTicks: number): boolean {
    this.lastActual = this.replay(this.lastRecorded, totalTicks);
    if (this.lastActual.length !== this.lastExpected.length) {
      return false;
    }
    return this.lastActual.every(
      (entry, index) =>
        entry.hash === this.lastExpected[index]?.hash && entry.tick === this.lastExpected[index]?.tick,
    );
  }

  getLastActual(): readonly StateChecksum[] {
    return this.lastActual;
  }

  getLastExpected(): readonly StateChecksum[] {
    return this.lastExpected;
  }
}
