import { describe, expect, it } from 'vitest';
import { NavigationService } from '@pastel-rts/navigation';
import {
  assertDeterministicReplay,
  createTestPackV2,
  runSimulationReplay,
} from '@pastel-rts/simulation';
import { COMMAND_PROTOCOL_VERSION } from '@pastel-rts/content-schema';
import type { CommandEnvelopeV1 } from '@pastel-rts/content-schema';
import { ReplayInspector } from '../replay/CommandRecorder';

describe('command replay checksum', () => {
  const pack = createTestPackV2();

  it('produces identical checksums on replay', () => {
    const commands = [
      {
        protocolVersion: COMMAND_PROTOCOL_VERSION,
        commandId: 'lab-1',
        sequence: 0,
        issuedAtTick: 0,
        executeTick: 0,
        playerId: 'lab-local',
        kind: 'spawnUnit' as const,
        payload: {
          kind: 'spawnUnit' as const,
          archetypeId: 'sunweaver-scout',
          position: { x: 8192, z: 8192 },
        },
      },
    ];
    const { identical } = assertDeterministicReplay({
      pack,
      navFactory: () => new NavigationService(),
      commands,
      totalTicks: 20,
    });
    expect(identical).toBe(true);
  });

  it('ReplayInspector matches recorded checksums', () => {
    const commands = [
      {
        protocolVersion: COMMAND_PROTOCOL_VERSION,
        commandId: 'lab-2',
        sequence: 0,
        issuedAtTick: 0,
        executeTick: 0,
        playerId: 'lab-local',
        kind: 'spawnUnit' as const,
        payload: {
          kind: 'spawnUnit' as const,
          archetypeId: 'sunweaver-scout',
          position: { x: 16384, z: 16384 },
        },
      },
    ];
    const first = runSimulationReplay({
      pack,
      navFactory: () => new NavigationService(),
      commands,
      totalTicks: 10,
    });
    const inspector = new ReplayInspector({
      replay: (log: CommandEnvelopeV1[], ticks: number) =>
        runSimulationReplay({
          pack,
          navFactory: () => new NavigationService(),
          commands: log,
          totalTicks: ticks,
        }).checksums,
    });
    inspector.setRecorded(commands, first.checksums);
    expect(inspector.runReplay(10)).toBe(true);
  });
});
