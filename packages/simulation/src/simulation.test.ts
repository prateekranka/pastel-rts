import { describe, expect, it } from 'vitest';
import type { CommandEnvelopeV1, EntityId } from '@pastel-rts/content-schema';
import { createEntityId } from '@pastel-rts/content-schema';
import { compareCommands } from './commandQueue.js';
import { allocateEntity, createEntityPool, releaseEntity, resolveEntity } from './entityPool.js';
import { StubNavigationService } from './navStub.js';
import { assertDeterministicReplay, replayFromCommandLog, runSimulationReplay } from './replay.js';
import { Simulation } from './simulation.js';
import { createTestPackV2 } from './testFixtures.js';

function spawnCommand(
  overrides: Partial<CommandEnvelopeV1> & { payload: CommandEnvelopeV1['payload'] },
): CommandEnvelopeV1 {
  return {
    protocolVersion: 1,
    commandId: overrides.commandId ?? `cmd-${Math.random().toString(36).slice(2)}`,
    sequence: overrides.sequence ?? 0,
    issuedAtTick: overrides.issuedAtTick ?? 0,
    executeTick: overrides.executeTick ?? 0,
    playerId: overrides.playerId ?? 'lab-local',
    kind: overrides.payload.kind,
    payload: overrides.payload,
  };
}

function createSim(entityCapacity = 512): Simulation {
  return new Simulation({
    pack: createTestPackV2(),
    nav: new StubNavigationService(),
    entityCapacity,
    cellsX: 32,
    cellsZ: 32,
  });
}

describe('entity ids', () => {
  it('allocates stable index+generation ids', () => {
    const pool = createEntityPool(4);
    const first = allocateEntity(pool);
    const second = allocateEntity(pool);
    expect(first).toEqual({ index: 0, generation: 1 });
    expect(second).toEqual({ index: 1, generation: 1 });
  });

  it('bumps generation on release and rejects stale references', () => {
    const pool = createEntityPool(4);
    const id = allocateEntity(pool);
    expect(id).not.toBeNull();
    if (id === null) {
      return;
    }
    releaseEntity(pool, id);
    expect(resolveEntity(pool, id)).toBe('stale');
    const reused = allocateEntity(pool);
    expect(reused).toEqual({ index: 0, generation: 2 });
    expect(resolveEntity(pool, id)).toBe('stale');
  });
});

