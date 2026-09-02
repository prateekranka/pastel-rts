import {
  COMMAND_PROTOCOL_VERSION,
  type CellCoord,
  type CommandEnvelopeV1,
  type CommandResult,
  type EntityId,
  type MoveFormation,
  type MovePayload,
  type PlaceBuildingPayload,
  type SpawnUnitPayload,
  type SubunitCoord,
  type Tick,
} from '@pastel-rts/content-schema';
import { LAB_LOCAL_PLAYER_ID } from './gestureConstants';

export type WorkerCommandMessage = {
  type: 'command';
  envelope: CommandEnvelopeV1;
};

export type WorkerInboundMessage = CommandResult | { type: string };

/** Minimal port surface for posting commands to the interaction-lab worker. */
export interface WorkerCommandPort {
  postMessage(message: WorkerCommandMessage): void;
}

export type CommandClientOptions = {
  port: WorkerCommandPort;
  playerId?: string;
  /** Returns monotonically increasing command ids. Defaults to lab-{n}. */
  createCommandId?: () => string;
};

/**
 * Serializes versioned {@link CommandEnvelopeV1} messages to the worker.
 * Does not start workers or mount canvases.
 */
export class CommandClient {
  private readonly port: WorkerCommandPort;
  private readonly playerId: string;
  private readonly createCommandId: () => string;
  private sequence = 0;
  private commandCounter = 0;

  constructor(options: CommandClientOptions) {
    this.port = options.port;
    this.playerId = options.playerId ?? LAB_LOCAL_PLAYER_ID;
    this.createCommandId =
      options.createCommandId ??
      (() => {
        this.commandCounter += 1;
        return `lab-${this.commandCounter}`;
      });
  }

  getNextSequence(): number {
    return this.sequence;
  }

  issueSpawnUnit(params: {
    archetypeId: string;
    position: SubunitCoord;
    issuedAtTick: Tick;
    executeTick: Tick;
    headingMilli?: number;
  }): CommandEnvelopeV1 {
    const payload: SpawnUnitPayload = {
      kind: 'spawnUnit',
      archetypeId: params.archetypeId,
      position: params.position,
    };
    if (params.headingMilli !== undefined) {
      payload.headingMilli = params.headingMilli;
    }
    return this.send('spawnUnit', payload, params.issuedAtTick, params.executeTick);
  }

  issueRemoveEntity(params: {
    entityId: EntityId;
    issuedAtTick: Tick;
    executeTick: Tick;
  }): CommandEnvelopeV1 {
    return this.send(
      'removeEntity',
      { kind: 'removeEntity', entityId: params.entityId },
      params.issuedAtTick,
      params.executeTick,
    );
  }

  issueMove(params: {
    entityIds: EntityId[];
    destination: SubunitCoord;
    issuedAtTick: Tick;
    executeTick: Tick;
    formation?: MoveFormation;
  }): CommandEnvelopeV1 {
    const payload: MovePayload = {
      kind: 'move',
      entityIds: params.entityIds,
      destination: params.destination,
    };
    if (params.formation !== undefined) {
      payload.formation = params.formation;
    }
    return this.send('move', payload, params.issuedAtTick, params.executeTick);
  }

  issueStop(params: {
    entityIds: EntityId[];
    issuedAtTick: Tick;
    executeTick: Tick;
  }): CommandEnvelopeV1 {
    return this.send(
      'stop',
      { kind: 'stop', entityIds: params.entityIds },
      params.issuedAtTick,
      params.executeTick,
    );
  }

  issuePlaceBuilding(params: {
    archetypeId: string;
    originCell: CellCoord;
    issuedAtTick: Tick;
    executeTick: Tick;
    headingMilli?: number;
  }): CommandEnvelopeV1 {
    const payload: PlaceBuildingPayload = {
      kind: 'placeBuilding',
      archetypeId: params.archetypeId,
      originCell: params.originCell,
    };
    if (params.headingMilli !== undefined) {
      payload.headingMilli = params.headingMilli;
    }
    return this.send('placeBuilding', payload, params.issuedAtTick, params.executeTick);
  }

  issueRemoveBuilding(params: {
    entityId: EntityId;
    issuedAtTick: Tick;
    executeTick: Tick;
  }): CommandEnvelopeV1 {
    return this.send(
      'removeBuilding',
      { kind: 'removeBuilding', entityId: params.entityId },
      params.issuedAtTick,
      params.executeTick,
    );
  }

  private send(
    kind: CommandEnvelopeV1['kind'],
    payload: CommandEnvelopeV1['payload'],
    issuedAtTick: Tick,
    executeTick: Tick,
  ): CommandEnvelopeV1 {
    const envelope: CommandEnvelopeV1 = {
      protocolVersion: COMMAND_PROTOCOL_VERSION,
      commandId: this.createCommandId(),
      sequence: this.sequence,
      issuedAtTick,
      executeTick,
      playerId: this.playerId,
      kind,
      payload,
    };
    this.sequence += 1;
    this.port.postMessage({ type: 'command', envelope });
    return envelope;
  }
}
