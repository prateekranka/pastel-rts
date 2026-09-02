import type { CellCoord, SubunitCoord, Tick } from './coords';
import type { EntityId } from './ids';
import { isRecord, requireContentId, requireFiniteNumber, requireInt, requireNonNegativeInt, requireString } from './validation';

export const COMMAND_PROTOCOL_VERSION = 1 as const;

export type CommandKind =
  | 'spawnUnit'
  | 'removeEntity'
  | 'move'
  | 'stop'
  | 'placeBuilding'
  | 'removeBuilding';

export type SpawnUnitPayload = {
  kind: 'spawnUnit';
  archetypeId: string;
  position: SubunitCoord;
  headingMilli?: number;
};

export type RemoveEntityPayload = {
  kind: 'removeEntity';
  entityId: EntityId;
};

export type MovePayload = {
  kind: 'move';
  entityIds: EntityId[];
  destination: SubunitCoord;
};

export type StopPayload = {
  kind: 'stop';
  entityIds: EntityId[];
};

export type PlaceBuildingPayload = {
  kind: 'placeBuilding';
  archetypeId: string;
  originCell: CellCoord;
  headingMilli?: number;
};

export type RemoveBuildingPayload = {
  kind: 'removeBuilding';
  entityId: EntityId;
};

export type CommandPayload =
  | SpawnUnitPayload
  | RemoveEntityPayload
  | MovePayload
  | StopPayload
  | PlaceBuildingPayload
  | RemoveBuildingPayload;

export type CommandEnvelopeV1 = {
  protocolVersion: typeof COMMAND_PROTOCOL_VERSION;
  commandId: string;
  issuedAtTick: Tick;
  playerId: string;
  kind: CommandKind;
  payload: CommandPayload;
};

export type CommandResultStatus = 'accepted' | 'rejected';

export type CommandRejectReason =
  | 'stale-id'
  | 'blocked'
  | 'unknown-archetype'
  | 'out-of-bounds'
  | 'capacity';

export type CommandResult = {
  type: 'commandResult';
  commandId: string;
  status: CommandResultStatus;
  acceptedAtTick?: Tick;
  reason?: CommandRejectReason;
  spawnedId?: EntityId;
};

export function validateCommandEnvelope(value: unknown): CommandEnvelopeV1 {
  if (!isRecord(value)) {
    throw new Error('Command envelope must be an object');
  }
  if (value['protocolVersion'] !== COMMAND_PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocolVersion: ${String(value['protocolVersion'])}`);
  }
  const commandId = requireString(value['commandId'], 'commandId');
  const issuedAtTick = requireNonNegativeInt(value['issuedAtTick'], 'issuedAtTick');
  const playerId = requireString(value['playerId'], 'playerId');
  const kind = value['kind'];
  if (typeof kind !== 'string') {
    throw new Error('kind is required');
  }
  const payload = validateCommandPayload(value['payload'], kind);
  if (payload.kind !== kind) {
    throw new Error('payload.kind must match envelope kind');
  }
  return {
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    commandId,
    issuedAtTick,
    playerId,
    kind: kind as CommandKind,
    payload,
  };
}

export function validateCommandPayload(value: unknown, expectedKind?: string): CommandPayload {
  if (!isRecord(value)) {
    throw new Error('Command payload must be an object');
  }
  const kind = value['kind'];
  if (typeof kind !== 'string') {
    throw new Error('payload.kind is required');
  }
  if (expectedKind !== undefined && kind !== expectedKind) {
    throw new Error('payload.kind must match envelope kind');
  }
  switch (kind) {
    case 'spawnUnit':
      return validateSpawnUnitPayload(value);
    case 'removeEntity':
      return validateRemoveEntityPayload(value);
    case 'move':
      return validateMovePayload(value);
    case 'stop':
      return validateStopPayload(value);
    case 'placeBuilding':
      return validatePlaceBuildingPayload(value);
    case 'removeBuilding':
      return validateRemoveBuildingPayload(value);
    default:
      throw new Error(`Unknown command kind: ${kind}`);
  }
}

function validateSpawnUnitPayload(value: Record<string, unknown>): SpawnUnitPayload {
  const payload: SpawnUnitPayload = {
    kind: 'spawnUnit',
    archetypeId: requireContentId(value['archetypeId'], 'archetypeId'),
    position: parseSubunitCoord(value['position'], 'position'),
  };
  const headingMilli = value['headingMilli'];
  if (headingMilli !== undefined) {
    payload.headingMilli = requireInt(headingMilli, 'headingMilli');
  }
  return payload;
}

function validateRemoveEntityPayload(value: Record<string, unknown>): RemoveEntityPayload {
  return {
    kind: 'removeEntity',
    entityId: parseEntityId(value['entityId']),
  };
}

function validateMovePayload(value: Record<string, unknown>): MovePayload {
  const entityIdsValue = value['entityIds'];
  if (!Array.isArray(entityIdsValue)) {
    throw new Error('entityIds must be an array');
  }
  if (entityIdsValue.length === 0) {
    throw new Error('entityIds must not be empty');
  }
  return {
    kind: 'move',
    entityIds: entityIdsValue.map((entry) => parseEntityId(entry)),
    destination: parseSubunitCoord(value['destination'], 'destination'),
  };
}

function validateStopPayload(value: Record<string, unknown>): StopPayload {
  const entityIdsValue = value['entityIds'];
  if (!Array.isArray(entityIdsValue)) {
    throw new Error('entityIds must be an array');
  }
  if (entityIdsValue.length === 0) {
    throw new Error('entityIds must not be empty');
  }
  return {
    kind: 'stop',
    entityIds: entityIdsValue.map((entry) => parseEntityId(entry)),
  };
}

function validatePlaceBuildingPayload(value: Record<string, unknown>): PlaceBuildingPayload {
  const payload: PlaceBuildingPayload = {
    kind: 'placeBuilding',
    archetypeId: requireContentId(value['archetypeId'], 'archetypeId'),
    originCell: parseCellCoord(value['originCell'], 'originCell'),
  };
  const headingMilli = value['headingMilli'];
  if (headingMilli !== undefined) {
    payload.headingMilli = requireInt(headingMilli, 'headingMilli');
  }
  return payload;
}

function validateRemoveBuildingPayload(value: Record<string, unknown>): RemoveBuildingPayload {
  return {
    kind: 'removeBuilding',
    entityId: parseEntityId(value['entityId']),
  };
}

function parseEntityId(value: unknown): EntityId {
  if (!isRecord(value)) {
    throw new Error('entityId must be an object');
  }
  const index = requireNonNegativeInt(value['index'], 'entityId.index');
  const generation = requireInt(value['generation'], 'entityId.generation');
  if (generation <= 0) {
    throw new Error('entityId.generation must be > 0');
  }
  return { index, generation };
}

function parseSubunitCoord(value: unknown, label: string): SubunitCoord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    x: requireInt(value['x'], `${label}.x`),
    z: requireInt(value['z'], `${label}.z`),
  };
}

function parseCellCoord(value: unknown, label: string): CellCoord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    cx: requireNonNegativeInt(value['cx'], `${label}.cx`),
    cz: requireNonNegativeInt(value['cz'], `${label}.cz`),
  };
}
