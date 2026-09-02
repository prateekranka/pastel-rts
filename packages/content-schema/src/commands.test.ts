import { describe, expect, it } from 'vitest';
import { validateCommandEnvelope } from './commands';

describe('command envelope validation', () => {
  it('accepts a spawnUnit command', () => {
    const envelope = validateCommandEnvelope({
      protocolVersion: 1,
      commandId: 'lab-1',
      issuedAtTick: 12,
      playerId: 'lab-local',
      kind: 'spawnUnit',
      payload: {
        kind: 'spawnUnit',
        archetypeId: 'sunweaver-scout',
        position: { x: 1024, z: 2048 },
      },
    });
    expect(envelope.payload.kind).toBe('spawnUnit');
  });

  it('rejects mismatched payload kind', () => {
    expect(() =>
      validateCommandEnvelope({
        protocolVersion: 1,
        commandId: 'lab-2',
        issuedAtTick: 0,
        playerId: 'lab-local',
        kind: 'move',
        payload: {
          kind: 'stop',
          entityIds: [{ index: 0, generation: 1 }],
        },
      }),
    ).toThrow(/kind/i);
  });
});
