import type {
  BuildingArchetype,
  CellCoord,
  CommandEnvelopeV1,
  CommandRejectReason,
  CommandResult,
  EntityId,
  Footprint,
  MoveFormation,
  PackV2,
  SubunitCoord,
  Tick,
  UnitArchetype,
} from '@pastel-rts/content-schema';
import { MOVE_FORMATION_KINDS, SUBUNITS_PER_CELL } from '@pastel-rts/content-schema';
import { isCellInBounds, isSubunitInBounds } from './checksum.js';
import type { EntityPool, EntitySlot } from './entityPool.js';
import { allocateEntity, releaseEntity, resolveEntity } from './entityPool.js';
import type { NavigationService } from './navigation.js';

export type CommandContext = {
  tick: Tick;
  pool: EntityPool;
  nav: NavigationService;
  pack: PackV2;
  cellsX: number;
  cellsZ: number;
  allowedPlayerIds: ReadonlySet<string>;
  localPlayerFactionId: 'sunweaver' | 'gravemark' | 'neutral';
};

function reject(commandId: string, reason: CommandRejectReason): CommandResult {
  return { type: 'commandResult', commandId, status: 'rejected', reason };
}

function accept(commandId: string, acceptedAtTick: Tick, spawnedId?: EntityId): CommandResult {
  const result: CommandResult = {
    type: 'commandResult',
    commandId,
    status: 'accepted',
    acceptedAtTick,
  };
  if (spawnedId !== undefined) {
    result.spawnedId = spawnedId;
  }
  return result;
}

function findUnitArchetype(pack: PackV2, id: string): UnitArchetype | undefined {
  return pack.units.find((unit) => unit.id === id && unit.enabled);
}

function findBuildingArchetype(pack: PackV2, id: string): BuildingArchetype | undefined {
  return pack.buildings.find((building) => building.id === id && building.enabled);
}

function footprintDimensions(footprint: Footprint): { cellsW: number; cellsH: number } {
  return { cellsW: footprint.cellsW, cellsH: footprint.cellsH };
}

function isFootprintPlaceable(
  ctx: CommandContext,
  origin: CellCoord,
  cellsW: number,
  cellsH: number,
): boolean {
  for (let dz = 0; dz < cellsH; dz += 1) {
    for (let dx = 0; dx < cellsW; dx += 1) {
      const cx = origin.cx + dx;
      const cz = origin.cz + dz;
      if (!isCellInBounds(cx, cz, ctx.cellsX, ctx.cellsZ)) {
        return false;
      }
      if (!ctx.nav.isWalkable(cx, cz)) {
        return false;
      }
    }
  }
  return true;
}

function validateFormation(formation: MoveFormation | undefined): boolean {
  if (formation === undefined) {
    return true;
  }
  if (!(MOVE_FORMATION_KINDS as readonly string[]).includes(formation.kind)) {
    return false;
  }
  if (formation.kind === 'line' || formation.kind === 'box') {
    return formation.spacingSubunits !== undefined && formation.spacingSubunits > 0;
  }
  return true;
}

function resolveAllUnits(
  ctx: CommandContext,
  entityIds: EntityId[],
): EntitySlot[] | CommandRejectReason {
  const slots: EntitySlot[] = [];
  for (const entityId of entityIds) {
    const resolved = resolveEntity(ctx.pool, entityId);
    if (resolved === 'stale' || resolved === 'invalid') {
      return 'stale-id';
    }
    if (resolved.kind !== 'unit') {
      return 'stale-id';
    }
    slots.push(resolved);
  }
  return slots;
}

export function applyCommand(ctx: CommandContext, envelope: CommandEnvelopeV1): CommandResult {
  if (!ctx.allowedPlayerIds.has(envelope.playerId)) {
    return reject(envelope.commandId, 'out-of-bounds');
  }

  switch (envelope.kind) {
    case 'spawnUnit':
      return applySpawnUnit(ctx, envelope);
    case 'removeEntity':
      return applyRemoveEntity(ctx, envelope);
    case 'move':
      return applyMove(ctx, envelope);
    case 'stop':
      return applyStop(ctx, envelope);
    case 'placeBuilding':
      return applyPlaceBuilding(ctx, envelope);
    case 'removeBuilding':
      return applyRemoveBuilding(ctx, envelope);
    default:
      return reject(envelope.commandId, 'out-of-bounds');
  }
}

