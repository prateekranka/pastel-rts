export const ENTITY_KIND = {
  combat: 0,
  worker: 1,
  building: 2,
  prop: 3,
} as const;

export type EntityKind = (typeof ENTITY_KIND)[keyof typeof ENTITY_KIND];

export const FACTION = {
  friendly: 0,
  opposing: 1,
  neutral: 2,
} as const;

export type FactionId = (typeof FACTION)[keyof typeof FACTION];

/** Packed snapshot layout: x, z, heading, anim, kind, faction, hpDummy (unused). */
export const SNAPSHOT_STRIDE = 8;

export type SimCounts = {
  combat: number;
  workers: number;
  buildings: number;
  props: number;
};

export type SimInitMessage = {
  type: 'init';
  seed: number;
  counts: SimCounts;
  concentrate: boolean;
};

export type SimControlMessage =
  | SimInitMessage
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'setCounts'; counts: SimCounts; concentrate: boolean; seed: number }
  | { type: 'terminate' };

export type SimSnapshotMessage = {
  type: 'snapshot';
  tick: number;
  simTimeMs: number;
  producedAtMs: number;
  tickDurationMs: number;
  counts: SimCounts;
  /** Float32Array length = totalEntities * SNAPSHOT_STRIDE. */
  payload: Float32Array;
};

export function totalEntities(counts: SimCounts): number {
  return counts.combat + counts.workers + counts.buildings + counts.props;
}
