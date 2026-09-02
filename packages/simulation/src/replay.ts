import type { CommandEnvelopeV1, PackV2, ScenarioDef } from '@pastel-rts/content-schema';
import type { StateChecksum } from './checksum.js';
import type { NavigationService } from './navigation.js';
import { Simulation, type SimulationConfig } from './simulation.js';

export type ReplayConfig = {
  pack: PackV2;
  navFactory: () => NavigationService;
  scenario?: ScenarioDef;
  commands: CommandEnvelopeV1[];
  totalTicks: number;
  simulationConfig?: Partial<Omit<SimulationConfig, 'pack' | 'nav'>>;
};

export type ReplayResult = {
  checksums: StateChecksum[];
  commandLogLength: number;
};

/**
 * Run a deterministic scenario+command stream and return checksum sequence.
 * Caller compares two runs or replays against stored checksums.
 */
export function runSimulationReplay(config: ReplayConfig): ReplayResult {
  const sim = new Simulation({
    pack: config.pack,
    nav: config.navFactory(),
    ...config.simulationConfig,
  });

  if (config.scenario !== undefined) {
    sim.loadScenario(config.scenario);
  }

  for (const command of config.commands) {
    sim.enqueueCommand(command);
  }

  sim.runTicks(config.totalTicks);

  return {
    checksums: [...sim.getChecksums()],
    commandLogLength: sim.getCommandLog().length,
  };
}

/** Verify two replays with identical inputs produce identical checksum sequences. */
export function assertDeterministicReplay(config: ReplayConfig): {
  first: ReplayResult;
  second: ReplayResult;
  identical: boolean;
} {
  const first = runSimulationReplay(config);
  const second = runSimulationReplay(config);
  const identical =
    first.checksums.length === second.checksums.length &&
    first.checksums.every(
      (entry, index) =>
        entry.hash === second.checksums[index]?.hash && entry.tick === second.checksums[index]?.tick,
    );
  return { first, second, identical };
}

/** Replay stored commands from a prior run and compare checksum sequences. */
export function replayFromCommandLog(
  config: Omit<ReplayConfig, 'commands'> & { recordedChecksums: StateChecksum[] },
): boolean {
  const result = runSimulationReplay({ ...config, commands: [] });
  if (result.checksums.length !== config.recordedChecksums.length) {
    return false;
  }
  return result.checksums.every(
    (entry, index) =>
      entry.hash === config.recordedChecksums[index]?.hash &&
      entry.tick === config.recordedChecksums[index]?.tick,
  );
}