function applySpawnUnit(ctx: CommandContext, envelope: CommandEnvelopeV1): CommandResult {
  if (envelope.payload.kind !== 'spawnUnit') {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  const archetype = findUnitArchetype(ctx.pack, envelope.payload.archetypeId);
  if (archetype === undefined) {
    return reject(envelope.commandId, 'unknown-archetype');
  }
  const { x, z } = envelope.payload.position;
  if (!isSubunitInBounds(x, z, ctx.cellsX, ctx.cellsZ)) {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  const id = allocateEntity(ctx.pool);
  if (id === null) {
    return reject(envelope.commandId, 'capacity');
  }
  const slot = resolveEntity(ctx.pool, id);
  if (slot === 'stale' || slot === 'invalid') {
    return reject(envelope.commandId, 'capacity');
  }
  slot.kind = 'unit';
  slot.archetypeId = archetype.id;
  slot.factionId = archetype.factionId;
  slot.x = x;
  slot.z = z;
  slot.headingMilli = envelope.payload.headingMilli ?? 0;
  slot.movementState = 'idle';
  slot.destination = null;
  slot.formation = null;
  slot.originCell = null;
  slot.footprintCellsW = 0;
  slot.footprintCellsH = 0;
  return accept(envelope.commandId, ctx.tick, id);
}

function applyRemoveEntity(ctx: CommandContext, envelope: CommandEnvelopeV1): CommandResult {
  if (envelope.payload.kind !== 'removeEntity') {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  const resolved = resolveEntity(ctx.pool, envelope.payload.entityId);
  if (resolved === 'stale' || resolved === 'invalid') {
    return reject(envelope.commandId, 'stale-id');
  }
  if (resolved.kind === 'building') {
    return reject(envelope.commandId, 'stale-id');
  }
  ctx.nav.cancel(envelope.payload.entityId);
  releaseEntity(ctx.pool, envelope.payload.entityId);
  return accept(envelope.commandId, ctx.tick);
}

function applyMove(ctx: CommandContext, envelope: CommandEnvelopeV1): CommandResult {
  if (envelope.payload.kind !== 'move') {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  if (envelope.payload.entityIds.length === 0) {
    return reject(envelope.commandId, 'stale-id');
  }
  const resolved = resolveAllUnits(ctx, envelope.payload.entityIds);
  if (typeof resolved === 'string') {
    return reject(envelope.commandId, resolved);
  }
  const destination = envelope.payload.destination;
  if (!isSubunitInBounds(destination.x, destination.z, ctx.cellsX, ctx.cellsZ)) {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  if (!validateFormation(envelope.payload.formation)) {
    return reject(envelope.commandId, 'out-of-bounds');
  }

  const formation = envelope.payload.formation ?? { kind: 'none' as const };
  const planned = ctx.nav.planFormation(envelope.payload.entityIds, destination, formation);
  const targets = new Map<string, SubunitCoord>();
  for (const slotPlan of planned) {
    targets.set(`${String(slotPlan.entityId.index)}:${String(slotPlan.entityId.generation)}`, slotPlan.target);
  }
  for (let index = 0; index < envelope.payload.entityIds.length; index += 1) {
    const entityId = envelope.payload.entityIds[index];
    const slot = resolved[index];
    if (entityId === undefined || slot === undefined) {
      continue;
    }
    const target = targets.get(`${String(entityId.index)}:${String(entityId.generation)}`) ?? destination;
    slot.movementState = 'move';
    slot.destination = { x: target.x, z: target.z };
    slot.formation = formation;
    ctx.nav.requestPath(entityId, { x: slot.x, z: slot.z }, target);
  }
  return accept(envelope.commandId, ctx.tick);
}

function applyStop(ctx: CommandContext, envelope: CommandEnvelopeV1): CommandResult {
  if (envelope.payload.kind !== 'stop') {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  const resolved = resolveAllUnits(ctx, envelope.payload.entityIds);
  if (typeof resolved === 'string') {
    return reject(envelope.commandId, resolved);
  }
  for (let index = 0; index < envelope.payload.entityIds.length; index += 1) {
    const entityId = envelope.payload.entityIds[index];
    const slot = resolved[index];
    if (entityId === undefined || slot === undefined) {
      continue;
    }
    ctx.nav.cancel(entityId);
    slot.movementState = 'idle';
    slot.destination = null;
    slot.formation = null;
  }
  return accept(envelope.commandId, ctx.tick);
}

function applyPlaceBuilding(ctx: CommandContext, envelope: CommandEnvelopeV1): CommandResult {
  if (envelope.payload.kind !== 'placeBuilding') {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  const archetype = findBuildingArchetype(ctx.pack, envelope.payload.archetypeId);
  if (archetype === undefined) {
    return reject(envelope.commandId, 'unknown-archetype');
  }
  const { cellsW, cellsH } = footprintDimensions(archetype.footprint);
  const origin = envelope.payload.originCell;
  if (!isFootprintPlaceable(ctx, origin, cellsW, cellsH)) {
    return reject(envelope.commandId, 'blocked');
  }
  const id = allocateEntity(ctx.pool);
  if (id === null) {
    return reject(envelope.commandId, 'capacity');
  }
  const slot = resolveEntity(ctx.pool, id);
  if (slot === 'stale' || slot === 'invalid') {
    return reject(envelope.commandId, 'capacity');
  }
  slot.kind = 'building';
  slot.archetypeId = archetype.id;
  slot.factionId = archetype.factionId;
  slot.x = origin.cx * SUBUNITS_PER_CELL + Math.floor(SUBUNITS_PER_CELL / 2);
  slot.z = origin.cz * SUBUNITS_PER_CELL + Math.floor(SUBUNITS_PER_CELL / 2);
  slot.headingMilli = envelope.payload.headingMilli ?? 0;
  slot.movementState = 'idle';
  slot.destination = null;
  slot.formation = null;
  slot.originCell = { cx: origin.cx, cz: origin.cz };
  slot.footprintCellsW = cellsW;
  slot.footprintCellsH = cellsH;
  ctx.nav.setFootprintBlocked(origin, cellsW, cellsH, true);
  return accept(envelope.commandId, ctx.tick, id);
}

function applyRemoveBuilding(ctx: CommandContext, envelope: CommandEnvelopeV1): CommandResult {
  if (envelope.payload.kind !== 'removeBuilding') {
    return reject(envelope.commandId, 'out-of-bounds');
  }
  const resolved = resolveEntity(ctx.pool, envelope.payload.entityId);
  if (resolved === 'stale' || resolved === 'invalid') {
    return reject(envelope.commandId, 'stale-id');
  }
  if (resolved.kind !== 'building' || resolved.originCell === null) {
    return reject(envelope.commandId, 'stale-id');
  }
  ctx.nav.setFootprintBlocked(
    resolved.originCell,
    resolved.footprintCellsW,
    resolved.footprintCellsH,
    false,
  );
  releaseEntity(ctx.pool, envelope.payload.entityId);
  return accept(envelope.commandId, ctx.tick);
}
