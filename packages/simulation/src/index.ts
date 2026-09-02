export {
  TICK_HZ,
  TICK_MS,
  DEFAULT_ENTITY_CAPACITY,
  DEFAULT_MAP_CELLS,
  INTERACTION_SNAPSHOT_STRIDE,
  SNAPSHOT_KIND_UNIT,
  SNAPSHOT_KIND_BUILDING,
  SNAPSHOT_ANIM_IDLE,
  SNAPSHOT_ANIM_MOVE,
  SNAPSHOT_RELATIONSHIP_FRIENDLY,
  SNAPSHOT_RELATIONSHIP_OPPOSING,
  SNAPSHOT_RELATIONSHIP_NEUTRAL,
  DEFAULT_PLAYER_ID,
  DEFAULT_CHECKSUM_INTERVAL,
} from './constants.js';

export type { NavigationService, NavCell, GridPath, PathId, NavDebugSnapshot } from './navigation.js';

export {
  createEntityPool,
  resolveEntity,
  allocateEntity,
  releaseEntity,
  forEachLiveEntity,
  entityIdFromSlot,
  isSameEntity,
} from './entityPool.js';
export type { EntityPool, EntitySlot, EntityKind, MovementState } from './entityPool.js';

export { computeStateChecksum, isSubunitInBounds, isCellInBounds } from './checksum.js';
export type { StateChecksum } from './checksum.js';

export {
  CommandQueue,
  compareCommands,
  serializeCommandLog,
} from './commandQueue.js';
export type { CommandLog, CommandLogEntry, PendingCommand } from './commandQueue.js';

export { applyCommand } from './commandHandler.js';
export type { CommandContext } from './commandHandler.js';

export { StubNavigationService } from './navStub.js';

export { Simulation } from './simulation.js';
export type { SimulationConfig, SimulationSnapshot } from './simulation.js';

export {
  runSimulationReplay,
  assertDeterministicReplay,
  replayFromCommandLog,
} from './replay.js';
export type { ReplayConfig, ReplayResult } from './replay.js';

export { createTestPackV2 } from './testFixtures.js';

export { SUBUNITS_PER_CELL } from '@pastel-rts/content-schema';
