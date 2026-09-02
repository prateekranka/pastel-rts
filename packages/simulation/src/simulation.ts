import type {
  CommandEnvelopeV1,
  CommandResult,
  PackV2,
  ScenarioDef,
  Tick,
} from '@pastel-rts/content-schema';
import { SUBUNITS_PER_CELL, subunitToWorldFloat } from '@pastel-rts/content-schema';
import type { PlayableFactionId } from '@pastel-rts/content-schema';
import { computeStateChecksum, type StateChecksum } from './checksum.js';
import { applyCommand, type CommandContext } from './commandHandler.js';
import { CommandQueue, type CommandLog, type CommandLogEntry, serializeCommandLog } from './commandQueue.js';
import {
  DEFAULT_CHECKSUM_INTERVAL,
  DEFAULT_ENTITY_CAPACITY,
  DEFAULT_MAP_CELLS,
  DEFAULT_PLAYER_ID,
  INTERACTION_SNAPSHOT_STRIDE,
  SNAPSHOT_ANIM_IDLE,
  SNAPSHOT_ANIM_MOVE,
  SNAPSHOT_KIND_BUILDING,
  SNAPSHOT_KIND_UNIT,
  SNAPSHOT_RELATIONSHIP_FRIENDLY,
  SNAPSHOT_RELATIONSHIP_NEUTRAL,
  SNAPSHOT_RELATIONSHIP_OPPOSING,
  TICK_HZ,
  TICK_MS,
} from './constants.js';
import { createEntityPool, forEachLiveEntity } from './entityPool.js';
import type { NavigationService } from './navigation.js';

export type SimulationConfig = {
  pack: PackV2;
  nav: NavigationService;
  seed?: number;
  cellsX?: number;
  cellsZ?: number;
  entityCapacity?: number;
  checksumInterval?: number;
  allowedPlayerIds?: readonly string[];
  localPlayerFactionId?: PlayableFactionId;
};

export type SimulationSnapshot = {
  tick: Tick;
  simTimeMs: number;
  payload: Float32Array;
  entityCount: number;
};

const MILLI_RADIANS_PER_INDEX = Math.PI / 4;

function factionToRelationship(
  factionId: string,
  localPlayerFactionId: PlayableFactionId,
): number {
  if (factionId === 'neutral') {
    return SNAPSHOT_RELATIONSHIP_NEUTRAL;
  }
  if (factionId === localPlayerFactionId) {
    return SNAPSHOT_RELATIONSHIP_FRIENDLY;
  }
  return SNAPSHOT_RELATIONSHIP_OPPOSING;
}

