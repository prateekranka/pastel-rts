import type { CellCoord, SubunitCoord, Tick } from './coords';
import type { EntityId } from './ids';
import { isRecord, requireContentId, requireInt, requireNonNegativeInt, requireString } from './validation';

/** Wire protocol version. User-spec name `schemaVersion` is accepted as an alias. */
export const COMMAND_PROTOCOL_VERSION = 1 as const;
export const COMMAND_SCHEMA_VERSION = COMMAND_PROTOCOL_VERSION;

export const MOVE_FORMATION_KINDS = ['none', 'line', 'box'] as const;
export type MoveFormationKind = (typeof MOVE_FORMATION_KINDS)[number];

export type MoveFormation = {
  kind: MoveFormationKind;
  spacingSubunits?: number;
};

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
  formation?: MoveFormation;
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
  /** Same-tick ordering. Lower sequence applies first. */
  sequence: number;
  issuedAtTick: Tick;
  /** Tick the worker should apply the command. Must be >= issuedAtTick. */
  executeTick: Tick;
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
  const protocolVersion = value['protocolVersion'];
  const schemaVersion = value['schemaVersion'];
  if (protocolVersion === undefined && schemaVersion === undefined) {
    throw new Error('protocolVersion is required');
  }
  if (protocolVersion !== undefined && protocolVersion !== COMMAND_PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocolVersion: ${String(protocolVersion)}`);
  }
  if (schemaVersion !== undefined && schemaVersion !== COMMAND_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(schemaVersion)}`);
  }
  const commandId = requireString(value['commandId'], 'commandId');
  const sequence = requireNonNegativeInt(value['sequence'], 'sequence');
  const issuedAtTick = requireNonNegativeInt(value['issuedAtTick'], 'issuedAtTick');
  const executeTick = requireNonNegativeInt(value['executeTick'], 'executeTick');
  if (executeTick < issuedAtTick) {
    throw new Error('executeTick must be >= issuedAtTick');
  }
  const playerId = requireString(value['playerId'], 'playerId');
  const kindValue = value['kind'];
  const typeValue = value['type'];
  const kindRaw = kindValue ?? typeValue;
  if (typeof kindRaw !== 'string') {
    throw new Error('kind is required');
  }
  if (kindValue !== undefined && typeValue !== undefined && kindValue !== typeValue) {
    throw new Error('type must match kind');
  }
  const payload = validateCommandPayload(value['payload'], kindRaw);
  if (payload.kind !== kindRaw) {
    throw new Error('payload.kind must match envelope kind');
  }
  return {
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    commandId,
    sequence,
    issuedAtTick,
    executeTick,
    playerId,
    kind: kindRaw as CommandKind,
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
  const payload: MovePayload = {
    kind: 'move',
    entityIds: entityIdsValue.map((entry) => parseEntityId(entry)),
    destination: parseSubunitCoord(value['destination'], 'destination'),
  };
  const formation = parseOptionalFormation(value['formation']);
  if (formation !== undefined) {
    payload.formation = formation;
  }
  return payload;
}

function parseOptionalFormation(value: unknown): MoveFormation | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('formation must be an object');
  }
  const kind = value['kind'];
  if (typeof kind !== 'string' || !(MOVE_FORMATION_KINDS as readonly string[]).includes(kind)) {
    throw new Error('formation.kind must be none, line, or box');
  }
  const formation: MoveFormation = { kind: kind as MoveFormationKind };
  const spacingSubunits = value['spacingSubunits'];
  if (spacingSubunits !== undefined) {
    formation.spacingSubunits = requireNonNegativeInt(spacingSubunits, 'formation.spacingSubunits');
  }
  return formation;
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
