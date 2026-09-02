import { describe, expect, it } from 'vitest';
import { validateCommandEnvelope } from './commands';

const spawnEnvelope = {
  protocolVersion: 1,
  commandId: 'lab-1',
  sequence: 0,
  issuedAtTick: 12,
  executeTick: 12,
  playerId: 'lab-local',
  kind: 'spawnUnit',
  payload: {
    kind: 'spawnUnit',
    archetypeId: 'sunweaver-scout',
    position: { x: 1024, z: 2048 },
  },
};

describe('command envelope validation', () => {
  it('accepts a spawnUnit command', () => {
    const envelope = validateCommandEnvelope(spawnEnvelope);
    expect(envelope.payload.kind).toBe('spawnUnit');
    expect(envelope.sequence).toBe(0);
    expect(envelope.executeTick).toBe(12);
  });

  it('rejects mismatched payload kind', () => {
    expect(() =>
      validateCommandEnvelope({
        protocolVersion: 1,
        commandId: 'lab-2',
        sequence: 1,
        issuedAtTick: 0,
        executeTick: 0,
        playerId: 'lab-local',
        kind: 'move',
        payload: {
          kind: 'stop',
          entityIds: [{ index: 0, generation: 1 }],
        },
      }),
    ).toThrow(/kind/i);
  });

  it('requires sequence and executeTick', () => {
    expect(() => {
      const { sequence: _sequence, ...rest } = spawnEnvelope;
      validateCommandEnvelope(rest);
    }).toThrow(/sequence/i);
    expect(() => {
      const { executeTick: _executeTick, ...rest } = spawnEnvelope;
      validateCommandEnvelope(rest);
    }).toThrow(/executeTick/i);
  });

  it('rejects executeTick before issuedAtTick', () => {
    expect(() =>
      validateCommandEnvelope({
        ...spawnEnvelope,
        issuedAtTick: 8,
        executeTick: 7,
      }),
    ).toThrow(/executeTick/i);
  });

  it('accepts optional formation on move', () => {
    const envelope = validateCommandEnvelope({
      protocolVersion: 1,
      commandId: 'lab-move',
      sequence: 2,
      issuedAtTick: 4,
      executeTick: 4,
      playerId: 'lab-local',
      kind: 'move',
      payload: {
        kind: 'move',
        entityIds: [{ index: 0, generation: 1 }],
        destination: { x: 2048, z: 3072 },
        formation: { kind: 'line', spacingSubunits: 512 },
      },
    });
    expect(envelope.payload.kind).toBe('move');
    if (envelope.payload.kind === 'move') {
      expect(envelope.payload.formation).toEqual({ kind: 'line', spacingSubunits: 512 });
    }
  });

  it('rejects an unknown formation kind', () => {
    expect(() =>
      validateCommandEnvelope({
        protocolVersion: 1,
        commandId: 'lab-move-bad',
        sequence: 3,
        issuedAtTick: 4,
        executeTick: 4,
        playerId: 'lab-local',
        kind: 'move',
        payload: {
          kind: 'move',
          entityIds: [{ index: 0, generation: 1 }],
          destination: { x: 0, z: 0 },
          formation: { kind: 'wedge' },
        },
      }),
    ).toThrow(/formation/i);
  });

  it('accepts user-spec schemaVersion and type aliases', () => {
    const envelope = validateCommandEnvelope({
      schemaVersion: 1,
      commandId: 'lab-alias',
      sequence: 4,
      issuedAtTick: 1,
      executeTick: 1,
      playerId: 'lab-local',
      type: 'stop',
      payload: {
        kind: 'stop',
        entityIds: [{ index: 1, generation: 2 }],
      },
    });
    expect(envelope.kind).toBe('stop');
    expect(envelope.protocolVersion).toBe(1);
  });
});