function headingToFacingIndex(headingMilli: number): number {
  const radians = headingMilli / 1000;
  const normalized = ((radians % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / MILLI_RADIANS_PER_INDEX) % 8;
}

export class Simulation {
  readonly tickHz = TICK_HZ;
  readonly tickMs = TICK_MS;

  private tick = 0;
  private paused = false;
  private readonly pool;
  private readonly queue = new CommandQueue();
  private readonly nav: NavigationService;
  private readonly pack: PackV2;
  private readonly cellsX: number;
  private readonly cellsZ: number;
  private readonly checksumInterval: number;
  private readonly allowedPlayerIds: ReadonlySet<string>;
  private readonly localPlayerFactionId: PlayableFactionId;
  private readonly commandLog: CommandLog = [];
  private readonly checksums: StateChecksum[] = [];
  private readonly seed: number;

  constructor(config: SimulationConfig) {
    this.pack = config.pack;
    this.nav = config.nav;
    this.cellsX = config.cellsX ?? DEFAULT_MAP_CELLS;
    this.cellsZ = config.cellsZ ?? DEFAULT_MAP_CELLS;
    this.pool = createEntityPool(config.entityCapacity ?? DEFAULT_ENTITY_CAPACITY);
    this.checksumInterval = config.checksumInterval ?? DEFAULT_CHECKSUM_INTERVAL;
    this.allowedPlayerIds = new Set(config.allowedPlayerIds ?? [DEFAULT_PLAYER_ID]);
    this.localPlayerFactionId = config.localPlayerFactionId ?? 'sunweaver';
    this.seed = config.seed ?? 0;
    this.nav.resize(this.cellsX, this.cellsZ);
  }

  get currentTick(): Tick {
    return this.tick;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  enqueueCommand(envelope: CommandEnvelopeV1): void {
    this.queue.enqueue(envelope);
  }

  getCommandLog(): CommandLog {
    return serializeCommandLog(this.commandLog);
  }

  getChecksums(): readonly StateChecksum[] {
    return this.checksums;
  }

  loadScenario(scenario: ScenarioDef): void {
    for (const unitSpawn of scenario.units) {
      this.enqueueCommand({
        protocolVersion: 1,
        commandId: `scenario-unit-${unitSpawn.archetypeId}-${String(unitSpawn.position.x)}`,
        sequence: 0,
        issuedAtTick: 0,
        executeTick: 0,
        playerId: DEFAULT_PLAYER_ID,
        kind: 'spawnUnit',
        payload: {
          kind: 'spawnUnit',
          archetypeId: unitSpawn.archetypeId,
          position: unitSpawn.position,
          ...(unitSpawn.headingMilli !== undefined ? { headingMilli: unitSpawn.headingMilli } : {}),
        },
      });
    }
    for (const buildingSpawn of scenario.buildings) {
      this.enqueueCommand({
        protocolVersion: 1,
        commandId: `scenario-building-${buildingSpawn.archetypeId}-${String(buildingSpawn.originCell.cx)}`,
        sequence: 0,
        issuedAtTick: 0,
        executeTick: 0,
        playerId: DEFAULT_PLAYER_ID,
        kind: 'placeBuilding',
        payload: {
          kind: 'placeBuilding',
          archetypeId: buildingSpawn.archetypeId,
          originCell: buildingSpawn.originCell,
          ...(buildingSpawn.headingMilli !== undefined ? { headingMilli: buildingSpawn.headingMilli } : {}),
        },
      });
    }
  }

  /** Advance one tick: apply due commands, integrate movement, record checksum. */
  step(): void {
    if (this.paused) {
      return;
    }

    const ctx = this.createCommandContext();
    const due = this.queue.drainForTick(this.tick);
    for (const envelope of due) {
      const result = applyCommand(ctx, envelope);
      this.commandLog.push({ envelope, result });
    }

    this.integrateMovement();
    this.recordChecksumIfDue();
    this.tick += 1;
  }

  /** Run `count` ticks. */
  runTicks(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.step();
    }
  }

  /** Pack interaction-lab snapshot for the current tick. */
  buildSnapshot(): SimulationSnapshot {
    let entityCount = 0;
    forEachLiveEntity(this.pool, () => {
      entityCount += 1;
    });

    const payload = new Float32Array(entityCount * INTERACTION_SNAPSHOT_STRIDE);
    let writeIndex = 0;
    forEachLiveEntity(this.pool, (id, slot) => {
      const offset = writeIndex * INTERACTION_SNAPSHOT_STRIDE;
      payload[offset] = subunitToWorldFloat(slot.x);
      payload[offset + 1] = subunitToWorldFloat(slot.z);
      payload[offset + 2] = slot.headingMilli / 1000;
      payload[offset + 3] = slot.animPhase;
      payload[offset + 4] = slot.kind === 'unit' ? SNAPSHOT_KIND_UNIT : SNAPSHOT_KIND_BUILDING;
      payload[offset + 5] = factionToRelationship(slot.factionId, this.localPlayerFactionId);
      payload[offset + 6] = id.index;
      payload[offset + 7] = id.generation;
      payload[offset + 8] = slot.movementState === 'move' ? SNAPSHOT_ANIM_MOVE : SNAPSHOT_ANIM_IDLE;
      payload[offset + 9] = headingToFacingIndex(slot.headingMilli);
      payload[offset + 10] = 0;
      payload[offset + 11] = 0;
      writeIndex += 1;
    });

    return {
      tick: this.tick,
      simTimeMs: this.tick * TICK_MS,
      payload,
      entityCount,
    };
  }

  private createCommandContext(): CommandContext {
    return {
      tick: this.tick,
      pool: this.pool,
      nav: this.nav,
      pack: this.pack,
      cellsX: this.cellsX,
      cellsZ: this.cellsZ,
      allowedPlayerIds: this.allowedPlayerIds,
      localPlayerFactionId: this.localPlayerFactionId,
    };
  }

  private integrateMovement(): void {
    forEachLiveEntity(this.pool, (id, slot) => {
      if (slot.kind !== 'unit' || slot.movementState !== 'move') {
        return;
      }
      const unitArchetype = this.pack.units.find((unit) => unit.id === slot.archetypeId);
      const speed = unitArchetype?.movement.speedSubunitsPerTick ?? 64;
      const waypoint = this.nav.nextWaypoint(id);
      if (waypoint === null) {
        slot.movementState = 'idle';
        slot.destination = null;
        slot.formation = null;
        return;
      }

      const dx = waypoint.x - slot.x;
      const dz = waypoint.z - slot.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance <= speed) {
        slot.x = waypoint.x;
        slot.z = waypoint.z;
        slot.headingMilli = Math.round(Math.atan2(dx, dz) * 1000);
        this.nav.cancel(id);
        slot.movementState = 'idle';
        slot.destination = null;
        slot.formation = null;
      } else {
        const scale = speed / distance;
        slot.x += Math.round(dx * scale);
        slot.z += Math.round(dz * scale);
        slot.headingMilli = Math.round(Math.atan2(dx, dz) * 1000);
      }
      slot.animPhase = (slot.animPhase + 1 / 12) % 1;
    });
  }

  private recordChecksumIfDue(): void {
    if (this.checksumInterval <= 0) {
      return;
    }
    if (this.tick % this.checksumInterval !== 0) {
      return;
    }
    this.checksums.push(computeStateChecksum(this.tick, this.pool, this.nav));
  }
}

export type { CommandLogEntry, CommandResult, StateChecksum };