describe('command application', () => {
  it('rejects stale entity references', () => {
    const sim = createSim();
    const staleId: EntityId = { index: 0, generation: 99 };
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'remove-stale',
        executeTick: 0,
        payload: { kind: 'removeEntity', entityId: staleId },
      }),
    );
    sim.step();
    const log = sim.getCommandLog();
    expect(log[0]?.result.status).toBe('rejected');
    expect(log[0]?.result.reason).toBe('stale-id');
  });

  it('orders same-tick commands by sequence deterministically', () => {
    const envelopes = [
      spawnCommand({
        commandId: 'b',
        sequence: 2,
        executeTick: 1,
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
        },
      }),
      spawnCommand({
        commandId: 'a',
        sequence: 1,
        executeTick: 1,
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 2048, z: 2048 },
        },
      }),
    ];
    const sorted = [...envelopes].sort(compareCommands);
    expect(sorted.map((entry) => entry.commandId)).toEqual(['a', 'b']);
  });

  it('rejects invalid player id', () => {
    const sim = createSim();
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'bad-player',
        playerId: 'intruder',
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
        },
      }),
    );
    sim.step();
    expect(sim.getCommandLog()[0]?.result.status).toBe('rejected');
  });

  it('rejects unknown archetype', () => {
    const sim = createSim();
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'bad-archetype',
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'missing-unit',
          position: { x: 1024, z: 1024 },
        },
      }),
    );
    sim.step();
    expect(sim.getCommandLog()[0]?.result.reason).toBe('unknown-archetype');
  });

  it('applies move on requested executeTick', () => {
    const sim = createSim();
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'spawn',
        executeTick: 0,
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
        },
      }),
    );
    sim.step();
    const spawnedId = sim.getCommandLog()[0]?.result.spawnedId;
    expect(spawnedId).toBeDefined();

    sim.enqueueCommand(
      spawnCommand({
        commandId: 'move-later',
        executeTick: 5,
        payload: {
          kind: 'move',
          entityIds: [spawnedId as EntityId],
          destination: { x: 4096, z: 4096 },
        },
      }),
    );

    sim.runTicks(4);
    expect(sim.getCommandLog().some((entry) => entry.envelope.commandId === 'move-later')).toBe(false);

    sim.step();
    const moveResult = sim.getCommandLog().find((entry) => entry.envelope.commandId === 'move-later');
    expect(moveResult?.result.status).toBe('accepted');
    expect(moveResult?.result.acceptedAtTick).toBe(5);
  });

  it('stop cancels current movement', () => {
    const sim = createSim();
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'spawn',
        executeTick: 0,
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
        },
      }),
    );
    sim.step();
    const unitId = sim.getCommandLog()[0]?.result.spawnedId as EntityId;

    sim.enqueueCommand(
      spawnCommand({
        commandId: 'move',
        executeTick: 1,
        payload: {
          kind: 'move',
          entityIds: [unitId],
          destination: { x: 8192, z: 8192 },
        },
      }),
    );
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'stop',
        sequence: 1,
        executeTick: 1,
        payload: { kind: 'stop', entityIds: [unitId] },
      }),
    );
    sim.step();

    const snapshot = sim.buildSnapshot();
    const stride = 12;
    expect(snapshot.entityCount).toBe(1);
    expect(snapshot.payload[stride * 0 + 8]).toBe(0);
  });

  it('placeBuilding creates nav blocker footprint', () => {
    const nav = new StubNavigationService();
    nav.resize(32, 32);
    const sim = new Simulation({
      pack: createTestPackV2(),
      nav,
      cellsX: 32,
      cellsZ: 32,
    });

    sim.enqueueCommand(
      spawnCommand({
        commandId: 'place',
        payload: {
          kind: 'placeBuilding',
          archetypeId: 'gravemark-bastion',
          originCell: { cx: 4, cz: 4 },
        },
      }),
    );
    sim.step();
    expect(sim.getCommandLog()[0]?.result.status).toBe('accepted');
    expect(nav.isWalkable(4, 4)).toBe(false);
    expect(nav.isWalkable(5, 5)).toBe(false);
    expect(nav.isWalkable(6, 6)).toBe(true);
  });

  it('removeBuilding clears nav blocker', () => {
    const nav = new StubNavigationService();
    nav.resize(32, 32);
    const sim = new Simulation({
      pack: createTestPackV2(),
      nav,
      cellsX: 32,
      cellsZ: 32,
    });

    sim.enqueueCommand(
      spawnCommand({
        commandId: 'place',
        payload: {
          kind: 'placeBuilding',
          archetypeId: 'gravemark-bastion',
          originCell: { cx: 2, cz: 2 },
        },
      }),
    );
    sim.step();
    const buildingId = sim.getCommandLog()[0]?.result.spawnedId as EntityId;
    expect(nav.isWalkable(2, 2)).toBe(false);

    sim.enqueueCommand(
      spawnCommand({
        commandId: 'remove',
        executeTick: 1,
        payload: { kind: 'removeBuilding', entityId: buildingId },
      }),
    );
    sim.step();
    expect(nav.isWalkable(2, 2)).toBe(true);
    expect(nav.isWalkable(3, 3)).toBe(true);
  });

  it('centers building snapshots on the full footprint', () => {
    const sim = createSim();
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'place-center',
        payload: {
          kind: 'placeBuilding',
          archetypeId: 'gravemark-bastion',
          originCell: { cx: 4, cz: 4 },
        },
      }),
    );
    sim.step();
    const snapshot = sim.buildSnapshot();
    expect(snapshot.payload[0]).toBe(5);
    expect(snapshot.payload[1]).toBe(5);
  });

  it('honors scenario spawn faction overrides', () => {
    const sim = createSim();
    sim.loadScenario({
      schemaVersion: 1,
      id: 'faction-override',
      displayName: 'Faction override',
      mapId: 'lab-grid',
      units: [
        {
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
          factionId: 'gravemark',
        },
      ],
      buildings: [],
    });
    sim.step();
    const snapshot = sim.buildSnapshot();
    expect(snapshot.payload[5]).toBe(1);
  });

  it('applies L-shaped blockedCellMask on place and remove', () => {
    const pack = createTestPackV2();
    const lShaped = {
      ...pack.buildings[0]!,
      id: 'l-hall',
      footprint: { kind: 'rect' as const, cellsW: 2, cellsH: 2 },
      blockedCellMask: [
        [true, false],
        [true, true],
      ],
    };
    const customPack = createTestPackV2();
    customPack.buildings.push(lShaped);
    const nav = new StubNavigationService();
    nav.resize(32, 32);
    const sim = new Simulation({
      pack: customPack,
      nav,
      cellsX: 32,
      cellsZ: 32,
    });
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'place-l',
        payload: {
          kind: 'placeBuilding',
          archetypeId: 'l-hall',
          originCell: { cx: 6, cz: 6 },
        },
      }),
    );
    sim.step();
    expect(nav.isWalkable(6, 6)).toBe(false);
    expect(nav.isWalkable(7, 6)).toBe(true);
    expect(nav.isWalkable(6, 7)).toBe(false);
    expect(nav.isWalkable(7, 7)).toBe(false);
    const buildingId = sim.getCommandLog()[0]?.result.spawnedId as EntityId;
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'remove-l',
        executeTick: 1,
        payload: { kind: 'removeBuilding', entityId: buildingId },
      }),
    );
    sim.step();
    expect(nav.isWalkable(6, 6)).toBe(true);
    expect(nav.isWalkable(7, 6)).toBe(true);
  });
});

