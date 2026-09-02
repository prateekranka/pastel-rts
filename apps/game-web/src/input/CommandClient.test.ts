import { describe, expect, it } from 'vitest';
import { validateCommandEnvelope } from '@pastel-rts/content-schema';
import { CommandClient, type WorkerCommandPort } from './CommandClient';

function fakePort(): WorkerCommandPort & { messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    messages,
    postMessage: (message) => {
      messages.push(message);
    },
  };
}

describe('CommandClient', () => {
  it('posts versioned move envelopes with sequence and executeTick', () => {
    const port = fakePort();
    const client = new CommandClient({ port, createCommandId: () => 'cmd-1' });
    const entityIds = [{ index: 2, generation: 1 }];
    const destination = { x: 8192, z: 16384 };

    const envelope = client.issueMove({
      entityIds,
      destination,
      issuedAtTick: 10,
      executeTick: 10,
    });

    expect(envelope.protocolVersion).toBe(1);
    expect(envelope.sequence).toBe(0);
    expect(envelope.executeTick).toBe(10);
    expect(envelope.kind).toBe('move');
    expect(envelope.payload).toEqual({ kind: 'move', entityIds, destination });
    expect(validateCommandEnvelope(envelope)).toEqual(envelope);
    expect(port.messages).toHaveLength(1);
    expect(port.messages[0]).toEqual({ type: 'command', envelope });
  });

  it('increments sequence for same-tick ordering', () => {
    const port = fakePort();
    const client = new CommandClient({ port, createCommandId: () => 'cmd-a' });
    const ids = [{ index: 0, generation: 1 }];

    client.issueStop({ entityIds: ids, issuedAtTick: 3, executeTick: 4 });
    const second = client.issueMove({
      entityIds: ids,
      destination: { x: 0, z: 0 },
      issuedAtTick: 3,
      executeTick: 4,
      formation: { kind: 'line', spacingSubunits: 512 },
    });

    expect(second.sequence).toBe(1);
    expect(second.payload).toMatchObject({
      kind: 'move',
      formation: { kind: 'line', spacingSubunits: 512 },
    });
    expect(port.messages).toHaveLength(2);
  });

  it('uses lab-local player id by default', () => {
    const port = fakePort();
    const client = new CommandClient({ port, createCommandId: () => 'cmd-x' });
    const envelope = client.issueStop({
      entityIds: [{ index: 1, generation: 2 }],
      issuedAtTick: 0,
      executeTick: 0,
    });
    expect(envelope.playerId).toBe('lab-local');
  });

  it('posts spawn and place envelopes that validate against the schema', () => {
    const port = fakePort();
    const client = new CommandClient({ port, createCommandId: () => 'cmd-lab' });

    const spawn = client.issueSpawnUnit({
      archetypeId: 'spear',
      position: { x: 1024, z: 2048 },
      issuedAtTick: 1,
      executeTick: 1,
      headingMilli: 0,
    });
    const place = client.issuePlaceBuilding({
      archetypeId: 'keep',
      originCell: { cx: 10, cz: 12 },
      issuedAtTick: 1,
      executeTick: 2,
    });
    const removeUnit = client.issueRemoveEntity({
      entityId: { index: 4, generation: 2 },
      issuedAtTick: 2,
      executeTick: 2,
    });
    const removeBuilding = client.issueRemoveBuilding({
      entityId: { index: 8, generation: 1 },
      issuedAtTick: 2,
      executeTick: 3,
    });

    expect(spawn.kind).toBe('spawnUnit');
    expect(place.kind).toBe('placeBuilding');
    expect(removeUnit.sequence).toBe(2);
    expect(removeBuilding.sequence).toBe(3);
    expect(validateCommandEnvelope(spawn)).toEqual(spawn);
    expect(validateCommandEnvelope(place)).toEqual(place);
    expect(validateCommandEnvelope(removeUnit)).toEqual(removeUnit);
    expect(validateCommandEnvelope(removeBuilding)).toEqual(removeBuilding);
    expect(port.messages).toHaveLength(4);
  });
});
