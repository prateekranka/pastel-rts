/** Simulation tick rate (matches Milestone 0 worker cadence). */
export const TICK_HZ = 20 as const;

/** Milliseconds per simulation tick. */
export const TICK_MS = 50 as const;

/** Recommended lab entity pool capacity (independent of M0 stress counts). */
export const DEFAULT_ENTITY_CAPACITY = 512 as const;

/** Default map size in cells (Milestone 0 map). */
export const DEFAULT_MAP_CELLS = 160 as const;

/**
 * Interaction-lab snapshot stride (world floats at worker boundary).
 *
 * | Offset | Content |
 * | --- | --- |
 * | 0–1 | x, z world floats |
 * | 2 | heading radians |
 * | 3 | anim phase 0..1 |
 * | 4 | kind (0 unit, 1 building, 2 reserved) |
 * | 5 | relationship enum (0 friendly, 1 opposing, 2 neutral) |
 * | 6–7 | entity index, generation |
 * | 8 | anim state (0 idle, 1 move) |
 * | 9 | facing index 0..7 |
 * | 10–11 | reserved |
 */
export const INTERACTION_SNAPSHOT_STRIDE = 12 as const;

export const SNAPSHOT_KIND_UNIT = 0 as const;
export const SNAPSHOT_KIND_BUILDING = 1 as const;

export const SNAPSHOT_ANIM_IDLE = 0 as const;
export const SNAPSHOT_ANIM_MOVE = 1 as const;

export const SNAPSHOT_RELATIONSHIP_FRIENDLY = 0 as const;
export const SNAPSHOT_RELATIONSHIP_OPPOSING = 1 as const;
export const SNAPSHOT_RELATIONSHIP_NEUTRAL = 2 as const;

/** Default local sandbox player id. */
export const DEFAULT_PLAYER_ID = 'lab-local' as const;

/** Default checksum interval in ticks (every tick when set to 1). */
export const DEFAULT_CHECKSUM_INTERVAL = 1 as const;