describe('determinism and replay', () => {
  it('repeated run produces identical checksums', () => {
    const pack = createTestPackV2();
    const commands: CommandEnvelopeV1[] = [
      spawnCommand({
        commandId: 'spawn-a',
        executeTick: 0,
        sequence: 0,
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
        },
      }),
      spawnCommand({
        commandId: 'spawn-b',
        executeTick: 0,
        sequence: 1,
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'gravemark-raider',
          position: { x: 3072, z: 3072 },
        },
      }),
      spawnCommand({
        commandId: 'move-a',
        executeTick: 2,
        payload: {
          kind: 'move',
          entityIds: [{ index: 0, generation: 1 }],
          destination: { x: 5120, z: 5120 },
          formation: { kind: 'line', spacingSubunits: 256 },
        },
      }),
      spawnCommand({
        commandId: 'place-b',
        executeTick: 10,
        payload: {
          kind: 'placeBuilding',
          archetypeId: 'gravemark-bastion',
          originCell: { cx: 8, cz: 8 },
        },
      }),
    ];

    const { identical, first, second } = assertDeterministicReplay({
      pack,
      navFactory: () => new StubNavigationService(),
      commands,
      totalTicks: 200,
      simulationConfig: { cellsX: 32, cellsZ: 32 },
    });

    expect(first.checksums.length).toBeGreaterThan(0);
    expect(identical).toBe(true);
    expect(second.checksums).toEqual(first.checksums);
  });

  it('replay reproduces the original checksum sequence', () => {
    const pack = createTestPackV2();
    const commands: CommandEnvelopeV1[] = [
      spawnCommand({
        commandId: 'spawn',
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 2048, z: 2048 },
        },
      }),
    ];

    const original = runSimulationReplay({
      pack,
      navFactory: () => new StubNavigationService(),
      commands,
      totalTicks: 50,
      simulationConfig: { cellsX: 32, cellsZ: 32 },
    });

    const replay = runSimulationReplay({
      pack,
      navFactory: () => new StubNavigationService(),
      commands,
      totalTicks: 50,
      simulationConfig: { cellsX: 32, cellsZ: 32 },
    });

    expect(replay.checksums).toEqual(original.checksums);
  });

  it('replayFromCommandLog applies recorded commands', () => {
    const pack = createTestPackV2();
    const commands: CommandEnvelopeV1[] = [
      spawnCommand({
        commandId: 'spawn',
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 2048, z: 2048 },
        },
      }),
    ];
    const replayConfig = {
      pack,
      navFactory: () => new StubNavigationService(),
      totalTicks: 50,
      simulationConfig: { cellsX: 32, cellsZ: 32 },
    };
    const original = runSimulationReplay({ ...replayConfig, commands });

    expect(
      replayFromCommandLog({
        ...replayConfig,
        commandLog: commands,
        recordedChecksums: original.checksums,
      }),
    ).toBe(true);
  });
});

describe('pause', () => {
  it('does not advance simulation while paused', () => {
    const sim = createSim();
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'spawn',
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
        },
      }),
    );
    sim.step();
    expect(sim.currentTick).toBe(1);

    sim.pause();
    sim.runTicks(10);
    expect(sim.currentTick).toBe(1);
    expect(sim.getChecksums().length).toBe(1);

    sim.resume();
    sim.step();
    expect(sim.currentTick).toBe(2);
  });
});

describe('command log', () => {
  it('is serializable', () => {
    const sim = createSim();
    sim.enqueueCommand(
      spawnCommand({
        commandId: 'spawn',
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 1024, z: 1024 },
        },
      }),
    );
    sim.step();
    const json = JSON.stringify(sim.getCommandLog());
    const parsed = JSON.parse(json) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe('entity pool generation', () => {
  it('never exposes generation 0 for live entities', () => {
    const pool = createEntityPool(2);
    const id = allocateEntity(pool);
    expect(id?.generation).toBeGreaterThan(0);
    expect(createEntityId(0, 0)).toEqual({ index: 0, generation: 0 });
  });
});
